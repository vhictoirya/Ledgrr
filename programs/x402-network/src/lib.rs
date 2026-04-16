use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5RqkCAYtJD5JuFU1RKrn1w1KKpAgwv5bhZv8aZXmhh5g");

/// Minimum stake required to become a facilitator (in token base units)
pub const MIN_STAKE_AMOUNT: u64 = 1_000_000_000; // 1,000 tokens (6 decimals)
/// Unstake timelock: 7 days in seconds
pub const UNSTAKE_TIMELOCK_SECS: i64 = 7 * 24 * 60 * 60;
/// Network fee in basis points (0.05% = 5 bps, 0.1% = 10 bps)
pub const DEFAULT_FEE_BPS: u16 = 7; // 0.07% default
/// Protocol treasury share of fee: 20%
pub const PROTOCOL_FEE_SHARE_BPS: u16 = 2000;

#[program]
pub mod x402_network {
    use super::*;

    // ─────────────────────────────────────────────────────────────────────
    // Admin / Network Setup
    // ─────────────────────────────────────────────────────────────────────

    /// One-time initialise: create the global NetworkConfig and treasury.
    pub fn initialize(
        ctx: Context<Initialize>,
        fee_bps: u16,
        min_stake: u64,
    ) -> Result<()> {
        require!(fee_bps <= 100, X402Error::FeeTooHigh); // cap at 1%
        require!(min_stake >= 1_000_000, X402Error::StakeTooLow);

        let config = &mut ctx.accounts.network_config;
        config.authority = ctx.accounts.authority.key();
        config.stake_mint = ctx.accounts.stake_mint.key();
        config.treasury = ctx.accounts.treasury.key();
        config.fee_bps = fee_bps;
        config.min_stake = min_stake;
        config.total_staked = 0;
        config.total_facilitators = 0;
        config.total_payments_routed = 0;
        config.total_fees_collected = 0;
        config.bump = ctx.bumps.network_config;

        emit!(NetworkInitialized {
            authority: config.authority,
            fee_bps,
            min_stake,
        });
        Ok(())
    }

    /// Authority can update fee rate and min stake.
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        fee_bps: Option<u16>,
        min_stake: Option<u64>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.network_config;
        if let Some(f) = fee_bps {
            require!(f <= 100, X402Error::FeeTooHigh);
            config.fee_bps = f;
        }
        if let Some(s) = min_stake {
            config.min_stake = s;
        }
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────
    // Facilitator Lifecycle
    // ─────────────────────────────────────────────────────────────────────

    /// Register as a facilitator and stake tokens.
    pub fn register_facilitator(
        ctx: Context<RegisterFacilitator>,
        stake_amount: u64,
        endpoint_url: String, // public HTTPS endpoint for routing
        metadata_uri: String, // optional JSON metadata
    ) -> Result<()> {
        let config = &ctx.accounts.network_config;
        require!(stake_amount >= config.min_stake, X402Error::InsufficientStake);
        require!(endpoint_url.len() <= 128, X402Error::UrlTooLong);
        require!(metadata_uri.len() <= 256, X402Error::MetadataTooLong);

        // Transfer stake from facilitator wallet → facilitator stake vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.facilitator_token_account.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.facilitator.to_account_info(),
                },
            ),
            stake_amount,
        )?;

        let acc = &mut ctx.accounts.facilitator_account;
        acc.facilitator = ctx.accounts.facilitator.key();
        acc.staked_amount = stake_amount;
        acc.pending_rewards = 0;
        acc.total_earned = 0;
        acc.payments_routed = 0;
        acc.status = FacilitatorStatus::Active;
        acc.registered_at = Clock::get()?.unix_timestamp;
        acc.unstake_requested_at = 0;
        acc.endpoint_url = endpoint_url.clone();
        acc.metadata_uri = metadata_uri;
        acc.bump = ctx.bumps.facilitator_account;

        let config = &mut ctx.accounts.network_config;
        config.total_staked = config.total_staked.checked_add(stake_amount).unwrap();
        config.total_facilitators = config.total_facilitators.checked_add(1).unwrap();

        emit!(FacilitatorRegistered {
            facilitator: acc.facilitator,
            stake_amount,
            endpoint_url,
        });
        Ok(())
    }

    /// Add more stake to an existing facilitator account.
    pub fn add_stake(ctx: Context<AddStake>, amount: u64) -> Result<()> {
        require!(amount > 0, X402Error::ZeroAmount);
        require!(
            ctx.accounts.facilitator_account.status == FacilitatorStatus::Active,
            X402Error::FacilitatorNotActive
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.facilitator_token_account.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.facilitator.to_account_info(),
                },
            ),
            amount,
        )?;

        ctx.accounts.facilitator_account.staked_amount = ctx
            .accounts
            .facilitator_account
            .staked_amount
            .checked_add(amount)
            .unwrap();
        ctx.accounts.network_config.total_staked = ctx
            .accounts
            .network_config
            .total_staked
            .checked_add(amount)
            .unwrap();

        Ok(())
    }

    /// Request unstake — starts the 7-day timelock.
    pub fn request_unstake(ctx: Context<RequestUnstake>) -> Result<()> {
        let acc = &mut ctx.accounts.facilitator_account;
        require!(acc.status == FacilitatorStatus::Active, X402Error::FacilitatorNotActive);
        acc.status = FacilitatorStatus::Unstaking;
        acc.unstake_requested_at = Clock::get()?.unix_timestamp;
        emit!(UnstakeRequested {
            facilitator: acc.facilitator,
            amount: acc.staked_amount,
        });
        Ok(())
    }

    /// Withdraw stake after timelock expires.
    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
        let acc = &ctx.accounts.facilitator_account;
        require!(acc.status == FacilitatorStatus::Unstaking, X402Error::NotUnstaking);

        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= acc.unstake_requested_at + UNSTAKE_TIMELOCK_SECS,
            X402Error::TimelockNotExpired
        );

        let amount = acc.staked_amount;
        let config_key = ctx.accounts.network_config.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"stake_vault",
            config_key.as_ref(),
            ctx.accounts.facilitator_account.facilitator.as_ref(),
            &[ctx.accounts.facilitator_account.bump],
        ]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.facilitator_token_account.to_account_info(),
                    authority: ctx.accounts.stake_vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        let acc = &mut ctx.accounts.facilitator_account;
        let old_stake = acc.staked_amount;
        acc.staked_amount = 0;
        acc.status = FacilitatorStatus::Inactive;

        ctx.accounts.network_config.total_staked = ctx
            .accounts
            .network_config
            .total_staked
            .saturating_sub(old_stake);
        ctx.accounts.network_config.total_facilitators = ctx
            .accounts
            .network_config
            .total_facilitators
            .saturating_sub(1);

        emit!(StakeWithdrawn {
            facilitator: ctx.accounts.facilitator_account.facilitator,
            amount,
        });
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────
    // Payment Routing & Fee Settlement
    // ─────────────────────────────────────────────────────────────────────

    /// Called by facilitator node after successfully routing an x402 payment.
    /// Splits network fee: 80% → facilitator, 20% → protocol treasury.
    pub fn record_payment(
        ctx: Context<RecordPayment>,
        payment_id: [u8; 32], // SHA-256 of the x402 payment proof
        gross_amount: u64,    // full payment amount in token base units
    ) -> Result<()> {
        require!(
            ctx.accounts.facilitator_account.status == FacilitatorStatus::Active,
            X402Error::FacilitatorNotActive
        );

        let config = &ctx.accounts.network_config;

        // Calculate fee split
        let total_fee = gross_amount
            .checked_mul(config.fee_bps as u64)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        let protocol_cut = total_fee
            .checked_mul(PROTOCOL_FEE_SHARE_BPS as u64)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        let facilitator_cut = total_fee.saturating_sub(protocol_cut);

        // Accumulate rewards (claimed separately to batch gas)
        ctx.accounts.facilitator_account.pending_rewards = ctx
            .accounts
            .facilitator_account
            .pending_rewards
            .checked_add(facilitator_cut)
            .unwrap();
        ctx.accounts.facilitator_account.total_earned = ctx
            .accounts
            .facilitator_account
            .total_earned
            .checked_add(facilitator_cut)
            .unwrap();
        ctx.accounts.facilitator_account.payments_routed = ctx
            .accounts
            .facilitator_account
            .payments_routed
            .checked_add(1)
            .unwrap();

        // Record payment on-chain for deduplication / audit
        let record = &mut ctx.accounts.payment_record;
        record.payment_id = payment_id;
        record.facilitator = ctx.accounts.facilitator_account.facilitator;
        record.gross_amount = gross_amount;
        record.fee_amount = total_fee;
        record.facilitator_fee = facilitator_cut;
        record.protocol_fee = protocol_cut;
        record.timestamp = Clock::get()?.unix_timestamp;
        record.bump = ctx.bumps.payment_record;

        // Update global counters
        let config = &mut ctx.accounts.network_config;
        config.total_payments_routed = config.total_payments_routed.checked_add(1).unwrap();
        config.total_fees_collected = config.total_fees_collected.checked_add(total_fee).unwrap();

        emit!(PaymentRouted {
            payment_id,
            facilitator: ctx.accounts.facilitator_account.facilitator,
            gross_amount,
            facilitator_fee: facilitator_cut,
            protocol_fee: protocol_cut,
        });
        Ok(())
    }

    /// Facilitator claims accumulated rewards.
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        let pending = ctx.accounts.facilitator_account.pending_rewards;
        require!(pending > 0, X402Error::NoPendingRewards);

        let config_key = ctx.accounts.network_config.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"rewards_vault",
            config_key.as_ref(),
            &[ctx.accounts.network_config.bump],
        ]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.rewards_vault.to_account_info(),
                    to: ctx.accounts.facilitator_token_account.to_account_info(),
                    authority: ctx.accounts.rewards_vault.to_account_info(),
                },
                signer_seeds,
            ),
            pending,
        )?;

        ctx.accounts.facilitator_account.pending_rewards = 0;

        emit!(RewardsClaimed {
            facilitator: ctx.accounts.facilitator_account.facilitator,
            amount: pending,
        });
        Ok(())
    }

    /// Governance slash — penalise a misbehaving facilitator.
    pub fn slash_facilitator(
        ctx: Context<SlashFacilitator>,
        slash_amount: u64,
        reason: String,
    ) -> Result<()> {
        require!(reason.len() <= 256, X402Error::MetadataTooLong);

        let acc = &mut ctx.accounts.facilitator_account;
        let actual_slash = slash_amount.min(acc.staked_amount);
        acc.staked_amount = acc.staked_amount.saturating_sub(actual_slash);
        acc.status = FacilitatorStatus::Slashed;

        ctx.accounts.network_config.total_staked = ctx
            .accounts
            .network_config
            .total_staked
            .saturating_sub(actual_slash);

        // Slashed tokens go to treasury
        emit!(FacilitatorSlashed {
            facilitator: acc.facilitator,
            slash_amount: actual_slash,
            reason,
        });
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Account Structs
// ─────────────────────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct NetworkConfig {
    pub authority: Pubkey,
    pub stake_mint: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub min_stake: u64,
    pub total_staked: u64,
    pub total_facilitators: u64,
    pub total_payments_routed: u64,
    pub total_fees_collected: u64,
    pub bump: u8,
}

#[account]
pub struct FacilitatorAccount {
    pub facilitator: Pubkey,
    pub staked_amount: u64,
    pub pending_rewards: u64,
    pub total_earned: u64,
    pub payments_routed: u64,
    pub status: FacilitatorStatus,
    pub registered_at: i64,
    pub unstake_requested_at: i64,
    pub endpoint_url: String, // max 128
    pub metadata_uri: String, // max 256
    pub bump: u8,
}

#[account]
pub struct PaymentRecord {
    pub payment_id: [u8; 32],
    pub facilitator: Pubkey,
    pub gross_amount: u64,
    pub fee_amount: u64,
    pub facilitator_fee: u64,
    pub protocol_fee: u64,
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default)]
pub enum FacilitatorStatus {
    #[default]
    Active,
    Unstaking,
    Inactive,
    Slashed,
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Structs
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub stake_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<NetworkConfig>() + 64,
        seeds = [b"network_config"],
        bump
    )]
    pub network_config: Account<'info, NetworkConfig>,

    /// Treasury token account (protocol fees land here)
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = stake_mint,
        associated_token::authority = network_config,
    )]
    pub treasury: Account<'info, TokenAccount>,

    /// Rewards vault (facilitator fee payouts sourced from here)
    #[account(
        init_if_needed,
        payer = authority,
        seeds = [b"rewards_vault", network_config.key().as_ref()],
        bump,
        token::mint = stake_mint,
        token::authority = network_config,
    )]
    pub rewards_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, constraint = network_config.authority == authority.key())]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [b"network_config"], bump = network_config.bump)]
    pub network_config: Account<'info, NetworkConfig>,
}

#[derive(Accounts)]
pub struct RegisterFacilitator<'info> {
    #[account(mut)]
    pub facilitator: Signer<'info>,

    #[account(mut, seeds = [b"network_config"], bump = network_config.bump)]
    pub network_config: Account<'info, NetworkConfig>,

    #[account(
        init,
        payer = facilitator,
        space = 8 + std::mem::size_of::<FacilitatorAccount>() + 128 + 256 + 32,
        seeds = [b"facilitator", facilitator.key().as_ref()],
        bump
    )]
    pub facilitator_account: Account<'info, FacilitatorAccount>,

    #[account(
        init_if_needed,
        payer = facilitator,
        seeds = [b"stake_vault", network_config.key().as_ref(), facilitator.key().as_ref()],
        bump,
        token::mint = stake_mint,
        token::authority = facilitator_account,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = facilitator_token_account.owner == facilitator.key(),
        constraint = facilitator_token_account.mint == stake_mint.key(),
    )]
    pub facilitator_token_account: Account<'info, TokenAccount>,

    pub stake_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddStake<'info> {
    #[account(mut)]
    pub facilitator: Signer<'info>,

    #[account(mut, seeds = [b"network_config"], bump = network_config.bump)]
    pub network_config: Account<'info, NetworkConfig>,

    #[account(
        mut,
        seeds = [b"facilitator", facilitator.key().as_ref()],
        bump = facilitator_account.bump,
        constraint = facilitator_account.facilitator == facilitator.key()
    )]
    pub facilitator_account: Account<'info, FacilitatorAccount>,

    #[account(
        mut,
        seeds = [b"stake_vault", network_config.key().as_ref(), facilitator.key().as_ref()],
        bump,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = facilitator_token_account.owner == facilitator.key())]
    pub facilitator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RequestUnstake<'info> {
    pub facilitator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"facilitator", facilitator.key().as_ref()],
        bump = facilitator_account.bump,
        constraint = facilitator_account.facilitator == facilitator.key()
    )]
    pub facilitator_account: Account<'info, FacilitatorAccount>,
}

#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    pub facilitator: Signer<'info>,

    #[account(mut, seeds = [b"network_config"], bump = network_config.bump)]
    pub network_config: Account<'info, NetworkConfig>,

    #[account(
        mut,
        seeds = [b"facilitator", facilitator.key().as_ref()],
        bump = facilitator_account.bump,
        constraint = facilitator_account.facilitator == facilitator.key()
    )]
    pub facilitator_account: Account<'info, FacilitatorAccount>,

    #[account(
        mut,
        seeds = [b"stake_vault", network_config.key().as_ref(), facilitator.key().as_ref()],
        bump,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = facilitator_token_account.owner == facilitator.key())]
    pub facilitator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct RecordPayment<'info> {
    #[account(mut)]
    pub facilitator: Signer<'info>,

    #[account(mut, seeds = [b"network_config"], bump = network_config.bump)]
    pub network_config: Account<'info, NetworkConfig>,

    #[account(
        mut,
        seeds = [b"facilitator", facilitator.key().as_ref()],
        bump = facilitator_account.bump,
        constraint = facilitator_account.facilitator == facilitator.key()
    )]
    pub facilitator_account: Account<'info, FacilitatorAccount>,

    /// Deduplication: one PDA per payment_id — double-submission reverts
    #[account(
        init,
        payer = facilitator,
        space = 8 + std::mem::size_of::<PaymentRecord>() + 8,
        seeds = [b"payment", payment_id.as_ref()],
        bump
    )]
    pub payment_record: Account<'info, PaymentRecord>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    pub facilitator: Signer<'info>,

    #[account(seeds = [b"network_config"], bump = network_config.bump)]
    pub network_config: Account<'info, NetworkConfig>,

    #[account(
        mut,
        seeds = [b"facilitator", facilitator.key().as_ref()],
        bump = facilitator_account.bump,
        constraint = facilitator_account.facilitator == facilitator.key()
    )]
    pub facilitator_account: Account<'info, FacilitatorAccount>,

    #[account(
        mut,
        seeds = [b"rewards_vault", network_config.key().as_ref()],
        bump,
    )]
    pub rewards_vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = facilitator_token_account.owner == facilitator.key())]
    pub facilitator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SlashFacilitator<'info> {
    #[account(constraint = network_config.authority == authority.key())]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [b"network_config"], bump = network_config.bump)]
    pub network_config: Account<'info, NetworkConfig>,

    #[account(mut, seeds = [b"facilitator", facilitator_account.facilitator.as_ref()], bump = facilitator_account.bump)]
    pub facilitator_account: Account<'info, FacilitatorAccount>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

#[event]
pub struct NetworkInitialized {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub min_stake: u64,
}

#[event]
pub struct FacilitatorRegistered {
    pub facilitator: Pubkey,
    pub stake_amount: u64,
    pub endpoint_url: String,
}

#[event]
pub struct UnstakeRequested {
    pub facilitator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct StakeWithdrawn {
    pub facilitator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PaymentRouted {
    pub payment_id: [u8; 32],
    pub facilitator: Pubkey,
    pub gross_amount: u64,
    pub facilitator_fee: u64,
    pub protocol_fee: u64,
}

#[event]
pub struct RewardsClaimed {
    pub facilitator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FacilitatorSlashed {
    pub facilitator: Pubkey,
    pub slash_amount: u64,
    pub reason: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum X402Error {
    #[msg("Fee exceeds 1% maximum")]
    FeeTooHigh,
    #[msg("Stake amount below minimum")]
    StakeTooLow,
    #[msg("Insufficient stake to register")]
    InsufficientStake,
    #[msg("Endpoint URL too long (max 128 chars)")]
    UrlTooLong,
    #[msg("Metadata URI too long (max 256 chars)")]
    MetadataTooLong,
    #[msg("Facilitator is not active")]
    FacilitatorNotActive,
    #[msg("Facilitator is not in unstaking state")]
    NotUnstaking,
    #[msg("Timelock has not expired yet")]
    TimelockNotExpired,
    #[msg("No pending rewards to claim")]
    NoPendingRewards,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
}
