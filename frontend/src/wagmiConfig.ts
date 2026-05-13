import type { Config } from "wagmi";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia } from "wagmi/chains";

export const wagmiConfig: Config = getDefaultConfig({
  appName: "x402 Payment Demo",
  projectId: "x402-poc-demo",
  chains: [baseSepolia],
});
