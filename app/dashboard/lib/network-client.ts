/**
 * Network client — fetches facilitator state from the chain and the node API.
 * Used by dashboard hooks.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";

const FACILITATOR_URL =
  process.env.NEXT_PUBLIC_FACILITATOR_URL ?? "http://localhost:4402";
const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC ?? "https://api.devnet.solana.com";

export const connection = new Connection(RPC, "confirmed");

export interface FacilitatorStatus {
  facilitator: string;
  endpoint: string;
  networkFeeBps: number;
  onChain: {
    stakedAmount: string;
    pendingRewards: string;
    totalEarned: string;
    paymentsRouted: string;
    status: string;
  } | null;
  solBalance: number;
}

export interface NetworkStats {
  totalFacilitators: number;
  totalStaked: string;
  totalPaymentsRouted: string;
  totalFeesCollected: string;
  feeBps: number;
}

export async function fetchFacilitatorStatus(): Promise<FacilitatorStatus> {
  const { data } = await axios.get(`${FACILITATOR_URL}/api/status`);
  return data;
}

export async function fetchActiveFacilitators() {
  const { data } = await axios.get(`${FACILITATOR_URL}/api/facilitators`);
  return data.facilitators as Array<{
    address: string;
    endpoint: string;
    feeBps: number;
    status: string;
  }>;
}

/** Get SOL balance for an address */
export async function getSolBalance(address: string): Promise<number> {
  const lamports = await connection.getBalance(new PublicKey(address));
  return lamports / 1e9;
}

/** Format USDC amount from micro-units (6 decimals) */
export function formatUsdc(microUnits: string | number | bigint): string {
  const n = typeof microUnits === "bigint" ? microUnits : BigInt(microUnits.toString());
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  return `${whole.toLocaleString()}.${frac.toString().padStart(6, "0").slice(0, 2)}`;
}

/** Format token amount (1B base units = 1000 tokens with 6 decimals) */
export function formatTokens(baseUnits: string | number): string {
  const n = Number(baseUnits) / 1_000_000;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
