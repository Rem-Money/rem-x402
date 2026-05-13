import type { Config } from "wagmi";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia } from "wagmi/chains";

export const wagmiConfig: Config = getDefaultConfig({
  appName: "x402 Payment Demo",
  projectId:
    import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "x402-poc-demo",
  chains: [baseSepolia, base],
});
