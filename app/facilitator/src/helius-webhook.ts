/**
 * Helius Webhook Handler
 *
 * Subscribes to on-chain events from the x402-network program using
 * Helius enhanced webhooks. Used to:
 *   - Monitor FacilitatorRegistered / StakeWithdrawn events
 *   - Track PaymentRouted events for audit
 *   - Alert on slash events
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { Helius } from "helius-sdk";
import { config } from "./config.js";
import { logger } from "./logger.js";

export function heliusWebhookRouter(): Router {
  const router = Router();

  // POST /webhooks/helius — receives Helius enhanced transaction webhooks
  router.post("/helius", (req: Request, res: Response) => {
    // Verify HMAC signature from Helius
    const signature = req.headers["helius-signature"] as string;
    if (config.heliusWebhookSecret && signature) {
      const expected = crypto
        .createHmac("sha256", config.heliusWebhookSecret)
        .update(JSON.stringify(req.body))
        .digest("hex");
      if (signature !== expected) {
        logger.warn("Invalid Helius webhook signature");
        res.status(401).json({ error: "invalid signature" });
        return;
      }
    }

    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      handleHeliusEvent(event);
    }

    res.json({ ok: true });
  });

  return router;
}

function handleHeliusEvent(event: any): void {
  const { type, signature, timestamp } = event;

  switch (type) {
    case "ACCOUNT_DATA_CHANGE":
      logger.info("Account state changed", { signature, timestamp });
      break;

    case "TRANSFER":
      logger.debug("Token transfer detected", {
        signature,
        amount: event.tokenTransfers?.[0]?.tokenAmount,
      });
      break;

    case "PROGRAM_INTERACTION":
      if (event.accountData?.some((a: any) => a.account === config.networkProgramId)) {
        logger.info("x402-network program interaction", { signature });
        processNetworkEvent(event);
      }
      break;

    default:
      logger.debug("Unhandled Helius event type", { type, signature });
  }
}

function processNetworkEvent(event: any): void {
  // Parse logs to identify instruction type
  const logs: string[] = event.meta?.logMessages ?? [];

  if (logs.some((l) => l.includes("FacilitatorRegistered"))) {
    logger.info("New facilitator registered", { signature: event.signature });
    // Could notify a discovery registry or update local routing table
  } else if (logs.some((l) => l.includes("PaymentRouted"))) {
    logger.info("Payment routed on-chain", { signature: event.signature });
  } else if (logs.some((l) => l.includes("FacilitatorSlashed"))) {
    logger.warn("Facilitator slashed!", { signature: event.signature });
    // Alert ops channel
  }
}

/**
 * Register a Helius webhook for the network program via API.
 * Call once during setup; webhook URL should be your public facilitator endpoint.
 */
export async function registerHeliusWebhook(publicUrl: string): Promise<void> {
  if (!config.heliusApiKey) {
    logger.warn("No HELIUS_API_KEY — skipping webhook registration");
    return;
  }

  const helius = new Helius(config.heliusApiKey);

  try {
    const webhook = await helius.createWebhook({
      accountAddresses: [config.networkProgramId],
      webhookURL: `${publicUrl}/webhooks/helius`,
      transactionTypes: ["Any"] as any,
      webhookType: "enhanced" as any,
      authHeader: config.heliusWebhookSecret,
    });
    logger.info("Helius webhook registered", { webhookId: webhook.webhookID });
  } catch (err: any) {
    logger.error("Failed to register Helius webhook", { error: err.message });
  }
}
