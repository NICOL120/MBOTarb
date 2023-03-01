import { StdFee } from "@cosmjs/stargate";

import { getFlashArbMessage } from "../../../chains/defaults/messages/getFlashArbMessages";
import { Asset, AssetInfo } from "./asset";
import { BotConfig } from "./botConfig";
import { getAssetsOrder, Pool } from "./pool";

export interface Path {
	pools: Array<Pool>;
	cooldown: number;
	txFee: StdFee;
	profitThreshold: number;
	assetBalances: Array<Array<Asset>>;
}

/**
 *
 */
export function setPathFees(paths: Array<Path>, botConfig: BotConfig) {
	for (const path of paths) {
		const fakeOfferAsset = { amount: "1000000", info: botConfig.offerAssetInfo };
		const flashloanMessage = getFlashArbMessage(path, fakeOfferAsset);
		const nrOfWasms = flashloanMessage.flash_loan.msgs.length;
		const pathTxFee = botConfig.txFees.get(nrOfWasms);
		const profitThreshold = botConfig.profitThresholds.get(nrOfWasms);
		if (!pathTxFee || !profitThreshold) {
			console.log("cannot set tx fee or profit threshold for path");
			path.pools.map((pool) => console.log(pool.address));
			continue;
		}
		path.txFee = pathTxFee; //we use this to send message later on
		path.profitThreshold = profitThreshold; //we use this to calculate profit
	}
}

/**
 *
 */
export function setPathAssetOrder(paths: Array<Path>, botConfig: BotConfig) {
	for (const path of paths) {
		let offerAssetNext: AssetInfo = botConfig.offerAssetInfo;
		const assetBalances: Array<Array<Asset>> = [];
		for (let i = 0; i < path.pools.length; i++) {
			const [a_in, a_out] = getAssetsOrder(path.pools[i], offerAssetNext);
			offerAssetNext = a_out.info;
			assetBalances.push([a_in, a_out]);
		}
		path.assetBalances = assetBalances;
	}
}
