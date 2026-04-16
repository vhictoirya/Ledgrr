/**
 * Integration tests for the x402-network facilitator node.
 * Run against a local facilitator: npm run dev:facilitator
 */

import axios from "axios";
import crypto from "crypto";

const BASE = process.env.FACILITATOR_URL ?? "http://localhost:4402";
const client = axios.create({ baseURL: BASE, validateStatus: () => true });

describe("Facilitator Node", () => {
  test("GET /api/health returns 200", async () => {
    const { status, data } = await client.get("/api/health");
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  test("GET /api/status returns facilitator info", async () => {
    const { status, data } = await client.get("/api/status");
    expect(status).toBe(200);
    expect(data.facilitator).toBeDefined();
    expect(typeof data.networkFeeBps).toBe("number");
  });

  test("GET /api/challenge returns 402 with x402 body", async () => {
    const { status, data } = await client.get("/api/challenge", {
      params: {
        amount: "1000000",
        currency: "USDC",
        recipient: "11111111111111111111111111111111",
        resource: "/api/test-resource",
      },
    });
    expect(status).toBe(402);
    expect(data.x402Version).toBe(1);
    expect(Array.isArray(data.accepts)).toBe(true);
  });

  test("POST /api/verify rejects missing payment header", async () => {
    const { status } = await client.post("/api/verify", {
      payment: null,
      expectedAmount: "1000000",
      expectedRecipient: "11111111111111111111111111111111",
    });
    expect(status).toBe(400);
  });

  test("POST /api/verify returns valid for well-formed payment", async () => {
    const txHash = crypto.randomBytes(32).toString("hex");
    const payment = {
      x402Version: 1,
      amount: "1000000",
      to: "11111111111111111111111111111111",
      chain: "solana",
      txHash,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const { status, data } = await client.post("/api/verify", {
      payment,
      expectedAmount: "1000000",
      expectedRecipient: "11111111111111111111111111111111",
    });

    // In test mode (no real Solana tx), verify returns valid (stub verifier)
    expect(status).toBe(200);
    expect(data.valid).toBe(true);
    expect(data.paymentId).toBeDefined();
  });

  test("GET /api/facilitators returns list", async () => {
    const { status, data } = await client.get("/api/facilitators");
    expect(status).toBe(200);
    expect(Array.isArray(data.facilitators)).toBe(true);
  });
});
