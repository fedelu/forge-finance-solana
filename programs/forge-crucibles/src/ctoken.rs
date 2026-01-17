use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Burn};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::{Crucible, CrucibleError};

/// Mint cToken when user deposits base token
pub fn mint_ctoken(ctx: Context<MintCToken>, amount: u64) -> Result<()> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;
    
    // Calculate exchange rate (1 cToken = base_amount / total_ctoken_supply)
    // Exchange rate grows as fees accrue
    let exchange_rate = calculate_exchange_rate(
        &crucible,
        ctx.accounts.vault.amount,
        ctx.accounts.ctoken_mint.supply,
    )?;
    
    // Calculate wrap fee: 0.5% of deposit amount
    let wrap_fee = amount
        .checked_mul(5u64)
        .and_then(|v| v.checked_div(1000u64))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Split fee: 80% to vault, 20% to treasury
    let vault_fee_share = wrap_fee
        .checked_mul(80u64)
        .and_then(|v| v.checked_div(100u64))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let protocol_fee_share = wrap_fee
        .checked_sub(vault_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Net deposit after fee
    let net_deposit = amount
        .checked_sub(wrap_fee)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate how many cTokens to mint based on current exchange rate (using net deposit)
    let ctokens_to_mint = net_deposit
        .checked_mul(1_000_000u64) // Scale for precision
        .and_then(|scaled| scaled.checked_div(exchange_rate))
        .ok_or(ProgramError::InvalidArgument)?;
    
    // Transfer net deposit from user to vault
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, net_deposit)?;
    
    // Transfer vault fee share to vault (generates yield for cToken holders)
    if vault_fee_share > 0 {
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, vault_fee_share)?;
    }
    
    // Transfer protocol fee share to treasury (if non-zero)
    if protocol_fee_share > 0 {
        // Validate treasury account matches crucible.treasury
        require!(
            ctx.accounts.treasury.key() == crucible.treasury,
            CrucibleError::InvalidTreasury
        );
        
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, protocol_fee_share)?;
    }
    
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
    
    // Update crucible state and expected vault balance
    crucible.total_base_deposited = crucible
        .total_base_deposited
        .checked_add(net_deposit)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    // Add net deposit + vault fee share to expected balance (vault fee share increases yield)
    crucible.expected_vault_balance = crucible
        .expected_vault_balance
        .checked_add(net_deposit)
        .ok_or(ProgramError::ArithmeticOverflow)?
        .checked_add(vault_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    // Track total fees accrued
    crucible.total_fees_accrued = crucible
        .total_fees_accrued
        .checked_add(vault_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    crucible.last_update_slot = clock.slot;
    
    emit!(CTokenMinted {
        crucible: crucible.key(),
        user: ctx.accounts.user.key(),
        amount: net_deposit,
        ctokens_minted: ctokens_to_mint,
        exchange_rate,
        wrap_fee,
        vault_fee_share,
        protocol_fee_share,
    });
    
    Ok(())
}

/// Burn cToken and return base tokens to user
pub fn burn_ctoken(ctx: Context<BurnCToken>, ctokens_amount: u64) -> Result<()> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;
    
    // Calculate current exchange rate
    let exchange_rate = calculate_exchange_rate(
        &crucible,
        ctx.accounts.vault.amount,
        ctx.accounts.ctoken_mint.supply,
    )?;
    
    // Calculate base tokens to return (includes accrued yield)
    let base_to_return_before_fee = ctokens_amount
        .checked_mul(exchange_rate)
        .and_then(|scaled| scaled.checked_div(1_000_000u64))
        .ok_or(ProgramError::InvalidArgument)?;
    
    require!(
        base_to_return_before_fee <= ctx.accounts.vault.amount,
        CrucibleError::InsufficientLiquidity
    );
    
    // Calculate unwrap fee: 0.75% (TODO: reduce to 0.3% after 5-day cooldown)
    let unwrap_fee = base_to_return_before_fee
        .checked_mul(75u64)
        .and_then(|v| v.checked_div(10000u64))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Split fee: 80% to vault, 20% to treasury
    let vault_fee_share = unwrap_fee
        .checked_mul(80u64)
        .and_then(|v| v.checked_div(100u64))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let protocol_fee_share = unwrap_fee
        .checked_sub(vault_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Net amount to return to user (after fee)
    let base_to_return = base_to_return_before_fee
        .checked_sub(unwrap_fee)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
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
    
    // Transfer net base tokens from vault to user
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, base_to_return)?;
    
    // Transfer protocol fee share to treasury (vault fee share stays in vault)
    if protocol_fee_share > 0 {
        // Validate treasury account matches crucible.treasury
        require!(
            ctx.accounts.treasury.key() == crucible.treasury,
            CrucibleError::InvalidTreasury
        );
        
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.crucible_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, protocol_fee_share)?;
    }
    
    // Update crucible state and expected vault balance
    // Fee share stays in vault (increases yield for remaining holders)
    let total_deducted = base_to_return
        .checked_add(protocol_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    crucible.total_base_deposited = crucible
        .total_base_deposited
        .checked_sub(base_to_return_before_fee.min(crucible.total_base_deposited))
        .unwrap_or(0);
    // Deduct total returned + protocol fee, but vault fee share stays (already accounted for in vault balance)
    crucible.expected_vault_balance = crucible
        .expected_vault_balance
        .checked_sub(total_deducted)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    // Track vault fee share in total fees accrued
    crucible.total_fees_accrued = crucible
        .total_fees_accrued
        .checked_add(vault_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    crucible.last_update_slot = clock.slot;
    
    emit!(CTokenBurned {
        crucible: crucible.key(),
        user: ctx.accounts.user.key(),
        ctokens_burned: ctokens_amount,
        base_returned: base_to_return,
        exchange_rate,
        unwrap_fee,
        vault_fee_share,
        protocol_fee_share,
    });
    
    Ok(())
}

/// Calculate exchange rate: vault_amount / ctoken_supply (scaled by 1M for precision)
/// Validates vault balance is at least expected amount (allows fee accrual growth)
/// SECURITY FIX: Multiply first, then divide to prevent precision loss
/// Fee accrual allows vault_amount >= expected_vault_balance (fees increase yield)
fn calculate_exchange_rate(
    crucible: &Crucible,
    vault_amount: u64,
    ctoken_supply: u64,
) -> Result<u64> {
    // Allow vault_amount >= expected_vault_balance (fees accrue and increase yield)
    // But prevent vault_amount < expected_vault_balance (which would indicate manipulation)
    require!(
        vault_amount >= crucible.expected_vault_balance,
        CrucibleError::VaultBalanceMismatch
    );
    
    if ctoken_supply == 0 {
        // Initial exchange rate is 1:1
        return Ok(1_000_000u64);
    }
    
    // SECURITY FIX: Multiply first, then divide to prevent precision loss
    // Old (wrong): vault_amount / ctoken_supply * 1_000_000
    // New (correct): vault_amount * 1_000_000 / ctoken_supply
    (vault_amount as u128)
        .checked_mul(1_000_000u128)
        .and_then(|scaled| scaled.checked_div(ctoken_supply as u128))
        .and_then(|rate| {
            if rate > u64::MAX as u128 {
                None
            } else {
                Some(rate as u64)
            }
        })
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
    pub crucible: Box<Account<'info, Crucible>>,
    
    pub base_mint: Account<'info, Mint>,
    #[account(mut)]
    pub ctoken_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_token_account: Box<Account<'info, TokenAccount>>,
    
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = ctoken_mint,
        associated_token::authority = user,
    )]
    pub user_ctoken_account: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump = crucible.vault_bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    
    /// CHECK: PDA authority for the crucible
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    
    /// CHECK: Protocol treasury token account for fee collection
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    
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
    pub crucible: Box<Account<'info, Crucible>>,
    
    pub base_mint: Account<'info, Mint>,
    #[account(mut)]
    pub ctoken_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_ctoken_account: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump = crucible.vault_bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    
    #[account(mut)]
    pub user_token_account: Box<Account<'info, TokenAccount>>,
    
    /// CHECK: PDA authority for the crucible
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    
    /// CHECK: Protocol treasury token account for fee collection
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    
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
    pub wrap_fee: u64,
    pub vault_fee_share: u64,
    pub protocol_fee_share: u64,
}

#[event]
pub struct CTokenBurned {
    pub crucible: Pubkey,
    pub user: Pubkey,
    pub ctokens_burned: u64,
    pub base_returned: u64,
    pub exchange_rate: u64,
    pub unwrap_fee: u64,
    pub vault_fee_share: u64,
    pub protocol_fee_share: u64,
}

// Error codes are now defined in state.rs

