use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, MintTo, Transfer};

declare_id!("3UPgC2UJ6odJwWPBqDEx19ycL5ccuS3mbF1pt5SU39dx");

#[program]
pub mod lending_pool_usdc {
    use super::*;

    /// Initialize the lending pool with USDC
    pub fn initialize(ctx: Context<Initialize>, initial_liquidity: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.total_liquidity = initial_liquidity;
        pool.total_borrowed = 0;
        pool.borrow_rate = 10; // 10% APY (scaled by 100)
        pool.lender_rate = 5; // 5% APY for lenders (scaled by 100)
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    /// Deposit USDC to the lending pool (lenders)
    pub fn deposit_usdc(ctx: Context<DepositUSDC>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
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

        let available = pool.total_liquidity
            .checked_sub(pool.total_borrowed)
            .ok_or(LendingPoolError::InsufficientLiquidity)?;
        require!(
            amount <= available,
            LendingPoolError::InsufficientLiquidity
        );
        
        // Transfer USDC from pool vault to borrower
        // Note: In production, pool would be a PDA and sign transfers
        // For MVP, we use a simple token transfer
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
        // SECURITY FIX: Initialize borrower account if it was just created
        // init_if_needed handles account creation, we just need to set initial values
        // Note: Initialization happens after transfer to ensure account is created
        let borrower_account = &mut ctx.accounts.borrower_account;
        if borrower_account.borrower == Pubkey::default() {
            borrower_account.borrower = ctx.accounts.borrower.key();
            borrower_account.amount_borrowed = 0;
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
        let borrower_account = &mut ctx.accounts.borrower_account;

        require!(
            amount <= borrower_account.amount_borrowed,
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

        // Update pool state
        // Use saturating_sub for repayments to prevent underflow
        pool.total_borrowed = pool.total_borrowed.saturating_sub(amount);

        borrower_account.amount_borrowed = borrower_account.amount_borrowed.saturating_sub(amount);

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
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct GetAvailableLiquidity<'info> {
    pub pool: Account<'info, LendingPool>,
}

#[account]
pub struct LendingPool {
    pub usdc_mint: Pubkey,
    pub total_liquidity: u64,
    pub total_borrowed: u64,
    pub borrow_rate: u64, // 10 = 10% APY (scaled by 100)
    pub lender_rate: u64, // 5 = 5% APY (scaled by 100)
    pub bump: u8,
}

impl LendingPool {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct BorrowerAccount {
    pub borrower: Pubkey,
    pub amount_borrowed: u64,
}

impl BorrowerAccount {
    pub const LEN: usize = 32 + 8; // borrower (32) + amount_borrowed (8)
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
}

