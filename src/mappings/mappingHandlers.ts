import {Wallet} from "../types/models/Wallet";

import {
    Transaction,
} from '../types/interfaces';

import {isHexString} from '@ethersproject/bytes';

import {SubstrateBlock, SubstrateExtrinsic} from "@subql/types";
import FrontierEvmDatasourcePlugin, { FrontierEvmCall } from "@subql/contract-processors/dist/frontierEvm";
import { 
    wrapExtrinsics,
    evmToNativeAddress
} from "../utils";

type TransferExtrinscArgs = [string, bigint] & { dest: string; value: bigint; };

/**
 * @fn substrate block handler
 * @param thisBlock substrate block
 */
export async function handleBlock(thisBlock: SubstrateBlock): Promise<void> {

    await extractBlockAsWallet(thisBlock);
}

/**
 * 
 * @param thisBlock block
 * @returns extract aggregate data from block
 */
async function extractBlockAsWallet(thisBlock: SubstrateBlock) :Promise<void>{

    const _wrapedExtinsics = wrapExtrinsics(thisBlock);
    const _nativeTransaction = _wrapedExtinsics.filter(
        (ext) => (
        /// withdraw evm to native wallet 
        ((ext.extrinsic.method.section === 'evm' && ext.extrinsic.method.method === 'withdraw'))
        /// native extrinsic
        ||(ext.extrinsic.method.section !== 'ethereum' || ext.extrinsic.method.method !== 'transact'))
    );
    const _evmTransaction = _wrapedExtinsics.filter(
        (ext) => ext.extrinsic.method.section === 'ethereum' && ext.extrinsic.method.method === 'transact'
    );
    for (let index = 0; index < _nativeTransaction.length; index++) {
        await fetchNativeWallet(_nativeTransaction[index]);
    }
    for (let index = 0; index < _evmTransaction.length; index++) {
        await fetchEvmWallet(_evmTransaction[index]);
    }
}

/**
 * 
 * @param _walletID wallet ID
 * @param _value transfer asset amount
 * @param _timestamp block timestamp
 * @param txhash transaction hash
 * @returns wallet entity
 */
async function fetchNativeWallet(_ext: SubstrateExtrinsic): Promise<void>{
    const modlPotStakeADDRESS = "YQnbw3h6couUX48Ghs3qyzhdbyxA3Gu9KQCoi8z2CPBf9N3";
    if(_ext.success){

        // logger.debug(_ext.extrinsic.signer.toString() + " " + _ext.extrinsic.method.method.toString());
        /// gas fee
        var _gasUsedCount = BigInt(0);
        _ext.events.forEach((evt)=>{
            const [address, balance] =  evt.event.data.toJSON() as [string, bigint];

            if(evt.event.method === "Deposit" && evt.event.section === "balances" && address === modlPotStakeADDRESS){
            _gasUsedCount += BigInt(balance);
            }
        })
        
        if("balances" === _ext.extrinsic.method.section ){
            /// balance : transfer sender to dest  
            const [dest, value] =  _ext.extrinsic.args as unknown as TransferExtrinscArgs;
            
            if(isHexString(dest.toString())){
            // TODO: public key to native address
            // const destSS58 = detriveAddress(dest.toString(), path ,42);
            // logger.debug("hex: " +_ext.extrinsic.signer.toString() + " -> " + dest.toString() +" " + value.toString());
            }
            
            let _sender: Wallet;
            let _destination: Wallet;
            if("transferAll" === _ext.extrinsic.method.method ){
                // get tx Sender
                _sender = await extractEventAsWalletAsset(
                    _ext.extrinsic.signer.toString(),
                    BigInt(0),
                    _ext.block.timestamp,
                    _ext.extrinsic.hash.toString()
                );

                let _amount: bigint = BigInt(0);
                if(0 < _sender.transaction.length){
                    _amount = BigInt(_sender.transaction[_sender.transaction.length - 1].amount);
                }
                // tx Sender
                _sender = await extractEventAsWalletAsset(
                    _ext.extrinsic.signer.toString(),
                    -_amount,
                    _ext.block.timestamp,
                    _ext.extrinsic.hash.toString()
                );

                // Destination
                _destination = await extractEventAsWalletAsset(
                    dest.toString(),
                    _amount,
                    _ext.block.timestamp,
                    _ext.extrinsic.hash.toString()
                );

                await _sender.save();
                await _destination.save();
            }
            else{
                // tx Sender
                _sender = await extractEventAsWalletAsset(
                    _ext.extrinsic.signer.toString(),
                    -BigInt(value.toString()) - _gasUsedCount,
                    _ext.block.timestamp,
                    _ext.extrinsic.hash.toString()
                );

                // Destination
                _destination = await extractEventAsWalletAsset(
                    dest.toString(),
                    BigInt(value.toString()),
                    _ext.block.timestamp,
                    _ext.extrinsic.hash.toString()
                );
                await _sender.save();
                await _destination.save();
            }

            // logger.debug("native transfer(" +_ext.block.block.header.number.toString() + ") :" + _ext.extrinsic.signer.toString() + " -> " + dest.toString() +" " + value.toString());

        }
        else if(_ext.extrinsic.method.section === 'evm' && _ext.extrinsic.method.method === 'withdraw'){
            /// evm withdraw 
            // logger.debug(_ext.extrinsic.signer.toString()); 

            const [address, value] =  _ext.extrinsic.args as unknown as TransferExtrinscArgs;
            const _evmWithdrawWallet = await extractEventAsWalletAsset(
                _ext.extrinsic.signer.toString(),
                BigInt(value.toString()) - _gasUsedCount,
                _ext.block.timestamp,
                _ext.extrinsic.hash.toString()
            );
            _evmWithdrawWallet.save();
            // logger.debug("evm withdraw: " + address + " -> " + _ext.extrinsic.signer.toString() +" " + value.toString());
        }
    }
}

/**
 * 
 * @param _walletID wallet ID
 * @param _value transfer asset amount
 * @param _timestamp block timestamp
 * @param txhash transaction hash
 * @returns wallet entity
 */
async function fetchEvmWallet(_ext: SubstrateExtrinsic): Promise<void>{
    const modlPotStakeADDRESS = "YQnbw3h6couUX48Ghs3qyzhdbyxA3Gu9KQCoi8z2CPBf9N3";
    const _evmCall: FrontierEvmCall = await FrontierEvmDatasourcePlugin.handlerProcessors['substrate/FrontierEvmCall'].transformer(_ext, {} as any, undefined, undefined) as any;
    if(_evmCall.success){
        
        // logger.debug(_ext.block.block.header.number);
        // logger.debug(_evmCall.from); 
        // logger.debug(_evmCall.to);  
        // logger.debug(_evmCall.value); 
        /// gas fee
        var _gasUsedCount = BigInt(0);
        _ext.events.forEach((evt)=>{
            const [address, balance] =  evt.event.data.toJSON() as [string, bigint];

            if(evt.event.method === "Deposit" && evt.event.section === "balances" && address === modlPotStakeADDRESS){
                _gasUsedCount += BigInt(balance);
            }
        })

        /// transfer : from to
        let _from = await extractEventAsWalletAsset(
            evmToNativeAddress(_evmCall.from), -_evmCall.value.toBigInt() - _gasUsedCount, _ext.block.timestamp, _evmCall.hash
        );
        _from.evmWallet = _evmCall.from;
        _from.isEvmWallet = true;
        await _from.save();

        if(BigInt(0) !== _evmCall.value.toBigInt()){
        // 
            let _to = await extractEventAsWalletAsset(
                evmToNativeAddress(_evmCall.to), _evmCall.value.toBigInt(), _ext.block.timestamp, _evmCall.hash
            );
            _to.evmWallet = _evmCall.to;
            _to.isEvmWallet = true;
            await _to.save();

            // logger.debug("evm transfer: " + _evmCall.from + "("+ evmToNativeAddress(_evmCall.from) + ")->" + _evmCall.to +" " + _evmCall.value.toString());
        }
    }
}

/**
 * 
 * @param _nativeWalletID Native wallet ID
 * @param _value transfer asset amount
 * @param _timestamp block timestamp
 * @param txhash transaction hash
 * @returns wallet entity
 */
async function extractEventAsWalletAsset(_nativeWalletID: string, _value: bigint, _timestamp: Date, txhash: string): Promise<Wallet>{
    let entity = await Wallet.get(_nativeWalletID);
    if (undefined === entity){
      //  {_walletID} is not registerd at database
        entity = createWallet(_nativeWalletID);
    }

    let _amount: bigint = BigInt(0);
    if(0 < entity.transaction.length){
        _amount = BigInt(entity.transaction[entity.transaction.length - 1].amount);
    }
    entity.transaction.push({
        amount: (_amount + _value).toString(),
        timestamp : _timestamp,
        txhash : txhash
    } as Transaction);

    return entity;
}

/**
 * 
 * @param accountID  key of new entity
 * @returns new entity
 */
function createWallet(accountID: string) :Wallet{
    const entity = new Wallet(accountID);
    entity.evmWallet = "0x";
    entity.isEvmWallet = false;
    entity.transaction = [];
    
    return entity
}
