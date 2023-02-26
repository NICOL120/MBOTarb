import { fromBase64 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { SendMessage } from "../messages/sendmessages";
import {
	DefaultSwapMessage,
	JunoSwapMessage,
	JunoSwapOperationsMessage,
	SwapOperationsMessage,
	TFMSwapOperationsMessage,
} from "../messages/swapmessages";
import { TradeMessageType } from "../messages/trademessages";
import { Asset } from "./asset";

export interface Mempool {
	n_txs: string;
	total: string;
	total_bytes: string;
	txs: Array<string>;
}
export interface MempoolTrade {
	contract: string;
	message:
		| DefaultSwapMessage
		| SwapOperationsMessage
		| SendMessage
		| JunoSwapMessage
		| TFMSwapOperationsMessage
		| JunoSwapOperationsMessage;
	offer_asset: Asset | undefined;
	txBytes: Uint8Array;
	tradeMessageType: TradeMessageType;
}

let txMemory: { [key: string]: boolean } = {};

/**
 *Flushes the already processed transactions from the mempool.
 */
export function flushTxMemory() {
	txMemory = {};
}

/**
 *
 */
export function showTxMemory() {
	console.log(Object.keys(txMemory).length);
}
/**
 *Filters the mempool for swaps, sends and swap operation messages.
 *@param mempool The mempool(state) to process.
 *@return An array of `MsgExecuteContract` paired with its raw tx bytes.
 */
export function processMempool(mempool: Mempool): Array<[MsgExecuteContract, Uint8Array]> {
	const mempoolTrades: Array<[MsgExecuteContract, Uint8Array]> = [];
	for (const tx of mempool.txs) {
		if (txMemory[tx] == true) {
			// the transaction is already processed and stored in the txMemory
			continue;
		}
		// set the transaction to processed in the txMemory
		txMemory[tx] = true;

		// decode transaction to readable object
		const txBytes = fromBase64(tx);
		const txRaw = decodeTxRaw(txBytes);
		for (const message of txRaw.body.messages) {
			try {
				if (message.typeUrl == "/cosmwasm.wasm.v1.MsgExecuteContract") {
					const msgExecuteContract: MsgExecuteContract = MsgExecuteContract.decode(message.value);
					mempoolTrades.push([msgExecuteContract, txBytes]);
				}
			} catch (e) {
				console.log("cannot decode mempool tx");
				console.log(message);
				console.log(e);
			}
		}
	}
	return mempoolTrades;
}
