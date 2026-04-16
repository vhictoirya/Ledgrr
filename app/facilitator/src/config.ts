import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  // Server
  port: parseInt(process.env.PORT ?? "4402"),
  nodeEnv: process.env.NODE_ENV ?? "development",

  // Solana
  rpcUrl: process.env.HELIUS_RPC_URL ?? "https://api.devnet.solana.com",
  facilitatorKeypairPath:
    process.env.FACILITATOR_KEYPAIR_PATH ?? `${process.env.HOME}/.config/solana/id.json`,
  networkProgramId:
    process.env.NETWORK_PROGRAM_ID ?? "5RqkCAYtJD5JuFU1RKrn1w1KKpAgwv5bhZv8aZXmhh5g",
  stakeMint: process.env.STAKE_MINT ?? "",

  // EVM (for settling EVM x402 payments on Base / Avalanche)
  // Fund this wallet with ETH/AVAX for gas. It receives the USDC from clients.
  evmPrivateKey: process.env.EVM_PRIVATE_KEY ?? "",
  evmWalletAddress: process.env.EVM_WALLET_ADDRESS ?? "",

  // Helius
  heliusApiKey: process.env.HELIUS_API_KEY ?? "",
  heliusWebhookSecret: process.env.HELIUS_WEBHOOK_SECRET ?? "",

  // x402
  facilitatorUrl: process.env.FACILITATOR_URL ?? `http://localhost:4402`,
  networkFeeBps: parseInt(process.env.NETWORK_FEE_BPS ?? "7"), // 0.07%

  // Metrics
  metricsPort: parseInt(process.env.METRICS_PORT ?? "9090"),
} as const;
