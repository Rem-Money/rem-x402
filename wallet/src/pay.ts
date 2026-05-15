import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "viem";
import { decrypt } from "./keystore.js";
import {
  publicClient,
  TOKEN_ADDRESS,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
  PERMIT2_ADDRESS,
  X402_PROXY,
  ERC20_ABI,
  chainId,
} from "./config.js";

const resourceUrl = process.argv[2];
const password = process.argv[3];

if (!resourceUrl || !password) {
  console.error(
    JSON.stringify({ error: "Usage: pay <resource-url> <password>" }),
  );
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

const initialRes = await fetch(resourceUrl);

if (initialRes.status !== 402) {
  let data: unknown;
  try {
    data = await initialRes.json();
  } catch {
    data = { raw: await initialRes.text() };
  }
  console.log(JSON.stringify({ status: "free", data }));
  process.exit(0);
}

const paymentRequiredHeader = initialRes.headers.get("PAYMENT-REQUIRED");
if (!paymentRequiredHeader) {
  console.log(
    JSON.stringify({ error: "402 response missing PAYMENT-REQUIRED header" }),
  );
  process.exit(1);
}

const paymentRequired = JSON.parse(atob(paymentRequiredHeader));
const accept = paymentRequired.accepts[0];
const method: string = accept.extra.assetTransferMethod;

const tokenBalance = await publicClient.readContract({
  address: TOKEN_ADDRESS,
  abi: ERC20_ABI,
  functionName: "balanceOf",
  args: [account.address],
});

const requiredAmount = BigInt(accept.amount);
if (tokenBalance < requiredAmount) {
  console.log(
    JSON.stringify({
      error: "insufficient_balance",
      message: `Insufficient ${TOKEN_SYMBOL} balance. Need ${formatUnits(requiredAmount, TOKEN_DECIMALS)}, have ${formatUnits(tokenBalance, TOKEN_DECIMALS)}`,
      required: formatUnits(requiredAmount, TOKEN_DECIMALS),
      available: formatUnits(tokenBalance, TOKEN_DECIMALS),
    }),
  );
  process.exit(1);
}

function randomBytes32(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

const now = BigInt(Math.floor(Date.now() / 1000));
let signature: `0x${string}`;
let authorization: Record<string, unknown>;

if (method === "eip3009") {
  const nonce = randomBytes32();
  authorization = {
    method: "eip3009",
    from: account.address,
    to: accept.payTo,
    value: accept.amount,
    validAfter: (now - 60n).toString(),
    validBefore: (now + BigInt(accept.maxTimeoutSeconds)).toString(),
    nonce,
  };

  signature = await account.signTypedData({
    domain: {
      name: accept.extra.name,
      version: accept.extra.version,
      chainId,
      verifyingContract: accept.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from as `0x${string}`,
      to: authorization.to as `0x${string}`,
      value: BigInt(authorization.value as string),
      validAfter: BigInt(authorization.validAfter as string),
      validBefore: BigInt(authorization.validBefore as string),
      nonce: authorization.nonce as `0x${string}`,
    },
  });
} else {
  // Permit2 flow — check ERC20 allowance to the Permit2 contract
  const allowance = await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, PERMIT2_ADDRESS],
  });

  if (allowance < requiredAmount) {
    console.log(
      JSON.stringify({
        error: "insufficient_allowance",
        message: `Token not approved for Permit2 contract. Run '/aud-wallet approve' first. Current allowance: ${formatUnits(allowance, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`,
        currentAllowance: formatUnits(allowance, TOKEN_DECIMALS),
      }),
    );
    process.exit(1);
  }

  const nonce = BigInt(randomBytes32()) & ((1n << 48n) - 1n);
  const deadline = now + BigInt(accept.maxTimeoutSeconds);

  authorization = {
    method: "permit2",
    from: account.address,
    to: accept.payTo,
    token: accept.asset,
    amount: accept.amount,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    witness: {
      to: accept.payTo,
      validAfter: (now - 60n).toString(),
    },
  };

  signature = await account.signTypedData({
    domain: {
      name: "Permit2",
      chainId,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "Witness" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      Witness: [
        { name: "to", type: "address" },
        { name: "validAfter", type: "uint256" },
      ],
    },
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: {
        token: accept.asset as `0x${string}`,
        amount: BigInt(accept.amount),
      },
      spender: X402_PROXY,
      nonce,
      deadline,
      witness: {
        to: (authorization.witness as { to: string }).to as `0x${string}`,
        validAfter: BigInt(
          (authorization.witness as { validAfter: string }).validAfter,
        ),
      },
    },
  });
}

const paymentPayload = {
  x402Version: 2,
  resource: paymentRequired.resource,
  accepted: accept,
  payload: { signature, authorization },
};

const encoded = btoa(JSON.stringify(paymentPayload));

const paidRes = await fetch(resourceUrl, {
  headers: { "PAYMENT-SIGNATURE": encoded },
});

if (!paidRes.ok) {
  const errBody = await paidRes.json().catch(() => null);
  console.log(
    JSON.stringify({
      error: "payment_failed",
      message:
        errBody?.reason ||
        errBody?.error ||
        `Server returned ${paidRes.status}`,
      details: errBody,
    }),
  );
  process.exit(1);
}

const paymentResponseHeader = paidRes.headers.get("PAYMENT-RESPONSE");
let settlement = null;
if (paymentResponseHeader) {
  settlement = JSON.parse(atob(paymentResponseHeader));
}

const resourceData = await paidRes.json();

console.log(
  JSON.stringify({
    status: "success",
    resource: resourceData,
    settlement,
  }),
);
