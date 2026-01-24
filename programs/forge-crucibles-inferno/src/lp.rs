use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer, MintTo, Burn};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use lending_pool_usdc::cpi::accounts::RepayUSDC;
use lending_pool_usdc::program::LendingPoolUsdc;

use crate::state::{InfernoCrucible, InfernoLPPositionAccount, InfernoCrucibleError};

const PRICE_SCALE: u64 = 1_000_000;
const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
const SLIPPAGE_TOLERANCE_BPS: u64 = 100;
const OPEN_FEE_BPS: u64 = 100;
const CLOSE_FEE_PRINCIPAL_BPS: u64 = 200;
const CLOSE_FEE_YIELD_BPS: u64 = 1_000;
const VAULT_FEE_SHARE_BPS: u64 = 8_000;
const PROTOCOL_FEE_SHARE_BPS: u64 = 2_000;

const MIN_LP_BASE_AMOUNT: u64 = 1_000;
const MIN_LP_USDC_AMOUNT: u64 = 1_000;
const MAX_LP_BASE_AMOUNT: u64 = 1_000_000_000_000_000_000;
const MAX_LP_USDC_AMOUNT: u64 = 1_000_000_000_000_000;

const MAX_LEVERAGE_BPS: u64 = 200;
const MIN_LEVERAGE_BPS: u64 = 100;
const MAX_CONFIDENCE_BPS: u64 = 500;
const MAX_STALENESS_SECONDS: u64 = 300;
const LIQUIDATION_THRESHOLD_BPS: u64 = 9_000;

pub fn open_inferno_lp_position(
    ctx: Context<OpenInfernoLPPosition>,
    base_amount: u64,
    usdc_amount: u64,
    borrowed_usdc: u64,
    leverage_factor: u64,
    max_slippage_bps: u64,
) -> Result<u64> {
    let crucible_key = ctx.accounts.crucible.key();
    let crucible = &mut ctx.accounts.crucible;
    require!(!crucible.paused, InfernoCrucibleError::ProtocolPaused);

    require!(
        max_slippage_bps <= 10_000 &&
        base_amount >= MIN_LP_BASE_AMOUNT && base_amount <= MAX_LP_BASE_AMOUNT &&
        usdc_amount >= MIN_LP_USDC_AMOUNT && usdc_amount <= MAX_LP_USDC_AMOUNT,
        InfernoCrucibleError::InvalidAmount
    );

    require!(
        leverage_factor <= MAX_LEVERAGE_BPS && leverage_factor >= MIN_LEVERAGE_BPS,
        InfernoCrucibleError::InvalidLeverage
    );

    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        &ctx.accounts.base_mint.key(),
    )?;

    let base_value = (base_amount as u128)
        .checked_mul(base_token_price as u128)
        .and_then(|v| v.checked_div(LAMPORTS_PER_SOL as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let usdc_value = usdc_amount as u128;

    let value_diff = if base_value > usdc_value {
        base_value.checked_sub(usdc_value)
    } else {
        usdc_value.checked_sub(base_value)
    }.ok_or(ProgramError::ArithmeticOverflow)?;

    let denominator = base_value.max(usdc_value);
    require!(denominator > 0, InfernoCrucibleError::InvalidAmount);
    let slippage_bps = value_diff
        .checked_mul(10_000)
        .and_then(|v| v.checked_div(denominator))
        .ok_or(InfernoCrucibleError::InvalidAmount)?;
    require!(
        slippage_bps <= max_slippage_bps as u128,
        InfernoCrucibleError::SlippageExceeded
    );

    // Calculate borrowed USDC based on user equity (total value minus borrowed)
    let total_position_value = base_value
        .checked_add(usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    require!(
        borrowed_usdc as u128 <= total_position_value,
        InfernoCrucibleError::InvalidLeverage
    );
    let user_equity_value = total_position_value
        .checked_sub(borrowed_usdc as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let leverage_excess = (leverage_factor as u128)
        .checked_sub(100)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let expected_borrowed_usdc = user_equity_value
        .checked_mul(leverage_excess)
        .and_then(|v| v.checked_div(100))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if expected_borrowed_usdc > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    }
    let expected_borrowed_usdc = expected_borrowed_usdc as u64;
    require!(
        borrowed_usdc == expected_borrowed_usdc,
        InfernoCrucibleError::InvalidLeverage
    );

    // Fees
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
    let _protocol_fee_share = open_fee_usdc
        .checked_sub(vault_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;

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

    let vault_fee_base = vault_fee_base as u64;
    let vault_fee_usdc = vault_fee_usdc as u64;
    let protocol_fee_base = protocol_fee_base as u64;
    let protocol_fee_usdc = protocol_fee_usdc as u64;

    let net_base_amount = base_amount
        .checked_sub(vault_fee_base + protocol_fee_base)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let net_usdc_amount = usdc_amount
        .checked_sub(vault_fee_usdc + protocol_fee_usdc)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        InfernoCrucibleError::InvalidProgram
    );

    // Transfers to vaults + treasury
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program.clone(), Transfer {
        from: ctx.accounts.user_base_token_account.to_account_info(),
        to: ctx.accounts.crucible_base_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    });
    token::transfer(cpi_ctx, net_base_amount)?;

    if vault_fee_base > 0 {
        let cpi_ctx = CpiContext::new(cpi_program.clone(), Transfer {
            from: ctx.accounts.user_base_token_account.to_account_info(),
            to: ctx.accounts.crucible_base_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        });
        token::transfer(cpi_ctx, vault_fee_base)?;
    }
    if protocol_fee_base > 0 {
        require!(
            ctx.accounts.treasury_base.key() == crucible.treasury_base,
            InfernoCrucibleError::InvalidTreasury
        );
        let cpi_ctx = CpiContext::new(cpi_program.clone(), Transfer {
            from: ctx.accounts.user_base_token_account.to_account_info(),
            to: ctx.accounts.treasury_base.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        });
        token::transfer(cpi_ctx, protocol_fee_base)?;
    }

    let cpi_ctx = CpiContext::new(cpi_program.clone(), Transfer {
        from: ctx.accounts.user_usdc_account.to_account_info(),
        to: ctx.accounts.crucible_usdc_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    });
    token::transfer(cpi_ctx, net_usdc_amount)?;

    if vault_fee_usdc > 0 {
        let cpi_ctx = CpiContext::new(cpi_program.clone(), Transfer {
            from: ctx.accounts.user_usdc_account.to_account_info(),
            to: ctx.accounts.crucible_usdc_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        });
        token::transfer(cpi_ctx, vault_fee_usdc)?;
    }
    if protocol_fee_usdc > 0 {
        require!(
            ctx.accounts.treasury_usdc.mint == ctx.accounts.user_usdc_account.mint,
            InfernoCrucibleError::InvalidTreasury
        );
        let cpi_ctx = CpiContext::new(cpi_program.clone(), Transfer {
            from: ctx.accounts.user_usdc_account.to_account_info(),
            to: ctx.accounts.treasury_usdc.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        });
        token::transfer(cpi_ctx, protocol_fee_usdc)?;
    }

    // Mint LP tokens based on limiting side:
    // 1 LP = 1 SOL + (SOL price in USDC * exchange rate)
    let exchange_rate = if crucible.exchange_rate == 0 {
        PRICE_SCALE
    } else {
        crucible.exchange_rate
    };
    let adjusted_price = (base_token_price as u128)
        .checked_mul(exchange_rate as u128)
        .and_then(|v| v.checked_div(PRICE_SCALE as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    require!(adjusted_price > 0, InfernoCrucibleError::InvalidAmount);

    let max_lp_by_usdc = (net_usdc_amount as u128)
        .checked_mul(LAMPORTS_PER_SOL as u128)
        .and_then(|v| v.checked_div(adjusted_price))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let lp_tokens_to_mint_u128 = (net_base_amount as u128).min(max_lp_by_usdc);
    let lp_tokens_to_mint = if lp_tokens_to_mint_u128 > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        lp_tokens_to_mint_u128 as u64
    };

    let crucible_bump = ctx.bumps.crucible;
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible_bump],
    ];
    let signer = &[&seeds[..]];
    let mint_to_accounts = MintTo {
        mint: ctx.accounts.lp_token_mint.to_account_info(),
        to: ctx.accounts.user_lp_token_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let mint_to_program = ctx.accounts.token_program.to_account_info();
    let mint_to_ctx = CpiContext::new_with_signer(mint_to_program, mint_to_accounts, signer);
    token::mint_to(mint_to_ctx, lp_tokens_to_mint)?;

    // Initialize position
    let position_id = crucible.total_lp_positions
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let position = &mut ctx.accounts.position;
    position.position_id = position_id;
    position.owner = ctx.accounts.user.key();
    position.crucible = crucible_key;
    position.base_mint = ctx.accounts.base_mint.key();
    position.base_amount = net_base_amount;
    position.usdc_amount = net_usdc_amount;
    position.borrowed_usdc = borrowed_usdc;
    position.leverage_factor = leverage_factor;
    position.entry_price = base_token_price;
    position.created_at = Clock::get()?.slot;
    position.is_open = true;
    position.bump = ctx.bumps.position;

    crucible.total_lp_positions = position_id;
    crucible.expected_vault_balance = crucible.expected_vault_balance
        .checked_add(net_base_amount)
        .and_then(|v| v.checked_add(vault_fee_base))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    crucible.expected_usdc_vault_balance = crucible.expected_usdc_vault_balance
        .checked_add(net_usdc_amount)
        .and_then(|v| v.checked_add(vault_fee_usdc))
        .ok_or(ProgramError::ArithmeticOverflow)?;

    crucible.total_lp_token_supply = crucible.total_lp_token_supply
        .checked_add(lp_tokens_to_mint)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if vault_fee_base > 0 {
        crucible.total_fees_accrued = crucible.total_fees_accrued
            .checked_add(vault_fee_base)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    update_lp_exchange_rate(crucible, base_token_price)?;
    crucible.last_update_slot = Clock::get()?.slot;

    emit!(InfernoLPPositionOpened {
        position_id,
        owner: ctx.accounts.user.key(),
        crucible: ctx.accounts.crucible.key(),
        base_mint: ctx.accounts.base_mint.key(),
        base_amount: net_base_amount,
        usdc_amount: net_usdc_amount,
        borrowed_usdc,
        leverage_factor,
        entry_price: base_token_price,
    });

    Ok(position_id)
}

pub fn close_inferno_lp_position(
    ctx: Context<CloseInfernoLPPosition>,
    max_slippage_bps: u64,
) -> Result<()> {
    require!(max_slippage_bps <= 10_000, InfernoCrucibleError::InvalidAmount);

    let crucible_key = ctx.accounts.crucible.key();
    let crucible = &mut ctx.accounts.crucible;
    require!(!crucible.paused, InfernoCrucibleError::ProtocolPaused);
    let position = &mut ctx.accounts.position;

    require!(position.is_open, InfernoCrucibleError::PositionNotOpen);
    require!(position.owner == ctx.accounts.user.key(), InfernoCrucibleError::Unauthorized);
    require!(position.crucible == crucible_key, InfernoCrucibleError::InvalidLPAmounts);

    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let current_base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        &ctx.accounts.base_mint.key(),
    )?;

    let current_base_value = (position.base_amount as u128)
        .checked_mul(current_base_token_price as u128)
        .and_then(|v| v.checked_div(LAMPORTS_PER_SOL as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let current_usdc_value = position.usdc_amount as u128;
    let current_total_value = current_base_value
        .checked_add(current_usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let entry_base_value = (position.base_amount as u128)
        .checked_mul(position.entry_price as u128)
        .and_then(|v| v.checked_div(LAMPORTS_PER_SOL as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let entry_usdc_value = position.usdc_amount as u128;
    let entry_total_value = entry_base_value
        .checked_add(entry_usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let value_diff = if current_total_value > entry_total_value {
        current_total_value.checked_sub(entry_total_value)
    } else {
        entry_total_value.checked_sub(current_total_value)
    }.ok_or(ProgramError::ArithmeticOverflow)?;

    require!(entry_total_value > 0, InfernoCrucibleError::InvalidAmount);
    let slippage_bps = value_diff
        .checked_mul(10_000)
        .and_then(|v| v.checked_div(entry_total_value))
        .ok_or(InfernoCrucibleError::InvalidAmount)?;
    require!(
        slippage_bps <= max_slippage_bps as u128,
        InfernoCrucibleError::SlippageExceeded
    );

    let yield_value = if current_total_value > entry_total_value {
        current_total_value.checked_sub(entry_total_value)
    } else {
        Some(0u128)
    }.ok_or(ProgramError::ArithmeticOverflow)?;

    let principal_fee_value = entry_total_value
        .checked_mul(CLOSE_FEE_PRINCIPAL_BPS as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let yield_fee_value = yield_value
        .checked_mul(CLOSE_FEE_YIELD_BPS as u128)
        .and_then(|v| v.checked_div(10_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let total_fee_value = principal_fee_value
        .checked_add(yield_fee_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let fee_base_value = total_fee_value
        .checked_mul(current_base_value)
        .and_then(|v| v.checked_div(current_total_value.max(1)))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let fee_usdc_value = total_fee_value
        .checked_mul(current_usdc_value)
        .and_then(|v| v.checked_div(current_total_value.max(1)))
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let fee_base_amount = fee_base_value
        .checked_mul(PRICE_SCALE as u128)
        .and_then(|v| v.checked_div(current_base_token_price as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let fee_usdc_amount = fee_usdc_value;

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

    let vault_fee_base = vault_fee_base as u64;
    let _vault_fee_usdc = vault_fee_usdc as u64;
    let protocol_fee_base = protocol_fee_base as u64;
    let protocol_fee_usdc = protocol_fee_usdc as u64;

    let fee_base_amount_u64 = fee_base_amount.min(position.base_amount as u128) as u64;
    let fee_usdc_amount_u64 = fee_usdc_amount.min(position.usdc_amount as u128) as u64;
    let base_to_return = position.base_amount
        .checked_sub(fee_base_amount_u64)
        .ok_or(InfernoCrucibleError::InvalidAmount)?;
    let usdc_to_return = position.usdc_amount
        .checked_sub(fee_usdc_amount_u64)
        .ok_or(InfernoCrucibleError::InvalidAmount)?;

    let crucible_bump = ctx.bumps.crucible;
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible_bump],
    ];
    let signer = &[&seeds[..]];

    // Return base to user
    let cpi_accounts = Transfer {
        from: ctx.accounts.crucible_base_vault.to_account_info(),
        to: ctx.accounts.user_base_token_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program.clone(), cpi_accounts, signer);
    token::transfer(cpi_ctx, base_to_return)?;

    // Calculate repay amount before USDC transfer (if leveraged)
    let mut repay_amount: u64 = 0;
    if position.borrowed_usdc > 0 {
        repay_amount = calculate_total_owed(&ctx.accounts.lending_market, &ctx.accounts.borrower_account)?;
    }

    // Return USDC to user (include repay amount so user can repay in same tx)
    let usdc_to_user = usdc_to_return
        .checked_add(repay_amount)
        .ok_or(InfernoCrucibleError::InvalidAmount)?;
    let cpi_accounts = Transfer {
        from: ctx.accounts.crucible_usdc_vault.to_account_info(),
        to: ctx.accounts.user_usdc_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(cpi_program.clone(), cpi_accounts, signer);
    token::transfer(cpi_ctx, usdc_to_user)?;

    // Protocol fee transfers
    if protocol_fee_base > 0 {
        require!(
            ctx.accounts.treasury_base.key() == crucible.treasury_base,
            InfernoCrucibleError::InvalidTreasury
        );
        let cpi_accounts = Transfer {
            from: ctx.accounts.crucible_base_vault.to_account_info(),
            to: ctx.accounts.treasury_base.to_account_info(),
            authority: ctx.accounts.crucible_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program.clone(), cpi_accounts, signer);
        token::transfer(cpi_ctx, protocol_fee_base)?;
    }
    if protocol_fee_usdc > 0 {
        require!(
            ctx.accounts.treasury_usdc.mint == ctx.accounts.user_usdc_account.mint,
            InfernoCrucibleError::InvalidTreasury
        );
        let cpi_accounts = Transfer {
            from: ctx.accounts.crucible_usdc_vault.to_account_info(),
            to: ctx.accounts.treasury_usdc.to_account_info(),
            authority: ctx.accounts.crucible_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program.clone(), cpi_accounts, signer);
        token::transfer(cpi_ctx, protocol_fee_usdc)?;
    }

    // Repay borrowed USDC (principal + interest) if leveraged
    if repay_amount > 0 {
        let cpi_program = ctx.accounts.lending_program.to_account_info();
        let cpi_accounts = RepayUSDC {
            pool: ctx.accounts.lending_market.to_account_info(),
            borrower: ctx.accounts.user.to_account_info(),
            borrower_account: ctx.accounts.borrower_account.to_account_info(),
            borrower_usdc_account: ctx.accounts.user_usdc_account.to_account_info(),
            pool_vault: ctx.accounts.lending_vault.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        lending_pool_usdc::cpi::repay_usdc(cpi_ctx, repay_amount)?;
    }

    // Burn LP tokens
    let burn_accounts = Burn {
        mint: ctx.accounts.lp_token_mint.to_account_info(),
        from: ctx.accounts.user_lp_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let burn_program = ctx.accounts.token_program.to_account_info();
    let burn_ctx = CpiContext::new(burn_program, burn_accounts);
    token::burn(burn_ctx, ctx.accounts.user_lp_token_account.amount)?;

    let base_vault_out = base_to_return
        .checked_add(protocol_fee_base)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let usdc_vault_out = usdc_to_return
        .checked_add(protocol_fee_usdc)
        .and_then(|v| v.checked_add(repay_amount))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    crucible.expected_vault_balance = crucible.expected_vault_balance
        .checked_sub(base_vault_out)
        .ok_or(InfernoCrucibleError::InvalidAmount)?;
    crucible.expected_usdc_vault_balance = crucible.expected_usdc_vault_balance
        .checked_sub(usdc_vault_out)
        .ok_or(InfernoCrucibleError::InvalidAmount)?;

    crucible.total_lp_token_supply = crucible.total_lp_token_supply
        .checked_sub(ctx.accounts.user_lp_token_account.amount)
        .ok_or(InfernoCrucibleError::InvalidAmount)?;
    if vault_fee_base > 0 {
        crucible.total_fees_accrued = crucible.total_fees_accrued
            .checked_add(vault_fee_base)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    update_lp_exchange_rate(crucible, current_base_token_price)?;
    crucible.last_update_slot = Clock::get()?.slot;

    position.is_open = false;

    emit!(InfernoLPPositionClosed {
        position_id: position.position_id,
        owner: position.owner,
        crucible: position.crucible,
        base_amount_returned: base_to_return,
        usdc_amount_returned: usdc_to_return,
        total_fee: total_fee_value as u64,
    });

    Ok(())
}

pub fn health_check_inferno(ctx: Context<HealthCheckInferno>) -> Result<u64> {
    calculate_ltv_bps(
        &ctx.accounts.crucible,
        &ctx.accounts.position,
        &ctx.accounts.base_mint.key(),
        &ctx.accounts.oracle,
    )
}

pub fn liquidate_inferno_lp_position(
    ctx: Context<CloseInfernoLPPosition>,
    max_slippage_bps: u64,
) -> Result<()> {
    let ltv_bps = calculate_ltv_bps(
        &ctx.accounts.crucible,
        &ctx.accounts.position,
        &ctx.accounts.base_mint.key(),
        &ctx.accounts.oracle,
    )?;

    require!(
        ltv_bps >= LIQUIDATION_THRESHOLD_BPS,
        InfernoCrucibleError::PositionNotLiquidatable
    );

    close_inferno_lp_position(ctx, max_slippage_bps)
}

fn calculate_total_owed(
    pool: &Account<lending_pool_usdc::LendingPool>,
    borrower_account: &Account<lending_pool_usdc::BorrowerAccount>,
) -> Result<u64> {
    const SECONDS_PER_YEAR: u64 = 31_536_000;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;
    require!(
        borrower_account.borrow_timestamp <= current_timestamp,
        InfernoCrucibleError::InvalidConfig
    );
    let seconds_elapsed = current_timestamp
        .checked_sub(borrower_account.borrow_timestamp)
        .ok_or(InfernoCrucibleError::InvalidConfig)?;

    let principal_u128 = borrower_account.amount_borrowed as u128;
    let borrow_rate_u128 = pool.borrow_rate as u128;
    let seconds_elapsed_u128 = seconds_elapsed as u128;

    let interest_accrued = principal_u128
        .checked_mul(borrow_rate_u128)
        .and_then(|v| v.checked_mul(seconds_elapsed_u128))
        .and_then(|v| v.checked_div(100u128))
        .and_then(|v| v.checked_div(SECONDS_PER_YEAR as u128))
        .ok_or(InfernoCrucibleError::InvalidAmount)?;

    let total_owed = principal_u128
        .checked_add(interest_accrued)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    if total_owed > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    }

    Ok(total_owed as u64)
}

fn update_lp_exchange_rate(crucible: &mut InfernoCrucible, base_token_price: u64) -> Result<()> {
    if crucible.total_lp_token_supply == 0 {
        crucible.exchange_rate = PRICE_SCALE;
        return Ok(());
    }

    let base_value = (crucible.expected_vault_balance as u128)
        .checked_mul(base_token_price as u128)
        .and_then(|v| v.checked_div(LAMPORTS_PER_SOL as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if base_value == 0 {
        crucible.exchange_rate = PRICE_SCALE;
        return Ok(());
    }

    let usdc_value = crucible.expected_usdc_vault_balance as u128;
    let exchange_rate = usdc_value
        .checked_mul(PRICE_SCALE as u128)
        .and_then(|v| v.checked_div(base_value))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if exchange_rate > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    }
    crucible.exchange_rate = exchange_rate as u64;
    Ok(())
}

pub fn get_oracle_price(
    crucible: &InfernoCrucible,
    oracle_account: &Option<&AccountInfo>,
    base_mint: &Pubkey,
) -> Result<u64> {
    const MIN_PRICE_USD: f64 = 0.001;
    const MAX_PRICE_USD: f64 = 1_000_000.0;

    if let Some(oracle_pubkey) = crucible.oracle {
        let oracle = oracle_account.ok_or(InfernoCrucibleError::InvalidOraclePrice)?;
        require!(!oracle.data_is_empty(), InfernoCrucibleError::InvalidOraclePrice);

        let account_data_result = oracle.try_borrow_data();
        if account_data_result.is_err() {
            return Err(InfernoCrucibleError::InvalidOraclePrice.into());
        }
        require!(
            *oracle.key == oracle_pubkey,
            InfernoCrucibleError::InvalidOraclePrice
        );
        let account_data = account_data_result.unwrap();

        let _price_update = PriceUpdateV2::try_deserialize(&mut &account_data[..])
            .map_err(|_| InfernoCrucibleError::InvalidOraclePrice)?;

        const MIN_REQUIRED_SIZE: usize = 132;
        require!(
            account_data.len() >= MIN_REQUIRED_SIZE,
            InfernoCrucibleError::InvalidOraclePrice
        );

        const PRICE_OFFSET: usize = 96;
        const PRICE_SIZE: usize = 8;
        let price_bytes = account_data[PRICE_OFFSET..PRICE_OFFSET + PRICE_SIZE]
            .try_into()
            .map_err(|_| InfernoCrucibleError::InvalidOraclePrice)?;
        let price: i64 = i64::from_le_bytes(price_bytes);

        const EXPO_OFFSET: usize = 104;
        const EXPO_SIZE: usize = 4;
        let expo_bytes = account_data[EXPO_OFFSET..EXPO_OFFSET + EXPO_SIZE]
            .try_into()
            .map_err(|_| InfernoCrucibleError::InvalidOraclePrice)?;
        let expo: i32 = i32::from_le_bytes(expo_bytes);

        const PUB_TIME_OFFSET: usize = 112;
        const PUB_TIME_SIZE: usize = 8;
        let pub_time_bytes = account_data[PUB_TIME_OFFSET..PUB_TIME_OFFSET + PUB_TIME_SIZE]
            .try_into()
            .map_err(|_| InfernoCrucibleError::InvalidOraclePrice)?;
        let publish_time: u64 = u64::from_le_bytes(pub_time_bytes);

        const CONFIDENCE_OFFSET: usize = 120;
        const CONFIDENCE_SIZE: usize = 8;
        if account_data.len() >= CONFIDENCE_OFFSET + CONFIDENCE_SIZE {
            let conf_bytes = account_data[CONFIDENCE_OFFSET..CONFIDENCE_OFFSET + CONFIDENCE_SIZE]
                .try_into()
                .map_err(|_| InfernoCrucibleError::InvalidOraclePrice)?;
            let confidence: u64 = u64::from_le_bytes(conf_bytes);
            let confidence_f64 = confidence as f64;
            let expo_val = expo as i32;
            let conf_price_f64 = if expo_val >= 0 {
                confidence_f64 * (10.0_f64.powi(expo_val))
            } else {
                confidence_f64 / (10.0_f64.powi(-expo_val))
            };
            let price_value_f64 = price as f64;
            let price_usd_temp = if expo_val >= 0 {
                price_value_f64 * (10.0_f64.powi(expo_val))
            } else {
                price_value_f64 / (10.0_f64.powi(-expo_val))
            };
            let confidence_bps = if price_usd_temp > 0.0 {
                (conf_price_f64 / price_usd_temp * 10_000.0) as u64
            } else {
                return Err(InfernoCrucibleError::InvalidOraclePrice.into());
            };
            require!(
                confidence_bps <= MAX_CONFIDENCE_BPS,
                InfernoCrucibleError::InvalidOraclePrice
            );
        }

        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp as u64;
        let age = current_time.saturating_sub(publish_time);
        require!(age <= MAX_STALENESS_SECONDS, InfernoCrucibleError::StaleOraclePrice);

        let price_value_f64 = price as f64;
        let expo_val = expo as i32;
        let price_usd = if expo_val >= 0 {
            price_value_f64 * (10.0_f64.powi(expo_val))
        } else {
            price_value_f64 / (10.0_f64.powi(-expo_val))
        };

        let (_min_price, _max_price) = match base_mint.to_string().as_str() {
            _ => (MIN_PRICE_USD, MAX_PRICE_USD),
        };
        require!(
            price_usd >= MIN_PRICE_USD && price_usd <= MAX_PRICE_USD,
            InfernoCrucibleError::InvalidOraclePrice
        );

        let price_scaled = (price_usd * PRICE_SCALE as f64) as u64;
        require!(price_scaled >= 1_000, InfernoCrucibleError::InvalidOraclePrice);
        Ok(price_scaled)
    } else {
        Err(InfernoCrucibleError::InvalidOraclePrice.into())
    }
}

#[derive(Accounts)]
pub struct OpenInfernoLPPosition<'info> {
    #[account(
        mut,
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
    )]
    pub crucible: Box<Account<'info, InfernoCrucible>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub base_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub user_base_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user_usdc_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub crucible_base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub crucible_usdc_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub lp_token_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub user_lp_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = user,
        space = 8 + InfernoLPPositionAccount::LEN,
        seeds = [b"lp_position", user.key().as_ref(), base_mint.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, InfernoLPPositionAccount>>,
    /// CHECK: Crucible authority PDA
    #[account(
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    /// CHECK: Optional oracle account for price feeds
    pub oracle: Option<UncheckedAccount<'info>>,
    #[account(
        mut,
        constraint = treasury_base.mint == base_mint.key() @ InfernoCrucibleError::InvalidTreasury
    )]
    pub treasury_base: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = treasury_usdc.mint == user_usdc_account.mint @ InfernoCrucibleError::InvalidTreasury
    )]
    pub treasury_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseInfernoLPPosition<'info> {
    #[account(
        mut,
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
    )]
    pub crucible: Box<Account<'info, InfernoCrucible>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub base_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [b"lp_position", user.key().as_ref(), base_mint.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == user.key() @ InfernoCrucibleError::Unauthorized,
    )]
    pub position: Box<Account<'info, InfernoLPPositionAccount>>,
    #[account(mut)]
    pub user_base_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user_usdc_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user_lp_token_account: Box<Account<'info, TokenAccount>>,
    pub lp_token_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub crucible_base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub crucible_usdc_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: Crucible authority PDA
    #[account(
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    /// CHECK: Optional oracle account for price feeds
    pub oracle: Option<UncheckedAccount<'info>>,
    #[account(
        mut,
        constraint = treasury_base.mint == base_mint.key() @ InfernoCrucibleError::InvalidTreasury
    )]
    pub treasury_base: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = treasury_usdc.mint == user_usdc_account.mint @ InfernoCrucibleError::InvalidTreasury
    )]
    pub treasury_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub lending_market: Box<Account<'info, lending_pool_usdc::LendingPool>>,
    #[account(mut)]
    pub borrower_account: Box<Account<'info, lending_pool_usdc::BorrowerAccount>>,
    #[account(mut)]
    pub lending_vault: Account<'info, TokenAccount>,
    pub lending_program: Program<'info, LendingPoolUsdc>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct HealthCheckInferno<'info> {
    #[account(
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
    )]
    pub crucible: Box<Account<'info, InfernoCrucible>>,
    pub base_mint: Box<Account<'info, Mint>>,
    #[account(
        seeds = [b"lp_position", position.owner.as_ref(), base_mint.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, InfernoLPPositionAccount>>,
    /// CHECK: Optional oracle account for price feeds
    pub oracle: Option<UncheckedAccount<'info>>,
}

fn calculate_ltv_bps(
    crucible: &InfernoCrucible,
    position: &InfernoLPPositionAccount,
    base_mint: &Pubkey,
    oracle: &Option<UncheckedAccount>,
) -> Result<u64> {
    let oracle_account_opt = oracle.as_ref().map(|o| o.as_ref());
    let current_base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        base_mint,
    )?;

    let base_value = (position.base_amount as u128)
        .checked_mul(current_base_token_price as u128)
        .and_then(|v| v.checked_div(LAMPORTS_PER_SOL as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let usdc_value = position.usdc_amount as u128;
    let total_value = base_value
        .checked_add(usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    require!(total_value > 0, InfernoCrucibleError::InvalidAmount);

    let ltv_bps = (position.borrowed_usdc as u128)
        .checked_mul(10_000)
        .and_then(|v| v.checked_div(total_value))
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(ltv_bps as u64)
}

#[event]
pub struct InfernoLPPositionOpened {
    pub position_id: u64,
    pub owner: Pubkey,
    pub crucible: Pubkey,
    pub base_mint: Pubkey,
    pub base_amount: u64,
    pub usdc_amount: u64,
    pub borrowed_usdc: u64,
    pub leverage_factor: u64,
    pub entry_price: u64,
}

#[event]
pub struct InfernoLPPositionClosed {
    pub position_id: u64,
    pub owner: Pubkey,
    pub crucible: Pubkey,
    pub base_amount_returned: u64,
    pub usdc_amount_returned: u64,
    pub total_fee: u64,
}
