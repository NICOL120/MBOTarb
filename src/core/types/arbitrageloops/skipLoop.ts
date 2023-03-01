import { AccountData } from "@cosmjs/amino";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { EncodeObject } from "@cosmjs/proto-signing";
import { SignerData } from "@cosmjs/stargate";
import { createJsonRpcRequest } from "@cosmjs/tendermint-rpc/build/jsonrpc";
import { SkipBundleClient } from "@skip-mev/skipjs";
import { WebClient } from "@slack/web-api";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { OptimalTrade } from "../../arbitrage/arbitrage";
import { Logger } from "../../logging";
import { BotClients } from "../../node/chainoperator";
import { SkipResult } from "../../node/skipclients";
import { BotConfig } from "../base/botConfig";
import { LogType } from "../base/logging";
import { processMempool } from "../base/mempool";
import { Path } from "../base/path";
import { applyMempoolTradesOnPools, Pool } from "../base/pool";
import { MempoolLoop } from "./mempoolLoop";

/**
 *
 */
export class SkipLoop extends MempoolLoop {
	skipClient: SkipBundleClient;
	skipSigner: DirectSecp256k1HdWallet;
	slackLogger: WebClient | undefined;
	logger: Logger | undefined;

	/**
	 *
	 */
	public constructor(
		pools: Array<Pool>,
		paths: Array<Path>,
		arbitrage: (paths: Array<Path>, botConfig: BotConfig) => OptimalTrade | undefined,
		updateState: (botclients: BotClients, pools: Array<Pool>) => void,
		messageFunction: (
			arbTrade: OptimalTrade,
			walletAddress: string,
			flashloanRouterAddress: string,
		) => [Array<EncodeObject>, number],
		botClients: BotClients,
		account: AccountData,
		botConfig: BotConfig,
		skipClient: SkipBundleClient,
		skipSigner: DirectSecp256k1HdWallet,
		logger: Logger | undefined,
	) {
		super(pools, paths, arbitrage, updateState, messageFunction, botClients, account, botConfig, logger);
		(this.skipClient = skipClient), (this.skipSigner = skipSigner), (this.logger = logger);
	}

	/**
	 *
	 */
	public async step(): Promise<void> {
		this.iterations++;
		this.updateStateFunction(this.botClients, this.pools);
		const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);

		if (arbTrade) {
			console.log("state arb", arbTrade);
			arbTrade.path.cooldown = 5;
			await this.skipTrade(arbTrade);
		}
		while (true) {
			try {
				const mempoolResult = await this.botClients.HttpClient.execute(createJsonRpcRequest("unconfirmed_txs"));
				this.mempool = mempoolResult.result;
			} catch (e) {
				console.log("query error");
				console.log("waiting...");
				await delay(20000);
			}

			if (+this.mempool.total_bytes < this.totalBytes) {
				break;
			} else if (+this.mempool.total_bytes === this.totalBytes) {
				continue;
			} else {
				this.totalBytes = +this.mempool.total_bytes;
			}

			const mempoolTrades: Array<[MsgExecuteContract, Uint8Array]> = processMempool(this.mempool);
			if (mempoolTrades.length === 0) {
				continue;
			} else {
				for (const trade of mempoolTrades) {
					applyMempoolTradesOnPools(this.pools, [trade[0]]);
					const arbTrade: OptimalTrade | undefined = this.arbitrageFunction(this.paths, this.botConfig);
					if (arbTrade) {
						console.log("mev arb", arbTrade);
						arbTrade.path.cooldown = 5; //set the cooldown of this path to true so we dont trade it again in next callbacks
						await this.skipTrade(arbTrade, trade[1]);
					}
				}
			}
		}
	}

	/**
	 *
	 */
	private async skipTrade(arbTrade: OptimalTrade, toArbTradeBytes?: Uint8Array) {
		if (
			!this.botConfig.skipConfig?.useSkip ||
			this.botConfig.skipConfig?.skipRpcUrl === undefined ||
			this.botConfig.skipConfig?.skipBidRate === undefined ||
			this.botConfig.skipConfig?.skipBidWallet === undefined ||
			arbTrade.skipBid === undefined
		) {
			await this.logger?.sendMessage(
				"Please setup skip variables in the config environment file",
				LogType.Console,
			);
			return;
		}

		const bidMsg: MsgSend = MsgSend.fromJSON({
			fromAddress: this.account.address,
			toAddress: this.botConfig.skipConfig.skipBidWallet,
			amount: [
				{
					denom: this.botConfig.offerAssetInfo.native_token.denom,
					amount: String(Math.max(arbTrade.skipBid, 651)),
				},
			],
		});
		const bidMsgEncodedObject: EncodeObject = {
			typeUrl: "/cosmos.bank.v1beta1.MsgSend",
			value: bidMsg,
		};

		const signerData: SignerData = {
			accountNumber: this.accountNumber,
			sequence: this.sequence,
			chainId: this.chainid,
		};
		const [msgs, _] = this.messageFunction(arbTrade, this.account.address, this.botConfig.flashloanRouterAddress);
		// sign, encode and broadcast the transaction
		if (arbTrade.profit > 100000) {
			const txRawNoSkip = await this.botClients.SigningCWClient.sign(
				this.account.address,
				msgs,
				arbTrade.path.txFee,
				"memo",
				signerData,
			);
			const txBytes = TxRaw.encode(txRawNoSkip).finish();
			const sendResult = await this.botClients.TMClient.broadcastTxSync({ tx: txBytes });
			console.log("result no skip: ", sendResult);
		}
		msgs.push(bidMsgEncodedObject);

		const txRaw: TxRaw = await this.botClients.SigningCWClient.sign(
			this.account.address,
			msgs,
			arbTrade.path.txFee,
			"",
			signerData,
		);
		let res: SkipResult;
		if (toArbTradeBytes) {
			const txToArbRaw: TxRaw = TxRaw.decode(toArbTradeBytes);
			const signed = await this.skipClient.signBundle([txToArbRaw, txRaw], this.skipSigner, this.account.address);
			res = <SkipResult>await this.skipClient.sendBundle(signed, 0, true);
		} else {
			const signed = await this.skipClient.signBundle([txRaw], this.skipSigner, this.account.address);
			res = <SkipResult>await this.skipClient.sendBundle(signed, 0, true);
		}
		let logItem = "";
		let logMessage = `**wallet:** ${this.account.address}\t **block:** ${res.result.desired_height}\t **profit:** ${arbTrade.profit}`;

		if (res.result.code !== 0) {
			logMessage += `\t **error code:** ${res.result.code}\n**error:** ${res.result.error}\n`;
		}

		if (res.result.result_check_txs != undefined) {
			res.result.result_check_txs.map(async (item, idx) => {
				if (item["code"] != "0") {
					logItem = JSON.stringify(item);

					const logMessageCheckTx = `**CheckTx Error:** index: ${idx}\t ${String(item.log)}\n`;
					logMessage = logMessage.concat(logMessageCheckTx);
				}
			});
		}
		if (res.result.result_deliver_txs != undefined) {
			res.result.result_deliver_txs.map(async (item, idx) => {
				if (item["code"] != "0") {
					logItem = JSON.stringify(item);

					const logMessageDeliverTx = `**DeliverTx Error:** index: ${idx}\t ${String(item.log)}\n`;
					logMessage = logMessage.concat(logMessageDeliverTx);
				}
			});
		}

		await this.logger?.sendMessage(logMessage, LogType.All, res.result.code);

		if (logItem.length > 0) {
			await this.logger?.sendMessage(logItem, LogType.Console);
		}

		if (res.result.code === 0) {
			this.sequence += 1;
		}
		await delay(5000);
	}
}

/**
 *
 */
function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
