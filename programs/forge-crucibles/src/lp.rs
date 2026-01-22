use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

use crate::state::{Crucible, LPPositionAccount, CrucibleError};
use crate::lvf::get_oracle_price;

// Fee and scaling constants
const PRICE_SCALE: u64 = 1_000_000; // Scale for price precision
const SLIPPAGE_TOLERANCE_BPS: u64 = 100; // 1% slippage tolerance (100 basis points)
const OPEN_FEE_BPS: u64 = 100; // 1% open fee (100 basis points)
const CLOSE_FEE_PRINCIPAL_BPS: u64 = 200; // 2% principal fee (200 basis points)
const CLOSE_FEE_YIELD_BPS: u64 = 1_000; // 10% yield fee (1000 basis points)
const VAULT_FEE_SHARE_BPS: u64 = 8_000; // 80% vault share (8000 basis points)
const PROTOCOL_FEE_SHARE_BPS: u64 = 2_000; // 20% protocol share (2000 basis points)

// Amount bounds to prevent dust and overflow attacks
const MIN_LP_BASE_AMOUNT: u64 = 1_000; // Minimum base token amount for LP position
const MIN_LP_USDC_AMOUNT: u64 = 1_000; // Minimum USDC amount for LP position (1 USDC = 1_000_000 lamports)
const MAX_LP_BASE_AMOUNT: u64 = 1_000_000_000_000_000_000; // 1 billion tokens with 9 decimals
const MAX_LP_USDC_AMOUNT: u64 = 1_000_000_000_000_000; // 1 billion USDC with 6 decimals

pub fn open_lp_position(
    ctx: Context<OpenLPPosition>,
    base_amount: u64,
    usdc_amount: u64,
    max_slippage_bps: u64, // Maximum slippage in basis points (e.g., 100 = 1%)
) -> Result<u64> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    require!(
        max_slippage_bps <= 10_000 &&
        base_amount >= MIN_LP_BASE_AMOUNT && base_amount <= MAX_LP_BASE_AMOUNT &&
        usdc_amount >= MIN_LP_USDC_AMOUNT && usdc_amount <= MAX_LP_USDC_AMOUNT,
        CrucibleError::InvalidAmount
    );
    
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;

    // Get base token price from oracle
    // Validate oracle account matches crucible configuration
    if let Some(crucible_oracle) = crucible.oracle {
        require!(
            ctx.accounts.oracle.as_ref().map(|o| o.key()) == Some(crucible_oracle),
            CrucibleError::InvalidOraclePrice
        );
    }
    
    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        &ctx.accounts.base_mint.key(),
    )?;

    // Calculate base value in USDC
    let base_value = (base_amount as u128)
        .checked_mul(base_token_price as u128)
        .and_then(|v| v.checked_div(PRICE_SCALE as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // USDC value is 1:1 (1 USDC = 1 USDC)
    let usdc_value = usdc_amount as u128;

    let tolerance = base_value
        .checked_mul(SLIPPAGE_TOLERANCE_BPS as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let value_diff = if base_value > usdc_value {
        base_value.checked_sub(usdc_value)
    } else {
        usdc_value.checked_sub(base_value)
    }.ok_or(ProgramError::ArithmeticOverflow)?;

    // Calculate slippage in basis points
    let denominator = base_value.max(usdc_value);
    require!(denominator > 0, CrucibleError::InvalidAmount);
    
    let slippage_bps = value_diff
        .checked_mul(10_000)
        .and_then(|v| v.checked_div(denominator))
        .ok_or(CrucibleError::InvalidAmount)?;

    // Validate slippage is within user's tolerance
    require!(
        slippage_bps <= max_slippage_bps as u128,
        CrucibleError::SlippageExceeded
    );

    // Calculate total position value in USDC
    let total_position_value = base_value
        .checked_add(usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let open_fee_usdc = total_position_value
        .checked_mul(OPEN_FEE_BPS as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let vault_fee_share = open_fee_usdc
        .checked_mul(VAULT_FEE_SHARE_BPS as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let protocol_fee_share = open_fee_usdc
        .checked_sub(vault_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate fee split proportionally between base and USDC
    // Fee in base tokens: (open_fee_usdc * base_amount / total_position_value) / base_price
    let fee_base_amount = open_fee_usdc
        .checked_mul(base_amount as u128)
        .and_then(|v| v.checked_div(total_position_value))
        .and_then(|v| v.checked_mul(PRICE_SCALE as u128))
        .and_then(|v| v.checked_div(base_token_price as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let fee_usdc_amount = open_fee_usdc
        .checked_mul(usdc_amount as u128)
        .and_then(|v| v.checked_div(total_position_value))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Split fees 80/20 with validation to ensure they sum correctly
    let vault_fee_base = fee_base_amount
        .checked_mul(80u128)
        .and_then(|v| v.checked_div(100u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let vault_fee_usdc = fee_usdc_amount
        .checked_mul(80u128)
        .and_then(|v| v.checked_div(100u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let protocol_fee_base = fee_base_amount.checked_sub(vault_fee_base)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let protocol_fee_usdc = fee_usdc_amount.checked_sub(vault_fee_usdc)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Validate fee amounts sum correctly (within rounding tolerance)
    let fee_base_value_check = vault_fee_base
        .checked_add(protocol_fee_base)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let fee_usdc_value_check = vault_fee_usdc
        .checked_add(protocol_fee_usdc)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Allow small rounding error (1 basis point tolerance)
    let fee_base_diff = if fee_base_value_check > fee_base_amount {
        fee_base_value_check - fee_base_amount
    } else {
        fee_base_amount - fee_base_value_check
    };
    let fee_usdc_diff = if fee_usdc_value_check > fee_usdc_amount {
        fee_usdc_value_check - fee_usdc_amount
    } else {
        fee_usdc_amount - fee_usdc_value_check
    };
    
    // Validate rounding errors are within tolerance (1 basis point = 0.01%)
    let tolerance_base = fee_base_amount
        .checked_div(10_000)
        .ok_or(CrucibleError::InvalidAmount)?;
    let tolerance_usdc = fee_usdc_amount
        .checked_div(10_000)
        .ok_or(CrucibleError::InvalidAmount)?;
    require!(
        fee_base_diff <= tolerance_base && fee_usdc_diff <= tolerance_usdc,
        CrucibleError::InvalidAmount
    );
    
    // Ensure fees fit in u64
    let vault_fee_base = if vault_fee_base > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        vault_fee_base as u64
    };
    let vault_fee_usdc = if vault_fee_usdc > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        vault_fee_usdc as u64
    };
    let protocol_fee_base = if protocol_fee_base > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        protocol_fee_base as u64
    };
    let protocol_fee_usdc = if protocol_fee_usdc > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        protocol_fee_usdc as u64
    };
    
    // Net amounts after fee
    let net_base_amount = base_amount
        .checked_sub(vault_fee_base + protocol_fee_base)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let net_usdc_amount = usdc_amount
        .checked_sub(vault_fee_usdc + protocol_fee_usdc)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );
    
    // Transfer base token to crucible vault (net amount)
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_base_token_account.to_account_info(),
        to: ctx.accounts.crucible_base_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, net_base_amount)?;
    
    // Transfer vault fee share to vault (increases yield)
    if vault_fee_base > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_base_token_account.to_account_info(),
            to: ctx.accounts.crucible_base_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, vault_fee_base)?;
    }
    
    // Transfer protocol fee share to treasury
    if protocol_fee_base > 0 {
        // Validate treasury account matches crucible.treasury for base token
        require!(
            ctx.accounts.treasury_base.key() == crucible.treasury,
            CrucibleError::InvalidTreasury
        );
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_base_token_account.to_account_info(),
            to: ctx.accounts.treasury_base.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, protocol_fee_base)?;
    }

    // Transfer USDC to crucible vault (net amount)
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_usdc_account.to_account_info(),
        to: ctx.accounts.crucible_usdc_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, net_usdc_amount)?;
    
    // Transfer vault fee share to vault (increases yield)
    if vault_fee_usdc > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc_account.to_account_info(),
            to: ctx.accounts.crucible_usdc_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, vault_fee_usdc)?;
    }
    
    // Transfer protocol fee share to treasury
    if protocol_fee_usdc > 0 {
        // SECURITY FIX: Validate treasury_usdc is a proper TokenAccount for USDC
        // The account constraint already validates mint matches, but we add explicit check here for clarity
        require!(
            ctx.accounts.treasury_usdc.mint == ctx.accounts.user_usdc_account.mint,
            CrucibleError::InvalidTreasury
        );
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc_account.to_account_info(),
            to: ctx.accounts.treasury_usdc.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, protocol_fee_usdc)?;
    }

    // Generate position ID and create PDA account
    let position_id = crucible.total_lp_positions
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Initialize position account
    let position = &mut ctx.accounts.position;
    position.position_id = position_id;
    position.owner = ctx.accounts.user.key();
    position.crucible = crucible.key();
    position.base_mint = ctx.accounts.base_mint.key();
    position.base_amount = net_base_amount;
    position.usdc_amount = net_usdc_amount;
    position.entry_price = base_token_price;
    position.created_at = clock.slot;
    position.is_open = true;
    position.bump = ctx.bumps.position;

    // Update crucible state and track fees
    crucible.total_lp_positions = position_id;
    
    // Track vault fee share in total fees accrued (for base token crucible)
    // Note: USDC fees go to USDC vault, not base token crucible vault
    // For analytics, we could track separately, but for now just track base fees
    if vault_fee_base > 0 {
        crucible.total_fees_accrued = crucible
            .total_fees_accrued
            .checked_add(vault_fee_base)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }
    
    // SECURITY FIX: Emit event for LP position opening
    emit!(LPPositionOpened {
        position_id,
        owner: ctx.accounts.user.key(),
        crucible: ctx.accounts.crucible.key(),
        base_mint: ctx.accounts.base_mint.key(),
        base_amount: net_base_amount,
        usdc_amount: net_usdc_amount,
        entry_price: base_token_price,
        open_fee_base: vault_fee_base + protocol_fee_base,
        open_fee_usdc: vault_fee_usdc + protocol_fee_usdc,
    });

    msg!("LP position opened: {} base + {} USDC (position ID: {}), open fee: {} base + {} USDC", 
         net_base_amount, net_usdc_amount, position_id, 
         vault_fee_base + protocol_fee_base, vault_fee_usdc + protocol_fee_usdc);
    Ok(position_id)
}

pub fn close_lp_position(
    ctx: Context<CloseLPPosition>,
    max_slippage_bps: u64, // Maximum slippage in basis points (e.g., 100 = 1%)
) -> Result<()> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    require!(
        max_slippage_bps <= 10_000,
        CrucibleError::InvalidAmount
    );
    
    let position = &mut ctx.accounts.position;
    let crucible = &mut ctx.accounts.crucible;

    // Validate position exists and is open
    require!(position.is_open, CrucibleError::PositionNotOpen);
    require!(position.owner == ctx.accounts.user.key(), CrucibleError::Unauthorized);
    require!(position.crucible == crucible.key(), CrucibleError::InvalidLPAmounts);

    // SECURITY FIX: Fetch current oracle price and validate slippage
    // Get base_mint before mutable borrow of crucible
    let base_mint_key = crucible.base_mint;
    
    // Get current base token price from oracle
    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let current_base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        &base_mint_key,
    )?;
    
    // Calculate current position value using current oracle price
    let current_base_value = (position.base_amount as u128)
        .checked_mul(current_base_token_price as u128)
        .and_then(|v| v.checked_div(PRICE_SCALE as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let current_usdc_value = position.usdc_amount as u128;
    let current_total_value = current_base_value
        .checked_add(current_usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate entry position value using entry price
    let entry_base_value = (position.base_amount as u128)
        .checked_mul(position.entry_price as u128)
        .and_then(|v| v.checked_div(PRICE_SCALE as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let entry_usdc_value = position.usdc_amount as u128;
    let entry_total_value = entry_base_value
        .checked_add(entry_usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate slippage in basis points
    let value_diff = if current_total_value > entry_total_value {
        current_total_value.checked_sub(entry_total_value)
    } else {
        entry_total_value.checked_sub(current_total_value)
    }.ok_or(ProgramError::ArithmeticOverflow)?;
    
    require!(entry_total_value > 0, CrucibleError::InvalidAmount);
    
    let slippage_bps = value_diff
        .checked_mul(10_000)
        .and_then(|v| v.checked_div(entry_total_value))
        .ok_or(CrucibleError::InvalidAmount)?;
    
    require!(
        slippage_bps <= max_slippage_bps as u128,
        CrucibleError::SlippageExceeded
    );
    
    // Use current price for calculations
    let base_token_price = current_base_token_price;
    let current_base_value = (position.base_amount as u128)
        .checked_mul(base_token_price as u128)
        .and_then(|v| v.checked_div(PRICE_SCALE as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let current_usdc_value = position.usdc_amount as u128;
    let current_total_value = current_base_value
        .checked_add(current_usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate initial position value
    let initial_base_value = (position.base_amount as u128)
        .checked_mul(base_token_price as u128)
        .and_then(|v| v.checked_div(PRICE_SCALE as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let initial_usdc_value = position.usdc_amount as u128;
    let initial_total_value = initial_base_value
        .checked_add(initial_usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate yield (can be negative if loss)
    let yield_value = if current_total_value > initial_total_value {
        current_total_value.checked_sub(initial_total_value)
    } else {
        Some(0u128) // No yield if loss
    }.ok_or(ProgramError::ArithmeticOverflow)?;
    
    let principal_fee_value = initial_total_value
        .checked_mul(CLOSE_FEE_PRINCIPAL_BPS as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate yield fee: 10% of yield earned
    let yield_fee_value = yield_value
        .checked_mul(CLOSE_FEE_YIELD_BPS as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let total_fee_value = principal_fee_value
        .checked_add(yield_fee_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let vault_fee_share_value = total_fee_value
        .checked_mul(VAULT_FEE_SHARE_BPS as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let protocol_fee_share_value = total_fee_value
        .checked_sub(vault_fee_share_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate fee split proportionally between base and USDC based on current values
    let fee_base_value = total_fee_value
        .checked_mul(current_base_value)
        .and_then(|v| v.checked_div(current_total_value.max(1)))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let fee_usdc_value = total_fee_value
        .checked_mul(current_usdc_value)
        .and_then(|v| v.checked_div(current_total_value.max(1)))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Convert fee values to token amounts
    let fee_base_amount = fee_base_value
        .checked_mul(PRICE_SCALE as u128)
        .and_then(|v| v.checked_div(base_token_price as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let fee_usdc_amount = fee_usdc_value; // USDC is 1:1
    
    // Split fees 80/20
    let vault_fee_base = fee_base_amount
        .checked_mul(80u128)
        .and_then(|v| v.checked_div(100u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let vault_fee_usdc = fee_usdc_amount
        .checked_mul(80u128)
        .and_then(|v| v.checked_div(100u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let protocol_fee_base = fee_base_amount - vault_fee_base;
    let protocol_fee_usdc = fee_usdc_amount - vault_fee_usdc;
    
    // Ensure fees fit in u64
    let vault_fee_base = if vault_fee_base > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        vault_fee_base as u64
    };
    let vault_fee_usdc = if vault_fee_usdc > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        vault_fee_usdc as u64
    };
    let protocol_fee_base = if protocol_fee_base > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        protocol_fee_base as u64
    };
    let protocol_fee_usdc = if protocol_fee_usdc > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        protocol_fee_usdc as u64
    };
    
    // Calculate net amounts to return
    // SECURITY FIX: Use explicit error handling instead of unwrap_or(0)
    // Ensure fees don't exceed position amounts
    let fee_base_amount_u64 = fee_base_amount.min(position.base_amount as u128) as u64;
    let fee_usdc_amount_u64 = fee_usdc_amount.min(position.usdc_amount as u128) as u64;
    
    let base_to_return = position.base_amount
        .checked_sub(fee_base_amount_u64)
        .ok_or(CrucibleError::InvalidAmount)?;
    let usdc_to_return = position.usdc_amount
        .checked_sub(fee_usdc_amount_u64)
        .ok_or(CrucibleError::InvalidAmount)?;

    // Transfer base tokens back to user (net amount)
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible.bump],
    ];
    let signer = &[&seeds[..]];

    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.crucible_base_vault.to_account_info(),
        to: ctx.accounts.user_base_token_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, base_to_return)?;

    // Transfer vault fee share to vault (increases yield for remaining LP positions)
    if vault_fee_base > 0 {
        // Fee already in vault from initial position, just track it
    }
    if vault_fee_usdc > 0 {
        // Fee already in vault from initial position, just track it
    }
    
    // Transfer protocol fee share to treasury
    if protocol_fee_base > 0 && protocol_fee_base <= position.base_amount {
        // Validate treasury account matches crucible.treasury for base token
        require!(
            ctx.accounts.treasury_base.key() == crucible.treasury,
            CrucibleError::InvalidTreasury
        );
        
        // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
        require!(
            ctx.accounts.token_program.key() == anchor_spl::token::ID,
            CrucibleError::InvalidProgram
        );
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.crucible_base_vault.to_account_info(),
            to: ctx.accounts.treasury_base.to_account_info(),
            authority: ctx.accounts.crucible_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, protocol_fee_base)?;
    }
    
    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );
    
    // Transfer USDC back to user (net amount)
    let cpi_accounts = Transfer {
        from: ctx.accounts.crucible_usdc_vault.to_account_info(),
        to: ctx.accounts.user_usdc_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, usdc_to_return)?;
    
    // Transfer protocol fee share to treasury (USDC)
    if protocol_fee_usdc > 0 && protocol_fee_usdc <= position.usdc_amount {
        // SECURITY FIX: Validate treasury_usdc is a proper TokenAccount for USDC
        // The account constraint already validates mint matches, but we add explicit check here for clarity
        require!(
            ctx.accounts.treasury_usdc.mint == ctx.accounts.user_usdc_account.mint,
            CrucibleError::InvalidTreasury
        );
        
        // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
        require!(
            ctx.accounts.token_program.key() == anchor_spl::token::ID,
            CrucibleError::InvalidProgram
        );
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.crucible_usdc_vault.to_account_info(),
            to: ctx.accounts.treasury_usdc.to_account_info(),
            authority: ctx.accounts.crucible_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, protocol_fee_usdc)?;
    }
    
    // Track vault fee share in total fees accrued (for base token crucible)
    if vault_fee_base > 0 {
        crucible.total_fees_accrued = crucible
            .total_fees_accrued
            .checked_add(vault_fee_base)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    // Mark position as closed
    position.is_open = false;

    // SECURITY FIX: Don't decrement total_lp_positions counter
    // This prevents position ID collisions. Positions are stored in PDA accounts
    // with unique addresses, so we don't need to reuse IDs. The counter only
    // tracks the next available ID and should never decrease.
    // crucible.total_lp_positions remains unchanged

    // SECURITY FIX: Emit event for LP position closure
    emit!(LPPositionClosed {
        position_id: position.position_id,
        owner: position.owner,
        crucible: position.crucible,
        base_amount_returned: base_to_return,
        usdc_amount_returned: usdc_to_return,
        total_fee: total_fee_value as u64,
    });

    msg!("LP position closed: {}", position.position_id);
    Ok(())
}

#[derive(Accounts)]
pub struct OpenLPPosition<'info> {
    #[account(mut)]
    pub crucible: Box<Account<'info, Crucible>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub base_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_base_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user_usdc_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub crucible_base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub crucible_usdc_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = user,
        space = 8 + LPPositionAccount::LEN,
        seeds = [b"lp_position", user.key().as_ref(), crucible.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, LPPositionAccount>>,
    /// CHECK: Crucible authority PDA
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    /// CHECK: Optional oracle account for price feeds
    /// If provided, must match crucible.oracle
    pub oracle: Option<UncheckedAccount<'info>>,
    /// Treasury account for base mint
    #[account(
        mut,
        constraint = treasury_base.mint == base_mint.key() @ CrucibleError::InvalidTreasury
    )]
    pub treasury_base: Account<'info, TokenAccount>,
    /// Treasury account for USDC
    #[account(
        mut,
        constraint = treasury_usdc.mint == user_usdc_account.mint @ CrucibleError::InvalidTreasury
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseLPPosition<'info> {
    #[account(mut)]
    pub crucible: Box<Account<'info, Crucible>>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"lp_position", user.key().as_ref(), crucible.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == user.key() @ CrucibleError::Unauthorized,
    )]
    pub position: Box<Account<'info, LPPositionAccount>>,
    #[account(mut)]
    pub user_base_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user_usdc_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub crucible_base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub crucible_usdc_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: Crucible authority PDA
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    /// CHECK: Optional oracle account for price feeds (required for slippage protection)
    /// If provided, must match crucible.oracle
    pub oracle: Option<UncheckedAccount<'info>>,
    /// SECURITY FIX: Validate treasury_base is a TokenAccount for base_mint
    #[account(
        mut,
        constraint = treasury_base.mint == crucible.base_mint @ CrucibleError::InvalidTreasury
    )]
    pub treasury_base: Account<'info, TokenAccount>,
    /// SECURITY FIX: Validate treasury_usdc is a TokenAccount for USDC
    #[account(
        mut,
        constraint = treasury_usdc.mint == user_usdc_account.mint @ CrucibleError::InvalidTreasury
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// SECURITY FIX: Event emissions for LP position state changes
#[event]
pub struct LPPositionOpened {
    pub position_id: u64,
    pub owner: Pubkey,
    pub crucible: Pubkey,
    pub base_mint: Pubkey,
    pub base_amount: u64,
    pub usdc_amount: u64,
    pub entry_price: u64,
    pub open_fee_base: u64,
    pub open_fee_usdc: u64,
}

#[event]
pub struct LPPositionClosed {
    pub position_id: u64,
    pub owner: Pubkey,
    pub crucible: Pubkey,
    pub base_amount_returned: u64,
    pub usdc_amount_returned: u64,
    pub total_fee: u64,
}

