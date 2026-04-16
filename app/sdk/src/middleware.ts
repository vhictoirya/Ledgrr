/**
 * x402 Express / generic middleware
 *
 * Usage:
 *   import { createX402Middleware } from "@x402-network/sdk";
 *
 *   app.use("/api/gated",
 *     createX402Middleware({
 *       price: "1000000",          // 1 USDC (6 decimals)
 *       currency: "USDC",
 *       recipient: "YourSolAddr",
 *       facilitatorUrl: "https://node1.x402.network",
 *     })
 *   );
 */

import type { Request, Response, NextFunction } from "express";
import { X402Client } from "./client.js";
import type { X402Challenge } from "./types.js";

export interface X402Options {
  /** Price in token base units (USDC = 6 decimals, so 1 USDC = "1000000") */
  price: string;
  /** Token symbol */
  currency?: "USDC" | "USDT" | "SOL";
  /** Your wallet address that receives payment */
  recipient: string;
  /** Facilitator node URL */
  facilitatorUrl?: string;
  /** Override resource ID (defaults to req.path) */
  resourceId?: string;
  /**
   * Optional custom verifier — use if you want to run your own verification
   * logic instead of delegating to the facilitator.
   */
  verify?: (payment: unknown, req: Request) => Promise<boolean>;
}

const DEFAULT_FACILITATOR = "http://localhost:4402";

export function createX402Middleware(options: X402Options) {
  const client = new X402Client({
    facilitatorUrl: options.facilitatorUrl ?? DEFAULT_FACILITATOR,
  });

  return async function x402Middleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const paymentHeader = req.headers["x-payment"] as string | undefined;

    // No payment header → issue 402 challenge
    if (!paymentHeader) {
      const resourceId = options.resourceId ?? req.path;

      let challenge: X402Challenge;
      try {
        challenge = await client.getChallenge({
          amount: options.price,
          currency: options.currency ?? "USDC",
          recipient: options.recipient,
          resource: resourceId,
        });
      } catch {
        // Fallback to inline challenge if facilitator is unreachable
        challenge = buildInlineChallenge(options, resourceId);
      }

      res.status(402).json(challenge);
      return;
    }

    // Has payment header → verify it
    const payment = X402Client.parsePaymentHeader(paymentHeader);
    if (!payment) {
      res.status(400).json({ error: "Malformed X-PAYMENT header" });
      return;
    }

    try {
      let valid: boolean;

      if (options.verify) {
        valid = await options.verify(payment, req);
      } else {
        const result = await client.verify(payment, options.price, options.recipient);
        valid = result.valid;
        if (valid) {
          // Attach verification result for downstream handlers
          (req as any).x402 = result;
        }
      }

      if (!valid) {
        res.status(402).json({ error: "Payment verification failed" });
        return;
      }

      next();
    } catch (err: any) {
      res.status(500).json({ error: "Payment verification error", detail: err.message });
    }
  };
}

function buildInlineChallenge(options: X402Options, resourceId: string): X402Challenge {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "solana",
        maxAmountRequired: options.price,
        resource: resourceId,
        description: `Pay ${options.price} ${options.currency ?? "USDC"} to access ${resourceId}`,
        payTo: options.recipient,
        maxTimeoutSeconds: 60,
        asset: options.currency ?? "USDC",
      },
    ],
    error: "payment required",
  };
}

// ─── Next.js helper ──────────────────────────────────────────────────────────

/**
 * withX402 — wrap a Next.js API route handler with x402 payment gating.
 *
 * Usage (pages/api/premium.ts):
 *   export default withX402(handler, { price: "1000000", recipient: "..." });
 */
export function withX402(
  handler: (req: any, res: any) => Promise<void> | void,
  options: X402Options
): (req: any, res: any) => Promise<void> {
  const middleware = createX402Middleware(options);
  return async (req: any, res: any) => {
    await new Promise<void>((resolve, reject) => {
      middleware(req, res, (err?: any) => (err ? reject(err) : resolve()));
    });
    return handler(req, res);
  };
}
