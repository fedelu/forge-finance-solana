use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Burn};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::{Crucible, CrucibleError};

// SECURITY FIX: Extract magic numbers to named constants
const PRICE_SCALE_FACTOR: u64 = 1_000_000; // Scale for price/exchange rate precision (1.0 = 1_000_000)
const WRAP_FEE_BPS: u64 = 50; // 0.5% wrap fee (50 basis points)
const UNWRAP_FEE_BPS: u64 = 50; // 0.5% unwrap fee (50 basis points)
const VAULT_FEE_SHARE_BPS: u64 = 8_000; // 80% vault share (8000 basis points)
const PROTOCOL_FEE_SHARE_BPS: u64 = 2_000; // 20% protocol share (2000 basis points)
const ARBITRAGE_VAULT_SHARE_BPS: u64 = 8_000; // 80% vault share for arbitrage (8000 basis points)
const ARBITRAGE_TREASURY_SHARE_BPS: u64 = 2_000; // 20% treasury share for arbitrage (2000 basis points)
const ARBITRAGE_REWARD_BPS: u64 = 100; // 1% arbitrageur reward (100 basis points)

// SECURITY FIX: Minimum amounts to prevent dust attacks
const MIN_DEPOSIT_AMOUNT: u64 = 1_000; // Minimum 1000 lamports (0.000001 SOL or equivalent)
const MIN_CTOKEN_AMOUNT: u64 = 1_000; // Minimum cToken amount to mint/burn

// SECURITY FIX: Maximum amounts to prevent overflow attacks
// Maximum deposit: 1 billion tokens (1_000_000_000 * 10^9 lamports for 9 decimals)
const MAX_DEPOSIT_AMOUNT: u64 = 1_000_000_000_000_000_000; // 1 billion tokens with 9 decimals
const MAX_CTOKEN_AMOUNT: u64 = 1_000_000_000_000_000_000; // Maximum cToken amount to mint/burn

/// Mint cToken when user deposits base token
pub fn mint_ctoken(ctx: Context<MintCToken>, amount: u64) -> Result<()> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    // SECURITY FIX: Require minimum deposit amount to prevent dust attacks
    require!(
        amount >= MIN_DEPOSIT_AMOUNT,
        CrucibleError::InvalidAmount
    );
    
    // SECURITY FIX: Require maximum deposit amount to prevent overflow attacks
    require!(
        amount <= MAX_DEPOSIT_AMOUNT,
        CrucibleError::InvalidAmount
    );
    
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;
    
    // Calculate exchange rate (1 cToken = base_amount / total_ctoken_supply)
    // Exchange rate grows as fees accrue
    // SECURITY FIX: Use tracked deposits instead of vault balance to prevent manipulation
    let exchange_rate = calculate_exchange_rate(
        &crucible,
        ctx.accounts.vault.amount, // Still pass for validation
        ctx.accounts.ctoken_mint.supply,
    )?;
    
    // SECURITY FIX: Calculate wrap fee using named constant
    let wrap_fee = amount
        .checked_mul(WRAP_FEE_BPS)
        .and_then(|v| v.checked_div(10_000u64))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // SECURITY FIX: Split fee using named constants
    let vault_fee_share = wrap_fee
        .checked_mul(VAULT_FEE_SHARE_BPS)
        .and_then(|v| v.checked_div(10_000u64))
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
    
    // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );
    
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
    
    // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );
    
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
        .and_then(|scaled| scaled.checked_div(PRICE_SCALE_FACTOR))
        .ok_or(ProgramError::InvalidArgument)?;
    
    require!(
        base_to_return_before_fee <= ctx.accounts.vault.amount,
        CrucibleError::InsufficientLiquidity
    );
    
    // SECURITY FIX: Calculate unwrap fee using named constant (0.75% = 75 bps)
    const UNWRAP_FEE_BPS_SPECIAL: u64 = 75; // 0.75% unwrap fee (TODO: reduce to 0.3% after 5-day cooldown)
    let unwrap_fee = base_to_return_before_fee
        .checked_mul(UNWRAP_FEE_BPS_SPECIAL)
        .and_then(|v| v.checked_div(10_000u64))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // SECURITY FIX: Split fee using named constants
    let vault_fee_share = unwrap_fee
        .checked_mul(VAULT_FEE_SHARE_BPS)
        .and_then(|v| v.checked_div(10_000u64))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let protocol_fee_share = unwrap_fee
        .checked_sub(vault_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Net amount to return to user (after fee)
    let base_to_return = base_to_return_before_fee
        .checked_sub(unwrap_fee)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
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
    
    // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );
    
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
        
        // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
        require!(
            ctx.accounts.token_program.key() == anchor_spl::token::ID,
            CrucibleError::InvalidProgram
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
    
    // SECURITY FIX: Calculate principal portion being withdrawn (excluding yield)
    // Exchange rate = (total_base_deposited + total_fees_accrued) / ctoken_supply
    // Principal portion = (ctokens_burned * total_base_deposited) / (total_base_deposited + total_fees_accrued)
    // This ensures we only subtract the principal, not the yield portion
    let tracked_balance = (crucible.total_base_deposited as u128)
        .checked_add(crucible.total_fees_accrued as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // SECURITY FIX: Validate tracked_balance > 0 before division
    require!(tracked_balance > 0, CrucibleError::InvalidAmount);
    
    let principal_portion = (base_to_return_before_fee as u128)
        .checked_mul(crucible.total_base_deposited as u128)
        .and_then(|v| v.checked_div(tracked_balance))
        .ok_or(CrucibleError::InvalidAmount)?;
    
    let principal_portion_u64 = if principal_portion > u64::MAX as u128 {
        crucible.total_base_deposited // Cap at total deposits if calculation overflows
    } else {
        principal_portion as u64
    };
    
    // SECURITY FIX: Validate amounts are sufficient before subtraction to detect accounting errors
    require!(
        crucible.total_base_deposited >= principal_portion_u64,
        CrucibleError::InvalidAmount
    );
    require!(
        crucible.expected_vault_balance >= total_deducted,
        CrucibleError::InvalidAmount
    );
    
    crucible.total_base_deposited = crucible
        .total_base_deposited
        .checked_sub(principal_portion_u64)
        .ok_or(CrucibleError::InvalidAmount)?;
    
    // Deduct total returned + protocol fee, but vault fee share stays (already accounted for in vault balance)
    // SECURITY FIX: Use checked_sub to detect underflow errors instead of silently preventing them
    crucible.expected_vault_balance = crucible
        .expected_vault_balance
        .checked_sub(total_deducted)
        .ok_or(CrucibleError::InvalidAmount)?;
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

/// Deposit arbitrage profits directly to crucible vault
/// This allows arbitrageurs to route profits to cToken holders, increasing yield
/// 80% of deposit goes to vault (increases yield), 20% goes to treasury (protocol revenue)
/// Optionally rewards arbitrageur with 1% of deposit as cTokens as incentive
pub fn deposit_arbitrage_profit(
    ctx: Context<DepositArbitrageProfit>,
    amount: u64,
) -> Result<()> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;
    
    // SECURITY FIX: Explicit zero amount validation
    require!(amount > 0, CrucibleError::InvalidAmount);
    
    // SECURITY FIX: Require maximum amount to prevent overflow attacks
    require!(
        amount <= MAX_DEPOSIT_AMOUNT,
        CrucibleError::InvalidAmount
    );
    
    // Calculate current exchange rate
    let exchange_rate = calculate_exchange_rate(
        &crucible,
        ctx.accounts.vault.amount,
        ctx.accounts.ctoken_mint.supply,
    )?;
    
    // SECURITY FIX: Split deposit using named constants
    let vault_share = amount
        .checked_mul(ARBITRAGE_VAULT_SHARE_BPS)
        .and_then(|v| v.checked_div(10_000u64))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let treasury_share = amount
        .checked_sub(vault_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Transfer vault share to vault (increases yield for cToken holders)
    if vault_share > 0 {
        // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
        require!(
            ctx.accounts.token_program.key() == anchor_spl::token::ID,
            CrucibleError::InvalidProgram
        );
        
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.arbitrageur_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.arbitrageur.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, vault_share)?;
    }
    
    // Transfer treasury share to treasury (protocol revenue)
    if treasury_share > 0 {
        // Validate treasury account matches crucible.treasury
        require!(
            ctx.accounts.treasury.key() == crucible.treasury,
            CrucibleError::InvalidTreasury
        );
        
        // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
        require!(
            ctx.accounts.token_program.key() == anchor_spl::token::ID,
            CrucibleError::InvalidProgram
        );
        
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.arbitrageur_token_account.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.arbitrageur.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, treasury_share)?;
    }
    
    // SECURITY FIX: Calculate reward for arbitrageur using named constant
    // This incentivizes arbitrageurs to route profits back to the protocol
    let reward_amount = amount
        .checked_mul(ARBITRAGE_REWARD_BPS)
        .and_then(|v| v.checked_div(10_000u64))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Mint reward cTokens to arbitrageur (1% incentive)
    // SECURITY FIX: Return error if calculation fails instead of silently defaulting to 0
    let reward_ctokens = if reward_amount > 0 && ctx.accounts.ctoken_mint.supply > 0 {
        // SECURITY FIX: Validate exchange_rate > 0 before division
        require!(exchange_rate > 0, CrucibleError::InvalidAmount);
        reward_amount
            .checked_mul(PRICE_SCALE_FACTOR)
            .and_then(|scaled| scaled.checked_div(exchange_rate))
            .ok_or(CrucibleError::InvalidAmount)?
    } else {
        0
    };
    
    if reward_ctokens > 0 {
        let seeds = &[
            b"crucible",
            crucible.base_mint.as_ref(),
            &[crucible.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = MintTo {
            mint: ctx.accounts.ctoken_mint.to_account_info(),
            to: ctx.accounts.arbitrageur_ctoken_account.to_account_info(),
            authority: ctx.accounts.crucible_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::mint_to(cpi_ctx, reward_ctokens)?;
    }
    
    // Update crucible state
    // All arbitrage profit vault share goes to fees accrued (increases exchange rate)
    crucible.total_fees_accrued = crucible
        .total_fees_accrued
        .checked_add(vault_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Update expected vault balance (includes arbitrage deposit vault share)
    crucible.expected_vault_balance = crucible
        .expected_vault_balance
        .checked_add(vault_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    crucible.last_update_slot = clock.slot;
    
    emit!(ArbitrageProfitDeposited {
        crucible: crucible.key(),
        arbitrageur: ctx.accounts.arbitrageur.key(),
        amount,
        vault_share,
        treasury_share,
        reward_ctokens,
        exchange_rate,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Calculate exchange rate: (total_base_deposited + total_fees_accrued) / ctoken_supply (scaled by 1M for precision)
/// Validates vault balance is at least expected amount (allows fee accrual growth)
/// SECURITY FIX: Use tracked deposits instead of vault_amount to prevent manipulation via direct vault donations
/// SECURITY FIX: Multiply first, then divide to prevent precision loss
/// Fee accrual allows vault_amount >= expected_vault_balance (fees increase yield)
fn calculate_exchange_rate(
    crucible: &Crucible,
    vault_amount: u64, // Used for validation only, not for rate calculation
    ctoken_supply: u64,
) -> Result<u64> {
    // Allow vault_amount >= expected_vault_balance (fees accrue and increase yield)
    // But prevent vault_amount < expected_vault_balance (which would indicate manipulation)
    require!(
        vault_amount >= crucible.expected_vault_balance,
        CrucibleError::VaultBalanceMismatch
    );
    
    // SECURITY FIX (CRITICAL-003): Add maximum deviation check to prevent extreme manipulation
    // Allow some deviation for fee accrual, but prevent extreme manipulation via direct transfers
    const MAX_VAULT_DEVIATION_BPS: u64 = 10_000; // 100% max deviation (allows doubling via fees)
    if vault_amount > crucible.expected_vault_balance {
        let deviation = vault_amount
            .checked_sub(crucible.expected_vault_balance)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        if crucible.expected_vault_balance > 0 {
            let deviation_bps = (deviation as u128)
                .checked_mul(10_000)
                .and_then(|v| v.checked_div(crucible.expected_vault_balance as u128))
                .ok_or(ProgramError::ArithmeticOverflow)?;
            require!(
                deviation_bps <= MAX_VAULT_DEVIATION_BPS as u128,
                CrucibleError::VaultBalanceMismatch
            );
        }
    }
    
    if ctoken_supply == 0 {
        // SECURITY FIX: Initial exchange rate is 1:1 using named constant
        return Ok(PRICE_SCALE_FACTOR);
    }
    
    // SECURITY FIX: Use tracked deposits + fees instead of vault_amount
    // This prevents manipulation through direct token transfers to the vault
    // Exchange rate = (total_base_deposited + total_fees_accrued) * 1_000_000 / ctoken_supply
    let tracked_balance = (crucible.total_base_deposited as u128)
        .checked_add(crucible.total_fees_accrued as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // SECURITY FIX: Multiply first, then divide to prevent precision loss
    (tracked_balance)
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
    
    /// SECURITY FIX: Validate treasury is a TokenAccount for the correct mint
    #[account(
        mut,
        constraint = treasury.mint == base_mint.key() @ CrucibleError::InvalidTreasury
    )]
    pub treasury: Account<'info, TokenAccount>,
    
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
    
    /// SECURITY FIX: Validate treasury is a TokenAccount for the correct mint
    #[account(
        mut,
        constraint = treasury.mint == base_mint.key() @ CrucibleError::InvalidTreasury
    )]
    pub treasury: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositArbitrageProfit<'info> {
    #[account(mut)]
    pub arbitrageur: Signer<'info>,
    
    #[account(
        mut,
        has_one = base_mint @ CrucibleError::InvalidBaseMint,
    )]
    pub crucible: Box<Account<'info, Crucible>>,
    
    pub base_mint: Account<'info, Mint>,
    #[account(mut)]
    pub ctoken_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub arbitrageur_token_account: Box<Account<'info, TokenAccount>>,
    
    #[account(
        init_if_needed,
        payer = arbitrageur,
        associated_token::mint = ctoken_mint,
        associated_token::authority = arbitrageur,
    )]
    pub arbitrageur_ctoken_account: Box<Account<'info, TokenAccount>>,
    
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
    
    /// SECURITY FIX: Validate treasury is a TokenAccount for the correct mint
    #[account(
        mut,
        constraint = treasury.mint == base_mint.key() @ CrucibleError::InvalidTreasury
    )]
    pub treasury: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
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

#[event]
pub struct ArbitrageProfitDeposited {
    pub crucible: Pubkey,
    pub arbitrageur: Pubkey,
    pub amount: u64,
    pub vault_share: u64,
    pub treasury_share: u64,
    pub reward_ctokens: u64,
    pub exchange_rate: u64,
    pub timestamp: i64,
}

// Error codes are now defined in state.rs

