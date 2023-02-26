import { fromAscii, fromBase64, fromUtf8 } from "@cosmjs/encoding";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { identity } from "../identity";
import { SendMessage } from "../messages/sendmessages";
import {
	DefaultSwapMessage,
	isAstroSwapOperationsMessages,
	isWWSwapOperationsMessages,
	isWyndDaoSwapOperationsMessages,
	JunoSwapMessage,
	JunoSwapOperationsMessage,
	SwapOperationsMessage,
	TFMSwapOperationsMessage,
} from "../messages/swapmessages";
import { detectTradeMessageType, TradeMessageType } from "../messages/trademessages";
import { Asset, AssetInfo, isMatchingAssetInfos, isWyndDaoNativeAsset, isWyndDaoTokenAsset } from "./asset";
import { Path } from "./path";
import { Uint128 } from "./uint128";

export enum AmmDexName {
	junoswap = "junoswap",
	default = "default",
	wyndex = "wyndex",
}
export enum ClobDexName {
	injective = "injective",
}
export interface Pool {
	/**
	 * The two assets that can be swapped between in the pool.
	 */
	assets: Array<Asset>;
	/**
	 * The total amount of LP tokens that exist.
	 */
	totalShare: Uint128;
	/**
	 * The address of the pool.
	 */
	address: string;

	dexname: AmmDexName;
	inputfee: number;
	outputfee: number;
	LPratio: number;
	factoryAddress: string;
	routerAddress: string;
}

/**
 * Function to calculate the expected received assets from a user perspective.
 * @param pool The pool to trade on.
 * @param offer_asset The offer asset the user wants to trade on the pool.
 * @return [number, assetInfo] of the received asset by the user.
 */
export function outGivenIn(pool: Pool, offer_asset: Asset): [number, AssetInfo] {
	const k = +pool.assets[0].amount * +pool.assets[1].amount;
	const [asset_in, asset_out] = getAssetsOrder(pool, offer_asset.info) ?? [];
	const a_in = +asset_in.amount;
	const a_out = +asset_out.amount;
	if (pool.inputfee > 0) {
		// pool uses inputfees
		const r1 = 1 - pool.inputfee / 100;
		const amount_in_after_fee = Math.floor(+offer_asset.amount * r1);
		const outGivenIn = Math.floor(a_out - k / (a_in + amount_in_after_fee));
		return [outGivenIn, asset_out.info];
	} else {
		const r2 = 1 - pool.outputfee / 100;
		const outGivenIn = Math.floor(r2 * Math.floor(a_out - k / (a_in + +offer_asset.amount)));
		return [outGivenIn, asset_out.info];
	}
}

/**
 * Function to apply a specific trade on a pool.
 * @param pool The pool to apply the trade on.
 * @param offer_asset The offer asset applied in the trade.
 */
function applyTradeOnPool(pool: Pool, offer_asset: Asset) {
	// K defines the constant product equilibrium
	const k = +pool.assets[0].amount * +pool.assets[1].amount;
	const [asset_in, asset_out] = getAssetsOrder(pool, offer_asset.info);
	if (!asset_in || !asset_out) {
		return;
	}
	const a_in = +asset_in.amount;
	const a_out = +asset_out.amount;

	// Check if pool uses input fees
	if (pool.inputfee > 0) {
		// Calculate the r1: the input fee as a rate
		const r1 = 1 - pool.inputfee / 100;

		// Calculate the input amount after the fee reduction
		const amount_in_after_fee = Math.floor(+offer_asset.amount * r1);

		// Calculate the LP_fee_amount, this value will stay in the pool as fee for the LP providers
		const lp_fee_amount = Math.floor((+offer_asset.amount - Math.floor(amount_in_after_fee)) * pool.LPratio);

		// Calculate the return amount based on the xy=k formula and offer_asset minus the fees
		const outGivenIn = Math.floor(a_out - k / (a_in + amount_in_after_fee));

		// Update the assets of the pool
		asset_in.amount = String(a_in + Math.floor(amount_in_after_fee) + lp_fee_amount);
		asset_out.amount = String(a_out - outGivenIn);
	} else {
		//If pool uses output fees, calculate the rate of the fees that actually leave the pool: e.g. if the fee is 0.3%, of which 0.2% is LP fee, only .1% of the
		// fees paid by the user actually leave the pool. The other .2% of the fees remains in the pool as fee for the LP providers
		const outflowReducer = 1 - (pool.outputfee * pool.LPratio) / 100;

		// Calculate return amount without deducting fees
		const outGivenIn = Math.floor(a_out - k / (a_in + +offer_asset.amount));

		// Update the assets of the pool
		asset_in.amount = String(a_in + +offer_asset.amount);

		// The outGivenIn amount is reduced with the outflowReducer
		asset_out.amount = String(a_out - Math.floor(outGivenIn * outflowReducer));
	}
}
/**
 * Function to apply the mempoolTrades derived from the mempool on the list of tracked pools.
 * @param pools The pools the bot is tracking.
 * @param mempool An array of MempoolTrades with relevant mempool messages.
 */
export function applyMempoolTradesOnPools(pools: Array<Pool>, mempoolTrades: Array<MsgExecuteContract>) {
	for (const msgExecuteContract of mempoolTrades) {
		let tradeMessage = JSON.parse(fromUtf8(msgExecuteContract.msg));
		const tradeMessageType = detectTradeMessageType(tradeMessage);
		if (tradeMessageType === TradeMessageType.Unknown) {
			continue;
		}
		switch (tradeMessageType) {
			case TradeMessageType.DefaultSwapMessage: {
				tradeMessage = identity<DefaultSwapMessage>(tradeMessage);
				const poolToUpdate = pools.find((pool) => msgExecuteContract.contract === pool.address);
				if (!poolToUpdate) {
					continue;
				}
				const offerAsset = tradeMessage.swap.offer_asset;
				//TODO: create types for assets
				if (isWyndDaoNativeAsset(offerAsset.info)) {
					offerAsset.info = { native_token: { denom: offerAsset.info.native } };
				}
				if (isWyndDaoTokenAsset(offerAsset.info)) {
					offerAsset.info = { token: { contract_addr: offerAsset.info.token } };
				}

				applyTradeOnPool(poolToUpdate, offerAsset);
				break;
			}
			case TradeMessageType.JunoSwapMessage: {
				tradeMessage = identity<JunoSwapMessage>(tradeMessage);
				const poolToUpdate = pools.find((pool) => msgExecuteContract.contract === pool.address);
				if (!poolToUpdate) {
					continue;
				}
				const offerAsset: Asset = {
					amount: tradeMessage.swap.input_amount,
					info:
						tradeMessage.swap.input_token === "Token1"
							? poolToUpdate.assets[0].info
							: poolToUpdate.assets[1].info,
				};
				applyTradeOnPool(poolToUpdate, offerAsset);
				break;
			}
			case TradeMessageType.SendMessage: {
				const innerTradeMessage = JSON.parse(fromAscii(fromBase64(tradeMessage.send.msg)));
				const innerTradeMessageType = detectTradeMessageType(innerTradeMessage);
				switch (innerTradeMessageType) {
					case TradeMessageType.SwapMessage: {
						const poolToUpdate = pools.find((pool) => tradeMessage.send.contract === pool.address);
						if (!poolToUpdate) {
							continue;
						}
						const offerAsset: Asset = {
							amount: tradeMessage.send.amount,
							info: { token: { contract_addr: msgExecuteContract.contract } },
						};
						applyTradeOnPool(poolToUpdate, offerAsset);
						break;
					}
					case TradeMessageType.SwapOperationsMessage:
						applySwapOperationsMessage(pools, undefined, msgExecuteContract);
						break;
				}
				break;
			}
			case TradeMessageType.TFMSwapOperationsMessage: {
				tradeMessage = identity<TFMSwapOperationsMessage>(tradeMessage);
				let offerAsset = {
					amount: tradeMessage.execute_swap_operations.offer_amount,
					info: tradeMessage.execute_swap_operations.routes[0].operations[0].t_f_m_swap.offer_asset_info,
				};
				for (const operation of tradeMessage.execute_swap_operations.routes[0].operations) {
					const currentPool = pools.find((pool) => pool.address === operation.t_f_m_swap.pair_contract);
					if (currentPool) {
						const [outGivenInNext, _] = outGivenIn(currentPool, offerAsset);
						applyTradeOnPool(currentPool, offerAsset);
						offerAsset = { amount: String(outGivenInNext), info: operation.ask_asset_info };
					}
				}
				break;
			}
			case TradeMessageType.JunoSwapOperationsMessage: {
				const poolToUpdate = pools.find((pool) => msgExecuteContract.contract === pool.address);
				if (!poolToUpdate) {
					break;
				}
				tradeMessage = identity<JunoSwapOperationsMessage>(tradeMessage);
				const offerAsset: Asset = {
					amount: tradeMessage.pass_through_swap.input_token_amount,
					info:
						tradeMessage.pass_through_swap.input_token === "Token1"
							? poolToUpdate.assets[0].info
							: poolToUpdate.assets[1].info,
				};
				applyTradeOnPool(poolToUpdate, offerAsset);

				// Second swap
				const [outGivenIn0, nextOfferAssetInfo] = outGivenIn(poolToUpdate, offerAsset);
				const secondPoolToUpdate = pools.find(
					(pool) => pool.address === tradeMessage.pass_through_swap.output_amm_address,
				);

				if (secondPoolToUpdate !== undefined) {
					applyTradeOnPool(secondPoolToUpdate, { amount: String(outGivenIn0), info: nextOfferAssetInfo });
				}
				break;
			}
			case TradeMessageType.SwapOperationsMessage: {
				tradeMessage = identity<SwapOperationsMessage>(tradeMessage);
				applySwapOperationsMessage(pools, msgExecuteContract, undefined);
				break;
			}
		}
	}
}

/**
 *
 */
function applySwapOperationsMessage(
	pools: Array<Pool>,
	defaultSwapOperations?: MsgExecuteContract,
	sendSwapOperations?: MsgExecuteContract,
) {
	let swapOperationsMessage: SwapOperationsMessage;
	let offerAmount;
	let routerAddress: string;
	if (sendSwapOperations) {
		// swap operations message nested in a send cw20 message
		const sendMsg: SendMessage = JSON.parse(fromUtf8(sendSwapOperations.msg));
		swapOperationsMessage = <SwapOperationsMessage>JSON.parse(fromAscii(fromBase64(sendMsg.send.msg)));
		offerAmount = sendMsg.send.amount;
		routerAddress = sendMsg.send.contract;
	} else if (defaultSwapOperations) {
		// swap operations message directly in msgExecuteContract
		swapOperationsMessage = <SwapOperationsMessage>JSON.parse(fromUtf8(defaultSwapOperations.msg));
		routerAddress = defaultSwapOperations.contract;
		offerAmount = defaultSwapOperations.funds[0].amount;
	} else {
		return;
	}

	// Detect which swapoperations dex
	const poolsFromThisRouter = pools.filter((pool) => routerAddress === pool.routerAddress);
	if (!poolsFromThisRouter) {
		return;
	} else {
		if (isWWSwapOperationsMessages(swapOperationsMessage.execute_swap_operations.operations)) {
			let offerAssetTrade: Asset = {
				amount: offerAmount,
				info: swapOperationsMessage.execute_swap_operations.operations[0].terra_swap.offer_asset_info,
			};
			for (const operation of swapOperationsMessage.execute_swap_operations.operations) {
				const currentPool = findPoolByInfos(
					poolsFromThisRouter,
					operation.terra_swap.offer_asset_info,
					operation.terra_swap.ask_asset_info,
				);
				if (currentPool !== undefined) {
					applyTradeOnPool(currentPool, offerAssetTrade);
					const receivedAmount = String(outGivenIn(currentPool, offerAssetTrade)[0]);
					offerAssetTrade = { amount: receivedAmount, info: operation.terra_swap.ask_asset_info };
				}
			}
		}
		if (isAstroSwapOperationsMessages(swapOperationsMessage.execute_swap_operations.operations)) {
			let offerAssetTrade: Asset = {
				amount: offerAmount,
				info: swapOperationsMessage.execute_swap_operations.operations[0].astro_swap.offer_asset_info,
			};
			for (const operation of swapOperationsMessage.execute_swap_operations.operations) {
				const currentPool = findPoolByInfos(
					poolsFromThisRouter,
					operation.astro_swap.offer_asset_info,
					operation.astro_swap.ask_asset_info,
				);
				if (currentPool !== undefined) {
					applyTradeOnPool(currentPool, offerAssetTrade);
					const receivedAmount = String(outGivenIn(currentPool, offerAssetTrade)[0]);
					offerAssetTrade = { amount: receivedAmount, info: operation.astro_swap.ask_asset_info };
				}
			}
		}
		if (isWyndDaoSwapOperationsMessages(swapOperationsMessage.execute_swap_operations.operations)) {
			const offerAssetInfoTrade = isWyndDaoNativeAsset(
				swapOperationsMessage.execute_swap_operations.operations[0].wyndex_swap.offer_asset_info,
			)
				? {
						native_token: {
							denom: swapOperationsMessage.execute_swap_operations.operations[0].wyndex_swap
								.offer_asset_info.native,
						},
				  }
				: {
						token: {
							contract_addr:
								swapOperationsMessage.execute_swap_operations.operations[0].wyndex_swap.offer_asset_info
									.token,
						},
				  };
			let offerAssetTrade: Asset = {
				amount: offerAmount,
				info: offerAssetInfoTrade,
			};

			for (const operation of swapOperationsMessage.execute_swap_operations.operations) {
				const askAssetInfo = isWyndDaoNativeAsset(operation.wyndex_swap.ask_asset_info)
					? { native_token: { denom: operation.wyndex_swap.ask_asset_info.native } }
					: { token: { contract_addr: operation.wyndex_swap.ask_asset_info.token } };
				const currentPool = findPoolByInfos(poolsFromThisRouter, offerAssetInfoTrade, askAssetInfo);
				if (currentPool !== undefined) {
					applyTradeOnPool(currentPool, offerAssetTrade);
					const [outGivenInNext, _] = outGivenIn(currentPool, offerAssetTrade);
					offerAssetTrade = { amount: String(outGivenInNext), info: askAssetInfo };
				}
			}
		}
	}
}
/**
 *
 */
function findPoolByInfos(pools: Array<Pool>, infoA: AssetInfo, infoB: AssetInfo) {
	const matchedPools = pools.filter(
		(pool) =>
			(isMatchingAssetInfos(pool.assets[0].info, infoA) && isMatchingAssetInfos(pool.assets[1].info, infoB)) ||
			(isMatchingAssetInfos(pool.assets[0].info, infoB) && isMatchingAssetInfos(pool.assets[1].info, infoA)),
	);
	return matchedPools[0];
}

/**
 *
 */
export function getAssetsOrder(pool: Pool, assetInfo: AssetInfo): [Asset, Asset] {
	if (isMatchingAssetInfos(pool.assets[0].info, assetInfo)) {
		return [pool.assets[0], pool.assets[1]];
	} else return [pool.assets[1], pool.assets[0]];
}

/**
 * Function to remove pools that are not used in paths.
 * @param pools Array of Pool types to check for filtering.
 * @param paths Array of Path types to check the pools against.
 * @returns Filtered array of Pools.
 */
export function removedUnusedPools(pools: Array<Pool>, paths: Array<Path>): Array<Pool> {
	const filteredPools: Set<Pool> = new Set(
		pools.filter((pool) => paths.some((path) => path.pools.some((pathPool) => pathPool.address === pool.address))),
	);
	return [...filteredPools];
}
