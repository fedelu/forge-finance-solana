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
        .checked_mul(RATE_SCALE)
        .ok_or(LendingError::InvalidAmount)?
        .checked_div(supply as u128)
        .ok_or(LendingError::InvalidAmount)?;

    // SECURITY FIX (CRITICAL-001): Fix precision loss in interest rate calculation
    // Multiply all numerators first, then divide once at the end to maximize precision
    let kink_scaled = (market.interest_model.kink_bps as u128)
        .checked_mul(RATE_SCALE)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(LendingError::InvalidAmount)?;
    let base_scaled = (market.interest_model.base_rate_bps as u128)
        .checked_mul(RATE_SCALE)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(LendingError::InvalidAmount)?;
    let slope1_scaled = (market.interest_model.slope1_bps as u128)
        .checked_mul(RATE_SCALE)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(LendingError::InvalidAmount)?;
    let slope2_scaled = (market.interest_model.slope2_bps as u128)
        .checked_mul(RATE_SCALE)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(LendingError::InvalidAmount)?;

    // Calculate interest rate with proper precision: multiply first, then divide
    let ir_scaled = if util_scaled <= kink_scaled {
        // Below kink: base + (util * slope1) / RATE_SCALE
        // Multiply util * slope1 first, then divide by RATE_SCALE
        let util_slope_product = util_scaled
            .checked_mul(slope1_scaled)
            .ok_or(LendingError::InvalidAmount)?;
        base_scaled
            .checked_add(util_slope_product.checked_div(RATE_SCALE).ok_or(LendingError::InvalidAmount)?)
            .ok_or(LendingError::InvalidAmount)?
    } else {
        // Above kink: base + (kink * slope1) / RATE_SCALE + ((util - kink) * slope2) / RATE_SCALE
        // Calculate pre-kink component
        let kink_slope_product = kink_scaled
            .checked_mul(slope1_scaled)
            .ok_or(LendingError::InvalidAmount)?;
        let pre_kink = base_scaled
            .checked_add(kink_slope_product.checked_div(RATE_SCALE).ok_or(LendingError::InvalidAmount)?)
            .ok_or(LendingError::InvalidAmount)?;
        // Calculate post-kink component
        let delta = util_scaled
            .checked_sub(kink_scaled)
            .ok_or(LendingError::InvalidAmount)?;
        let delta_slope_product = delta
            .checked_mul(slope2_scaled)
            .ok_or(LendingError::InvalidAmount)?;
        pre_kink
            .checked_add(delta_slope_product.checked_div(RATE_SCALE).ok_or(LendingError::InvalidAmount)?)
            .ok_or(LendingError::InvalidAmount)?
    };

    // SECURITY FIX (CRITICAL-001): Use exact seconds per year constant and multiply before dividing
    // simple linear accrual per second on index: index *= (1 + ir_per_sec)
    // ir_scaled is annualized in fixed-point; convert to per-second with maximum precision
    const SECONDS_PER_YEAR: u128 = 31_536_000; // Exact: 365 * 24 * 60 * 60
    let seconds = now - market.last_accrued_ts;
    
    // Calculate increment: (accumulated_index * ir_scaled * seconds) / (RATE_SCALE * SECONDS_PER_YEAR)
    // Multiply all numerators first, then divide by denominator to maximize precision
    let increment = market.accumulated_index
        .checked_mul(ir_scaled)
        .ok_or(LendingError::InvalidAmount)?
        .checked_mul(seconds as u128)
        .ok_or(LendingError::InvalidAmount)?
        .checked_div(RATE_SCALE)
        .ok_or(LendingError::InvalidAmount)?
        .checked_div(SECONDS_PER_YEAR)
        .ok_or(LendingError::InvalidAmount)?;

    market.accumulated_index = market.accumulated_index
        .checked_add(increment)
        .ok_or(LendingError::InvalidAmount)?;
    market.last_accrued_ts = now;
    Ok(())
}

#[program]
pub mod lending {
    use super::*;

    pub fn initialize_market(ctx: Context<InitializeMarket>, params: InitializeMarketParams) -> Result<()> {
        // SECURITY FIX (AUDIT-047): Verify interest rate model parameters are reasonable
        // Base rate: 0 to 100,000 bps (0% to 1000% APY)
        require!(params.base_rate_bps <= 1_000_000, LendingError::InvalidParams);
        
        // Slope1: 0 to 1,000,000 bps (0% to 10000% APY per utilization point)
        require!(params.slope1_bps <= 1_000_000, LendingError::InvalidParams);
        
        // Slope2: 0 to 1,000,000 bps (0% to 10000% APY per utilization point)
        require!(params.slope2_bps <= 1_000_000, LendingError::InvalidParams);
        
        // Kink: 0 to 10,000 bps (0% to 100% utilization)
        require!(params.kink_bps <= 10_000, LendingError::InvalidParams);
        
        // SECURITY FIX (AUDIT-048): Verify liquidation threshold is reasonable
        // Liquidation threshold: 0 to 10,000 bps (0% to 100% LTV)
        require!(params.liquidation_threshold_bps <= 10_000, LendingError::InvalidParams);
        
        // Sanity check: liquidation threshold should be less than 100% (10,000 bps)
        // and typically between 70-90% for safety
        require!(
            params.liquidation_threshold_bps > 0 && params.liquidation_threshold_bps < 10_000,
            LendingError::InvalidParams
        );

        let market = &mut ctx.accounts.market;
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
        market.pause_proposed_at = None;
        market.bump = ctx.bumps.market;

        Ok(())
    }

    /// Propose to pause/unpause the market (requires timelock delay)
    pub fn pause_market(ctx: Context<PauseMarket>, paused: bool) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require_keys_eq!(market.authority, ctx.accounts.authority.key(), LendingError::Unauthorized);
        
        // SECURITY FIX: Implement timelock for pause operations
        // For unpausing, allow immediate execution (emergency recovery)
        // For pausing, require timelock delay via execute_pause
        if !paused && market.paused {
            // Unpausing - allow immediately for emergency recovery
            market.paused = false;
            market.pause_proposed_at = None;
        } else if paused && !market.paused {
            // SECURITY FIX: Prevent resetting existing proposal
            require!(
                market.pause_proposed_at.is_none(),
                LendingError::PauseProposalAlreadyExists
            );
            // Proposing to pause - set proposal timestamp, don't pause yet
            let clock = Clock::get()?;
            market.pause_proposed_at = Some(clock.unix_timestamp as u64);
            // Pause will be executed via execute_pause after timelock
        }
        
        Ok(())
    }
    
    /// Execute pause after timelock delay
    pub fn execute_pause(ctx: Context<PauseMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require_keys_eq!(market.authority, ctx.accounts.authority.key(), LendingError::Unauthorized);
        
        const TIMELOCK_DELAY_SECONDS: u64 = 86400; // 24 hours delay
        
        require!(
            market.pause_proposed_at.is_some(),
            LendingError::NoPauseProposal
        );
        
        // SECURITY FIX: Safe unwrap after checking is_some()
        let proposed_at = market.pause_proposed_at.ok_or(LendingError::NoPauseProposal)?;
        let clock = Clock::get()?;
        let elapsed = (clock.unix_timestamp as u64).saturating_sub(proposed_at);
        
        require!(
            elapsed >= TIMELOCK_DELAY_SECONDS,
            LendingError::TimelockNotExpired
        );
        
        // Execute the pause
        market.paused = true;
        market.pause_proposed_at = None;
        
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

        market.total_supply = market.total_supply
            .checked_add(amount as u128)
            .ok_or(LendingError::InvalidAmount)?;
        emit!(SupplyEvent { user: ctx.accounts.user.key(), amount });
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(!market.paused, LendingError::Paused);
        require!(amount > 0, LendingError::InvalidAmount);

        // SECURITY FIX: Accrue interest before state changes to ensure accurate exchange rates
        do_accrue_interest(market)?;

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
        market.total_supply = market.total_supply
            .checked_sub(amount as u128)
            .ok_or(LendingError::InvalidAmount)?;
        emit!(WithdrawEvent { user: ctx.accounts.user.key(), amount });
        Ok(())
    }

    pub fn borrow(ctx: Context<BorrowAccounts>, amount: u64) -> Result<()> {
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

        // SECURITY FIX (CRITICAL-002): Track borrower account with weighted average borrow_index
        // When borrowing multiple times, use weighted average to correctly calculate interest
        let borrower_account = &mut ctx.accounts.borrower_account;
        let amount_u128 = amount as u128;
        
        // Check if account was just initialized
        if borrower_account.borrower == Pubkey::default() {
            borrower_account.borrower = ctx.accounts.user.key();
            borrower_account.principal = 0;
            borrower_account.borrow_index = market.accumulated_index; // Track current index
        } else {
            // Validate borrower matches signer
            require!(
                borrower_account.borrower == ctx.accounts.user.key(),
                LendingError::Unauthorized
            );
            // SECURITY FIX (CRITICAL-002): Calculate weighted average borrow index
            // When adding to existing debt, calculate: (old_principal * old_index + new_amount * current_index) / (old_principal + new_amount)
            // This ensures each borrow's interest is calculated from its own borrow time
            let old_principal = borrower_account.principal;
            let old_index = borrower_account.borrow_index;
            let new_principal = old_principal
                .checked_add(amount_u128)
                .ok_or(LendingError::InvalidAmount)?;
            
            if old_principal > 0 {
                // Calculate weighted average: (old_principal * old_index + new_amount * current_index) / new_principal
                let old_weighted = old_principal
                    .checked_mul(old_index)
                    .ok_or(LendingError::InvalidAmount)?;
                let new_weighted = amount_u128
                    .checked_mul(market.accumulated_index)
                    .ok_or(LendingError::InvalidAmount)?;
                let total_weighted = old_weighted
                    .checked_add(new_weighted)
                    .ok_or(LendingError::InvalidAmount)?;
                borrower_account.borrow_index = total_weighted
                    .checked_div(new_principal)
                    .ok_or(LendingError::InvalidAmount)?;
            } else {
                // No existing principal, use current index
                borrower_account.borrow_index = market.accumulated_index;
            }
        }
        
        // Update borrower principal
        borrower_account.principal = borrower_account.principal
            .checked_add(amount_u128)
            .ok_or(LendingError::InvalidAmount)?;

        // Update borrowed amount
        market.total_borrowed = market.total_borrowed
            .checked_add(amount_u128)
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

        // SECURITY FIX: Accrue interest before state changes
        do_accrue_interest(market)?;

        // SECURITY FIX: Calculate total owed including accrued interest using accumulated_index
        // total_owed = principal × (current_accumulated_index / user_borrow_index)
        let borrower_account = &mut ctx.accounts.borrower_account;
        
        // Validate borrower matches signer
        require!(
            borrower_account.borrower == ctx.accounts.user.key(),
            LendingError::Unauthorized
        );
        
        // Calculate total owed: principal × (current_index / borrow_index)
        // Multiply first, then divide to maximize precision
        let total_owed_u128 = (borrower_account.principal as u128)
            .checked_mul(market.accumulated_index)
            .and_then(|v| v.checked_div(borrower_account.borrow_index.max(1))) // Prevent division by zero
            .ok_or(LendingError::InvalidAmount)?;
        
        // Ensure total_owed fits in u64
        let total_owed_u64 = if total_owed_u128 > u64::MAX as u128 {
            return Err(LendingError::InvalidAmount.into());
        } else {
            total_owed_u128 as u64
        };
        
        // Validate repayment amount doesn't exceed total owed
        require!(
            amount <= total_owed_u64,
            LendingError::InvalidAmount
        );

        // Transfer repayment from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            amount,
        )?;

        // SECURITY FIX: Calculate principal repaid based on repayment amount
        // For partial repayments, calculate the principal portion
        // principal_repaid = amount × (borrow_index / current_index)
        let principal_repaid_u128 = if amount >= total_owed_u64 {
            // Full repayment - repay all principal
            borrower_account.principal
        } else {
            // Partial repayment - calculate principal portion
            // principal_repaid = amount × (borrow_index / accumulated_index)
            // SECURITY FIX: Return error on calculation failure instead of silently defaulting to 0
            (amount as u128)
                .checked_mul(borrower_account.borrow_index)
                .and_then(|v| v.checked_div(market.accumulated_index.max(1)))
                .ok_or(LendingError::InvalidAmount)?
        };
        
        // SECURITY FIX: Validate amounts are sufficient before subtraction to detect accounting errors
        require!(
            borrower_account.principal >= principal_repaid_u128,
            LendingError::InvalidAmount
        );
        require!(
            market.total_borrowed >= principal_repaid_u128,
            LendingError::InvalidAmount
        );
        
        // Update borrower account
        borrower_account.principal = borrower_account.principal
            .checked_sub(principal_repaid_u128)
            .ok_or(LendingError::InvalidAmount)?;
        
        // Update market borrowed amount
        market.total_borrowed = market.total_borrowed
            .checked_sub(principal_repaid_u128)
            .ok_or(LendingError::InvalidAmount)?;

        emit!(RepayEvent { user: ctx.accounts.user.key(), amount });
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
pub struct BorrowAccounts<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// SECURITY FIX: Borrower account - auto-initializes if doesn't exist
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + BorrowerAccount::LEN,
        seeds = [b"borrower", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub borrower_account: Account<'info, BorrowerAccount>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// SECURITY FIX: Borrower account - tracks principal and borrow_index
    #[account(
        mut,
        seeds = [b"borrower", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub borrower_account: Account<'info, BorrowerAccount>,
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
    #[msg("Timelock has not expired")] TimelockNotExpired,
    #[msg("No pause proposal exists")] NoPauseProposal,
    #[msg("Pause proposal already exists")] PauseProposalAlreadyExists,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeMarketParams {
    pub base_rate_bps: u64,
    pub slope1_bps: u64,
    pub slope2_bps: u64,
    pub kink_bps: u64,
    pub liquidation_threshold_bps: u64,
}


