"use client";

import { useState, useEffect, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  fetchFacilitatorAccount,
  fetchNetworkConfig,
  buildRegisterFacilitatorTx,
  buildClaimRewardsTx,
  buildAddStakeTx,
  buildRequestUnstakeTx,
  buildWithdrawStakeTx,
} from "@/lib/anchor-client";

const RPC = process.env.NEXT_PUBLIC_HELIUS_RPC ?? "https://api.devnet.solana.com";
const STAKE_MINT = process.env.NEXT_PUBLIC_STAKE_MINT ?? "";
const FACILITATOR_URL =
  process.env.NEXT_PUBLIC_FACILITATOR_URL ?? "http://localhost:4402";

export interface FacilitatorState {
  stakedAmount: string;
  pendingRewards: string;
  totalEarned: string;
  paymentsRouted: string;
  status: string;
  registeredAt: number;
  endpointUrl: string;
}

export interface NetworkConfig {
  feeBps: number;
  minStake: string;
  totalStaked: string;
  totalFacilitators: string;
  totalPaymentsRouted: string;
  totalFeesCollected: string;
}

export interface ActiveFacilitator {
  address: string;
  endpoint: string;
  feeBps: number;
  status: string;
  stakedAmount: string;
}

export function useFacilitator() {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const solanaWallet = wallets.find((w) => w.walletClientType !== "coinbase_smart_wallet");

  const [facilitatorState, setFacilitatorState] = useState<FacilitatorState | null>(null);
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig | null>(null);
  const [activeFacilitators, setActiveFacilitators] = useState<ActiveFacilitator[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletAddress = solanaWallet?.address ?? user?.wallet?.address;

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const connection = new Connection(RPC, "confirmed");
      const pubkey = new PublicKey(walletAddress);

      const [accState, netCfg, facilitatorsRes] = await Promise.all([
        fetchFacilitatorAccount(connection, pubkey),
        fetchNetworkConfig(connection),
        fetch(`${FACILITATOR_URL}/api/facilitators`)
          .then((r) => r.json())
          .catch(() => ({ facilitators: [] })),
      ]);

      setFacilitatorState(accState);
      setNetworkConfig(netCfg);
      setActiveFacilitators(facilitatorsRes.facilitators ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    facilitatorState,
    networkConfig,
    activeFacilitators,
    loading,
    error,
    refresh,
    walletAddress,
    solanaWallet,
  };
}

// ─── Transaction hooks ────────────────────────────────────────────────────────

export function useNodeActions() {
  const { wallets } = useWallets();
  const solanaWallet = wallets.find((w) => w.walletClientType !== "coinbase_smart_wallet");
  const [txLoading, setTxLoading] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  async function sendTx(label: string, buildFn: () => Promise<any>) {
    if (!solanaWallet) {
      setTxError("No Solana wallet connected");
      return;
    }
    setTxLoading(label);
    setTxError(null);
    try {
      const connection = new Connection(RPC, "confirmed");
      const tx = await buildFn();
      const sig = await solanaWallet.sendTransaction(tx, connection);
      setLastTx(sig);
      return sig;
    } catch (err: any) {
      setTxError(err.message);
      throw err;
    } finally {
      setTxLoading(null);
    }
  }

  async function register(endpointUrl: string, stakeAmount: bigint) {
    const connection = new Connection(RPC, "confirmed");
    const pubkey = new PublicKey(solanaWallet!.address);
    const stakeMint = new PublicKey(STAKE_MINT);
    const ata = await getAssociatedTokenAddress(stakeMint, pubkey);
    return sendTx("register", () =>
      buildRegisterFacilitatorTx(connection, pubkey, stakeMint, ata, stakeAmount, endpointUrl)
    );
  }

  async function claimRewards() {
    const connection = new Connection(RPC, "confirmed");
    const pubkey = new PublicKey(solanaWallet!.address);
    const stakeMint = new PublicKey(STAKE_MINT);
    const ata = await getAssociatedTokenAddress(stakeMint, pubkey);
    return sendTx("claim", () => buildClaimRewardsTx(connection, pubkey, ata));
  }

  async function addStake(amount: bigint) {
    const connection = new Connection(RPC, "confirmed");
    const pubkey = new PublicKey(solanaWallet!.address);
    const stakeMint = new PublicKey(STAKE_MINT);
    const ata = await getAssociatedTokenAddress(stakeMint, pubkey);
    return sendTx("addStake", () => buildAddStakeTx(connection, pubkey, ata, amount));
  }

  async function requestUnstake() {
    const connection = new Connection(RPC, "confirmed");
    const pubkey = new PublicKey(solanaWallet!.address);
    return sendTx("unstake", () => buildRequestUnstakeTx(connection, pubkey));
  }

  async function withdrawStake() {
    const connection = new Connection(RPC, "confirmed");
    const pubkey = new PublicKey(solanaWallet!.address);
    const stakeMint = new PublicKey(STAKE_MINT);
    const ata = await getAssociatedTokenAddress(stakeMint, pubkey);
    return sendTx("withdraw", () => buildWithdrawStakeTx(connection, pubkey, ata));
  }

  return {
    register,
    claimRewards,
    addStake,
    requestUnstake,
    withdrawStake,
    txLoading,
    txError,
    lastTx,
  };
}

/** Simulated 30-day earnings chart until Helius tx history is wired */
export function useEarningsHistory() {
  const [data, setData] = useState<Array<{ date: string; earned: number; payments: number }>>([]);

  useEffect(() => {
    const now = Date.now();
    const points = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(now - (29 - i) * 86400_000);
      return {
        date: date.toLocaleDateString("en", { month: "short", day: "numeric" }),
        earned: Math.random() * 50 + 5,
        payments: Math.floor(Math.random() * 500 + 50),
      };
    });
    setData(points);
  }, []);

  return data;
}
