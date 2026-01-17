use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use crate::state::*;

/// Open a leveraged LP position
pub fn open_leveraged_position(
    ctx: Context<OpenLeveragedPosition>,
    collateral_amount: u64,
    leverage_factor: u64, // 150 = 1.5x, 200 = 2x (scaled by 100)
) -> Result<u64> {
    let position = &mut ctx.accounts.position;
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;

    require!(
        leverage_factor <= 200, // Max 2x
        CrucibleError::InvalidLeverage
    );

    require!(
        leverage_factor >= 100, // Min 1x
        CrucibleError::InvalidLeverage
    );

    // Calculate borrowed USDC amount
    // For 2x leverage: borrow = collateral (100% of collateral value)
    // For 1.5x leverage: borrow = 0.5 * collateral
    let leverage_multiplier = leverage_factor as u128;
    let borrowed_usdc = collateral_amount as u128
        .checked_mul(leverage_multiplier - 100) // (leverage - 1) * 100
        .and_then(|v| v.checked_div(100))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;

    // Get base token price (simplified - in production use oracle)
    let base_token_price = if crucible.base_mint == ctx.accounts.base_token_mint.key() {
        500_000 // $0.50 scaled by 1M (for SOL)
    } else {
        2_000 // $0.002 scaled by 1M (for FORGE)
    };

    // Calculate collateral value in USDC (simplified)
    let collateral_value_usdc = collateral_amount as u128
        .checked_mul(base_token_price as u128)
        .and_then(|v| v.checked_div(1_000_000))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;

    // Borrow USDC from lending pool
    // Note: In production, this would call lending_pool::borrow_usdc
    // For now, we'll track it in the position

    // Transfer collateral from user to crucible vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.crucible_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, collateral_amount)?;

    // Initialize position
    position.id = ctx.accounts.position_id.key();
    position.owner = ctx.accounts.user.key();
    position.token = ctx.accounts.base_token_mint.key();
    position.collateral = collateral_amount;
    position.borrowed_usdc = borrowed_usdc;
    position.leverage_factor = leverage_factor;
    position.entry_price = base_token_price;
    position.current_value = collateral_value_usdc;
    position.yield_earned = 0;
    position.is_open = true;
    position.created_at = clock.slot;
    position.bump = ctx.bumps.position;

    // Update crucible state
    crucible.total_leveraged_positions = crucible.total_leveraged_positions
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    emit!(LeveragedPositionOpened {
        position_id: position.id,
        owner: position.owner,
        token: position.token,
        collateral: collateral_amount,
        borrowed_usdc,
        leverage_factor,
    });

    Ok(position.id.key())
}

/// Close a leveraged LP position
pub fn close_leveraged_position(
    ctx: Context<CloseLeveragedPosition>,
    position_id: Pubkey,
) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;

    require!(position.is_open, CrucibleError::PositionNotOpen);
    require!(position.owner == ctx.accounts.user.key(), CrucibleError::Unauthorized);

    // Calculate yield earned (simplified - in production use exchange rate growth)
    // Yield increases cToken exchange rate
    let base_token_price = position.entry_price;
    let current_exchange_rate = calculate_lvf_exchange_rate(
        crucible,
        position.collateral,
        position.borrowed_usdc,
        clock.slot - position.created_at,
    )?;

    // Calculate tokens to return (includes yield)
    let tokens_to_return = position.collateral as u128
        .checked_mul(current_exchange_rate)
        .and_then(|v| v.checked_div(1_000_000))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;

    // Calculate protocol fee (0.3%)
    let protocol_fee = tokens_to_return as u128
        .checked_mul(3)
        .and_then(|v| v.checked_div(1000))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;

    let tokens_after_fee = tokens_to_return
        .checked_sub(protocol_fee)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Transfer tokens back to user (minus fees)
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.crucible_vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, tokens_after_fee)?;

    // Update position
    position.is_open = false;
    position.yield_earned = tokens_to_return
        .checked_sub(position.collateral)
        .unwrap_or(0);

    // Update crucible state
    crucible.total_leveraged_positions = crucible.total_leveraged_positions
        .checked_sub(1)
        .ok_or(0);

    emit!(LeveragedPositionClosed {
        position_id: position.id,
        owner: position.owner,
        collateral_returned: tokens_after_fee,
        yield_earned: position.yield_earned,
    });

    Ok(())
}

/// Calculate LVF exchange rate based on time and leverage
fn calculate_lvf_exchange_rate(
    crucible: &Crucible,
    collateral: u64,
    borrowed_usdc: u64,
    slots_elapsed: u64,
) -> Result<u64> {
    // Base exchange rate starts at 1.0 (1_000_000 scaled)
    let base_rate = 1_000_000u64;

    // Calculate effective APY with leverage
    // Effective APY = Base APY * Leverage - Borrow Cost
    let leverage_multiplier = (borrowed_usdc as u128 * 100) / collateral as u128 + 100;
    let base_apy = crucible.fee_rate; // Use crucible fee rate as base APY
    let borrow_rate = 10_000_000; // 10% (scaled by 100M)
    
    let effective_apy = (base_apy as u128 * leverage_multiplier) / 100
        .checked_sub((borrow_rate * (leverage_multiplier - 100)) / 100)
        .unwrap_or(0);

    // Convert slots to years (assuming 400ms per slot)
    let slots_per_year = 365 * 24 * 60 * 60 * 1000 / 400; // ~78.8M slots
    let years_elapsed = slots_elapsed as u128 * 1_000_000 / slots_per_year;

    // Calculate exchange rate growth: rate = (1 + APY)^years
    // Simplified: rate = 1 + (APY * years)
    let growth = (base_rate as u128 * effective_apy * years_elapsed) / (100 * 1_000_000 * 1_000_000);
    let exchange_rate = base_rate as u128 + growth;

    Ok(exchange_rate.min(u64::MAX as u128) as u64)
}

#[derive(Accounts)]
#[instruction(position_id: Pubkey)]
pub struct OpenLeveragedPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        has_one = base_mint @ CrucibleError::InvalidBaseMint,
    )]
    pub crucible: Account<'info, Crucible>,

    pub base_token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump = crucible.vault_bump,
    )]
    pub crucible_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + LeveragedPosition::LEN,
        seeds = [b"position", user.key().as_ref(), crucible.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, LeveragedPosition>,

    /// CHECK: Position ID PDA
    #[account(
        seeds = [b"position", user.key().as_ref(), crucible.key().as_ref()],
        bump,
    )]
    pub position_id: UncheckedAccount<'info>,

    /// CHECK: Crucible authority PDA
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(position_id: Pubkey)]
pub struct CloseLeveragedPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        has_one = base_mint @ CrucibleError::InvalidBaseMint,
    )]
    pub crucible: Account<'info, Crucible>,

    #[account(
        mut,
        seeds = [b"position", user.key().as_ref(), crucible.key().as_ref()],
        bump = position.bump,
        constraint = position.id == position_id @ CrucibleError::InvalidPosition,
    )]
    pub position: Account<'info, LeveragedPosition>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump = crucible.vault_bump,
    )]
    pub crucible_vault: Account<'info, TokenAccount>,

    /// CHECK: Crucible authority PDA
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct LeveragedPosition {
    pub id: Pubkey,
    pub owner: Pubkey,
    pub token: Pubkey, // Base token mint (SOL or FORGE)
    pub collateral: u64, // Base token amount deposited
    pub borrowed_usdc: u64, // USDC borrowed
    pub leverage_factor: u64, // 150 = 1.5x, 200 = 2x (scaled by 100)
    pub entry_price: u64, // Entry price in USDC (scaled)
    pub current_value: u64, // Current position value in USDC
    pub yield_earned: u64, // Yield earned in base token
    pub is_open: bool,
    pub created_at: u64, // Slot when created
    pub bump: u8,
}

impl LeveragedPosition {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 1;
}

#[event]
pub struct LeveragedPositionOpened {
    pub position_id: Pubkey,
    pub owner: Pubkey,
    pub token: Pubkey,
    pub collateral: u64,
    pub borrowed_usdc: u64,
    pub leverage_factor: u64,
}

#[event]
pub struct LeveragedPositionClosed {
    pub position_id: Pubkey,
    pub owner: Pubkey,
    pub collateral_returned: u64,
    pub yield_earned: u64,
}

