/**
 * @x402-network/sdk
 *
 * Merchant SDK — drop-in middleware + client for x402 Network.
 *
 * Quick-start (Express):
 *   import { x402, X402Client } from "@x402-network/sdk/express";
 *   app.use("/api/premium", x402({ price: "1000000", recipient: "YOUR_SOLANA_ADDR" }));
 *
 * Quick-start (Next.js API route):
 *   import { withX402 } from "@x402-network/sdk/next";
 *   export default withX402(handler, { price: "1000000", recipient: "YOUR_SOLANA_ADDR" });
 */

export { X402Client } from "./client.js";
export { createX402Middleware, type X402Options } from "./middleware.js";
export type { X402PaymentPayload, X402Challenge, VerifyResponse } from "./types.js";
