# REM x402

A proof-of-concept implementation of the [x402 HTTP payment protocol](https://www.x402.org/) on Base. Three services work together to gate API resources behind on-chain ERC-20 payments using either EIP-3009 or Permit2.

## Architecture

```
┌────────────┐        ┌────────────┐        ┌──────────────┐        ┌───────────┐
│  Frontend   │───────>│   Server   │───────>│  Facilitator │───────>│   Base    │
│  (React)    │<──────│   (Hono)   │<──────│    (Hono)    │<──────│  Network  │
└────────────┘        └────────────┘        └──────────────┘        └───────────┘
  :5173 / :3000         :4401                  :4402
```

**Flow:**

1. User connects a wallet via RainbowKit.
2. Frontend requests a protected resource from the Server.
3. Server responds with `402 Payment Required` and payment requirements.
4. Frontend prompts the user to sign an EIP-3009 or Permit2 authorization.
5. Frontend sends the signed payment payload back to the Server.
6. Server forwards the payload to the Facilitator, which verifies and settles the payment on-chain.
7. Server returns the protected resource.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ | |
| pnpm | 9+ | `corepack enable` to activate |
| Docker | 24+ | Only for Docker deployment |
| Docker Compose | v2+ | Only for Docker deployment |
| Foundry | latest | Only for deploying test tokens — `curl -L https://foundry.paradigm.xyz | bash` |

You also need:

- A wallet funded with ERC-20 tokens on your target chain (to pay).
- A **settlement wallet** funded with ETH on your target chain (to submit settlement transactions — the facilitator uses this).
- An ERC-20 token deployed on Base Sepolia (testnet) or Base (mainnet). See [Deploying a Test Token](#deploying-a-test-token) below if you need one.

## Environment Variables

Copy `.env.example` to `.env` and fill in the values. Every variable is documented inline in that file.

### Required

| Variable | Description |
|----------|-------------|
| `RPC_URL` | JSON-RPC endpoint for the target chain. Use `https://sepolia.base.org` for testnet or a provider like Alchemy/Infura for mainnet. |
| `TOKEN_ADDRESS` | ERC-20 token contract address. |
| `TOKEN_NAME` | Token name — **must match** the EIP-712 domain `name` in the token contract. |
| `TOKEN_SYMBOL` | Token ticker symbol (for display only). |
| `PRICE_AMOUNT` | Price per request in the token's smallest unit (e.g. `1000000` = 1 USDC). |
| `SETTLEMENT_PRIVATE_KEY` | Private key for the facilitator's settlement wallet. This wallet pays gas fees. **Never commit this.** |
| `PAY_TO_ADDRESS` | Wallet address that receives token payments. |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `NETWORK` | `eip155:84532` | CAIP-2 network ID. `eip155:84532` = Base Sepolia, `eip155:8453` = Base mainnet. |
| `TOKEN_DECIMALS` | `18` | Token decimal places. USDC uses `6`. |
| `TOKEN_VERSION` | `1` | EIP-712 domain `version`. USDC on Base uses `2`. |
| `EIP3009_ENABLED` | `false` | Set to `true` for EIP-3009 (gasless transfers). Set to `false` for Permit2. |
| `FACILITATOR_URL` | `http://localhost:4402` | Where the server reaches the facilitator. In Docker this is set automatically to `http://facilitator:4402`. |
| `SERVER_PORT` | `4401` | Port for the resource server. |
| `FACILITATOR_PORT` | `4402` | Port for the facilitator. |
| `VITE_SERVER_URL` | `http://localhost:4401` | Server URL as reachable **from the browser**. Must be the publicly accessible URL in production. |
| `VITE_WALLETCONNECT_PROJECT_ID` | `x402-poc-demo` | WalletConnect Cloud project ID. Get one at [cloud.walletconnect.com](https://cloud.walletconnect.com). The placeholder works locally but not in production. |
| `FRONTEND_PORT` | `3000` | Host port for the frontend (Docker only). |
| `X402_PERMIT2_PROXY` | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` | x402 Permit2 settlement proxy contract. Only change if you've deployed your own. |

## Local Development (without Docker)

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your values

# 3. Start all three services in parallel
pnpm dev
```

This runs the facilitator (:4402), server (:4401), and frontend (:5173) concurrently.

To start services individually:

```bash
pnpm --filter @x402/facilitator dev   # Terminal 1
pnpm --filter @x402/server dev        # Terminal 2
pnpm --filter @x402/frontend dev      # Terminal 3
```

Open [http://localhost:5173](http://localhost:5173).

## Docker Deployment

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your values

# 2. Build and start all services
docker compose up --build -d

# 3. View logs
docker compose logs -f
```

| Service | URL |
|---------|-----|
| Frontend | [http://localhost:3000](http://localhost:3000) |
| Server | [http://localhost:4401](http://localhost:4401) |
| Facilitator | [http://localhost:4402](http://localhost:4402) |

The `FACILITATOR_URL` is automatically set to the Docker-internal address (`http://facilitator:4402`), so you do **not** need to change it in `.env` for Docker.

The `VITE_SERVER_URL` must be the URL the **browser** can reach — typically `http://localhost:4401` for local Docker, or your public server URL in production.

### Rebuild after code changes

```bash
docker compose up --build -d
```

### Stop

```bash
docker compose down
```

## Deploying a Test Token

The `contracts/` directory contains a UUPS-upgradeable ERC-20 with EIP-3009 support (`transferWithAuthorization`). Deploy it on Base Sepolia to test both x402 transfer methods.

```bash
cd contracts

# Install Solidity dependencies
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install OpenZeppelin/openzeppelin-contracts-upgradeable --no-commit

# Build
forge build
```

Deploy using your settlement wallet (reads `SETTLEMENT_PRIVATE_KEY` from `.env`):

```bash
source ../.env

# Defaults: name="Test AUD", symbol="TAUD", decimals=6, mint=1M tokens
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://sepolia.base.org \
  --broadcast

# Or customize via env vars
TOKEN_NAME="Test NZD" TOKEN_SYMBOL="TNZD" TOKEN_DECIMALS=6 INITIAL_MINT=500000 \
  forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://sepolia.base.org \
  --broadcast
```

The script outputs two addresses — use the **Proxy** address as your `TOKEN_ADDRESS`. The proxy pattern (UUPS) keeps each contract well under the EIP-170 size limit.

The deployed token supports both transfer methods:

| `EIP3009_ENABLED` | Method | What happens |
|---|---|---|
| `true` | EIP-3009 | User signs once, facilitator calls `transferWithAuthorization` directly on the token |
| `false` | Permit2 | User approves Permit2 once, then signs per payment |

After deploying, update `.env`:

```env
TOKEN_ADDRESS=<proxy address>
TOKEN_NAME=Test AUD
TOKEN_SYMBOL=TAUD
TOKEN_DECIMALS=6
TOKEN_VERSION=1
EIP3009_ENABLED=true
```

## Testnet vs Mainnet

### Testnet — Base Sepolia (default)

```env
RPC_URL=https://sepolia.base.org
NETWORK=eip155:84532
TOKEN_ADDRESS=0x...          # Your test token on Base Sepolia
TOKEN_NAME=My Token
TOKEN_SYMBOL=MTK
TOKEN_DECIMALS=18
TOKEN_VERSION=1
EIP3009_ENABLED=false
PRICE_AMOUNT=1000000000000000
```

- Get testnet ETH from the [Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia).
- Deploy your own ERC-20 or use an existing test token.
- The settlement wallet needs Base Sepolia ETH for gas.

### Mainnet — Base

```env
RPC_URL=https://mainnet.base.org
NETWORK=eip155:8453
TOKEN_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
TOKEN_NAME=USD Coin
TOKEN_SYMBOL=USDC
TOKEN_DECIMALS=6
TOKEN_VERSION=2
EIP3009_ENABLED=true
PRICE_AMOUNT=1000000          # 1 USDC
```

**Mainnet checklist:**

- [ ] Use a reliable RPC provider (Alchemy, Infura, QuickNode) — not the public endpoint.
- [ ] Fund the settlement wallet with real ETH on Base for gas.
- [ ] `TOKEN_NAME` and `TOKEN_VERSION` must exactly match the token contract's EIP-712 domain — signatures will fail otherwise.
- [ ] For USDC on Base, use `TOKEN_VERSION=2` and `EIP3009_ENABLED=true`.
- [ ] Get a real WalletConnect project ID at [cloud.walletconnect.com](https://cloud.walletconnect.com).
- [ ] Double-check `PAY_TO_ADDRESS` — payments are irreversible.
- [ ] Set `VITE_SERVER_URL` to your publicly accessible server URL.
- [ ] Consider using a dedicated hot-wallet for `SETTLEMENT_PRIVATE_KEY`, not your main wallet.

### Common Base Mainnet Tokens

| Token | Address | Decimals | Version | EIP-3009 |
|-------|---------|----------|---------|----------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | 2 | Yes |

### EIP-3009 vs Permit2

| | EIP-3009 | Permit2 |
|-|----------|---------|
| **How it works** | User signs a `transferWithAuthorization`; facilitator submits it on-chain | User approves the Permit2 contract once, then signs off-chain permits per payment |
| **User steps** | Sign once per payment | One-time approval tx + sign per payment |
| **Token support** | Only tokens implementing EIP-3009 (e.g. USDC) | Any ERC-20 via the universal Permit2 contract |
| **Gas** | Facilitator pays gas | Facilitator pays gas |
| **When to use** | Preferred when the token supports it | Fallback for tokens without EIP-3009 |

## Troubleshooting

**"Insufficient token balance"** — The connected wallet doesn't have enough tokens. Fund it with the correct ERC-20 on the right chain.

**"Insufficient Permit2 allowance"** — When using Permit2 mode (`EIP3009_ENABLED=false`), the user must first approve the Permit2 contract. The frontend shows an "Approve" button for this.

**"Authorization expired"** — The signed payment timed out (default: 60 seconds). Try again.

**"Transaction reverted"** — The on-chain settlement failed. Check that:
- The settlement wallet has enough ETH for gas.
- `TOKEN_ADDRESS` points to the correct contract on the current chain.
- `TOKEN_NAME` and `TOKEN_VERSION` match the contract's EIP-712 domain exactly.

**Server can't reach facilitator** — In Docker, `FACILITATOR_URL` is set automatically to `http://facilitator:4402`. Without Docker, ensure it's `http://localhost:4402` (or wherever the facilitator is running).

**Frontend can't reach server** — `VITE_SERVER_URL` is baked into the frontend at build time. If you change it, rebuild the frontend (`pnpm build` or `docker compose up --build`).

**WalletConnect not working in production** — The default project ID (`x402-poc-demo`) only works locally. Register at [cloud.walletconnect.com](https://cloud.walletconnect.com) and set `VITE_WALLETCONNECT_PROJECT_ID`.
