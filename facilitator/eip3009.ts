import {
  createPublicClient,
  createWalletClient,
  http,
  hexToSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type {
  PaymentPayload,
  PaymentAccept,
  EIP3009Authorization,
} from "@poc/shared";
import { ERC20_ABI } from "./abi.js";
import { RPC_URL, SETTLEMENT_PRIVATE_KEY, TOKEN_CONFIG } from "./config.js";

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

export async function verifyEIP3009(
  payload: PaymentPayload,
  requirements: PaymentAccept
): Promise<{ isValid: boolean; invalidReason?: string }> {
  const auth = payload.payload.authorization as EIP3009Authorization;

  if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { isValid: false, invalidReason: "Recipient mismatch" };
  }

  if (BigInt(auth.value) < BigInt(requirements.amount)) {
    return { isValid: false, invalidReason: "Insufficient payment amount" };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(auth.validBefore) <= now) {
    return { isValid: false, invalidReason: "Authorization expired" };
  }
  if (BigInt(auth.validAfter) > now) {
    return { isValid: false, invalidReason: "Authorization not yet valid" };
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

  const nonceUsed = await publicClient.readContract({
    address: TOKEN_CONFIG.address,
    abi: ERC20_ABI,
    functionName: "authorizationState",
    args: [auth.from, auth.nonce],
  });

  if (nonceUsed) {
    return { isValid: false, invalidReason: "Nonce already used" };
  }

  return { isValid: true };
}

export async function settleEIP3009(
  payload: PaymentPayload,
  requirements: PaymentAccept
): Promise<{
  success: boolean;
  transaction?: `0x${string}`;
  payer?: `0x${string}`;
  error?: string;
}> {
  const auth = payload.payload.authorization as EIP3009Authorization;
  const { v, r, s } = hexToSignature(payload.payload.signature);

  try {
    const hash = await walletClient.writeContract({
      address: TOKEN_CONFIG.address,
      abi: ERC20_ABI,
      functionName: "transferWithAuthorization",
      args: [
        auth.from,
        auth.to,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce,
        Number(v),
        r,
        s,
      ],
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
