import express from "express";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { apiRouter } from "./routes.js";
import { heliusWebhookRouter, registerHeliusWebhook } from "./helius-webhook.js";
import { solanaClient } from "./solana-client.js";

async function main() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Trust proxy headers (important behind nginx/cloudflare)
  app.set("trust proxy", 1);

  // CORS — allow any origin for MVP (tighten in production)
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-PAYMENT");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    next();
  });

  // Mount routes
  app.use("/api", apiRouter());
  app.use("/webhooks", heliusWebhookRouter());

  // Root — quick facilitator info card
  app.get("/", (_req, res) => {
    res.json({
      name: "x402-network facilitator",
      version: "0.1.0",
      address: solanaClient.publicKey.toBase58(),
      feeBps: config.networkFeeBps,
      docs: `${config.facilitatorUrl}/api`,
    });
  });

  const server = app.listen(config.port, () => {
    logger.info(`Facilitator node running`, {
      port: config.port,
      address: solanaClient.publicKey.toBase58(),
      rpc: config.rpcUrl.replace(/api-key=[^&]+/, "api-key=***"),
    });
  });

  // Register Helius webhook on startup (idempotent)
  if (config.heliusApiKey && config.facilitatorUrl !== "http://localhost:4402") {
    await registerHeliusWebhook(config.facilitatorUrl);
  }

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received — shutting down");
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", { err });
  process.exit(1);
});
