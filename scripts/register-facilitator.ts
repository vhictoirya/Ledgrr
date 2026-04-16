#!/usr/bin/env tsx
/**
 * Register this node as a facilitator on the x402-network.
 *
 * Usage: npx tsx scripts/register-facilitator.ts \
 *   --endpoint https://your-node.example.com \
 *   --stake 2000000000
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { readFileSync } from "fs";
import dotenv from "dotenv";
dotenv.config();

const args = process.argv.slice(2);
const endpointIdx = args.indexOf("--endpoint");
const stakeIdx = args.indexOf("--stake");
const ENDPOINT = endpointIdx >= 0 ? args[endpointIdx + 1] : process.env.FACILITATOR_URL!;
const STAKE_AMOUNT = stakeIdx >= 0 ? parseInt(args[stakeIdx + 1]) : 2_000_000_000; // 2,000 tokens default

async function main() {
  const raw = JSON.parse(readFileSync(process.env.FACILITATOR_KEYPAIR_PATH!, "utf-8"));
  const facilitatorKeypair = Keypair.fromSecretKey(new Uint8Array(raw));

  const connection = new Connection(
    process.env.HELIUS_RPC_URL ?? "https://api.devnet.solana.com",
    "confirmed"
  );
  const wallet = new anchor.Wallet(facilitatorKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync("./target/idl/x402_network.json", "utf-8"));
  const program = new anchor.Program(idl, provider);
  const PROGRAM_ID = new PublicKey(process.env.NETWORK_PROGRAM_ID!);
  const STAKE_MINT = new PublicKey(process.env.STAKE_MINT!);

  const facilitatorTokenAccount = await getAssociatedTokenAddress(
    STAKE_MINT,
    facilitatorKeypair.publicKey
  );

  console.log("Registering facilitator...");
  console.log("Address:", facilitatorKeypair.publicKey.toBase58());
  console.log("Endpoint:", ENDPOINT);
  console.log("Stake:", STAKE_AMOUNT / 1_000_000, "X402 tokens");

  const tx = await (program.methods as any)
    .registerFacilitator(new anchor.BN(STAKE_AMOUNT), ENDPOINT, "")
    .accounts({
      facilitator: facilitatorKeypair.publicKey,
      facilitatorTokenAccount,
      stakeMint: STAKE_MINT,
    })
    .rpc();

  console.log("\n✅ Registered! Tx:", tx);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
