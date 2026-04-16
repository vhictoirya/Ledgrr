/**
 * Facilitator HTTP Routes
 *
 * Implements the x402 facilitator interface:
 *   POST /verify   — verify a payment payload against requirements
 *   POST /settle   — verify + settle EVM, or verify + record Solana
 *
 * Plus:
 *   GET  /health        — liveness probe
 *   GET  /status        — node state + network config
 *   GET  /facilitators  — live on-chain facilitator list (Helius getProgramAccounts)
 *   GET  /challenge     — build a 402 payment-required body
 *   GET  /metrics       — Prometheus metrics
 */

import { Router, Request, Response } from "express";
import { paymentHandler } from "./payment-handler.js";
import { solanaClient } from "./solana-client.js";
import { metrics } from "./metrics.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { X402PaymentPayload, PaymentRequirements } from "./payment-handler.js";

export function apiRouter(): Router {
  const router = Router();

  // ─── Health ─────────────────────────────────────────────────────────────

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, version: "0.1.0", ts: Date.now() });
  });

  // ─── Status ──────────────────────────────────────────────────────────────

  router.get("/status", async (_req: Request, res: Response) => {
    try {
      const [state, networkConfig, solBalance] = await Promise.all([
        solanaClient.getFacilitatorState(),
        solanaClient.getNetworkConfig(),
        solanaClient.getSolBalance(),
      ]);

      res.json({
        facilitator: solanaClient.publicKey.toBase58(),
        endpoint: config.facilitatorUrl,
        networkFeeBps: config.networkFeeBps,
        onChain: state,
        networkConfig,
        solBalance,
        supportedNetworks: ["solana", "base", "base-sepolia", "avalanche", "avalanche-fuji"],
        rpc: config.rpcUrl.replace(/api-key=[^&]+/, "api-key=***"),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Challenge (402 payment-required builder) ────────────────────────────

  router.get("/challenge", (req: Request, res: Response) => {
    const {
      amount,
      currency = "USDC",
      network = "base-sepolia",
      recipient,
      asset,
      resource,
    } = req.query as Record<string, string>;

    if (!amount || !recipient || !resource) {
      res.status(400).json({ error: "amount, recipient, resource required" });
      return;
    }

    const body = paymentHandler.buildPaymentRequired({
      amount,
      currency,
      network,
      payTo: recipient,
      // EVM: USDC contract address; Solana: token mint
      asset: asset ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC
      resourceId: resource,
    });

    res.status(402).json(body);
  });

  // ─── x402 Verify ─────────────────────────────────────────────────────────

  /**
   * POST /verify
   * Body: { payload: X402PaymentPayload, paymentRequirements: PaymentRequirements }
   *
   * x402 standard interface. Verifies the payment signature/tx.
   * Returns: { isValid, invalidReason?, payer }
   */
  router.post("/verify", async (req: Request, res: Response) => {
    const { payload, paymentRequirements } = req.body as {
      payload: X402PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!payload || !paymentRequirements) {
      res.status(400).json({ error: "payload and paymentRequirements required" });
      return;
    }

    const result = await paymentHandler.verify(payload, paymentRequirements);

    if (!result.valid) {
      logger.warn("Payment verify failed", {
        error: result.error,
        network: payload.network,
      });
      res.status(402).json({
        isValid: false,
        invalidReason: result.error,
        payer: result.payer,
      });
      return;
    }

    logger.info("Payment verified", {
      network: payload.network,
      grossAmount: result.grossAmount.toString(),
    });

    res.json({
      isValid: true,
      payer: result.payer ?? "unknown",
      paymentId: Buffer.from(result.paymentId).toString("hex"),
    });
  });

  // ─── x402 Settle ─────────────────────────────────────────────────────────

  /**
   * POST /settle
   * Body: { payload: X402PaymentPayload, paymentRequirements: PaymentRequirements }
   *
   * x402 standard interface. For EVM: executes the transferWithAuthorization.
   * For Solana: verifies the already-submitted tx and records on-chain.
   * Returns: { success, network, transaction, payer? }
   */
  router.post("/settle", async (req: Request, res: Response) => {
    const { payload, paymentRequirements } = req.body as {
      payload: X402PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!payload || !paymentRequirements) {
      res.status(400).json({ error: "payload and paymentRequirements required" });
      return;
    }

    const result = await paymentHandler.settle(payload, paymentRequirements);

    if (!result.success) {
      logger.warn("Payment settle failed", {
        errorReason: result.errorReason,
        network: result.network,
      });
      res.status(402).json(result);
      return;
    }

    const feeBps = config.networkFeeBps;
    const gross = BigInt(paymentRequirements.maxAmountRequired);
    const facilitatorFee = (gross * BigInt(feeBps) * 8000n) / (10000n * 10000n);
    metrics.feesEarned.inc(Number(facilitatorFee));

    logger.info("Payment settled", {
      network: result.network,
      tx: result.transaction,
      facilitatorFee: facilitatorFee.toString(),
    });

    res.json({
      ...result,
      facilitatorFee: facilitatorFee.toString(),
    });
  });

  // ─── Facilitator Discovery ───────────────────────────────────────────────

  /**
   * GET /facilitators
   * Returns all active facilitators fetched live from the x402-network program
   * via Helius getProgramAccounts.
   */
  router.get("/facilitators", async (_req: Request, res: Response) => {
    try {
      const facilitators = await solanaClient.getActiveFacilitators();
      const networkConfig = await solanaClient.getNetworkConfig();

      res.json({
        facilitators,
        networkFeeBps: networkConfig?.feeBps ?? config.networkFeeBps,
        totalStaked: networkConfig?.totalStaked ?? "0",
        count: facilitators.length,
      });
    } catch (err: any) {
      logger.error("Failed to fetch facilitators", { err: err.message });
      // Fallback: return this node only
      res.json({
        facilitators: [
          {
            address: solanaClient.publicKey.toBase58(),
            endpoint: config.facilitatorUrl,
            feeBps: config.networkFeeBps,
            status: "active",
            stakedAmount: "0",
          },
        ],
        networkFeeBps: config.networkFeeBps,
        count: 1,
      });
    }
  });

  // ─── Prometheus metrics ──────────────────────────────────────────────────

  router.get("/metrics", async (_req: Request, res: Response) => {
    res.set("Content-Type", metrics.register.contentType);
    res.end(await metrics.register.metrics());
  });

  return router;
}
