import { Asset } from "../types/base/asset";
import { BotConfig } from "../types/base/botConfig";
import { Path } from "../types/base/path";
import { getOptimalTrade } from "./optimizers/analyticalOptimizer";

export interface OptimalTrade {
	offerAsset: Asset;
	profit: number;
	path: Path;
	skipBid: number | undefined;
}
/**
 *
 */
export function trySomeArb(paths: Array<Path>, botConfig: BotConfig): OptimalTrade | undefined {
	const optimalTrade: OptimalTrade | undefined = getOptimalTrade(paths, botConfig);
	if (optimalTrade) {
		console.log("optimal trade");
		console.log(optimalTrade.offerAsset, optimalTrade.path.profitThreshold, optimalTrade.profit);
	}
	return optimalTrade;
}
