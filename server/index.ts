import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type {
  PaymentRequired,
  PaymentAccept,
  VerifyResponse,
  SettlementResponse,
} from "@x402/shared";
import {
  TOKEN_CONFIG,
  PAY_TO,
  NETWORK,
  PRICE_AMOUNT,
  FACILITATOR_URL,
  PORT,
} from "./config.js";

const app = new Hono();
app.use("/*", cors({
  exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
}));

function buildPaymentRequirements(): PaymentAccept {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: PRICE_AMOUNT,
    asset: TOKEN_CONFIG.address,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {
      name: TOKEN_CONFIG.name,
      version: TOKEN_CONFIG.version,
      assetTransferMethod: TOKEN_CONFIG.eip3009Enabled ? "eip3009" : "permit2",
    },
  };
}

function buildPaymentRequired(url: string): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url,
      description: "Demo protected resource",
      mimeType: "application/json",
    },
    accepts: [buildPaymentRequirements()],
  };
}

app.get("/resource", async (c) => {
  const paymentSignature = c.req.header("PAYMENT-SIGNATURE");

  if (!paymentSignature) {
    const fullUrl = c.req.url;
    const paymentRequired = buildPaymentRequired(fullUrl);
    const encoded = btoa(JSON.stringify(paymentRequired));

    return c.json(paymentRequired, 402, {
      "PAYMENT-REQUIRED": encoded,
    });
  }

  const requirements = buildPaymentRequirements();

  const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentPayload: paymentSignature,
      paymentRequirements: requirements,
    }),
  });

  const verification: VerifyResponse = await verifyRes.json();

  if (!verification.isValid) {
    console.log(`[server] Payment invalid: ${verification.invalidReason}`);
    const paymentRequired = buildPaymentRequired(c.req.url);
    const encoded = btoa(JSON.stringify(paymentRequired));
    return c.json(
      { error: "Payment invalid", reason: verification.invalidReason },
      402,
      { "PAYMENT-REQUIRED": encoded }
    );
  }

  console.log("[server] Payment verified, settling...");

  const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentPayload: paymentSignature,
      paymentRequirements: requirements,
    }),
  });

  const settlement: SettlementResponse = await settleRes.json();

  if (!settlement.success) {
    console.log(`[server] Settlement failed: ${settlement.error}`);
    return c.json({ error: "Settlement failed", reason: settlement.error }, 500);
  }

  console.log(`[server] Settled: tx=${settlement.transaction}`);

  const paymentResponse = btoa(JSON.stringify(settlement));

  return c.json(
    {
      secret: `You paid ${Number(PRICE_AMOUNT) / 10 ** TOKEN_CONFIG.decimals} ${TOKEN_CONFIG.symbol} for this!`,
      timestamp: new Date().toISOString(),
      txHash: settlement.transaction,
      payer: settlement.payer,
    },
    200,
    { "PAYMENT-RESPONSE": paymentResponse }
  );
});

app.get("/config", (c) => {
  return c.json({
    token: {
      address: TOKEN_CONFIG.address,
      name: TOKEN_CONFIG.name,
      symbol: TOKEN_CONFIG.symbol,
      decimals: TOKEN_CONFIG.decimals,
      eip3009Enabled: TOKEN_CONFIG.eip3009Enabled,
    },
    price: PRICE_AMOUNT,
    payTo: PAY_TO,
    network: NETWORK,
  });
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
  console.log(`Token: ${TOKEN_CONFIG.symbol} (${TOKEN_CONFIG.address})`);
  console.log(`Price: ${PRICE_AMOUNT} (smallest unit)`);
  console.log(
    `Transfer method: ${TOKEN_CONFIG.eip3009Enabled ? "EIP-3009" : "Permit2"}`
  );
});
