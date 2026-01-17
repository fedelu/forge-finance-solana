use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

use crate::state::{Crucible, LPPosition};

const RATE_SCALE: u128 = 1_000_000_000u128;

#[error_code]
pub enum CrucibleError {
    #[msg("Invalid LP amounts - must be equal value")]
    InvalidLPAmounts,
    #[msg("Position not found")]
    PositionNotFound,
}

pub fn open_lp_position(
    ctx: Context<OpenLPPosition>,
    base_amount: u64,
    usdc_amount: u64,
) -> Result<u64> {
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;

    // Validate amounts are equal value (within tolerance)
    // base_amount * base_price ≈ usdc_amount * 1.0
    // In production, determine base token from base_mint or context
    // For now, use a simplified check - in production you'd compare mint addresses
    let base_token_price = 0.5; // Default SOL price - in production, get from oracle or config

    let base_value = (base_amount as u128)
        .checked_mul((base_token_price * 1_000_000.0) as u128)
        .unwrap()
        .checked_div(1_000_000u128)
        .unwrap();

    let usdc_value = (usdc_amount as u128)
        .checked_mul(1_000_000u128)
        .unwrap()
        .checked_div(1_000_000u128)
        .unwrap();

    // Allow 1% tolerance
    let tolerance = base_value
        .checked_mul(100)
        .unwrap()
        .checked_div(10000)
        .unwrap();

    require!(
        base_value.checked_sub(usdc_value).unwrap().abs() <= tolerance || 
        usdc_value.checked_sub(base_value).unwrap().abs() <= tolerance,
        CrucibleError::InvalidLPAmounts
    );

    // Transfer base token to crucible
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_base_token_account.to_account_info(),
        to: ctx.accounts.crucible_base_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, base_amount)?;

    // Transfer USDC to crucible
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_usdc_account.to_account_info(),
        to: ctx.accounts.crucible_usdc_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, usdc_amount)?;

    // Create LP position
    let position_id = crucible.total_lp_positions.checked_add(1).unwrap();
    let entry_price = base_token_price; // Store entry price

    // Store position (in production, use PDA account)
    // For now, we'll just increment the counter
    // The actual position data would be stored in a separate PDA account

    crucible.total_lp_positions = position_id;
    // Store position (in production, use PDA account)
    
    msg!("LP position opened: {} base + {} USDC (position ID: {})", base_amount, usdc_amount, position_id);
    Ok(position_id)
}

pub fn close_lp_position(
    ctx: Context<CloseLPPosition>,
    position_id: u64,
) -> Result<()> {
    let crucible = &mut ctx.accounts.crucible;

    // In production, fetch position from PDA
    // For now, validate position exists and is open
    require!(
        position_id > 0 && position_id <= crucible.total_lp_positions,
        CrucibleError::PositionNotFound
    );

    // Calculate return amounts (with yield)
    // Simplified: return proportional amounts
    // In production, calculate based on LP pool reserves

    // Transfer tokens back to user
    // (Implementation depends on LP pool mechanics)

    // Update crucible state
    crucible.total_lp_positions = crucible.total_lp_positions
        .checked_sub(1)
        .unwrap_or(0);

    msg!("LP position closed: {}", position_id);
    Ok(())
}

#[derive(Accounts)]
pub struct OpenLPPosition<'info> {
    #[account(mut)]
    pub crucible: Account<'info, Crucible>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_base_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_usdc_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub crucible_base_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub crucible_usdc_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseLPPosition<'info> {
    #[account(mut)]
    pub crucible: Account<'info, Crucible>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_base_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_usdc_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub crucible_base_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub crucible_usdc_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum CrucibleError {
    #[msg("Invalid LP amounts - must be equal value")]
    InvalidLPAmounts,
    #[msg("Position not found")]
    PositionNotFound,
}

