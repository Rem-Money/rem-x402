# PRD: x402 Payment Infrastructure for Custom ERC20 on Base

## Overview

Build end-to-end infrastructure enabling any existing ERC20 token on Base to be accepted as an x402 payment method. The system consists of three components: a **server/gateway** that gates resources behind HTTP 402 paywalls, a **facilitator** that verifies and settles on-chain payments, and a **client library** that transparently handles payment flows.

The x402 protocol revives HTTP 402 (Payment Required) to embed token payments directly into HTTP request/response flows — no accounts, sessions, or API keys needed.

### Dual Transfer Method Support

The system supports two on-chain transfer mechanisms, selected per-token via a single config flag:

| Method | Flag | Tokens | How it works | Client prerequisite |
|---|---|---|---|---|
| **EIP-3009** | `eip3009Enabled: true` | USDC, EURC, and any ERC20 implementing `transferWithAuthorization` | Client signs an off-chain authorization; facilitator calls `transferWithAuthorization()` directly on the token contract | None — fully gasless for the payer |
| **Permit2** | `eip3009Enabled: false` | Any standard ERC20 | Client signs a Permit2 `PermitTransferFrom`; facilitator calls `x402ExactPermit2Proxy.settle()` | One-time `token.approve(Permit2, amount)` tx |

The entire stack — client signing, server 402 response, facilitator verify/settle — branches on this flag. All modules expose the same external API regardless of which path is active.

---

## Architecture

```
┌──────────────┐     1. GET /resource      ┌──────────────────┐
│              │ ──────────────────────────▶│                  │
│              │     2. 402 + PAYMENT-      │   Server/Gateway │
│              │        REQUIRED header     │   (Express/Hono/ │
│   Client     │ ◀──────────────────────────│    Next.js)      │
│   Library    │                            │                  │
│              │  3. Retry + PAYMENT-       │                  │
│  (fetch/     │     SIGNATURE header       │                  │
│   axios      │ ──────────────────────────▶│                  │
│   wrapper)   │                            │                  │
│              │  6. 200 OK + PAYMENT-      │                  │
│              │     RESPONSE header        │                  │
│              │ ◀──────────────────────────│                  │
└──────────────┘                            └────────┬─────────┘
                                                     │
                                              4. /verify
                                              5. /settle
                                                     │
                                                     ▼
                                            ┌──────────────────┐
                                            │                  │
                                            │   Facilitator    │
                                            │                  │
                                            │  - Verify sigs   │
                                            │  - Check balance │
                                            │  - Simulate tx   │
                                            │  - Route to      │
                                            │    transfer      │
                                            │    method module │
                                            │                  │
                                            └────────┬─────────┘
                                                     │
                                        ┌────────────┴────────────┐
                                        │                         │
                                        ▼                         ▼
                              ┌──────────────────┐    ┌──────────────────┐
                              │ eip3009Enabled:   │    │ eip3009Enabled:   │
                              │   true            │    │   false           │
                              │                   │    │                   │
                              │ Call token's      │    │ Call Permit2      │
                              │ transferWith-     │    │ proxy settle()    │
                              │ Authorization()   │    │                   │
                              └────────┬──────────┘    └────────┬──────────┘
                                       │                         │
                                       └────────────┬────────────┘
                                                    ▼
                                            ┌──────────────────┐
                                            │   Base Network   │
                                            │                  │
                                            │  ERC20 Token     │
                                            │  Permit2 Contract│
                                            │  x402 Proxy      │
                                            └──────────────────┘
```

---

## Payment Flow (Detailed)

Steps 1-2 and 4-8, 10 are identical for both methods. Steps 3 and 9 branch based on `eip3009Enabled`.

1. **Client** sends `GET /resource` (no payment header)
2. **Server** responds `HTTP 402` with `PAYMENT-REQUIRED` header containing:
   - Token address (ERC20)
   - Price (amount in token's smallest unit)
   - Recipient address (`payTo`)
   - Network (`eip155:8453` for Base mainnet)
   - Scheme (`exact`)
   - Transfer method (`eip3009` or `permit2` — driven by server's `eip3009Enabled` flag)
3. **Client** parses requirements and signs based on `extra.assetTransferMethod`:
   - **EIP-3009 path:** Construct `TransferWithAuthorization` params (`from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`), sign via EIP-712 against the token contract's domain
   - **Permit2 path:** Construct `PermitTransferFrom` with witness, sign via EIP-712 against the Permit2 contract's domain
4. **Client** retries the same request with `PAYMENT-SIGNATURE` header containing the signed payload
5. **Server** forwards the payment payload to **Facilitator** `POST /verify`
6. **Facilitator** validates (method-specific — see Transfer Method Modules below)
7. **Server** serves the resource
8. **Server** calls **Facilitator** `POST /settle`
9. **Facilitator** settles on-chain:
   - **EIP-3009 path:** Call `token.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature)` directly on the ERC20 contract
   - **Permit2 path:** Call `x402ExactPermit2Proxy.settle(permit, owner, witness, signature)` on the proxy contract
10. **Server** returns `200 OK` with `PAYMENT-RESPONSE` header containing tx hash

---

## Transfer Method Modules

Both modules implement the same `TransferMethodModule` interface so the facilitator, server, and client can swap them transparently.

### Interface

```typescript
type TransferMethod = "eip3009" | "permit2";

interface TransferMethodModule {
  method: TransferMethod;

  // Client-side: construct and sign the payment authorization
  createAuthorization(params: CreateAuthParams): Promise<PaymentAuthorization>;

  // Facilitator-side: verify a signed authorization without executing
  verifyAuthorization(params: VerifyAuthParams): Promise<VerificationResult>;

  // Facilitator-side: settle (execute) a verified authorization on-chain
  settleAuthorization(params: SettleAuthParams): Promise<SettlementResult>;
}
```

### EIP-3009 Module (`eip3009Enabled: true`)

For tokens that natively implement `transferWithAuthorization` (EIP-3009). No Permit2 approval needed — the token contract handles everything.

**Signing (Client):**
```typescript
// EIP-712 domain — the TOKEN contract itself
{
  name: "TOKEN_NAME",        // e.g. "USD Coin"
  version: "2",              // e.g. "2" for USDC
  chainId: 8453,
  verifyingContract: "0xTokenAddress"
}

// EIP-712 type
{
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
}
```

**Verification (Facilitator):**
1. Recover signer from EIP-712 signature against token's domain
2. Verify signer == `from`
3. Check payer's ERC20 balance >= amount
4. Check `validBefore` > now > `validAfter`
5. Check nonce hasn't been used (call `token.authorizationState(from, nonce)`)
6. Simulate `transferWithAuthorization()` via `eth_call`

**Settlement (Facilitator):**
```solidity
// Direct call on the token contract — no proxy needed
token.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)
```

**Authorization payload shape:**
```typescript
interface EIP3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;     // bytes32 — random, not sequential
}
```

### Permit2 Module (`eip3009Enabled: false`)

For any standard ERC20. Uses Uniswap's Permit2 contract + x402 proxy for atomic settlement.

**Prerequisite:** Payer must have called `token.approve(Permit2Address, amount)` at least once.

**Signing (Client):**
```typescript
// EIP-712 domain — the PERMIT2 contract
{
  name: "Permit2",
  chainId: 8453,
  verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3"
}

// EIP-712 types
{
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" }
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" }
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" }
  ]
}
```

**Verification (Facilitator):**
1. Recover signer from Permit2 EIP-712 signature
2. Verify signer == `from`
3. Check payer's ERC20 balance >= amount
4. Check payer's Permit2 allowance >= amount (`token.allowance(from, Permit2Address)`)
5. Simulate `x402ExactPermit2Proxy.settle()` via `eth_call`
6. Verify `deadline` > now and `validAfter` < now

**Settlement (Facilitator):**
```solidity
// Call through the x402 proxy contract
x402ExactPermit2Proxy.settle(permit, owner, witness, signature)
```

**Authorization payload shape:**
```typescript
interface Permit2Authorization {
  from: string;
  to: string;
  token: string;
  amount: string;
  nonce: string;       // uint256 — managed by Permit2
  deadline: string;
  witness: {
    to: string;
    validAfter: string;
  };
}
```

### Module Selection

The active module is determined by the token config's `eip3009Enabled` flag. All three components read this from the same source of truth:

```typescript
// Server: includes method in the 402 response
extra.assetTransferMethod = token.eip3009Enabled ? "eip3009" : "permit2"

// Client: reads method from the 402 response
const method = paymentRequired.accepts[0].extra.assetTransferMethod;
const module = method === "eip3009" ? eip3009Module : permit2Module;

// Facilitator: reads method from the payment requirements forwarded by server
const method = paymentRequirements.extra.assetTransferMethod;
const module = method === "eip3009" ? eip3009Module : permit2Module;
```

---

## Component 1: Server / Gateway

### Purpose
Middleware layer that protects HTTP endpoints behind x402 paywalls, demanding payment in a configured ERC20 token.

### Deliverables

| Deliverable | Description |
|---|---|
| `@rem-x402/server-core` | Framework-agnostic server logic: 402 response construction, payment header parsing, facilitator communication |
| `@rem-x402/express` | Express.js middleware using server-core |
| `@rem-x402/hono` | Hono middleware using server-core |
| `@rem-x402/next` | Next.js middleware + `withX402` route wrapper |

### Configuration

```typescript
interface TokenConfig {
  address: string;           // ERC20 contract address on Base
  name: string;              // Token name (used in EIP-712 domain for EIP-3009)
  symbol: string;            // Token symbol
  decimals: number;          // Token decimals
  version?: string;          // EIP-712 domain version (default "1")
  eip3009Enabled: boolean;   // true → use transferWithAuthorization, false → use Permit2
}

interface X402ServerConfig {
  // Token configuration
  token: TokenConfig;

  // Payment configuration
  payTo: string;            // Recipient wallet address
  network: string;          // CAIP-2 network ID (default "eip155:8453")

  // Facilitator
  facilitator: {
    url: string;            // Facilitator base URL
    apiKey?: string;        // Optional API key for facilitator auth
  };

  // Route pricing
  routes: Record<string, {
    price: string;          // Amount in token's smallest unit
    description?: string;   // Resource description
    mimeType?: string;      // Response MIME type
  }>;
}
```

**Example — USDC (EIP-3009):**
```typescript
const config: X402ServerConfig = {
  token: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    version: "2",
    eip3009Enabled: true,   // USDC supports transferWithAuthorization
  },
  // ...
};
```

**Example — Custom ERC20 (Permit2):**
```typescript
const config: X402ServerConfig = {
  token: {
    address: "0xYourTokenAddress",
    name: "My Token",
    symbol: "MTK",
    decimals: 18,
    version: "1",
    eip3009Enabled: false,  // Standard ERC20 → Permit2 fallback
  },
  // ...
};
```

### Middleware Behavior

1. Intercept incoming requests on configured routes
2. If no `PAYMENT-SIGNATURE` header → respond `402` with `PAYMENT-REQUIRED` header
3. If `PAYMENT-SIGNATURE` present → decode, forward to facilitator `/verify`
4. If verification passes → call `next()`, then call facilitator `/settle`
5. Attach `PAYMENT-RESPONSE` header with settlement result
6. If verification fails → respond `402` with error details

### 402 Response Format (PAYMENT-REQUIRED header, base64-encoded)

The `extra.assetTransferMethod` field is set automatically based on `token.eip3009Enabled`.

**EIP-3009 token (e.g. USDC):**
```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": "...", "description": "...", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "amount": "1000000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xRecipientAddress",
      "maxTimeoutSeconds": 60,
      "extra": {
        "name": "USD Coin",
        "version": "2",
        "assetTransferMethod": "eip3009"
      }
    }
  ]
}
```

**Permit2 token (any standard ERC20):**
```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": "...", "description": "...", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "amount": "1000000000000000000",
      "asset": "0xYourTokenAddress",
      "payTo": "0xRecipientAddress",
      "maxTimeoutSeconds": 60,
      "extra": {
        "name": "My Token",
        "version": "1",
        "assetTransferMethod": "permit2"
      }
    }
  ]
}
```

---

## Component 2: Facilitator

### Purpose
Standalone service that verifies payment signatures and settles them on-chain via Permit2. This is the only component that interacts with the blockchain.

### Deliverables

| Deliverable | Description |
|---|---|
| `@rem-x402/facilitator` | Full facilitator service with HTTP API, signature verification, balance checking, tx simulation, and on-chain settlement |

### API Endpoints

#### `POST /verify`
Validates a payment payload without executing it.

**Request:**
```json
{
  "paymentPayload": "<base64-encoded PaymentPayload>",
  "paymentRequirements": {
    "scheme": "exact",
    "network": "eip155:8453",
    "amount": "1000000",
    "asset": "0xERC20Address",
    "payTo": "0xRecipient",
    "maxTimeoutSeconds": 60,
    "extra": {}
  }
}
```

**Verification steps:**
1. Decode and parse the payment payload
2. Read `extra.assetTransferMethod` to select the transfer method module
3. Delegate to the module's `verifyAuthorization()` (see Transfer Method Modules section)
   - **EIP-3009:** recover signer from token-domain EIP-712, check balance, check nonce unused, simulate `transferWithAuthorization()`
   - **Permit2:** recover signer from Permit2-domain EIP-712, check balance, check Permit2 allowance, simulate `x402ExactPermit2Proxy.settle()`
4. Return result

**Response:**
```json
{
  "isValid": true,
  "invalidReason": null
}
```

#### `POST /settle`
Executes the payment on-chain.

**Settlement flow:**
1. Re-verify the payment (same as `/verify`)
2. Delegate to the module's `settleAuthorization()`:
   - **EIP-3009:** Call `token.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)` on the ERC20 contract
   - **Permit2:** Call `x402ExactPermit2Proxy.settle(permit, owner, witness, signature)` on the proxy contract
3. Wait for transaction confirmation (configurable: 1-3 block confirmations)
4. Return transaction hash

**Response:**
```json
{
  "success": true,
  "transaction": "0xTxHash...",
  "network": "eip155:8453",
  "payer": "0xPayerAddress"
}
```

#### `GET /supported`
Returns supported networks, tokens, and schemes.

**Response:**
```json
{
  "networks": ["eip155:8453"],
  "schemes": ["exact"],
  "tokens": {
    "eip155:8453": [
      {
        "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "name": "USD Coin",
        "symbol": "USDC",
        "decimals": 6,
        "transferMethod": "eip3009"
      },
      {
        "address": "0xYourTokenAddress",
        "name": "My Token",
        "symbol": "MTK",
        "decimals": 18,
        "transferMethod": "permit2"
      }
    ]
  }
}
```

### Infrastructure Requirements

| Requirement | Detail |
|---|---|
| **RPC Provider** | Base mainnet JSON-RPC endpoint (Alchemy, QuickNode, or public) |
| **Settlement Wallet** | EOA with ETH for gas to call Permit2 proxy contracts |
| **Nonce Management** | Track and manage nonces for the settlement wallet to avoid tx conflicts |
| **Database** | Store payment records, settlement status, and idempotency keys |
| **Retry Logic** | Retry failed settlements with exponential backoff |

### On-Chain Contracts (Pre-deployed, Deterministic Addresses)

| Contract | Address | Role |
|---|---|---|
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Uniswap's canonical Permit2 |
| x402ExactPermit2Proxy | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` | Atomic permit-verify + transfer |
| x402UptoPermit2Proxy | `0x4020a4f3b7b90CCA423b9FabCC0CE57c6c240002` | Variable-amount transfers |

---

## Component 3: Client Library

### Purpose
Drop-in HTTP client wrappers that transparently detect 402 responses, sign Permit2 authorizations, and retry — making paid API calls feel like normal HTTP requests.

### Deliverables

| Deliverable | Description |
|---|---|
| `@rem-x402/client-core` | Framework-agnostic client: 402 detection, dual-method signing (EIP-3009 + Permit2), payload construction |
| `@rem-x402/fetch` | Wraps native `fetch()` for transparent x402 payment |
| `@rem-x402/axios` | Wraps Axios for transparent x402 payment |

### Configuration

```typescript
interface X402ClientConfig {
  // Wallet (one of)
  wallet: {
    privateKey?: string;          // Raw private key (for server-side agents)
    signer?: ethers.Signer;       // Ethers signer
    viemAccount?: Account;        // Viem account
    walletClient?: WalletClient;  // Viem wallet client (browser wallets)
  };

  // Permit2 options (only used when server requests permit2 method)
  autoApprovePermit2?: boolean;   // Auto-approve Permit2 if needed (default false)
  permit2AllowanceAmount?: string; // Amount to approve (default: MaxUint256)

  // Network
  rpcUrl?: string;                // Base RPC URL (for balance/allowance checks)
}
```

The client does NOT need to know the transfer method upfront — it reads `extra.assetTransferMethod` from the 402 response and selects the correct signing module automatically.

### Client Behavior

1. Make HTTP request normally
2. If response is `402` with `PAYMENT-REQUIRED` header:
   a. Decode payment requirements
   b. Read `extra.assetTransferMethod` → `"eip3009"` or `"permit2"`
   c. Verify the request can be paid (balance check; + Permit2 allowance check if permit2 method)
   d. **EIP-3009 path:** Construct `TransferWithAuthorization` params, sign against token's EIP-712 domain
   e. **Permit2 path:** Check/ensure Permit2 approval, construct `PermitTransferFrom` with witness, sign against Permit2's EIP-712 domain
   f. Base64-encode the `PaymentPayload`
   g. Retry the original request with `PAYMENT-SIGNATURE` header
3. Return the final response with decoded `PAYMENT-RESPONSE` header accessible

### Permit2 Approval Flow (Permit2 method only)

Only needed when the server requests `permit2` transfer method. EIP-3009 tokens require no client-side approval.

```typescript
// One-time approval (can be done via client library helper)
await token.approve(
  "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Permit2
  ethers.MaxUint256 // or a specific amount
);
```

The client library will provide:
- `checkPermit2Approval(tokenAddress, ownerAddress)` — check current allowance
- `approvePermit2(tokenAddress, amount?)` — send approval tx
- `ensurePermit2Approval(tokenAddress)` — check + approve if needed

These helpers are no-ops / not called when the server requests eip3009 method.

---

## Shared Types (`@rem-x402/types`)

```typescript
// ─── Transfer method discriminator ───
type TransferMethod = "eip3009" | "permit2";

// ─── Token configuration ───
interface TokenConfig {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  version?: string;
  eip3009Enabled: boolean;
}

// ─── Core protocol types ───
interface PaymentRequired {
  x402Version: 2;
  error: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: PaymentAccept[];
}

interface PaymentAccept {
  scheme: "exact";          // "upto" deferred to v2
  network: string;          // CAIP-2
  amount: string;           // In token's smallest unit
  asset: string;            // ERC20 address
  payTo: string;            // Recipient
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    assetTransferMethod: TransferMethod;
    [key: string]: unknown;
  };
}

// ─── Authorization payloads (discriminated union) ───
interface EIP3009Authorization {
  method: "eip3009";
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;            // bytes32 — random
}

interface Permit2Authorization {
  method: "permit2";
  from: string;
  to: string;
  token: string;
  amount: string;
  nonce: string;            // uint256 — managed by Permit2
  deadline: string;
  witness: {
    to: string;
    validAfter: string;
  };
}

type PaymentAuthorization = EIP3009Authorization | Permit2Authorization;

// ─── Payment payload (sent in PAYMENT-SIGNATURE header) ───
interface PaymentPayload {
  x402Version: 2;
  resource: PaymentRequired["resource"];
  accepted: PaymentAccept;
  payload: {
    signature: string;
    authorization: PaymentAuthorization;
  };
}

// ─── Settlement response (returned in PAYMENT-RESPONSE header) ───
interface SettlementResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  error?: string;
}

// ─── Transfer method module interface ───
interface CreateAuthParams {
  paymentRequirements: PaymentAccept;
  payerAddress: string;
}

interface VerifyAuthParams {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentAccept;
}

interface SettleAuthParams {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentAccept;
}

interface VerificationResult {
  isValid: boolean;
  invalidReason?: string;
}

interface SettlementResult {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  error?: string;
}

interface TransferMethodModule {
  method: TransferMethod;
  createAuthorization(params: CreateAuthParams): Promise<PaymentAuthorization>;
  verifyAuthorization(params: VerifyAuthParams): Promise<VerificationResult>;
  settleAuthorization(params: SettleAuthParams): Promise<SettlementResult>;
}
```

---

## Package Structure (Monorepo)

```
rem-x402/
├── packages/
│   ├── types/              # @rem-x402/types — shared TypeScript types
│   ├── eip3009/            # @rem-x402/eip3009 — EIP-3009 transfer method module
│   ├── permit2/            # @rem-x402/permit2 — Permit2 transfer method module
│   ├── client-core/        # @rem-x402/client-core — 402 detection, dual-method signing
│   ├── fetch/              # @rem-x402/fetch — fetch wrapper
│   ├── axios/              # @rem-x402/axios — axios wrapper
│   ├── server-core/        # @rem-x402/server-core — 402 response construction, facilitator comms
│   ├── express/            # @rem-x402/express — Express middleware
│   ├── hono/               # @rem-x402/hono — Hono middleware
│   ├── next/               # @rem-x402/next — Next.js middleware
│   └── facilitator/        # @rem-x402/facilitator — verification + settlement service
├── examples/
│   ├── server-express/     # Example Express server with x402 paywall
│   ├── server-hono/        # Example Hono server
│   ├── client-fetch/       # Example client using fetch wrapper
│   └── client-axios/       # Example client using axios wrapper
├── package.json            # Monorepo root (turborepo/pnpm workspaces)
├── tsconfig.json
├── turbo.json
└── prd.md
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode) |
| Runtime | Node.js 22+ |
| Monorepo | pnpm workspaces + Turborepo |
| Ethereum | viem (preferred), ethers v6 compatibility |
| Permit2 | @uniswap/permit2-sdk |
| HTTP Server | Express, Hono, Next.js |
| HTTP Client | Native fetch, Axios |
| Facilitator Server | Hono (lightweight, fast) |
| Database | SQLite (drizzle-orm) for facilitator payment records |
| Testing | Vitest |
| Chain | Base mainnet (`eip155:8453`) / Base Sepolia (`eip155:84532`) for testnet |
| Build | tsup (for library builds) |

---

## Token Requirements

### EIP-3009 tokens (`eip3009Enabled: true`)
The token must:
1. Be deployed on Base (chain ID 8453)
2. Implement `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`
3. Implement `authorizationState(authorizer, nonce)` for nonce checking
4. Expose EIP-712 domain with `name` and `version` matching the token config

Known compatible: **USDC** (v2), **EURC**

### Permit2 tokens (`eip3009Enabled: false`)
The token must:
1. Be deployed on Base (chain ID 8453)
2. Implement standard ERC20 interface (`transfer`, `approve`, `balanceOf`, `allowance`)

No special interface needed — Permit2 works with any standard ERC20. The payer must approve the Permit2 contract once.

---

## Security Considerations

| Concern | Mitigation |
|---|---|
| Replay attacks | Permit2 nonces are single-use; `validBefore`/`validAfter` time bounds |
| Double settlement | Facilitator tracks settled payment hashes; Permit2 nonce consumed on-chain |
| Signature malleability | EIP-712 typed data prevents cross-domain replay |
| Settlement wallet compromise | Wallet only needs ETH for gas, never holds ERC20 tokens |
| Facilitator availability | Facilitator is stateless for verify; settlement has retry + idempotency |
| Front-running | Permit2 witness binds the destination; front-runner can't redirect funds |

---

## POC: End-to-End Demo (Milestone 0)

Minimal working demo of the entire x402 payment flow before building the full monorepo. Three pieces — all at the workspace root, no package splitting, no abstractions. Just enough to prove the flow works with a real ERC20 on Base Sepolia.

### Goal
Connect a browser wallet, pay a configured ERC20 token, and receive a paywalled resource — demonstrating the full loop: client → 402 → sign → retry → verify → settle → 200.

### Structure

```
├── facilitator/          # Hono server — /verify, /settle, /supported
│   ├── index.ts          # Endpoints + settlement logic
│   ├── eip3009.ts        # EIP-3009 verify + settle functions
│   ├── permit2.ts        # Permit2 verify + settle functions
│   └── config.ts         # Token config, RPC url, settlement wallet
├── server/               # Hono server — paywalled API
│   ├── index.ts          # Single GET /resource route behind 402
│   └── config.ts         # Token, pricing, facilitator URL
├── frontend/             # Vite + React — browser wallet UI
│   ├── index.html
│   ├── src/
│   │   ├── App.tsx        # Main app — connect wallet, pay, show resource
│   │   ├── useX402.ts     # Hook: detect 402, sign payment, retry
│   │   └── config.ts      # Token address, server URL
│   ├── package.json
│   └── vite.config.ts
├── shared/
│   └── types.ts          # Minimal shared types (PaymentRequired, PaymentPayload, etc.)
├── docs/
│   └── prd.md            # Product requirements document
├── package.json          # Workspace root
├── tsconfig.json
└── .env.example          # RPC_URL, SETTLEMENT_PRIVATE_KEY, TOKEN_ADDRESS, etc.
```

### POC Facilitator (`facilitator/`)

Single Hono server with three endpoints. No database — verify is stateless, settle is fire-and-forget with console logging.

**Endpoints:**
- `POST /verify` — decode payload, select module by `assetTransferMethod`, validate signature + balance, simulate tx, return `{ isValid }`
- `POST /settle` — re-verify, broadcast tx (EIP-3009 `transferWithAuthorization` or Permit2 proxy `settle`), wait for receipt, return `{ success, transaction }`
- `GET /supported` — return hardcoded token config

**Config (`facilitator/config.ts`):**
```typescript
export const TOKEN_CONFIG = {
  address: process.env.TOKEN_ADDRESS!,
  name: process.env.TOKEN_NAME!,
  symbol: process.env.TOKEN_SYMBOL!,
  decimals: Number(process.env.TOKEN_DECIMALS!),
  version: process.env.TOKEN_VERSION || "1",
  eip3009Enabled: process.env.EIP3009_ENABLED === "true",
};

export const SETTLEMENT_PRIVATE_KEY = process.env.SETTLEMENT_PRIVATE_KEY!;
export const RPC_URL = process.env.RPC_URL!;
export const NETWORK = process.env.NETWORK || "eip155:84532"; // Base Sepolia default
```

**Settlement wallet:** A funded EOA on Base Sepolia. Only needs ETH for gas — never holds tokens.

### POC Server (`server/`)

Single Hono server with one paywalled route.

```typescript
// GET /resource
// 1. No PAYMENT-SIGNATURE header → return 402 with PAYMENT-REQUIRED
// 2. Has PAYMENT-SIGNATURE → forward to facilitator /verify
//    → if valid: serve resource, then POST facilitator /settle
//    → if invalid: return 402 with error
```

**Demo resource:** Returns a JSON payload like `{ secret: "You paid 0.001 TKN for this!", timestamp, txHash }`.

**Pricing:** Single route, single price, configured via env var:
```
PRICE_AMOUNT=1000000000000000    # 0.001 tokens (18 decimals)
```

### POC Frontend (`frontend/`)

Vite + React app. Minimal UI — no design system, just functional.

**Dependencies:** `viem`, `wagmi`, `@tanstack/react-query`, `@rainbow-me/rainbowkit` (for wallet connect UX)

**Screens/states:**

```
┌─────────────────────────────────┐
│                                 │
│  x402 Payment Demo              │
│                                 │
│  Token: MTK (0x1234...5678)     │
│  Price: 0.001 MTK               │
│  Network: Base Sepolia          │
│                                 │
│  [Connect Wallet]               │
│                                 │
└─────────────────────────────────┘
         │ wallet connected
         ▼
┌─────────────────────────────────┐
│                                 │
│  Connected: 0xAbCd...EfGh       │
│  Balance: 1.5 MTK               │
│                                 │
│  (if permit2 token & not        │
│   approved yet):                │
│  [Approve Token for Permit2]    │
│                                 │
│  [Pay 0.001 MTK & Get Resource] │
│                                 │
└─────────────────────────────────┘
         │ click pay
         ▼
┌─────────────────────────────────┐
│                                 │
│  Status: Signing payment...     │
│  → Sending to server...         │
│  → Verifying on-chain...        │
│  → Settling...                  │
│  → Done!                        │
│                                 │
│  Resource:                      │
│  { "secret": "You paid!" }      │
│                                 │
│  Tx: 0xABC... (link to scan)    │
│                                 │
│  [Pay Again]                    │
│                                 │
└─────────────────────────────────┘
```

**`useX402` hook — core client logic:**
```typescript
// 1. fetch(serverUrl + "/resource")
// 2. If 402 → decode PAYMENT-REQUIRED header
// 3. Read assetTransferMethod from response
// 4. EIP-3009: sign TransferWithAuthorization via walletClient.signTypedData()
//    Permit2: sign PermitWitnessTransferFrom via walletClient.signTypedData()
// 5. Base64-encode PaymentPayload
// 6. Retry fetch with PAYMENT-SIGNATURE header
// 7. Decode PAYMENT-RESPONSE header from 200 response
// 8. Return { resource, txHash, status }
```

### Environment Variables (`.env.example`)

```env
# Network
RPC_URL=https://sepolia.base.org
NETWORK=eip155:84532

# Token (configure for your ERC20)
TOKEN_ADDRESS=0xYourTestTokenOnBaseSepolia
TOKEN_NAME="My Token"
TOKEN_SYMBOL=MTK
TOKEN_DECIMALS=18
TOKEN_VERSION=1
EIP3009_ENABLED=false

# Pricing
PRICE_AMOUNT=1000000000000000

# Facilitator settlement wallet (funded with Base Sepolia ETH)
SETTLEMENT_PRIVATE_KEY=0x...

# Recipient wallet (receives the token payments)
PAY_TO_ADDRESS=0x...

# URLs (for local dev)
FACILITATOR_URL=http://localhost:4402
SERVER_URL=http://localhost:4401
```

### What the POC skips (deferred to full build)

| Skipped | Why |
|---|---|
| Monorepo / package splitting | POC is one workspace, not publishable packages |
| Database / payment records | Console logging only |
| Rate limiting | Not needed for demo |
| Gas sponsorship | Not needed for Sepolia (faucet ETH is free) |
| Retry / idempotency | Happy path only |
| Nonce management | Single-threaded facilitator, no concurrent settlement |
| Error UI | Minimal — console errors + alert |
| Tests | Manual testing via the frontend |

### POC Tech Stack

| Layer | Choice |
|---|---|
| Facilitator | Hono + viem |
| Server | Hono + viem |
| Frontend | Vite + React + wagmi + viem + RainbowKit |
| Chain | Base Sepolia (`eip155:84532`) |
| Token | Any ERC20 deployed on Base Sepolia (bring your own, or deploy a test token) |

### POC Steps to Run

```bash
# 1. Copy env and fill in values
cp .env.example .env

# 2. Install
pnpm install

# 3. Start facilitator (port 4402)
pnpm --filter facilitator dev

# 4. Start server (port 4401)
pnpm --filter server dev

# 5. Start frontend (port 5173)
pnpm --filter frontend dev

# 6. Open http://localhost:5173, connect wallet, pay
```

### POC Success Criteria

- [ ] Browser wallet connects and shows token balance
- [ ] Clicking "Pay" triggers EIP-712 signature prompt in wallet (no gas tx for EIP-3009 tokens)
- [ ] Server returns 402, client signs and retries, server returns 200 with resource
- [ ] Facilitator settles payment on-chain — tx visible on Base Sepolia explorer
- [ ] Both transfer methods work: swap `EIP3009_ENABLED` between `true`/`false` and re-test with appropriate token
- [ ] Full flow completes in under 15 seconds (signing + verification + settlement + block confirmation)

---

## Milestones

### M1: Core + Transfer Modules + Facilitator (Week 1-2)
- [ ] Monorepo setup (pnpm + turbo + tsup)
- [ ] `@rem-x402/types` — shared types including `TransferMethodModule` interface
- [ ] `@rem-x402/eip3009` — EIP-3009 signing, verification, settlement module
- [ ] `@rem-x402/permit2` — Permit2 signing, verification, settlement module
- [ ] `@rem-x402/facilitator` — verify + settle endpoints, delegates to transfer method modules
- [ ] Module tests: EIP-3009 against USDC on Base Sepolia, Permit2 against test ERC20

### M2: Server Middleware (Week 2-3)
- [ ] `@rem-x402/server-core` — 402 response builder, facilitator client
- [ ] `@rem-x402/express` — Express middleware
- [ ] `@rem-x402/hono` — Hono middleware
- [ ] Integration tests: server ↔ facilitator

### M3: Client Library (Week 3-4)
- [ ] `@rem-x402/client-core` — 402 detection, auto-selects EIP-3009 or Permit2 module, approval helpers
- [ ] `@rem-x402/fetch` — fetch wrapper
- [ ] `@rem-x402/axios` — axios wrapper
- [ ] End-to-end tests: both paths (EIP-3009 + Permit2) through client → server → facilitator → Base Sepolia

### M4: Next.js + Examples + Docs (Week 4-5)
- [ ] `@rem-x402/next` — Next.js middleware
- [ ] Example apps (server + client)
- [ ] README docs for each package
- [ ] Mainnet deployment guide

---

## Decisions

1. **Exact scheme only for v1.** Upto (variable/usage-based pricing) deferred to v2. Covers the majority of API paywall use cases.
2. **Gas sponsorship — yes.** Facilitator will sponsor the one-time Permit2 approval tx for first-time users (Permit2 path only). This removes the onboarding friction where a new payer would need Base ETH just to approve.
3. **Single token per server for v1.** Multi-token per route (accepting multiple tokens in the `accepts` array) deferred to v2. Keeps config and pricing simple.
4. **Rate limiting — yes.** Facilitator will rate limit per payer address on both `/verify` and `/settle` endpoints. Protects against gas draining, RPC abuse, and dust attacks. Configurable thresholds with sensible defaults.
5. **No CDP facilitator fallback.** We only support the configured custom ERC20 — no USDC, no Coinbase dependency. Our facilitator handles all payments. Revisit if multi-token lands in v2.
