import type { PrivyClientConfig } from "@privy-io/react-auth";

export const privyConfig: PrivyClientConfig = {
  // Appearance
  appearance: {
    theme: "dark",
    accentColor: "#6366f1", // indigo-500
    logo: "/logo.svg",
    landingHeader: "x402 Network",
    loginMessage: "Connect your wallet to manage your facilitator node",
  },

  // Login methods
  loginMethods: ["wallet", "email", "google"],

  // Embedded wallets — Privy creates a Solana wallet automatically
  embeddedWallets: {
    createOnLogin: "all-users",
    requireUserPasswordOnCreate: false,
  },

  // Solana config
  solanaClusters: [
    {
      name: "devnet",
      rpcUrl: process.env.NEXT_PUBLIC_HELIUS_RPC ?? "https://api.devnet.solana.com",
    },
  ],

  // MFA (optional for high-stake operations)
  mfa: {
    noPromptOnMfaRequired: false,
  },
};
