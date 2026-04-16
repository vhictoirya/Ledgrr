# x402 Network

**Stripe for x402** — a DePIN-style incentivized facilitator network for x402 + MPP micropayments.

Anyone runs a facilitator node → stakes X402 tokens → earns 0.05–0.1% on every payment routed.

---

## Overview

```
Client ──[GET /resource]──► Merchant API
                                │ 402 + PaymentRequired
                            ◄───┘
Client pays on-chain (USDC on Base / Solana)
Client ──[GET /resource + X-Payment]──► Merchant API
                                            │ POST /settle
                                        ──►  Facilitator Node
                                            │ verify sig / tx
                                            │ execute transferWithAuthorization (EVM)
                                            │ record_payment on Solana (earns fee)
                                        ◄───┘
                            ◄── 200 + resource ───────────────
```

### Fee economics

| Parameter          | Value                         |
|--------------------|-------------------------------|
| Network fee        | 0.07% (7 bps, configurable)   |
| Facilitator share  | 80% of fee                    |
| Protocol treasury  | 20% of fee                    |
| Minimum stake      | 1,000 X402 tokens             |
| Unstake timelock   | 7 days                        |
| Supported chains   | Solana, Base, Avalanche, IoTeX |

---

## Repository Structure

```
x402-network/
├── programs/
│   └── x402-network/          # Anchor staking program (Rust)
│       └── src/lib.rs
├── app/
│   ├── facilitator/           # Facilitator node server (Express + TypeScript)
│   ├── sdk/                   # Merchant SDK (@x402-network/sdk)
│   ├── dashboard/             # Node operator dashboard (Next.js + Privy)
│   └── merchant-demo/         # End-to-end integration demo
├── scripts/
│   ├── setup-devnet.ts        # Airdrop + mint test tokens
│   ├── initialize-network.ts  # Initialize program on devnet
│   └── register-facilitator.ts
├── tests/
│   └── facilitator.test.ts
├── target/
│   └── idl/x402_network.json  # Generated Anchor IDL
└── Anchor.toml
```

---

## Solana Program

**Program ID:** `5RqkCAYtJD5JuFU1RKrn1w1KKpAgwv5bhZv8aZXmhh5g`  
**Framework:** Anchor 0.31 · **Network:** Devnet (ready for mainnet deploy)

### Instructions

| Instruction            | Who calls it       | What it does                                              |
|------------------------|--------------------|-----------------------------------------------------------|
| `initialize`           | Protocol admin     | Create NetworkConfig PDA, treasury, rewards vault         |
| `update_config`        | Protocol admin     | Update fee rate or minimum stake                          |
| `register_facilitator` | Node operator      | Stake X402 tokens, publish endpoint URL, go live          |
| `add_stake`            | Node operator      | Top up stake on an existing facilitator account           |
| `request_unstake`      | Node operator      | Begin 7-day timelock before withdrawal                    |
| `withdraw_stake`       | Node operator      | Withdraw stake after timelock expires                     |
| `record_payment`       | Facilitator node   | Book fee on-chain after routing a payment (dedup via PDA) |
| `claim_rewards`        | Node operator      | Transfer accumulated `pending_rewards` to wallet          |
| `slash_facilitator`    | Protocol admin     | Slash stake for misbehaviour                              |

### On-chain accounts

| Account              | Seeds                                        | Stores                                      |
|----------------------|----------------------------------------------|---------------------------------------------|
| `NetworkConfig`      | `["network_config"]`                         | Fee rate, min stake, global counters        |
| `FacilitatorAccount` | `["facilitator", wallet]`                    | Stake, rewards, status, endpoint URL        |
| `PaymentRecord`      | `["payment", payment_id]`                    | Deduplication — one PDA per payment         |
| `StakeVault`         | `["stake_vault", config, facilitator]`       | Locked X402 tokens                          |
| `RewardsVault`       | `["rewards_vault", config]`                  | Claimable facilitator earnings              |

---

## Facilitator Node

Express server that implements the x402 facilitator interface.

### Endpoints

| Method | Path              | Description                                              |
|--------|-------------------|----------------------------------------------------------|
| GET    | `/api/health`     | Liveness probe                                           |
| GET    | `/api/status`     | Node state, on-chain account, network config             |
| GET    | `/api/challenge`  | Build a 402 payment-required body for a resource         |
| POST   | `/api/verify`     | Verify payment (EVM: EIP-712 sig; Solana: SPL tx parse)  |
| POST   | `/api/settle`     | Verify + execute (EVM: `transferWithAuthorization`; Solana: verify + `record_payment`) |
| GET    | `/api/facilitators` | Live list of active facilitators from `getProgramAccounts` |
| GET    | `/api/metrics`    | Prometheus metrics                                       |
| POST   | `/webhooks/helius`| Helius enhanced webhook receiver                         |

### Supported networks

| Network          | Chain ID | Settlement method                               |
|------------------|----------|-------------------------------------------------|
| `solana`         | —        | Verify SPL transfer tx, call `record_payment`   |
| `base`           | 8453     | `transferWithAuthorization` on USDC contract    |
| `base-sepolia`   | 84532    | Same (testnet)                                  |
| `avalanche`      | 43114    | Same                                            |
| `avalanche-fuji` | 43113    | Same (testnet)                                  |

### Setup

```bash
cd app/facilitator
cp .env.example .env
# Edit .env — fill in HELIUS_RPC_URL, HELIUS_API_KEY, EVM_PRIVATE_KEY, etc.
npm run dev
```

**Required env vars:**

```bash
# Solana
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_API_KEY=YOUR_KEY
NETWORK_PROGRAM_ID=5RqkCAYtJD5JuFU1RKrn1w1KKpAgwv5bhZv8aZXmhh5g
STAKE_MINT=<mint-from-setup-devnet>
FACILITATOR_KEYPAIR_PATH=./facilitator.json

# EVM (for settling Base / Avalanche payments)
EVM_PRIVATE_KEY=0x...        # funded EOA — pays gas, receives USDC
EVM_WALLET_ADDRESS=0x...

# Helius webhook (optional — registers automatically on startup)
HELIUS_WEBHOOK_SECRET=your-hmac-secret
FACILITATOR_URL=https://your-node.example.com
```

---

## Merchant SDK

```bash
npm install @x402-network/sdk
```

### Express middleware

```typescript
import { createX402Middleware } from "@x402-network/sdk";

app.use("/api/premium",
  createX402Middleware({
    price: "1000000",                           // 1 USDC (6 decimals)
    currency: "USDC",
    network: "base-sepolia",                    // or "solana", "base", "avalanche"
    recipient: "0xYourMerchantAddress",
    facilitatorUrl: "https://node1.x402.network",
  })
);
```

### Next.js API routes

```typescript
import { withX402 } from "@x402-network/sdk";

export default withX402(
  async (req, res) => {
    res.json({ data: "premium content" });
  },
  {
    price: "1000000",
    recipient: "0xYourMerchantAddress",
    facilitatorUrl: "https://node1.x402.network",
  }
);
```

### Programmatic client

```typescript
import { X402Client } from "@x402-network/sdk";

const client = new X402Client({ facilitatorUrl: "https://node1.x402.network" });

// Verify a payment manually
const result = await client.verify(payment, "1000000", "0xRecipient");

// Discover all active facilitators
const nodes = await client.getFacilitators();
```

---

## Dashboard

Next.js 14 app with Privy authentication. Lets node operators manage their facilitator from a browser — all actions sign real Solana transactions via Privy.

```bash
cd app/dashboard
cp .env.example .env.local
# Fill in NEXT_PUBLIC_PRIVY_APP_ID, NEXT_PUBLIC_HELIUS_RPC, etc.
npm run dev
# → http://localhost:3000
```

**Required env vars:**

```bash
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id       # dashboard.privy.io
NEXT_PUBLIC_HELIUS_RPC=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_FACILITATOR_URL=http://localhost:4402
NEXT_PUBLIC_NETWORK_PROGRAM_ID=5RqkCAYtJD5JuFU1RKrn1w1KKpAgwv5bhZv8aZXmhh5g
NEXT_PUBLIC_STAKE_MINT=<your-stake-mint>
```

**Actions available in the dashboard:**

- Register as facilitator (set endpoint URL + stake amount)
- Add stake to an existing account
- Claim pending USDC rewards
- Request unstake (starts 7-day timelock)
- Withdraw stake (after timelock)
- View live earnings chart and active network nodes

---

## End-to-End Demo

Demonstrates the full payment flow: merchant API → 402 challenge → client pays → facilitator settles → resource unlocked.

```bash
# Terminal 1 — run the facilitator node
cd app/facilitator && npm run dev

# Terminal 2 — run the demo merchant
cd app/merchant-demo
cp .env.example .env
# Set MERCHANT_ADDRESS, FACILITATOR_URL
npm run dev

# Terminal 3 — run the demo client (pays 0.01 USDC on Base Sepolia)
cd app/merchant-demo
EVM_PRIVATE_KEY=0x... npm run client
```

Expected output:
```
Client wallet: 0xabc...
1. Requesting premium resource...
   Got 402. Payment required.
   Pay: 10000 0x036CbD... on base-sepolia
2. Signing TransferWithAuthorization...
3. Re-requesting with X-Payment header...
✅ Access granted!
   Secret: The answer is 42
   Settlement tx: 0xdef...
   Facilitator fee: 7 USDC micro-units
```

---

## First-time Setup (from scratch)

### 1. Install toolchain

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh && source ~/.cargo/env

# Solana CLI
curl -sSfL https://solana-install.solana.workers.dev | bash && source ~/.profile

# Anchor
cargo install --git https://github.com/solana-foundation/anchor avm --locked && avm update
```

### 2. Bootstrap devnet

```bash
cd x402-network
npx tsx scripts/setup-devnet.ts
# Outputs: facilitator.json keypair, stake mint address, .env.devnet-generated
```

### 3. Deploy the program

```bash
anchor build
anchor deploy --provider.cluster devnet
# Copy the Program ID printed to stdout
```

### 4. Initialize the network

```bash
# Update NETWORK_PROGRAM_ID in .env, then:
npx tsx scripts/initialize-network.ts
```

### 5. Register your node

```bash
npx tsx scripts/register-facilitator.ts --endpoint https://your-node.example.com --stake 2000000000
```

### 6. Run everything

```bash
npm run dev:facilitator   # facilitator node → :4402
npm run dev:dashboard     # dashboard UI    → :3000
```

---

## Architecture Decisions

**Why Solana for staking?**  
Sub-cent fees make per-payment `record_payment` calls economically viable. On Ethereum the gas cost would exceed the fee earned on small payments.

**Why EIP-3009 (`transferWithAuthorization`) for EVM?**  
Gasless for the payer — the facilitator submits the settlement tx and pays gas, funded from the fee earned. No approve + transfer round-trip.

**Why on-chain deduplication via PDA?**  
`PaymentRecord` PDAs are derived from the payment ID — a second `record_payment` call with the same ID reverts at the program level. No database needed.

**Why Privy for the dashboard?**  
Supports embedded wallets, so node operators who don't have Phantom installed can still register and manage their node. Falls back to any injected Solana wallet.

**Why Helius for RPC?**  
Enhanced `getProgramAccounts` with indexed filters makes the facilitator discovery call fast at scale. Webhook support lets nodes react to on-chain events (slashing, new registrations) in real time.

---

## Stack

| Layer             | Technology                          |
|-------------------|-------------------------------------|
| Smart contract    | Anchor 0.31 / Rust                  |
| Facilitator node  | Express, TypeScript, viem           |
| Payment protocol  | x402 (Coinbase open standard)       |
| EVM settlement    | viem + EIP-3009                     |
| Solana client     | @solana/web3.js, @coral-xyz/anchor  |
| RPC / Webhooks    | Helius                              |
| Auth / Wallets    | Privy                               |
| Dashboard         | Next.js 14, Tailwind CSS, Recharts  |
| Metrics           | Prometheus (prom-client)            |
| Monorepo          | npm workspaces                      |

---

## Security Notes

- The EVM private key (`EVM_PRIVATE_KEY`) should be stored in a secrets manager (AWS Secrets Manager, Doppler, etc.) — never committed to git.
- The `slash_facilitator` instruction is currently gated by a single authority key. A multisig or DAO vote should replace this before mainnet.
- The rewards vault signer seeds should be audited before mainnet deployment.
- Run `/security-review` before handling real funds.

---

## License

MIT
