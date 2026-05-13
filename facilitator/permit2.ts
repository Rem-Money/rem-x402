import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type {
  PaymentPayload,
  PaymentAccept,
  Permit2Authorization,
} from "@poc/shared";
import { ERC20_ABI, X402_EXACT_PERMIT2_PROXY_ABI } from "./abi.js";
import {
  RPC_URL,
  SETTLEMENT_PRIVATE_KEY,
  TOKEN_CONFIG,
  PERMIT2_ADDRESS,
  X402_EXACT_PERMIT2_PROXY,
} from "./config.js";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const settlementAccount = privateKeyToAccount(SETTLEMENT_PRIVATE_KEY);
const walletClient = createWalletClient({
  account: settlementAccount,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

export async function verifyPermit2(
  payload: PaymentPayload,
  requirements: PaymentAccept
): Promise<{ isValid: boolean; invalidReason?: string }> {
  const auth = payload.payload.authorization as Permit2Authorization;

  if (auth.witness.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { isValid: false, invalidReason: "Recipient mismatch" };
  }

  if (BigInt(auth.amount) < BigInt(requirements.amount)) {
    return { isValid: false, invalidReason: "Insufficient payment amount" };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(auth.deadline) <= now) {
    return { isValid: false, invalidReason: "Permit expired" };
  }

  const balance = await publicClient.readContract({
    address: TOKEN_CONFIG.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [auth.from],
  });

  if (balance < BigInt(requirements.amount)) {
    return { isValid: false, invalidReason: "Insufficient token balance" };
  }

  const allowance = await publicClient.readContract({
    address: TOKEN_CONFIG.address,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [auth.from, PERMIT2_ADDRESS],
  });

  if (allowance < BigInt(requirements.amount)) {
    return {
      isValid: false,
      invalidReason:
        "Insufficient Permit2 allowance. Payer must approve Permit2 first.",
    };
  }

  return { isValid: true };
}

export async function settlePermit2(
  payload: PaymentPayload,
  requirements: PaymentAccept
): Promise<{
  success: boolean;
  transaction?: `0x${string}`;
  payer?: `0x${string}`;
  error?: string;
}> {
  const auth = payload.payload.authorization as Permit2Authorization;

  const permit = {
    permitted: {
      token: auth.token,
      amount: BigInt(auth.amount),
    },
    nonce: BigInt(auth.nonce),
    deadline: BigInt(auth.deadline),
  };

  const witness = {
    to: auth.witness.to,
    validAfter: BigInt(auth.witness.validAfter),
  };

  try {
    const hash = await walletClient.writeContract({
      address: X402_EXACT_PERMIT2_PROXY,
      abi: X402_EXACT_PERMIT2_PROXY_ABI,
      functionName: "settle",
      args: [permit, auth.from, witness, payload.payload.signature],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "reverted") {
      return { success: false, error: "Transaction reverted" };
    }

    return { success: true, transaction: hash, payer: auth.from };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
