#!/usr/bin/env tsx
/**
 * Initialize the x402-network Anchor program on devnet.
 * Run after `anchor deploy`.
 *
 * Usage: npx tsx scripts/initialize-network.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import dotenv from "dotenv";
dotenv.config();

const PROGRAM_ID = new PublicKey(process.env.NETWORK_PROGRAM_ID!);
const RPC = process.env.HELIUS_RPC_URL ?? "https://api.devnet.solana.com";
const STAKE_MINT = new PublicKey(process.env.STAKE_MINT!);
const FEE_BPS = 7; // 0.07%
const MIN_STAKE = 1_000_000_000; // 1,000 tokens

async function main() {
  const raw = JSON.parse(readFileSync(process.env.FACILITATOR_KEYPAIR_PATH!, "utf-8"));
  const authority = Keypair.fromSecretKey(new Uint8Array(raw));

  const connection = new Connection(RPC, "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load IDL from build artifacts
  const idl = JSON.parse(readFileSync("./target/idl/x402_network.json", "utf-8"));
  const program = new anchor.Program(idl, provider);

  const [networkConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("network_config")],
    PROGRAM_ID
  );

  console.log("Initializing x402-network program...");
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("NetworkConfig PDA:", networkConfigPDA.toBase58());

  const tx = await (program.methods as any)
    .initialize(FEE_BPS, new anchor.BN(MIN_STAKE))
    .accounts({
      authority: authority.publicKey,
      stakeMint: STAKE_MINT,
    })
    .rpc();

  console.log("\n✅ Network initialized! Tx:", tx);
  console.log("NetworkConfig PDA:", networkConfigPDA.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
