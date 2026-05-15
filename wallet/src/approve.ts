import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, parseAbi } from "viem";
import { decrypt } from "./keystore.js";
import {
  chain,
  RPC_URL,
  TOKEN_ADDRESS,
  TOKEN_SYMBOL,
  PERMIT2_ADDRESS,
  publicClient,
} from "./config.js";

const password = process.argv[2];
if (!password) {
  console.error(JSON.stringify({ error: "Password required as first argument" }));
  process.exit(1);
}

let privateKey: string;
try {
  privateKey = decrypt(password);
} catch {
  console.log(
    JSON.stringify({ error: "Wrong password or corrupted keystore" }),
  );
  process.exit(1);
}

const account = privateKeyToAccount(privateKey as `0x${string}`);

const ethBalance = await publicClient.getBalance({
  address: account.address,
});
if (ethBalance === 0n) {
  console.log(
    JSON.stringify({
      error: "no_eth",
      message:
        "No ETH for gas. Deposit ETH to your wallet before approving.",
      address: account.address,
    }),
  );
  process.exit(1);
}

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

const hash = await walletClient.writeContract({
  address: TOKEN_ADDRESS,
  abi: parseAbi([
    "function approve(address spender, uint256 amount) returns (bool)",
  ]),
  functionName: "approve",
  args: [PERMIT2_ADDRESS, 2n ** 256n - 1n],
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });

console.log(
  JSON.stringify({
    status: "approved",
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    token: TOKEN_ADDRESS,
    tokenSymbol: TOKEN_SYMBOL,
    spender: PERMIT2_ADDRESS,
  }),
);
