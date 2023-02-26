import { isSendMessage, SendMessage } from "./sendmessages";
import {
	DefaultSwapMessage,
	isDefaultSwapMessage,
	isJunoSwapMessage,
	isJunoSwapOperationsMessage,
	isSwapMessage,
	isSwapOperationsMessage,
	isTFMSwapOperationsMessage,
	JunoSwapMessage,
	JunoSwapOperationsMessage,
	SwapOperationsMessage,
	TFMSwapOperationsMessage,
} from "./swapmessages";
export enum TradeMessageType {
	SwapOperationsMessage = "SwapOperationsMessage",
	DefaultSwapMessage = "DefaultSwapMessage",
	SwapMessage = "SwapMessage",
	SendMessage = "SendMessage",
	JunoSwapMessage = "JunoSwapMessage",
	JunoSwapOperationsMessage = "JunoSwapOperationsMessage",
	TFMSwapOperationsMessage = "TFMSwapOperationsMessage",
	Unknown = "Unknown",
}
export type TradeMessage =
	| SwapOperationsMessage
	| DefaultSwapMessage
	| SendMessage
	| JunoSwapMessage
	| JunoSwapOperationsMessage
	| TFMSwapOperationsMessage;

/**
 *
 */
export function detectTradeMessageType(tradeMessage: TradeMessage): TradeMessageType {
	if (isDefaultSwapMessage(tradeMessage)) {
		return TradeMessageType.DefaultSwapMessage;
	} else if (isJunoSwapMessage(tradeMessage)) {
		return TradeMessageType.JunoSwapMessage;
	} else if (isSendMessage(tradeMessage)) {
		return TradeMessageType.SendMessage;
	} else if (isTFMSwapOperationsMessage(tradeMessage)) {
		return TradeMessageType.TFMSwapOperationsMessage;
	} else if (isJunoSwapOperationsMessage(tradeMessage)) {
		return TradeMessageType.JunoSwapOperationsMessage;
	} else if (isSwapOperationsMessage(tradeMessage)) {
		return TradeMessageType.SwapOperationsMessage;
	} else if (isSwapMessage(tradeMessage)) {
		return TradeMessageType.SwapMessage;
	} else {
		return TradeMessageType.Unknown;
	}
}
