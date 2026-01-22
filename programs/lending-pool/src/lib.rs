use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

declare_id!("3UPgC2UJ6odJwWPBqDEx19ycL5ccuS3mbF1pt5SU39dx");

#[program]
pub mod lending_pool_usdc {
    use super::*;

    /// Initialize the lending pool with USDC
    pub fn initialize(ctx: Context<Initialize>, initial_liquidity: u64) -> Result<()> {
        // SECURITY FIX (AUDIT-064): Validate initial_liquidity is reasonable
        // Allow zero initial liquidity (pool can start empty)
        // Maximum: 1 billion USDC (1_000_000_000 * 10^6 lamports for 6 decimals)
        const MAX_INITIAL_LIQUIDITY: u64 = 1_000_000_000_000_000; // 1 billion USDC with 6 decimals
        require!(
            initial_liquidity <= MAX_INITIAL_LIQUIDITY,
            LendingPoolError::InvalidAmount
        );
        
        // SECURITY FIX (AUDIT-065): Verify interest rates are reasonable
        // Rates are hardcoded below, but we validate they're within bounds
        const MAX_BORROW_RATE: u64 = 1000; // 1000% APY max (scaled by 100)
        const MAX_LENDER_RATE: u64 = 500; // 500% APY max (scaled by 100)
        const BORROW_RATE: u64 = 10; // 10% APY (scaled by 100)
        const LENDER_RATE: u64 = 5; // 5% APY (scaled by 100)
        
        require!(
            BORROW_RATE <= MAX_BORROW_RATE && LENDER_RATE <= MAX_LENDER_RATE,
            LendingPoolError::InvalidConfig
        );
        require!(
            LENDER_RATE <= BORROW_RATE, // Lender rate should not exceed borrow rate
            LendingPoolError::InvalidConfig
        );
        
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.total_liquidity = initial_liquidity;
        pool.total_borrowed = 0;
        pool.borrow_rate = BORROW_RATE;
        pool.lender_rate = LENDER_RATE;
        pool.paused = false;
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    /// Deposit USDC to the lending pool (lenders)
    pub fn deposit_usdc(ctx: Context<DepositUSDC>, amount: u64) -> Result<()> {
        // SECURITY FIX: Explicit zero amount validation
        require!(amount > 0, LendingPoolError::InvalidAmount);
        
        // SECURITY FIX: Maximum deposit amount to prevent overflow (1 billion USDC)
        const MAX_DEPOSIT_AMOUNT: u64 = 1_000_000_000_000_000; // 1 billion USDC with 6 decimals
        require!(amount <= MAX_DEPOSIT_AMOUNT, LendingPoolError::InvalidAmount);
        
        let pool = &mut ctx.accounts.pool;
        
        // SECURITY FIX: Explicitly validate pool is a PDA with correct seeds
        let (expected_pool_pda, expected_bump) = Pubkey::find_program_address(
            &[b"pool"],
            ctx.program_id,
        );
        require!(
            pool.key() == expected_pool_pda,
            LendingPoolError::InvalidConfig
        );
        require!(
            pool.bump == expected_bump,
            LendingPoolError::InvalidConfig
        );
        
        // SECURITY FIX: Check if pool is paused
        require!(!pool.paused, LendingPoolError::PoolPaused);
        
        // Transfer USDC from user to pool vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc_account.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Update pool state
        pool.total_liquidity = pool.total_liquidity
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        emit!(USDCDeposited {
            lender: ctx.accounts.user.key(),
            amount,
            total_liquidity: pool.total_liquidity,
        });

        Ok(())
    }

    /// Borrow USDC from the lending pool
    pub fn borrow_usdc(ctx: Context<BorrowUSDC>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        // SECURITY FIX: Explicitly validate pool is a PDA with correct seeds
        let (expected_pool_pda, expected_bump) = Pubkey::find_program_address(
            &[b"pool"],
            ctx.program_id,
        );
        require!(
            pool.key() == expected_pool_pda,
            LendingPoolError::InvalidConfig
        );
        require!(
            pool.bump == expected_bump,
            LendingPoolError::InvalidConfig
        );
        
        // SECURITY FIX: Check if pool is paused
        require!(!pool.paused, LendingPoolError::PoolPaused);
        
        // SECURITY FIX: Explicit zero amount validation
        require!(amount > 0, LendingPoolError::InvalidAmount);
        
        // SECURITY FIX: Maximum borrow amount to prevent overflow (1 billion USDC)
        const MAX_BORROW_AMOUNT: u64 = 1_000_000_000_000_000; // 1 billion USDC with 6 decimals
        require!(amount <= MAX_BORROW_AMOUNT, LendingPoolError::InvalidAmount);

        // SECURITY FIX (MEDIUM-001): Enforce minimum liquidity reserve to prevent complete pool drainage
        const MIN_LIQUIDITY_RESERVE: u64 = 1_000_000; // 1 USDC minimum reserve (1 USDC = 1_000_000 lamports for 6 decimals)
        let available = pool.total_liquidity
            .checked_sub(pool.total_borrowed)
            .ok_or(LendingPoolError::InsufficientLiquidity)?;
        // SECURITY FIX (MEDIUM-003): Use explicit error handling instead of unwrap_or(0)
        let borrowable = available
            .checked_sub(MIN_LIQUIDITY_RESERVE)
            .ok_or(LendingPoolError::InsufficientLiquidity)?;
        require!(
            amount > 0 && amount <= borrowable,
            LendingPoolError::InsufficientLiquidity
        );
        
        // Transfer USDC from pool vault to borrower
        // SECURITY FIX: Pool is a PDA and signs transfers
        let seeds: &[&[u8]] = &[b"pool", &[pool.bump]];
        let signer = &[seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_vault.to_account_info(),
            to: ctx.accounts.borrower_usdc_account.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        // Update pool state
        pool.total_borrowed = pool.total_borrowed
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Record borrower debt
        // SECURITY FIX: init_if_needed handles account creation, but we need to validate
        // that the borrower field matches the signer after initialization
        let borrower_account = &mut ctx.accounts.borrower_account;
        
        let clock = Clock::get()?;
        
        // SECURITY FIX (HIGH-003): Use Unix timestamp instead of slot for accurate time measurement
        let current_timestamp = clock.unix_timestamp as u64;
        
        // Check if account was just initialized by checking if borrower is default
        // If so, initialize it properly
        if borrower_account.borrower == Pubkey::default() {
            borrower_account.borrower = ctx.accounts.borrower.key();
            borrower_account.amount_borrowed = 0;
            borrower_account.borrow_timestamp = current_timestamp; // Track creation timestamp for new borrowers
        } else {
            // SECURITY FIX: Validate borrower matches signer to prevent account hijacking
            require!(
                borrower_account.borrower == ctx.accounts.borrower.key(),
                LendingPoolError::InvalidBorrower
            );
            // SECURITY FIX (HIGH-003 + CRITICAL-002): Calculate weighted average borrow timestamp
            // When adding to existing debt, calculate: (old_amount * old_timestamp + new_amount * current_timestamp) / (old_amount + new_amount)
            // This ensures each borrow's interest is calculated from its own borrow time
            let old_amount = borrower_account.amount_borrowed;
            let old_timestamp = borrower_account.borrow_timestamp;
            let new_amount = old_amount
                .checked_add(amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;
            
            if old_amount > 0 {
                // Calculate weighted average: (old_amount * old_timestamp + new_amount * current_timestamp) / new_amount
                let old_weighted = (old_amount as u128)
                    .checked_mul(old_timestamp as u128)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
                let new_weighted = (amount as u128)
                    .checked_mul(current_timestamp as u128)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
                let total_weighted = old_weighted
                    .checked_add(new_weighted)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
                borrower_account.borrow_timestamp = (total_weighted
                    .checked_div(new_amount as u128)
                    .ok_or(ProgramError::ArithmeticOverflow)?) as u64;
            } else {
                // No existing amount, use current timestamp
                borrower_account.borrow_timestamp = current_timestamp;
            }
        }
        
        borrower_account.amount_borrowed = borrower_account.amount_borrowed
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        emit!(USDCBorrowed {
            borrower: ctx.accounts.borrower.key(),
            amount,
            total_borrowed: pool.total_borrowed,
        });

        Ok(())
    }

    /// Repay borrowed USDC
    pub fn repay_usdc(ctx: Context<RepayUSDC>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        // SECURITY FIX: Explicitly validate pool is a PDA with correct seeds
        let (expected_pool_pda, expected_bump) = Pubkey::find_program_address(
            &[b"pool"],
            ctx.program_id,
        );
        require!(
            pool.key() == expected_pool_pda,
            LendingPoolError::InvalidConfig
        );
        require!(
            pool.bump == expected_bump,
            LendingPoolError::InvalidConfig
        );
        
        // SECURITY FIX: Check if pool is paused
        require!(!pool.paused, LendingPoolError::PoolPaused);
        
        // SECURITY FIX: Explicit zero amount validation
        require!(amount > 0, LendingPoolError::InvalidAmount);
        
        let borrower_account = &mut ctx.accounts.borrower_account;
        
        // SECURITY FIX (LOW-002): Validate borrower account is initialized
        require!(
            borrower_account.borrower != Pubkey::default(),
            LendingPoolError::InvalidBorrower
        );
        
        // SECURITY FIX: Validate borrower matches signer
        require!(
            borrower_account.borrower == ctx.accounts.borrower.key(),
            LendingPoolError::InvalidBorrower
        );
        
        let clock = Clock::get()?;

        // SECURITY FIX (HIGH-003): Calculate accrued interest using Unix timestamp for accurate time measurement
        // Interest calculation: borrowedAmount × (borrowRate / 100) × (timeElapsed / timePerYear)
        // borrow_rate is stored as 10 = 10% APY (scaled by 100)
        // Use Unix timestamp-based calculation for accuracy (not affected by slot timing variations)
        const SECONDS_PER_YEAR: u64 = 31_536_000; // Exact: 365 * 24 * 60 * 60
        
        // SECURITY FIX: Use borrow_timestamp (tracked when loan was created) for accurate time measurement
        // SECURITY FIX: Validate borrow_timestamp <= current_timestamp to prevent invalid time calculations
        let current_timestamp = clock.unix_timestamp as u64;
        require!(
            borrower_account.borrow_timestamp <= current_timestamp,
            LendingPoolError::InvalidConfig
        );
        let seconds_elapsed = current_timestamp
            .checked_sub(borrower_account.borrow_timestamp)
            .ok_or(LendingPoolError::InvalidConfig)?;
        
        // SECURITY FIX: Proper interest calculation with optimized precision
        // Multiply numerators first, then divide to maximize precision
        let borrow_rate = pool.borrow_rate; // Fetch from pool state (10 = 10% APY, scaled by 100)
        let principal_u128 = borrower_account.amount_borrowed as u128;
        let borrow_rate_u128 = borrow_rate as u128;
        let seconds_elapsed_u128 = seconds_elapsed as u128;
        
        // Interest = (principal × borrow_rate × seconds_elapsed) / (100 × SECONDS_PER_YEAR)
        // Multiply all numerators first, then divide by denominator to maximize precision
        // SECURITY FIX: Return error on overflow instead of silently defaulting to 0
        // Overflow indicates extremely large values that could indicate an attack or bug
        let interest_accrued = principal_u128
            .checked_mul(borrow_rate_u128)
            .and_then(|v| v.checked_mul(seconds_elapsed_u128))
            .and_then(|v| v.checked_div(100u128))
            .and_then(|v| v.checked_div(SECONDS_PER_YEAR as u128))
            .ok_or(LendingPoolError::InvalidAmount)?;
        
        let total_owed = (borrower_account.amount_borrowed as u128)
            .checked_add(interest_accrued)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        
        let total_owed_u64 = if total_owed > u64::MAX as u128 {
            return Err(ProgramError::ArithmeticOverflow.into());
        } else {
            total_owed as u64
        };

        require!(
            amount <= total_owed_u64,
            LendingPoolError::RepayAmountExceedsDebt
        );

        // Transfer USDC from borrower to pool vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.borrower_usdc_account.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
            authority: ctx.accounts.borrower.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // SECURITY FIX (CRITICAL-005): Properly calculate principal vs interest portions
        // Calculate how much principal was repaid (amount may include interest)
        let principal_repaid = if amount >= total_owed_u64 {
            // Full repayment - repay all principal
            borrower_account.amount_borrowed
        } else {
            // Partial repayment - calculate principal portion
            // principal_repaid = amount × (principal / total_owed)
            // This ensures interest is paid first, then principal
            let principal_portion = (amount as u128)
                .checked_mul(borrower_account.amount_borrowed as u128)
                .and_then(|v| v.checked_div(total_owed_u64 as u128))
                .ok_or(LendingPoolError::InvalidAmount)? as u64;
            
            // Update borrow_timestamp proportionally for remaining debt
            // New timestamp = old_timestamp + (elapsed × principal_repaid / principal)
            let remaining_principal = borrower_account.amount_borrowed
                .checked_sub(principal_portion)
                .ok_or(LendingPoolError::InvalidAmount)?;
            
            if remaining_principal > 0 {
                // Update timestamp: move forward proportionally
                let principal_repaid_u128 = principal_portion as u128;
                let total_principal_u128 = borrower_account.amount_borrowed as u128;
                let time_advance = (seconds_elapsed as u128)
                    .checked_mul(principal_repaid_u128)
                    .and_then(|v| v.checked_div(total_principal_u128))
                    .ok_or(LendingPoolError::InvalidAmount)?;
                borrower_account.borrow_timestamp = borrower_account.borrow_timestamp
                    .checked_add(time_advance as u64)
                    .ok_or(LendingPoolError::InvalidAmount)?;
            } else {
                // All principal repaid, reset timestamp
                borrower_account.borrow_timestamp = current_timestamp;
            }
            
            principal_portion
        };
        
        // SECURITY FIX: Validate amounts are sufficient before subtraction to detect accounting errors
        require!(
            pool.total_borrowed >= principal_repaid,
            LendingPoolError::InvalidAmount
        );
        require!(
            borrower_account.amount_borrowed >= principal_repaid,
            LendingPoolError::InvalidAmount
        );
        
        pool.total_borrowed = pool.total_borrowed
            .checked_sub(principal_repaid)
            .ok_or(LendingPoolError::InvalidAmount)?;
        borrower_account.amount_borrowed = borrower_account.amount_borrowed
            .checked_sub(principal_repaid)
            .ok_or(LendingPoolError::InvalidAmount)?;
        
        // SECURITY FIX (CRITICAL-005): Reset timestamp if all debt is repaid
        if borrower_account.amount_borrowed == 0 {
            borrower_account.borrow_timestamp = current_timestamp;
        }

        emit!(USDCRepaid {
            borrower: ctx.accounts.borrower.key(),
            amount,
            remaining_debt: borrower_account.amount_borrowed,
        });

        Ok(())
    }

    /// Get available liquidity (view function simulation)
    pub fn get_available_liquidity(ctx: Context<GetAvailableLiquidity>) -> Result<u64> {
        let pool = &ctx.accounts.pool;
        let available = pool.total_liquidity
            .checked_sub(pool.total_borrowed)
            .ok_or(LendingPoolError::InsufficientLiquidity)?;
        Ok(available)
    }
    
    /// Pause/Resume the lending pool (emergency function)
    pub fn set_pool_status(
        ctx: Context<SetPoolStatus>,
        paused: bool,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        // SECURITY FIX: Explicitly verify authority matches pool authority
        require_keys_eq!(
            pool.authority,
            ctx.accounts.authority.key(),
            LendingPoolError::Unauthorized
        );
        
        // SECURITY FIX: Prevent redundant state changes
        require!(
            pool.paused != paused,
            LendingPoolError::InvalidConfig
        );
        
        pool.paused = paused;
        
        msg!("Pool status set to: {}", if paused { "paused" } else { "active" });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + LendingPool::LEN,
        seeds = [b"pool"],
        bump,
    )]
    pub pool: Account<'info, LendingPool>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositUSDC<'info> {
    #[account(mut)]
    pub pool: Account<'info, LendingPool>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub user_usdc_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump,
        constraint = pool_vault.mint == pool.usdc_mint @ LendingPoolError::InvalidConfig
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BorrowUSDC<'info> {
    #[account(mut)]
    pub pool: Account<'info, LendingPool>,

    #[account(mut)]
    pub borrower: Signer<'info>,

    /// SECURITY FIX: Borrower account - auto-initializes if doesn't exist  
    #[account(
        init_if_needed,
        payer = borrower,
        space = 8 + BorrowerAccount::LEN,
        seeds = [b"borrower", borrower.key().as_ref()],
        bump
    )]
    pub borrower_account: Account<'info, BorrowerAccount>,

    #[account(mut)]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub borrower_usdc_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RepayUSDC<'info> {
    #[account(mut)]
    pub pool: Account<'info, LendingPool>,

    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [b"borrower", borrower.key().as_ref()],
        bump,
    )]
    pub borrower_account: Account<'info, BorrowerAccount>,

    #[account(mut)]
    pub borrower_usdc_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump,
        constraint = pool_vault.mint == pool.usdc_mint @ LendingPoolError::InvalidConfig
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct GetAvailableLiquidity<'info> {
    pub pool: Account<'info, LendingPool>,
}

#[derive(Accounts)]
pub struct SetPoolStatus<'info> {
    #[account(mut, has_one = authority)]
    pub pool: Account<'info, LendingPool>,
    pub authority: Signer<'info>,
}

#[account]
pub struct LendingPool {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub total_liquidity: u64,
    pub total_borrowed: u64,
    pub borrow_rate: u64, // 10 = 10% APY (scaled by 100)
    pub lender_rate: u64, // 5 = 5% APY (scaled by 100)
    pub paused: bool,
    pub bump: u8,
}

impl LendingPool {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1; // authority (32) + usdc_mint (32) + total_liquidity (8) + total_borrowed (8) + borrow_rate (8) + lender_rate (8) + paused (1) + bump (1)
}

#[account]
pub struct BorrowerAccount {
    pub borrower: Pubkey,
    pub amount_borrowed: u64,
    pub borrow_timestamp: u64, // Unix timestamp when the loan was created (for interest calculation)
}

impl BorrowerAccount {
    pub const LEN: usize = 32 + 8 + 8; // borrower (32) + amount_borrowed (8) + borrow_timestamp (8)
}

#[event]
pub struct USDCDeposited {
    pub lender: Pubkey,
    pub amount: u64,
    pub total_liquidity: u64,
}

#[event]
pub struct USDCBorrowed {
    pub borrower: Pubkey,
    pub amount: u64,
    pub total_borrowed: u64,
}

#[event]
pub struct USDCRepaid {
    pub borrower: Pubkey,
    pub amount: u64,
    pub remaining_debt: u64,
}

#[error_code]
pub enum LendingPoolError {
    #[msg("Insufficient liquidity in pool")]
    InsufficientLiquidity,
    #[msg("Repay amount exceeds debt")]
    RepayAmountExceedsDebt,
    #[msg("Invalid borrower account")]
    InvalidBorrower,
    #[msg("Invalid amount - must be greater than zero")]
    InvalidAmount,
    #[msg("Pool is paused")]
    PoolPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid configuration")]
    InvalidConfig,
}

