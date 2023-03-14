import { BotClients } from "../../../core/node/chainoperator";
import { AmmDexName } from "../../../core/types/base/pool";

/**
 *
 */
export async function getPoolFees(botClients: BotClients, poolAddress: string, dexname: AmmDexName) {
	if (dexname === AmmDexName.default) {
		try {
			const wwPair: DefaultConfig = await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress, {
				config: {},
			});
			console.log(
				"WW Pool \n",
				"protocol fee: ",
				wwPair.pool_fees.protocol_fee.share,
				"lp fee: ",
				wwPair.pool_fees.swap_fee.share,
				"burn fee: ",
				wwPair.pool_fees.burn_fee.share,
			);
		} catch (e) {
			try {
				const loopConfig: LoopConfig = await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress, {
					query_config: {},
				});
				const loopCommission: LoopExtraCommissionInfo =
					await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress, {
						extra_commission_info: {},
					});
				console.log(
					"Loopswap Pool \n",
					"protocol fee: ",
					+loopConfig.commission_rate * (+loopCommission.fee_allocation / 100),
					"lp fee: ",
					+loopConfig.commission_rate - +loopConfig.commission_rate * (+loopCommission.fee_allocation / 100),
				);
			} catch (e) {
				//do nothing
			}
		}
	}
	if (dexname === AmmDexName.wyndex) {
		try {
			const wyndexPair: WyndexPair = await botClients.WasmQueryClient.wasm.queryContractSmart(poolAddress, {
				pair: {},
			});
			console.log(
				"Wyndex Pool \n",
				"protocol fee: ",
				Math.round(
					(wyndexPair.fee_config.total_fee_bps / 10000) *
						(wyndexPair.fee_config.protocol_fee_bps / 10000) *
						100000,
				) / 100000,
				"lp fee: ",
				wyndexPair.fee_config.total_fee_bps / 10000 -
					Math.round(
						(wyndexPair.fee_config.total_fee_bps / 10000) *
							(wyndexPair.fee_config.protocol_fee_bps / 10000) *
							100000,
					) /
						100000,
			);
		} catch (e) {
			console.log("not a wyndex pool");
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
				console.log(
					"Junoswap Pool \n",
					"protocol fee: ",
					+junoswapFees.protocol_fee_percent / 100,
					"lp fee: ",
					+junoswapFees.lp_fee_percent / 100,
				);
			} else {
				const hopersFee: HopersFees = <HopersFees>res;
				console.log("Hopers Pool \n", "protocol fee: ", +hopersFee.total_fee_percent + 0.005);
			}
		} catch (e) {
			console.log("cannot find fees for: ", poolAddress);
		}
	}
	return [0, 0, 0] as const;
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
