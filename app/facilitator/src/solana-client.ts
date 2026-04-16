import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { readFileSync } from "fs";
import { config } from "./config.js";
import { logger } from "./logger.js";
import IDL from "./x402_network_idl.json";

export interface FacilitatorOnChain {
  facilitator: string;
  stakedAmount: string;
  pendingRewards: string;
  totalEarned: string;
  paymentsRouted: string;
  status: string;
  registeredAt: number;
  endpointUrl: string;
}

export interface ActiveFacilitator {
  address: string;
  endpoint: string;
  feeBps: number;
  status: string;
  stakedAmount: string;
}

export class SolanaClient {
  public connection: Connection;
  public keypair: Keypair;
  public facilitatorPDA: PublicKey;
  public networkConfigPDA: PublicKey;
  public programId: PublicKey;
  private _program: anchor.Program | null = null;

  constructor() {
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.programId = new PublicKey(config.networkProgramId);

    try {
      const raw = JSON.parse(readFileSync(config.facilitatorKeypairPath, "utf-8"));
      this.keypair = Keypair.fromSecretKey(new Uint8Array(raw));
    } catch {
      logger.warn("No keypair file — generating ephemeral keypair for dev");
      this.keypair = Keypair.generate();
    }

    [this.networkConfigPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("network_config")],
      this.programId
    );
    [this.facilitatorPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("facilitator"), this.keypair.publicKey.toBuffer()],
      this.programId
    );
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  private get program(): anchor.Program {
    if (!this._program) {
      const wallet = new anchor.Wallet(this.keypair);
      const provider = new anchor.AnchorProvider(this.connection, wallet, {
        commitment: "confirmed",
      });
      this._program = new anchor.Program(IDL as any, provider);
    }
    return this._program;
  }

  paymentRecordPDA(paymentId: Uint8Array): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("payment"), paymentId],
      this.programId
    );
    return pda;
  }

  async isPaymentRecorded(paymentId: Uint8Array): Promise<boolean> {
    const pda = this.paymentRecordPDA(paymentId);
    const info = await this.connection.getAccountInfo(pda);
    return info !== null;
  }

  /**
   * Submit the record_payment instruction after a successful payment verification.
   * This is what actually books the fee on-chain and prevents replays.
   */
  async submitRecordPayment(
    paymentId: Uint8Array,
    grossAmount: bigint
  ): Promise<string> {
    const paymentRecord = this.paymentRecordPDA(paymentId);

    const txSig = await (this.program.methods as any)
      .recordPayment(
        Array.from(paymentId),
        new anchor.BN(grossAmount.toString())
      )
      .accounts({
        facilitator: this.keypair.publicKey,
        networkConfig: this.networkConfigPDA,
        facilitatorAccount: this.facilitatorPDA,
        paymentRecord,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([this.keypair])
      .rpc();

    logger.info("record_payment submitted", {
      txSig,
      paymentId: Buffer.from(paymentId).toString("hex").slice(0, 16),
      grossAmount: grossAmount.toString(),
    });
    return txSig;
  }

  /**
   * Fetch this node's facilitator account from the chain.
   */
  async getFacilitatorState(): Promise<FacilitatorOnChain | null> {
    try {
      const acc = await (this.program.account as any).facilitatorAccount.fetch(
        this.facilitatorPDA
      );
      return {
        facilitator: acc.facilitator.toBase58(),
        stakedAmount: acc.stakedAmount.toString(),
        pendingRewards: acc.pendingRewards.toString(),
        totalEarned: acc.totalEarned.toString(),
        paymentsRouted: acc.paymentsRouted.toString(),
        status: Object.keys(acc.status)[0],
        registeredAt: acc.registeredAt.toNumber(),
        endpointUrl: acc.endpointUrl,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch all registered facilitators via getProgramAccounts.
   * Uses the 8-byte discriminator for FacilitatorAccount to filter.
   * Helius RPC handles this efficiently with indexed filters.
   */
  async getActiveFacilitators(): Promise<ActiveFacilitator[]> {
    try {
      const accounts = await (this.program.account as any).facilitatorAccount.all();

      return accounts
        .filter((a: any) => Object.keys(a.account.status)[0] === "active")
        .map((a: any) => ({
          address: a.account.facilitator.toBase58(),
          endpoint: a.account.endpointUrl,
          feeBps: config.networkFeeBps, // each node's fee is network-wide for now
          status: Object.keys(a.account.status)[0],
          stakedAmount: a.account.stakedAmount.toString(),
        }));
    } catch (err: any) {
      logger.warn("getActiveFacilitators failed", { err: err.message });
      return [];
    }
  }

  /**
   * Fetch network-wide config from the NetworkConfig PDA.
   */
  async getNetworkConfig() {
    try {
      const cfg = await (this.program.account as any).networkConfig.fetch(
        this.networkConfigPDA
      );
      return {
        feeBps: cfg.feeBps,
        minStake: cfg.minStake.toString(),
        totalStaked: cfg.totalStaked.toString(),
        totalFacilitators: cfg.totalFacilitators.toString(),
        totalPaymentsRouted: cfg.totalPaymentsRouted.toString(),
        totalFeesCollected: cfg.totalFeesCollected.toString(),
      };
    } catch {
      return null;
    }
  }

  async getSolBalance(): Promise<number> {
    const lamports = await this.connection.getBalance(this.keypair.publicKey);
    return lamports / 1e9;
  }
}

export const solanaClient = new SolanaClient();
