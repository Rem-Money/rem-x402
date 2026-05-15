import { formatEther, formatUnits } from "viem";
import { getAddress } from "./keystore.js";
import {
  publicClient,
  TOKEN_ADDRESS,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
  ERC20_ABI,
  chain,
} from "./config.js";

const address = getAddress();
if (!address) {
  console.log(
    JSON.stringify({ error: "No wallet found. Run 'aud wallet' first." }),
  );
  process.exit(1);
}

const [ethBalance, tokenBalance] = await Promise.all([
  publicClient.getBalance({ address: address as `0x${string}` }),
  publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  }),
]);

console.log(
  JSON.stringify({
    address,
    network: chain.name,
    eth: formatEther(ethBalance),
    ethRaw: ethBalance.toString(),
    token: formatUnits(tokenBalance, TOKEN_DECIMALS),
    tokenRaw: tokenBalance.toString(),
    tokenSymbol: TOKEN_SYMBOL,
  }),
);
