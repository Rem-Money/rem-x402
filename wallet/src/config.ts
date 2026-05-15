import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { createPublicClient, http, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

export const RPC_URL = process.env.RPC_URL!;
export const NETWORK = process.env.NETWORK || "eip155:84532";
export const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS! as `0x${string}`;
export const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL!;
export const TOKEN_NAME = process.env.TOKEN_NAME!;
export const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS!);
export const TOKEN_VERSION = process.env.TOKEN_VERSION || "1";
export const SERVER_URL = process.env.SERVER_URL || "http://localhost:4401";

export const PERMIT2_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const X402_PROXY =
  "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as `0x${string}`;

const CHAIN_MAP: Record<number, Chain> = {
  8453: base,
  84532: baseSepolia,
};

export const chainId = parseInt(NETWORK.split(":")[1]);
export const chain: Chain = CHAIN_MAP[chainId] ?? baseSepolia;

export const WALLET_DIR = resolve(process.env.HOME!, ".aud-wallet");
export const KEYSTORE_PATH = resolve(WALLET_DIR, "keystore.json");
export const ADDRESS_PATH = resolve(WALLET_DIR, "address");

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
