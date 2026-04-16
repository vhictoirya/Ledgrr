/**
 * Client-side Anchor instruction builders for the x402-network program.
 *
 * Builds serialized Solana transactions that Privy's sendTransaction can sign.
 * Uses the real IDL deployed on devnet.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import IDL from "./x402_network_idl.json";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_NETWORK_PROGRAM_ID ?? "5RqkCAYtJD5JuFU1RKrn1w1KKpAgwv5bhZv8aZXmhh5g"
);

export function getNetworkConfigPDA(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("network_config")],
    PROGRAM_ID
  );
  return pda;
}

export function getFacilitatorPDA(wallet: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("facilitator"), wallet.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getStakeVaultPDA(networkConfig: PublicKey, facilitator: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake_vault"), networkConfig.toBuffer(), facilitator.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getRewardsVaultPDA(networkConfig: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rewards_vault"), networkConfig.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

/** Build a read-only Anchor provider (no wallet needed for reads) */
export function buildReadProvider(connection: Connection) {
  const wallet = {
    publicKey: PublicKey.default,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  };
  return new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
}

/** Get the program instance (read-only — no wallet needed) */
export function getProgram(connection: Connection): anchor.Program {
  const provider = buildReadProvider(connection);
  return new anchor.Program(IDL as any, provider);
}

/**
 * Build a register_facilitator transaction.
 * Caller must get a recent blockhash and set feePayer before sending.
 */
export async function buildRegisterFacilitatorTx(
  connection: Connection,
  facilitator: PublicKey,
  stakeMint: PublicKey,
  facilitatorTokenAccount: PublicKey,
  stakeAmount: bigint,
  endpointUrl: string
): Promise<Transaction> {
  const program = getProgram(connection);
  const networkConfig = getNetworkConfigPDA();
  const facilitatorAccount = getFacilitatorPDA(facilitator);
  const stakeVault = getStakeVaultPDA(networkConfig, facilitator);

  const ix = await (program.methods as any)
    .registerFacilitator(
      new anchor.BN(stakeAmount.toString()),
      endpointUrl,
      "" // metadata_uri
    )
    .accounts({
      facilitator,
      networkConfig,
      facilitatorAccount,
      stakeVault,
      facilitatorTokenAccount,
      stakeMint,
      tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bN"),
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = facilitator;
  return tx;
}

/**
 * Build a claim_rewards transaction.
 */
export async function buildClaimRewardsTx(
  connection: Connection,
  facilitator: PublicKey,
  facilitatorTokenAccount: PublicKey
): Promise<Transaction> {
  const program = getProgram(connection);
  const networkConfig = getNetworkConfigPDA();
  const facilitatorAccount = getFacilitatorPDA(facilitator);
  const rewardsVault = getRewardsVaultPDA(networkConfig);

  const ix = await (program.methods as any)
    .claimRewards()
    .accounts({
      facilitator,
      networkConfig,
      facilitatorAccount,
      rewardsVault,
      facilitatorTokenAccount,
      tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    })
    .instruction();

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = facilitator;
  return tx;
}

/**
 * Build an add_stake transaction.
 */
export async function buildAddStakeTx(
  connection: Connection,
  facilitator: PublicKey,
  facilitatorTokenAccount: PublicKey,
  amount: bigint
): Promise<Transaction> {
  const program = getProgram(connection);
  const networkConfig = getNetworkConfigPDA();
  const facilitatorAccount = getFacilitatorPDA(facilitator);
  const stakeVault = getStakeVaultPDA(networkConfig, facilitator);

  const ix = await (program.methods as any)
    .addStake(new anchor.BN(amount.toString()))
    .accounts({
      facilitator,
      networkConfig,
      facilitatorAccount,
      stakeVault,
      facilitatorTokenAccount,
      tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    })
    .instruction();

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = facilitator;
  return tx;
}

/**
 * Build a request_unstake transaction.
 */
export async function buildRequestUnstakeTx(
  connection: Connection,
  facilitator: PublicKey
): Promise<Transaction> {
  const program = getProgram(connection);
  const facilitatorAccount = getFacilitatorPDA(facilitator);

  const ix = await (program.methods as any)
    .requestUnstake()
    .accounts({ facilitator, facilitatorAccount })
    .instruction();

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = facilitator;
  return tx;
}

/**
 * Build a withdraw_stake transaction.
 */
export async function buildWithdrawStakeTx(
  connection: Connection,
  facilitator: PublicKey,
  facilitatorTokenAccount: PublicKey
): Promise<Transaction> {
  const program = getProgram(connection);
  const networkConfig = getNetworkConfigPDA();
  const facilitatorAccount = getFacilitatorPDA(facilitator);
  const stakeVault = getStakeVaultPDA(networkConfig, facilitator);

  const ix = await (program.methods as any)
    .withdrawStake()
    .accounts({
      facilitator,
      networkConfig,
      facilitatorAccount,
      stakeVault,
      facilitatorTokenAccount,
      tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    })
    .instruction();

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(ix);
  tx.recentBlockhash = blockhash;
  tx.feePayer = facilitator;
  return tx;
}

/**
 * Fetch facilitator account state from chain.
 */
export async function fetchFacilitatorAccount(
  connection: Connection,
  facilitator: PublicKey
) {
  try {
    const program = getProgram(connection);
    const pda = getFacilitatorPDA(facilitator);
    const acc = await (program.account as any).facilitatorAccount.fetch(pda);
    return {
      stakedAmount: acc.stakedAmount.toString(),
      pendingRewards: acc.pendingRewards.toString(),
      totalEarned: acc.totalEarned.toString(),
      paymentsRouted: acc.paymentsRouted.toString(),
      status: Object.keys(acc.status)[0] as string,
      registeredAt: acc.registeredAt.toNumber(),
      endpointUrl: acc.endpointUrl as string,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch network config from chain.
 */
export async function fetchNetworkConfig(connection: Connection) {
  try {
    const program = getProgram(connection);
    const pda = getNetworkConfigPDA();
    const cfg = await (program.account as any).networkConfig.fetch(pda);
    return {
      feeBps: cfg.feeBps as number,
      minStake: cfg.minStake.toString() as string,
      totalStaked: cfg.totalStaked.toString() as string,
      totalFacilitators: cfg.totalFacilitators.toString() as string,
      totalPaymentsRouted: cfg.totalPaymentsRouted.toString() as string,
      totalFeesCollected: cfg.totalFeesCollected.toString() as string,
    };
  } catch {
    return null;
  }
}
