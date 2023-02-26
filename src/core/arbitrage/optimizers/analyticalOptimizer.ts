import { Asset } from "../../types/base/asset";
import { BotConfig } from "../../types/base/botConfig";
import { Path } from "../../types/base/path";
import { outGivenIn } from "../../types/base/pool";
import { OptimalTrade } from "../arbitrage";

/** Function to calculate the optimal path, tradesize and profit given an Array of paths and a starting asset.
 * @param paths Type `Array<Path>` to check for arbitrage.
 * @param offerAssetInfo Type `AssetInfo` to start the arbitrage from.
 */
export function getOptimalTrade(paths: Array<Path>, botConfig: BotConfig): OptimalTrade | undefined {
	let maxTradesize = 0;
	let maxNetProfit = 0;
	let maxPath;
	let maxSkipBid;

	paths.map((path: Path) => {
		if (!path.cooldown) {
			const [tradesize, netProfit, skipBid] = getOptimalTradeForPath(path, botConfig);
			if (netProfit > maxNetProfit && tradesize > 0) {
				maxNetProfit = netProfit;
				maxTradesize = tradesize;
				maxPath = path;
				maxSkipBid = skipBid;
			}
		}
	});
	if (maxPath) {
		return {
			path: maxPath,
			offerAsset: { amount: String(maxTradesize), info: botConfig.offerAssetInfo },
			profit: maxNetProfit,
			skipBid: maxSkipBid,
		};
	} else {
		return undefined;
	}
}

/** Given an ordered route, calculate the optimal amount into the first pool that maximizes the profit of swapping through the route
*	Implements n-pool cylic arb from this paper: https://arxiv.org/abs/2105.02784.
*	Extends algo to have varying swap fees for each pool.
    @param path Path of type `Path` to calculate the optimal tradesize for.
	@param offerAssetInfo OfferAsset type `AssetInfo` from which the arbitrage path starts. 
    @returns [optimal tradesize, expected profit] for this particular path.
 */
export function getOptimalTradeForPath(path: Path, botConfig: BotConfig): [number, number, number | undefined] {
	// # Set the aprime_in and aprime_out to the first pool in the route
	let [aprime_in, aprime_out] = path.assetBalances[0].map((asset) => +asset.amount);

	// # Set the r1_first and r2_first to the first pool in the route
	const [r1_first, r2_first] = [1 - path.pools[0].inputfee / 100, 1 - path.pools[0].outputfee / 100];

	// # Iterate through the route
	for (let i = 1; i < path.assetBalances.length; i++) {
		// # Set the a_in and a_out to the current pool in the route
		const [a_in, a_out] = path.assetBalances[i].map((asset) => +asset.amount);
		// # Set the r1 and r2 to the current pool in the route
		const [r1, r2] = [1 - path.pools[i].inputfee / 100, 1 - path.pools[i].outputfee / 100];
		// # Calculate the aprime_in
		aprime_in = (aprime_in * a_in) / (a_in + r1 * r2 * aprime_out);
		// # Calculate the aprime_out
		aprime_out = (r1 * r2 * aprime_out * a_out) / (a_in + r1 * r2 * aprime_out);
	}
	// # Calculate the delta_a
	const delta_a = Math.floor((Math.sqrt(r1_first * r2_first * aprime_in * aprime_out) - aprime_in) / r1_first);

	let currentOfferAsset: Asset = { amount: String(delta_a), info: botConfig.offerAssetInfo };
	for (let i = 0; i < path.pools.length; i++) {
		const [outAmount, outInfo] = outGivenIn(path.pools[i], currentOfferAsset);
		currentOfferAsset = { amount: String(outAmount), info: outInfo };
	}
	const rawProfit = +currentOfferAsset.amount - delta_a;
	let netProfit;
	if (rawProfit < 0) {
		netProfit = rawProfit;
	} else {
		if (botConfig.skipConfig) {
			const skipBidRate = botConfig.skipConfig.skipBidRate;
			//Rawprofit - skipbid*Rawprofit - flashloanfee*tradesize - profitThreshold(including fees)
			const skipBid = Math.ceil((1 - skipBidRate) * rawProfit);
			netProfit = rawProfit - skipBid - (botConfig.flashloanFee / 100) * delta_a - path.profitThreshold;
			return [delta_a, Math.floor(netProfit), skipBid];
		} else {
			netProfit = rawProfit - (botConfig.flashloanFee / 100) * delta_a - path.profitThreshold;
		}
	}
	return [delta_a, Math.floor(netProfit), undefined];

	// # Return the floor of delta_a and the actual profit excluding a potential skip bid, this bid will be recalculated later
}
