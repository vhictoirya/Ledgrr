/**
 * Demo x402 client (EVM / Base Sepolia)
 *
 * Simulates a paying client:
 *   1. Hits /premium → gets 402 + payment requirements
 *   2. Signs a TransferWithAuthorization using a funded test wallet
 *   3. Encodes the payload as X-Payment header
 *   4. Re-requests /premium with the payment
 *   5. Logs the unlocked resource
 *
 * Usage:
 *   EVM_PRIVATE_KEY=0x... MERCHANT_URL=http://localhost:3001 npx tsx src/client.ts
 */

import axios from "axios";
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { exact } from "x402/schemes";
const exactEvm = exact.evm;
import dotenv from "dotenv";
dotenv.config();

const MERCHANT_URL = process.env.MERCHANT_URL ?? "http://localhost:3001";
const EVM_PRIVATE_KEY = (process.env.EVM_PRIVATE_KEY ?? "") as `0x${string}`;

async function main() {
  if (!EVM_PRIVATE_KEY) {
    console.error("Set EVM_PRIVATE_KEY (funded Base Sepolia wallet)");
    process.exit(1);
  }

  const account = privateKeyToAccount(EVM_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });

  console.log(`Client wallet: ${account.address}`);

  // ── Step 1: Hit the gated endpoint → get 402 ──────────────────────────
  console.log("\n1. Requesting premium resource...");
  const { data: challenge, status } = await axios.get(`${MERCHANT_URL}/premium`, {
    validateStatus: () => true,
  });

  if (status !== 402) {
    console.log("Unexpected status:", status, challenge);
    process.exit(1);
  }

  console.log("   Got 402. Payment required.");
  const requirements = challenge.accepts[0];
  console.log(`   Pay: ${requirements.maxAmountRequired} ${requirements.asset} on ${requirements.network}`);
  console.log(`   Recipient: ${requirements.payTo}`);

  // ── Step 2: Sign the payment authorization ────────────────────────────
  console.log("\n2. Signing TransferWithAuthorization...");
  const payment = await exactEvm.createPaymentHeader(
    walletClient,
    challenge.x402Version,
    requirements
  );
  const encodedPayment = payment;
  console.log("   Signed. Encoding X-Payment header...");

  // ── Step 3: Re-request with X-Payment header ──────────────────────────
  console.log("\n3. Re-requesting with X-Payment header...");
  const { data: result, status: finalStatus } = await axios.get(`${MERCHANT_URL}/premium`, {
    headers: { "X-Payment": encodedPayment },
    validateStatus: () => true,
  });

  if (finalStatus !== 200) {
    console.error("Payment rejected:", result);
    process.exit(1);
  }

  // ── Step 4: Log the result ────────────────────────────────────────────
  console.log("\n✅ Access granted!");
  console.log("   Message:", result.message);
  console.log("   Secret:", result.data.secret);
  console.log("   API Key:", result.data.apiKey);
  console.log("   Settlement tx:", result.payment.transaction);
  console.log("   Facilitator fee:", result.payment.facilitatorFee, "USDC micro-units");
}

main().catch((err) => {
  console.error(err.response?.data ?? err.message);
  process.exit(1);
});
