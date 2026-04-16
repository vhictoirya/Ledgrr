import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const metrics = {
  paymentsVerified: new client.Counter({
    name: "x402_payments_verified_total",
    help: "Total payments verified by this facilitator node",
    registers: [register],
  }),
  paymentsReplayed: new client.Counter({
    name: "x402_payments_replayed_total",
    help: "Replay attempts rejected",
    registers: [register],
  }),
  paymentErrors: new client.Counter({
    name: "x402_payment_errors_total",
    help: "Payments that failed verification",
    registers: [register],
  }),
  volumeRouted: new client.Counter({
    name: "x402_volume_routed_usdc",
    help: "Total USDC volume routed (micro-units)",
    registers: [register],
  }),
  feesEarned: new client.Counter({
    name: "x402_fees_earned_usdc",
    help: "Total fees earned by this node",
    registers: [register],
  }),
  activeConnections: new client.Gauge({
    name: "x402_active_connections",
    help: "Active facilitator connections",
    registers: [register],
  }),
  register,
};
