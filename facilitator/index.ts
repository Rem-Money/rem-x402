import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type {
  PaymentPayload,
  VerifyRequest,
  SettleRequest,
} from "@x402/shared";
import { TOKEN_CONFIG, NETWORK, PORT } from "./config.js";
import { verifyEIP3009, settleEIP3009 } from "./eip3009.js";
import { verifyPermit2, settlePermit2 } from "./permit2.js";

const app = new Hono();
app.use("/*", cors());

function decodePayload(encoded: string): PaymentPayload {
  return JSON.parse(atob(encoded));
}

app.post("/verify", async (c) => {
  const body = await c.req.json<VerifyRequest>();
  const payload = decodePayload(body.paymentPayload);
  const method = body.paymentRequirements.extra.assetTransferMethod;

  console.log(`[verify] method=${method} from=${payload.payload.authorization.from}`);

  const result =
    method === "eip3009"
      ? await verifyEIP3009(payload, body.paymentRequirements)
      : await verifyPermit2(payload, body.paymentRequirements);

  console.log(`[verify] result=${JSON.stringify(result)}`);
  return c.json(result);
});

app.post("/settle", async (c) => {
  const body = await c.req.json<SettleRequest>();
  const payload = decodePayload(body.paymentPayload);
  const method = body.paymentRequirements.extra.assetTransferMethod;

  console.log(`[settle] method=${method} from=${payload.payload.authorization.from}`);

  const result =
    method === "eip3009"
      ? await settleEIP3009(payload, body.paymentRequirements)
      : await settlePermit2(payload, body.paymentRequirements);

  console.log(`[settle] result=${JSON.stringify(result)}`);
  return c.json({
    ...result,
    network: NETWORK,
  });
});

app.get("/supported", (c) => {
  const transferMethod = TOKEN_CONFIG.eip3009Enabled ? "eip3009" : "permit2";
  return c.json({
    networks: [NETWORK],
    schemes: ["exact"],
    tokens: {
      [NETWORK]: [
        {
          address: TOKEN_CONFIG.address,
          name: TOKEN_CONFIG.name,
          symbol: TOKEN_CONFIG.symbol,
          decimals: TOKEN_CONFIG.decimals,
          transferMethod,
        },
      ],
    },
  });
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Facilitator running on http://localhost:${info.port}`);
  console.log(`Token: ${TOKEN_CONFIG.symbol} (${TOKEN_CONFIG.address})`);
  console.log(
    `Transfer method: ${TOKEN_CONFIG.eip3009Enabled ? "EIP-3009" : "Permit2"}`
  );
});
