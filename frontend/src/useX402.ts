import { useState, useCallback } from "react";
import { useWalletClient, usePublicClient } from "wagmi";
import type {
  PaymentRequired,
  PaymentPayload,
  EIP3009Authorization,
  Permit2Authorization,
  SettlementResponse,
} from "@poc/shared";
import { SERVER_URL, PERMIT2_ADDRESS } from "./config";

type Status =
  | "idle"
  | "fetching"
  | "signing"
  | "sending"
  | "settling"
  | "done"
  | "error";

interface X402Result {
  status: Status;
  resource: any | null;
  settlement: SettlementResponse | null;
  error: string | null;
  pay: () => Promise<void>;
}

function decodePaymentRequired(header: string): PaymentRequired {
  return JSON.parse(atob(header));
}

function randomBytes32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

export function useX402(): X402Result {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [status, setStatus] = useState<Status>("idle");
  const [resource, setResource] = useState<any | null>(null);
  const [settlement, setSettlement] = useState<SettlementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pay = useCallback(async () => {
    if (!walletClient || !publicClient) {
      setError("Wallet not connected");
      return;
    }

    try {
      setStatus("fetching");
      setError(null);
      setResource(null);
      setSettlement(null);

      const initialRes = await fetch(`${SERVER_URL}/resource`);

      if (initialRes.status !== 402) {
        const data = await initialRes.json();
        setResource(data);
        setStatus("done");
        return;
      }

      const paymentRequiredHeader = initialRes.headers.get("PAYMENT-REQUIRED");
      if (!paymentRequiredHeader) {
        throw new Error("402 response missing PAYMENT-REQUIRED header");
      }

      const paymentRequired = decodePaymentRequired(paymentRequiredHeader);
      const accept = paymentRequired.accepts[0];
      const method = accept.extra.assetTransferMethod;

      setStatus("signing");

      const [address] = await walletClient.getAddresses();
      let signature: `0x${string}`;
      let authorization: EIP3009Authorization | Permit2Authorization;

      if (method === "eip3009") {
        const now = BigInt(Math.floor(Date.now() / 1000));
        const nonce = randomBytes32();

        const authParams: EIP3009Authorization = {
          method: "eip3009",
          from: address,
          to: accept.payTo,
          value: accept.amount,
          validAfter: (now - 60n).toString(),
          validBefore: (now + BigInt(accept.maxTimeoutSeconds)).toString(),
          nonce,
        };

        signature = await walletClient.signTypedData({
          domain: {
            name: accept.extra.name,
            version: accept.extra.version,
            chainId: publicClient.chain.id,
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
            from: authParams.from,
            to: authParams.to,
            value: BigInt(authParams.value),
            validAfter: BigInt(authParams.validAfter),
            validBefore: BigInt(authParams.validBefore),
            nonce: authParams.nonce,
          },
        });

        authorization = authParams;
      } else {
        const now = BigInt(Math.floor(Date.now() / 1000));
        const nonce = BigInt(randomBytes32()) & ((1n << 48n) - 1n);
        const deadline = now + BigInt(accept.maxTimeoutSeconds);

        const authParams: Permit2Authorization = {
          method: "permit2",
          from: address,
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

        const WITNESS_TYPE_STRING =
          "Witness witness)TokenPermissions(address token,uint256 amount)Witness(address to,uint256 validAfter)";

        signature = await walletClient.signTypedData({
          domain: {
            name: "Permit2",
            chainId: publicClient.chain.id,
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
              token: accept.asset,
              amount: BigInt(accept.amount),
            },
            spender: "0x402085c248EeA27D92E8b30b2C58ed07f9E20001",
            nonce,
            deadline,
            witness: {
              to: authParams.witness.to,
              validAfter: BigInt(authParams.witness.validAfter),
            },
          },
        });

        authorization = authParams;
      }

      const paymentPayload: PaymentPayload = {
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted: accept,
        payload: { signature, authorization },
      };

      const encoded = btoa(JSON.stringify(paymentPayload));

      setStatus("sending");

      const paidRes = await fetch(`${SERVER_URL}/resource`, {
        headers: { "PAYMENT-SIGNATURE": encoded },
      });

      if (!paidRes.ok && paidRes.status !== 200) {
        const errBody = await paidRes.json().catch(() => null);
        throw new Error(
          errBody?.reason || errBody?.error || `Server returned ${paidRes.status}`
        );
      }

      setStatus("settling");

      const paymentResponseHeader = paidRes.headers.get("PAYMENT-RESPONSE");
      if (paymentResponseHeader) {
        const settlementData: SettlementResponse = JSON.parse(
          atob(paymentResponseHeader)
        );
        setSettlement(settlementData);
      }

      const resourceData = await paidRes.json();
      setResource(resourceData);
      setStatus("done");
    } catch (err: any) {
      console.error("x402 payment error:", err);
      setError(err.message || "Unknown error");
      setStatus("error");
    }
  }, [walletClient, publicClient]);

  return { status, resource, settlement, error, pay };
}
