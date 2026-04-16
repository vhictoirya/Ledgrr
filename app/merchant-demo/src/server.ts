/**
 * Merchant Demo Server
 *
 * A simple Express API with two routes:
 *   GET /free     — public, no payment
 *   GET /premium  — requires x402 payment, verified via facilitator
 *
 * Flow:
 *   1. Client requests GET /premium
 *   2. Server returns 402 with PaymentRequired body
 *   3. Client pays on Base Sepolia (or Solana), gets tx hash
 *   4. Client encodes payload → X-Payment header, retries request
 *   5. Server forwards X-Payment to facilitator /settle
 *   6. Facilitator verifies + executes transferWithAuthorization on-chain
 *   7. Facilitator records payment on x402-network program (earns fee)
 *   8. Server returns the premium resource
 */

import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { exact } from "x402/schemes";
dotenv.config();

const PORT = parseInt(process.env.PORT ?? "3001");
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4402";
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS ?? "";

// Price: 0.01 USDC = 10_000 base units (6 decimals)
const PRICE = process.env.RESOURCE_PRICE ?? "10000";
const NETWORK = process.env.PAYMENT_NETWORK ?? "base-sepolia";
// Base Sepolia USDC
const USDC_ASSET = process.env.USDC_ASSET ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const app = express();
app.use(express.json());

// ─── Free endpoint ─────────────────────────────────────────────────────────
app.get("/free", (_req, res) => {
  res.json({
    message: "This is free content. No payment required.",
    timestamp: new Date().toISOString(),
  });
});

// ─── Gated endpoint ────────────────────────────────────────────────────────
app.get("/premium", async (req, res) => {
  const paymentHeader = req.headers["x-payment"] as string | undefined;

  if (!paymentHeader) {
    // 1. No payment → issue 402 challenge
    const challenge = buildChallenge(req.path);
    res.status(402).json(challenge);
    return;
  }

  // 2. Has X-Payment header → decode and settle via facilitator
  let payload: any;
  try {
    payload = exact.evm.decodePayment(paymentHeader);
  } catch {
    res.status(400).json({ error: "malformed X-Payment header" });
    return;
  }

  const requirements = buildRequirements(req.path);

  try {
    const { data } = await axios.post(
      `${FACILITATOR_URL}/api/settle`,
      { payload, paymentRequirements: requirements },
      { timeout: 30_000 }
    );

    if (!data.success) {
      res.status(402).json({ error: "payment rejected", detail: data.errorReason });
      return;
    }

    // Payment settled — return premium content
    res.json({
      message: "You unlocked premium content!",
      data: {
        secret: "The answer is 42",
        apiKey: `demo-key-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      payment: {
        network: data.network,
        transaction: data.transaction,
        facilitatorFee: data.facilitatorFee,
      },
    });
  } catch (err: any) {
    const msg = err.response?.data?.error ?? err.message;
    res.status(402).json({ error: "facilitator unavailable", detail: msg });
  }
});

// ─── Payment requirement builders ──────────────────────────────────────────

function buildRequirements(resourcePath: string) {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: PRICE,
    resource: `${FACILITATOR_URL}${resourcePath}`,
    description: `Pay ${PRICE} USDC to access ${resourcePath}`,
    mimeType: "application/json",
    payTo: MERCHANT_ADDRESS,
    maxTimeoutSeconds: 300,
    asset: USDC_ASSET,
    extra: {
      name: "USDC",
      version: "2",
      facilitator: FACILITATOR_URL,
    },
  };
}

function buildChallenge(resourcePath: string) {
  return {
    x402Version: 1,
    accepts: [buildRequirements(resourcePath)],
    error: "X-PAYMENT required",
  };
}

app.listen(PORT, () => {
  console.log(`Merchant demo server running at http://localhost:${PORT}`);
  console.log(`  Free:    http://localhost:${PORT}/free`);
  console.log(`  Premium: http://localhost:${PORT}/premium  (requires ${PRICE} USDC on ${NETWORK})`);
  console.log(`  Facilitator: ${FACILITATOR_URL}`);
});
