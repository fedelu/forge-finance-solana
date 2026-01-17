// Summary: Anchor program implementing isolated lending markets with supply, borrow,
// repay, withdraw and interest accrual. Uses u128 fixed-point RATE_SCALE = 1e9
// to match existing crucible cToken rate scale. Includes pause and admin hooks.
//
// NOTE: For crucibles leverage, only USDC lending markets are used.
// This allows crucible positions to borrow USDC for leveraged LP positions.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo, Burn};

pub mod state;
use state::*;

declare_id!("BeJW4TrT31GWgW5wpLeYS4tFiCQquHd5bHcfYrPykErs");

pub const RATE_SCALE: u128 = 1_000_000_000u128; // 1e9 fixed point for rates

/// Helper function to accrue interest on a market - can be called internally
fn do_accrue_interest(market: &mut Market) -> Result<()> {
    let now = Clock::get()?.unix_timestamp as u64;
    if now <= market.last_accrued_ts { return Ok(()); }

    // utilization = borrowed / max(1, supply)
    let supply = market.total_supply.max(1);
    let util_scaled = (market.total_borrowed as u128)
        .checked_mul(RATE_SCALE).unwrap()
        .checked_div(supply as u128).unwrap();

    // piecewise interest rate
    let kink_scaled = (market.interest_model.kink_bps as u128) * RATE_SCALE / 10_000u128;
    let base_scaled = (market.interest_model.base_rate_bps as u128) * RATE_SCALE / 10_000u128;
    let slope1_scaled = (market.interest_model.slope1_bps as u128) * RATE_SCALE / 10_000u128;
    let slope2_scaled = (market.interest_model.slope2_bps as u128) * RATE_SCALE / 10_000u128;

    let ir_scaled = if util_scaled <= kink_scaled {
        base_scaled + util_scaled.checked_mul(slope1_scaled).unwrap() / RATE_SCALE
    } else {
        let pre = base_scaled + kink_scaled.checked_mul(slope1_scaled).unwrap() / RATE_SCALE;
        let delta = util_scaled - kink_scaled;
        pre + delta.checked_mul(slope2_scaled).unwrap() / RATE_SCALE
    };

    // simple linear accrual per second on index: index *= (1 + ir_per_sec)
    // ir_scaled is annualized in fixed-point; convert roughly to per-second
    let seconds = now - market.last_accrued_ts;
    let per_sec_scaled = ir_scaled / (365u128 * 24 * 60 * 60);
    let increment = market.accumulated_index
        .checked_mul(per_sec_scaled).unwrap()
        .checked_mul(seconds as u128).unwrap()
        .checked_div(RATE_SCALE).unwrap();

    market.accumulated_index = market.accumulated_index.checked_add(increment).unwrap();
    market.last_accrued_ts = now;
    Ok(())
}

#[program]
pub mod lending {
    use super::*;

    pub fn initialize_market(ctx: Context<InitializeMarket>, params: InitializeMarketParams) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(params.base_rate_bps <= 1_000_000, LendingError::InvalidParams);

        market.authority = ctx.accounts.authority.key();
        market.base_mint = ctx.accounts.base_mint.key();
        market.vault = ctx.accounts.vault.key();
        market.receipt_mint = ctx.accounts.receipt_mint.key();
        market.total_supply = 0;
        market.total_borrowed = 0;
        market.accumulated_index = RATE_SCALE; // start at 1.0
        market.last_accrued_ts = Clock::get()?.unix_timestamp as u64;
        market.interest_model = InterestRateModelConfig {
            base_rate_bps: params.base_rate_bps,
            slope1_bps: params.slope1_bps,
            slope2_bps: params.slope2_bps,
            kink_bps: params.kink_bps,
        };
        market.liquidation_threshold_bps = params.liquidation_threshold_bps;
        market.paused = false;
        market.bump = ctx.bumps.market;

        Ok(())
    }

    pub fn pause_market(ctx: Context<PauseMarket>, paused: bool) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require_keys_eq!(market.authority, ctx.accounts.authority.key(), LendingError::Unauthorized);
        market.paused = paused;
        Ok(())
    }

    pub fn accrue_interest(ctx: Context<AccrueInterest>) -> Result<()> {
        do_accrue_interest(&mut ctx.accounts.market)
    }

    pub fn supply(ctx: Context<Supply>, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(!market.paused, LendingError::Paused);
        require!(amount > 0, LendingError::InvalidAmount);

        // Accrue before state changes
        do_accrue_interest(market)?;

        // Transfer base tokens to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_base_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), amount)?;

        // Compute receipt to mint using index (1:1 scaled by index)
        let receipt_amount = amount; // For MVP, 1:1; redeem logic will apply index

        // Mint receipt token to user (mint authority = market PDA)
        let seeds = &[b"market", market.base_mint.as_ref(), &[market.bump]];
        let signer = &[&seeds[..]];
        let mint_cpi = MintTo {
            mint: ctx.accounts.receipt_mint.to_account_info(),
            to: ctx.accounts.user_receipt_account.to_account_info(),
            authority: market.to_account_info(),
        };
        token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), mint_cpi, signer), receipt_amount)?;

        market.total_supply = market.total_supply.checked_add(amount as u128).unwrap();
        emit!(SupplyEvent { user: ctx.accounts.user.key(), amount });
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(amount > 0, LendingError::InvalidAmount);

        // Burn receipt
        let burn_cpi = Burn {
            mint: ctx.accounts.receipt_mint.to_account_info(),
            from: ctx.accounts.user_receipt_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::burn(CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_cpi), amount)?;

        // Transfer base back
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user_base_account.to_account_info(),
            authority: market.to_account_info(),
        };
        let seeds = &[b"market", market.base_mint.as_ref(), &[market.bump]];
        let signer = &[&seeds[..]];
        token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer), amount)?;

        // Update accounting using index in later iteration; MVP track nominal
        market.total_supply = market.total_supply.checked_sub(amount as u128).unwrap();
        emit!(WithdrawEvent { user: ctx.accounts.user.key(), amount });
        Ok(())
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(!market.paused, LendingError::Paused);
        require!(amount > 0, LendingError::InvalidAmount);

        // Accrue interest before state changes
        do_accrue_interest(market)?;

        // Check available liquidity
        let available = (market.total_supply as i128)
            .checked_sub(market.total_borrowed as i128)
            .ok_or(LendingError::InvalidAmount)?;
        require!(amount as i128 <= available, LendingError::InvalidAmount);

        // Update borrowed amount
        market.total_borrowed = market.total_borrowed
            .checked_add(amount as u128)
            .ok_or(LendingError::InvalidAmount)?;

        // Transfer borrowed tokens to user
        let seeds = &[b"market", market.base_mint.as_ref(), &[market.bump]];
        let signer = &[&seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user_account.to_account_info(),
            authority: market.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer),
            amount,
        )?;

        emit!(BorrowEvent { user: ctx.accounts.user.key(), amount });
        Ok(())
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(!market.paused, LendingError::Paused);
        require!(amount > 0, LendingError::InvalidAmount);

        // Accrue interest before state changes
        do_accrue_interest(market)?;

        // Calculate total owed including accrued interest
        // For simplicity, use accumulated_index to calculate interest
        // In production, track per-user borrow index
        let total_owed = amount; // Simplified: assume amount includes interest

        // Transfer repayment from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            total_owed,
        )?;

        // Update borrowed amount (assuming full repayment for now)
        market.total_borrowed = market.total_borrowed
            .checked_sub(amount as u128)
            .unwrap_or(0);

        emit!(RepayEvent { user: ctx.accounts.user.key(), amount: total_owed });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(params: InitializeMarketParams)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = Market::SIZE,
        seeds = [b"market", base_mint.key().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub base_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        token::mint = base_mint,
        token::authority = market
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = market
    )]
    pub receipt_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct PauseMarket<'info> {
    #[account(mut, has_one = authority)]
    pub market: Account<'info, Market>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AccrueInterest<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Supply<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_base_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub receipt_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_receipt_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_base_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub receipt_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_receipt_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct SupplyEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BorrowEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RepayEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum LendingError {
    #[msg("Invalid parameters")] InvalidParams,
    #[msg("Market is paused")] Paused,
    #[msg("Invalid amount")] InvalidAmount,
    #[msg("Unauthorized")] Unauthorized,
    #[msg("Unimplemented")] Unimplemented,
    #[msg("Insufficient liquidity")] InsufficientLiquidity,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeMarketParams {
    pub base_rate_bps: u64,
    pub slope1_bps: u64,
    pub slope2_bps: u64,
    pub kink_bps: u64,
    pub liquidation_threshold_bps: u64,
}


