// Summary: LVF program to open/close leveraged positions using cTokens as collateral
// and interacting with the lending market. Includes pause, health check stubs,
// liquidation entry point and admin config.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

pub mod state;
use state::*;

declare_id!("DNV9nTmTztTaufsdKQd3WW1vfaKHMB5uiGzWRXD3AgYd");

pub const RATE_SCALE: u128 = 1_000_000_000u128; // align with crucibles/lending

#[program]
pub mod lvf {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, params: InitializeLvfParams) -> Result<()> {
        // SECURITY FIX (AUDIT-075): Validate parameter bounds
        // Max leverage: 100 bps (1x) to 50000 bps (500x) - reasonable upper bound
        const MIN_LEVERAGE_BPS: u64 = 100; // 1x minimum
        const MAX_LEVERAGE_BPS: u64 = 50_000; // 500x maximum (very high but allowed)
        require!(
            params.max_leverage_bps >= MIN_LEVERAGE_BPS && params.max_leverage_bps <= MAX_LEVERAGE_BPS,
            LvfError::InvalidParams
        );
        
        // Liquidation threshold: 0 to 10000 bps (0% to 100%)
        require!(
            params.liquidation_threshold_bps <= 10_000,
            LvfError::InvalidParams
        );
        
        // SECURITY FIX (AUDIT-076): Verify liquidation_bounty is reasonable
        // Bounty: 0 to 5000 bps (0% to 50% of liquidated amount)
        const MAX_LIQUIDATION_BOUNTY_BPS: u64 = 5_000; // 50% maximum
        require!(
            params.liquidation_bounty_bps <= MAX_LIQUIDATION_BOUNTY_BPS,
            LvfError::InvalidParams
        );
        
        // Ensure liquidation threshold is less than max leverage (sanity check)
        require!(
            params.liquidation_threshold_bps < params.max_leverage_bps,
            LvfError::InvalidParams
        );
        
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.max_leverage_bps = params.max_leverage_bps;
        cfg.liquidation_threshold_bps = params.liquidation_threshold_bps;
        cfg.liquidation_bounty_bps = params.liquidation_bounty_bps;
        cfg.paused = false;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn pause(ctx: Context<Pause>, paused: bool) -> Result<()> {
        require_keys_eq!(ctx.accounts.config.authority, ctx.accounts.authority.key(), LvfError::Unauthorized);
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    pub fn open_position(_ctx: Context<OpenPosition>, _params: OpenPositionParams) -> Result<()> {
        // Placeholder; full CPI to crucibles and lending to be added in next iteration
        err!(LvfError::Unimplemented)
    }

    pub fn close_position(_ctx: Context<ClosePosition>) -> Result<()> {
        err!(LvfError::Unimplemented)
    }

    pub fn liquidate_position(_ctx: Context<LiquidatePosition>) -> Result<()> {
        err!(LvfError::Unimplemented)
    }

    pub fn health_check(_ctx: Context<HealthCheck>) -> Result<u64> {
        // Return LTV in basis points (stub)
        Ok(0)
    }
}

#[derive(Accounts)]
#[instruction(params: InitializeLvfParams)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = LvfConfig::SIZE,
        seeds = [b"lvf_config"],
        bump
    )]
    pub config: Account<'info, LvfConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut, has_one = authority)]
    pub config: Account<'info, LvfConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    pub config: Account<'info, LvfConfig>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    pub config: Account<'info, LvfConfig>,
}

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    pub config: Account<'info, LvfConfig>,
}

#[derive(Accounts)]
pub struct HealthCheck<'info> {
    pub config: Account<'info, LvfConfig>,
}

#[error_code]
pub enum LvfError {
    #[msg("Unauthorized")] Unauthorized,
    #[msg("Unimplemented")] Unimplemented,
    #[msg("Invalid parameters")] InvalidParams,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeLvfParams {
    pub max_leverage_bps: u64,
    pub liquidation_threshold_bps: u64,
    pub liquidation_bounty_bps: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenPositionParams {
    pub leverage_bps: u64,
}


