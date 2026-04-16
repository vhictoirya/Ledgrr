# x402 Network — Getting Started

## What was built

```
x402-network/
├── programs/x402-network/src/lib.rs   ← Anchor staking program (Rust)
├── app/facilitator/                    ← Facilitator node (Express + x402)
├── app/sdk/                            ← Merchant SDK (@x402-network/sdk)
├── app/dashboard/                      ← Dashboard (Next.js + Privy)
├── scripts/setup-devnet.ts             ← Devnet bootstrap
├── scripts/initialize-network.ts       ← Program init
└── scripts/register-facilitator.ts     ← Node registration
```

## Step 1 — Install Rust + Solana toolchain

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Solana CLI
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
source ~/.profile

# Anchor via AVM
cargo install --git https://github.com/solana-foundation/anchor avm --locked
avm update
```

## Step 2 — Configure .env files

```bash
cp app/facilitator/.env.example app/facilitator/.env
# Edit: add HELIUS_API_KEY, FACILITATOR_URL
```

## Step 3 — Bootstrap devnet

```bash
npx tsx scripts/setup-devnet.ts
# → creates facilitator.json keypair
# → airdrops 2 SOL
# → creates X402 test token
# → mints 10,000 tokens to your wallet
```

## Step 4 — Build and deploy the Anchor program

```bash
anchor build
anchor deploy --provider.cluster devnet
# Copy the program ID from output → update NETWORK_PROGRAM_ID in .env
npx tsx scripts/initialize-network.ts
```

## Step 5 — Register your node + run it

```bash
npx tsx scripts/register-facilitator.ts --endpoint https://your-node.example.com
npm run dev:facilitator
# Node running at http://localhost:4402
```

## Step 6 — Dashboard

```bash
cp app/dashboard/.env.example app/dashboard/.env.local
# Edit: add NEXT_PUBLIC_PRIVY_APP_ID (from dashboard.privy.io)
npm run dev:dashboard
# → http://localhost:3000
```

## Merchant integration (3 lines)

```ts
import { createX402Middleware } from "@x402-network/sdk";

app.use("/api/premium",
  createX402Middleware({
    price: "1000000",        // 1 USDC
    recipient: "YOUR_ADDR",
    facilitatorUrl: "https://your-facilitator.example.com",
  })
);
```

## Fee economics

| Metric              | Value               |
|---------------------|---------------------|
| Network fee         | 0.07% (7 bps)       |
| Facilitator share   | 80% of fee          |
| Protocol treasury   | 20% of fee          |
| Min stake           | 1,000 X402 tokens   |
| Unstake timelock    | 7 days              |

## Next: Security review

Run `/review-and-iterate` for a full security audit before mainnet.
