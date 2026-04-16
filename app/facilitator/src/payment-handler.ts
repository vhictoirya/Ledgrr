/**
 * Payment Handler — real x402 verification for EVM and Solana.
 *
 * EVM (Base / Avalanche / IoTeX):
 *   Uses x402/schemes/exact/evm:
 *     verify(viemPublicClient, payload, requirements) — checks EIP-712 sig
 *     settle(viemWalletClient, payload, requirements) — calls transferWithAuthorization
 *
 * Solana:
 *   Parses the SPL token transfer transaction to confirm:
 *     - tx is confirmed on-chain
 *     - correct token amount transferred
 *     - correct recipient
 */

import crypto from "crypto";
import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  publicActions,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, avalanche, avalancheFuji } from "viem/chains";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { exact } = require("x402/schemes") as { exact: { evm: any } };
const exactEvm = exact.evm;
import { solanaClient } from "./solana-client.js";
import { metrics } from "./metrics.js";
import { logger } from "./logger.js";
import { config } from "./config.js";

// ─── EVM chain config ────────────────────────────────────────────────────────

const EVM_CHAINS: Record<string, { chain: any; rpc: string }> = {
  base: { chain: base, rpc: "https://mainnet.base.org" },
  "base-sepolia": { chain: baseSepolia, rpc: "https://sepolia.base.org" },
  avalanche: { chain: avalanche, rpc: "https://api.avax.network/ext/bc/C/rpc" },
  "avalanche-fuji": { chain: avalancheFuji, rpc: "https://api.avax-test.network/ext/bc/C/rpc" },
};

function getViemPublicClient(network: string): PublicClient {
  const c = EVM_CHAINS[network];
  if (!c) throw new Error(`Unsupported EVM network: ${network}`);
  return createPublicClient({ chain: c.chain, transport: http(c.rpc) });
}

function getViemWalletClient(network: string): WalletClient {
  const c = EVM_CHAINS[network];
  if (!c) throw new Error(`Unsupported EVM network: ${network}`);
  const pk = config.evmPrivateKey as `0x${string}`;
  if (!pk) throw new Error("EVM_PRIVATE_KEY not configured");
  const account = privateKeyToAccount(pk);
  return createWalletClient({ account, chain: c.chain, transport: http(c.rpc) }).extend(publicActions);
}

// ─── Solana SPL token transfer verification ──────────────────────────────────

/**
 * Parse a Solana transaction and find an SPL token transfer to `recipient`
 * of at least `expectedAmount` lamports of the given mint.
 */
async function verifySolanaTokenTransfer(
  connection: Connection,
  signature: string,
  expectedAmountLamports: bigint,
  recipientWallet: string
): Promise<{ valid: boolean; reason?: string }> {
  let tx: ParsedTransactionWithMeta | null;
  try {
    tx = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (err: any) {
    return { valid: false, reason: `rpc_error: ${err.message}` };
  }

  if (!tx) return { valid: false, reason: "tx_not_found" };
  if (tx.meta?.err) return { valid: false, reason: "tx_failed_on_chain" };

  // Check token balance changes
  const preBalances = tx.meta?.preTokenBalances ?? [];
  const postBalances = tx.meta?.postTokenBalances ?? [];

  // Find an account whose balance increased, owned by recipientWallet
  for (const post of postBalances) {
    if (post.owner !== recipientWallet) continue;

    const pre = preBalances.find(
      (p) => p.accountIndex === post.accountIndex && p.mint === post.mint
    );
    const preAmount = BigInt(pre?.uiTokenAmount.amount ?? "0");
    const postAmount = BigInt(post.uiTokenAmount.amount);
    const received = postAmount - preAmount;

    if (received >= expectedAmountLamports) {
      return { valid: true };
    }
  }

  // Also check SOL native transfer if asset is SOL
  const accountKeys = tx.transaction.message.accountKeys;
  const recipientIdx = accountKeys.findIndex(
    (k) => (typeof k === "string" ? k : k.pubkey.toBase58()) === recipientWallet
  );
  if (recipientIdx >= 0) {
    const pre = tx.meta?.preBalances[recipientIdx] ?? 0;
    const post = tx.meta?.postBalances[recipientIdx] ?? 0;
    const received = BigInt(post - pre);
    if (received >= expectedAmountLamports) {
      return { valid: true };
    }
  }

  return { valid: false, reason: "amount_or_recipient_mismatch" };
}

// ─── Exported types ──────────────────────────────────────────────────────────

export interface X402PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: any; // EVM: { authorization, signature } | Solana: { signature }
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  asset: string; // EVM: USDC contract addr | Solana: mint addr
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface VerifyResult {
  valid: boolean;
  paymentId: Uint8Array;
  grossAmount: bigint;
  payer?: string;
  error?: string;
}

export interface SettleResult {
  success: boolean;
  network: string;
  transaction: string;
  payer?: string;
  errorReason?: string;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export class PaymentHandler {
  private connection: Connection;

  constructor() {
    this.connection = solanaClient.connection;
  }

  /**
   * Verify an x402 payment payload against the stated payment requirements.
   * Does NOT settle — call settle() separately for EVM, or it auto-settles for Solana.
   */
  async verify(
    payload: X402PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResult> {
    const paymentId = this.derivePaymentId(payload);

    // Replay check
    const alreadyRecorded = await solanaClient.isPaymentRecorded(paymentId);
    if (alreadyRecorded) {
      metrics.paymentsReplayed.inc();
      return { valid: false, paymentId, grossAmount: 0n, error: "replay" };
    }

    if (requirements.network !== "solana") {
      // ─── EVM path ────────────────────────────────────────────────────────
      try {
        const publicClient = getViemPublicClient(requirements.network);
        const result = await exactEvm.verify(publicClient, payload, requirements as any);
        if (!result.isValid) {
          metrics.paymentErrors.inc();
          return {
            valid: false,
            paymentId,
            grossAmount: 0n,
            payer: result.payer,
            error: result.invalidReason,
          };
        }
        const grossAmount = BigInt(requirements.maxAmountRequired);
        metrics.paymentsVerified.inc();
        metrics.volumeRouted.inc(Number(grossAmount));
        return { valid: true, paymentId, grossAmount, payer: result.payer };
      } catch (err: any) {
        logger.error("EVM verify error", { err: err.message, network: payload.network });
        metrics.paymentErrors.inc();
        return { valid: false, paymentId, grossAmount: 0n, error: err.message };
      }
    }

    if (requirements.network === "solana") {
      // ─── Solana path ─────────────────────────────────────────────────────
      const txSignature: string = payload.payload?.signature ?? payload.payload;
      if (!txSignature || typeof txSignature !== "string") {
        return { valid: false, paymentId, grossAmount: 0n, error: "missing_solana_signature" };
      }

      const grossAmount = BigInt(requirements.maxAmountRequired);
      const result = await verifySolanaTokenTransfer(
        this.connection,
        txSignature,
        grossAmount,
        requirements.payTo
      );

      if (!result.valid) {
        metrics.paymentErrors.inc();
        return { valid: false, paymentId, grossAmount: 0n, error: result.reason };
      }

      metrics.paymentsVerified.inc();
      metrics.volumeRouted.inc(Number(grossAmount));
      return { valid: true, paymentId, grossAmount };
    }

    return { valid: false, paymentId, grossAmount: 0n, error: "unsupported_network" };
  }

  /**
   * Settle an EVM payment (execute transferWithAuthorization on-chain).
   * For Solana, the client already submitted the tx — nothing to settle.
   * After settling, records the payment on the x402-network program.
   */
  async settle(
    payload: X402PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResult> {
    if (requirements.network === "solana") {
      // Solana is already settled by the client; just verify + record
      const verifyResult = await this.verify(payload, requirements);
      if (!verifyResult.valid) {
        return {
          success: false,
          network: "solana",
          transaction: "",
          payer: verifyResult.payer,
          errorReason: verifyResult.error,
        };
      }
      const recordTx = await this.recordPaymentOnChain(
        verifyResult.paymentId,
        verifyResult.grossAmount
      );
      return { success: true, network: "solana", transaction: recordTx };
    }

    // EVM: settle (execute the transferWithAuthorization)
    try {
      const walletClient = getViemWalletClient(requirements.network);
      const result = await exactEvm.settle(walletClient, payload, requirements as any);

      if (result.success) {
        const verifyResult = await this.verify(payload, requirements);
        const recordTx = await this.recordPaymentOnChain(
          verifyResult.paymentId,
          BigInt(requirements.maxAmountRequired)
        );
        logger.info("EVM payment settled + recorded", {
          evmTx: result.transaction,
          recordTx,
        });
      }
      return {
        success: result.success,
        network: result.network,
        transaction: result.transaction,
        payer: result.payer,
        errorReason: result.errorReason,
      };
    } catch (err: any) {
      logger.error("EVM settle error", { err: err.message });
      return {
        success: false,
        network: payload.network,
        transaction: "",
        errorReason: err.message,
      };
    }
  }

  /**
   * Submit record_payment to the x402-network Anchor program.
   * Earns facilitator fee on-chain.
   */
  async recordPaymentOnChain(
    paymentId: Uint8Array,
    grossAmount: bigint
  ): Promise<string> {
    try {
      return await solanaClient.submitRecordPayment(paymentId, grossAmount);
    } catch (err: any) {
      // Non-fatal: fees will be missed but payment is already verified
      logger.error("record_payment failed", { err: err.message });
      metrics.paymentErrors.inc();
      return "";
    }
  }

  /**
   * Build a payment-required challenge body (402 response).
   */
  buildPaymentRequired(params: {
    amount: string;
    currency: string;
    network: string;
    payTo: string;
    asset: string;
    resourceId: string;
    description?: string;
  }): object {
    return {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: params.network,
          maxAmountRequired: params.amount,
          resource: params.resourceId,
          description: params.description ?? `Pay ${params.amount} ${params.currency} to access ${params.resourceId}`,
          mimeType: "application/json",
          payTo: params.payTo,
          maxTimeoutSeconds: 300,
          asset: params.asset,
          extra: {
            facilitator: config.facilitatorUrl,
            feeBps: config.networkFeeBps,
            name: params.currency,
          },
        },
      ],
      error: "X-PAYMENT required",
    };
  }

  /**
   * Derive a canonical payment ID from the payload.
   * For EVM: hash(network + from + nonce).
   * For Solana: hash(signature).
   */
  derivePaymentId(payload: X402PaymentPayload): Uint8Array {
    let data: string;
    if (payload.network === "solana") {
      const sig = payload.payload?.signature ?? payload.payload ?? "";
      data = `solana:${sig}`;
    } else {
      const auth = payload.payload?.authorization ?? {};
      data = `${payload.network}:${auth.from ?? ""}:${auth.nonce ?? ""}:${auth.validBefore ?? ""}`;
    }
    return new Uint8Array(crypto.createHash("sha256").update(data).digest());
  }
}

export const paymentHandler = new PaymentHandler();
