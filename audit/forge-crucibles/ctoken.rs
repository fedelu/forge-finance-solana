use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Burn};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;

/// Mint cToken when user deposits base token
pub fn mint_ctoken(ctx: Context<MintCToken>, amount: u64) -> Result<()> {
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;
    
    // Calculate exchange rate (1 cToken = base_amount / total_ctoken_supply)
    // Exchange rate grows as fees accrue
    let exchange_rate = calculate_exchange_rate(
        &crucible,
        ctx.accounts.vault.amount,
        ctx.accounts.ctoken_mint.supply,
    )?;
    
    // Calculate how many cTokens to mint based on current exchange rate
    let ctokens_to_mint = amount
        .checked_mul(1_000_000u64) // Scale for precision
        .and_then(|scaled| scaled.checked_div(exchange_rate))
        .ok_or(ProgramError::InvalidArgument)?;
    
    // Transfer base tokens from user to vault
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
    
    // Mint cTokens to user
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible.bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_accounts = MintTo {
        mint: ctx.accounts.ctoken_mint.to_account_info(),
        to: ctx.accounts.user_ctoken_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::mint_to(cpi_ctx, ctokens_to_mint)?;
    
    // Update crucible state
    crucible.total_base_deposited = crucible
        .total_base_deposited
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    crucible.last_update_slot = clock.slot;
    
    emit!(CTokenMinted {
        crucible: crucible.key(),
        user: ctx.accounts.user.key(),
        amount,
        ctokens_minted: ctokens_to_mint,
        exchange_rate,
    });
    
    Ok(())
}

/// Burn cToken and return base tokens to user
pub fn burn_ctoken(ctx: Context<BurnCToken>, ctokens_amount: u64) -> Result<()> {
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;
    
    // Calculate current exchange rate
    let exchange_rate = calculate_exchange_rate(
        &crucible,
        ctx.accounts.vault.amount,
        ctx.accounts.ctoken_mint.supply,
    )?;
    
    // Calculate base tokens to return (includes accrued yield)
    let base_to_return = ctokens_amount
        .checked_mul(exchange_rate)
        .and_then(|scaled| scaled.checked_div(1_000_000u64))
        .ok_or(ProgramError::InvalidArgument)?;
    
    require!(
        base_to_return <= ctx.accounts.vault.amount,
        CrucibleError::InsufficientLiquidity
    );
    
    // Burn user's cTokens
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible.bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_accounts = Burn {
        mint: ctx.accounts.ctoken_mint.to_account_info(),
        from: ctx.accounts.user_ctoken_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::burn(cpi_ctx, ctokens_amount)?;
    
    // Transfer base tokens from vault to user
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, base_to_return)?;
    
    // Update crucible state
    crucible.total_base_deposited = crucible
        .total_base_deposited
        .checked_sub(base_to_return.min(crucible.total_base_deposited))
        .unwrap_or(0);
    crucible.last_update_slot = clock.slot;
    
    emit!(CTokenBurned {
        crucible: crucible.key(),
        user: ctx.accounts.user.key(),
        ctokens_burned: ctokens_amount,
        base_returned: base_to_return,
        exchange_rate,
    });
    
    Ok(())
}

/// Calculate exchange rate: vault_amount / ctoken_supply (scaled by 1M for precision)
fn calculate_exchange_rate(
    _crucible: &Crucible,
    vault_amount: u64,
    ctoken_supply: u64,
) -> Result<u64> {
    if ctoken_supply == 0 {
        // Initial exchange rate is 1:1
        return Ok(1_000_000u64);
    }
    
    vault_amount
        .checked_mul(1_000_000u64)
        .and_then(|scaled| scaled.checked_div(ctoken_supply))
        .ok_or(ProgramError::ArithmeticOverflow.into())
}

#[derive(Accounts)]
pub struct MintCToken<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        has_one = base_mint @ CrucibleError::InvalidBaseMint,
    )]
    pub crucible: Account<'info, Crucible>,
    
    pub base_mint: Account<'info, Mint>,
    #[account(mut)]
    pub ctoken_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = ctoken_mint,
        associated_token::authority = user,
    )]
    pub user_ctoken_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump = crucible.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,
    
    /// CHECK: PDA authority for the crucible
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BurnCToken<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        has_one = base_mint @ CrucibleError::InvalidBaseMint,
    )]
    pub crucible: Account<'info, Crucible>,
    
    pub base_mint: Account<'info, Mint>,
    #[account(mut)]
    pub ctoken_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_ctoken_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump = crucible.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: PDA authority for the crucible
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct CTokenMinted {
    pub crucible: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub ctokens_minted: u64,
    pub exchange_rate: u64,
}

#[event]
pub struct CTokenBurned {
    pub crucible: Pubkey,
    pub user: Pubkey,
    pub ctokens_burned: u64,
    pub base_returned: u64,
    pub exchange_rate: u64,
}

#[error_code]
pub enum CrucibleError {
    #[msg("Insufficient liquidity in vault")]
    InsufficientLiquidity,
    #[msg("Invalid base mint")]
    InvalidBaseMint,
    #[msg("Invalid leverage factor")]
    InvalidLeverage,
    #[msg("Position is not open")]
    PositionNotOpen,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid position ID")]
    InvalidPosition,
}

