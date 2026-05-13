import "dotenv/config";
import type { TokenConfig } from "@poc/shared";

export const TOKEN_CONFIG: TokenConfig = {
  address: process.env.TOKEN_ADDRESS! as `0x${string}`,
  name: process.env.TOKEN_NAME!,
  symbol: process.env.TOKEN_SYMBOL!,
  decimals: Number(process.env.TOKEN_DECIMALS!),
  version: process.env.TOKEN_VERSION || "1",
  eip3009Enabled: process.env.EIP3009_ENABLED === "true",
};

export const SETTLEMENT_PRIVATE_KEY = process.env
  .SETTLEMENT_PRIVATE_KEY! as `0x${string}`;
export const RPC_URL = process.env.RPC_URL!;
export const NETWORK = process.env.NETWORK || "eip155:84532";
export const PORT = Number(process.env.FACILITATOR_PORT || 4402);

export const PERMIT2_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const X402_EXACT_PERMIT2_PROXY =
  "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as const;
