import { BotClients } from "../../../core/node/chainoperator";
import { AmmDexName } from "../../../core/types/base/pool";

/**
 *
 */
export async function getPoolFees(botClients: BotClients, poolAddress: string, dexname: AmmDexName, factory?: string) {
	if (dexname === AmmDexName.default) {
		try {
			const wwPair: DefaultConfig = await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress, {
				config: {},
			});
			const protocolFee = +wwPair.pool_fees.protocol_fee.share;
			const lpFee = +wwPair.pool_fees.swap_fee.share;
			const burnFee = wwPair.pool_fees.burn_fee.share;
			return [0, (protocolFee + lpFee) * 100, lpFee / (protocolFee + lpFee)];
		} catch (e) {
			try {
				const loopConfig: LoopConfig = await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress, {
					query_config: {},
				});
				const loopCommission: LoopExtraCommissionInfo =
					await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress, {
						extra_commission_info: {},
					});
				const protocolFee = +loopConfig.commission_rate * (+loopCommission.fee_allocation / 100);
				const lpFee =
					+loopConfig.commission_rate - +loopConfig.commission_rate * (+loopCommission.fee_allocation / 100);
				return [0, (protocolFee + lpFee) * 100, lpFee / (protocolFee + lpFee)];
			} catch (e) {
				try {
					if (factory) {
						const astroFees: AstroFees = await botClients.WasmQueryClient.wasm.queryContractSmart(factory, {
							fee_info: { pair_type: { xyk: {} } },
						});
						const protocolFee = ((astroFees.maker_fee_bps / 10000) * astroFees.total_fee_bps) / 100;
						const lpFee = (astroFees.total_fee_bps / 100) * (1 - astroFees.maker_fee_bps / 10000);
						console.log("astro pair");
						return [0, protocolFee + lpFee, lpFee / (protocolFee + lpFee)];
					}
				} catch (e) {
					//
				}
			}
		}
	}
	if (dexname === AmmDexName.wyndex) {
		try {
			const wyndexPair: WyndexPair = await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress, {
				pair: {},
			});
			const protocolFee =
				Math.round(
					(wyndexPair.fee_config.total_fee_bps / 10000) *
						(wyndexPair.fee_config.protocol_fee_bps / 10000) *
						100000,
				) / 100000;
			const lpFee =
				wyndexPair.fee_config.total_fee_bps / 10000 -
				Math.round(
					(wyndexPair.fee_config.total_fee_bps / 10000) *
						(wyndexPair.fee_config.protocol_fee_bps / 10000) *
						100000,
				) /
					100000;

			return [0, (protocolFee + lpFee) * 100, lpFee / (protocolFee + lpFee)];
		} catch (e) {
			//defaulting fees?
		}
	}
	if (dexname === AmmDexName.junoswap) {
		try {
			const res = await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress, {
				fee: {},
			});
			if (res["lp_fee_percent" as keyof typeof res] !== undefined) {
				// junoswap fees
				const junoswapFees: JunoswapFees = <JunoswapFees>res;
				const protocolFee = +junoswapFees.protocol_fee_percent / 100;
				const lpFee = +junoswapFees.lp_fee_percent / 100;
				return [(protocolFee + lpFee) * 100, 0, lpFee / (protocolFee + lpFee)];
			} else {
				const hopersFee: HopersFees = <HopersFees>res;
				const protocolFee = +hopersFee.total_fee_percent + 0.005;
				return [protocolFee * 100, 0, 0];
			}
		} catch (e) {
			console.log("cannot find fees for: ", poolAddress);
			console.log("defaulting to [0.3, 0, 1]");
			return [0.3, 0, 1];
		}
	}
	return [0, 0.3, 1] as const;
}

interface DefaultConfig {
	owner: string;
	fee_collector_addr: string;
	pool_fees: {
		protocol_fee: {
			share: string;
		};
		swap_fee: {
			share: string;
		};
		burn_fee: {
			share: string;
		};
	};
	feature_toggle: {
		withdrawals_enabled: boolean;
		deposits_enabled: boolean;
		swaps_enabled: boolean;
	};
}

interface LoopConfig {
	admin: string;
	commission_rate: string;
}

interface LoopExtraCommissionInfo {
	contract_addr: string;
	fee_allocation: string;
}

interface WyndexPair {
	asset_infos: Array<any>;
	contract_addr: string;
	liquidity_token: string;
	staking_addr: string;
	pair_type: any;
	fee_config: {
		total_fee_bps: number;
		protocol_fee_bps: number;
	};
}

interface HopersFees {
	owner: string;
	total_fee_percent: string;
	dev_wallet_lists: Array<Record<string, never>>;
}
interface JunoswapFees {
	owner: string;
	lp_fee_percent: string;
	protocol_fee_percent: string;
	protocol_fee_recipient: string;
}
interface AstroFees {
	fee_address: string;
	total_fee_bps: number;
	maker_fee_bps: number;
}
