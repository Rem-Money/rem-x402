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

export const PAY_TO = process.env.PAY_TO_ADDRESS! as `0x${string}`;
export const NETWORK = process.env.NETWORK || "eip155:84532";
export const PRICE_AMOUNT = process.env.PRICE_AMOUNT!;
export const FACILITATOR_URL =
  process.env.FACILITATOR_URL || "http://localhost:4402";
export const PORT = Number(process.env.SERVER_PORT || 4401);
