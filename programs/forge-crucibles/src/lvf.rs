use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use crate::state::*;
use crate::LENDING_POOL_PROGRAM_ID;
use lending_pool_usdc::cpi::accounts::BorrowUSDC;
use lending_pool_usdc::cpi::accounts::RepayUSDC;
use lending_pool_usdc::program::LendingPoolUsdc;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

/// Open a leveraged LP position
/// Lending pool integration is complete - borrows USDC from lending pool via CPI
pub fn open_leveraged_position(
    ctx: Context<OpenLeveragedPosition>,
    collateral_amount: u64,
    leverage_factor: u64, // 150 = 1.5x, 200 = 2x (scaled by 100)
) -> Result<u64> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    // Lending integration enabled - borrow from lending pool
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

    // Get base token price from oracle with validation
    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        &ctx.accounts.base_mint.key(),
    )?;

    // Calculate collateral value in USDC with checked arithmetic
    let collateral_value_usdc = (collateral_amount as u128)
        .checked_mul(base_token_price as u128)
        .and_then(|v| v.checked_div(1_000_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Ensure value fits in u64
    let collateral_value_usdc = if collateral_value_usdc > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        collateral_value_usdc as u64
    };

    // Calculate borrowed USDC amount based on leverage
    // For 2x leverage: borrow = collateral_value (100% of collateral value)
    // For 1.5x leverage: borrow = 0.5 * collateral_value
    let leverage_multiplier = leverage_factor as u128;
    let leverage_excess = leverage_multiplier
        .checked_sub(100)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let borrowed_usdc = (collateral_value_usdc as u128)
        .checked_mul(leverage_excess)
        .and_then(|v| v.checked_div(100))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Ensure borrowed_usdc fits in u64
    let borrowed_usdc = if borrowed_usdc > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        borrowed_usdc as u64
    };

    // Transfer collateral from user to crucible vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.crucible_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, collateral_amount)?;

    // Borrow USDC from USDC-only lending pool via CPI
    // NOTE: Only USDC lending pool is supported for leverage in crucibles
    if borrowed_usdc > 0 {
        // Get pool bump from pool account data
        // Pool account structure: discriminator (8) + usdc_mint (32) + total_liquidity (8) + total_borrowed (8) + borrow_rate (8) + lender_rate (8) + bump (1)
        // Bump is at offset 72
        let pool_data = ctx.accounts.lending_market.try_borrow_data()?;
        if pool_data.len() < 73 {
            return Err(ProgramError::InvalidAccountData.into());
        }
        // Create CPI context for borrowing
        let cpi_program = ctx.accounts.lending_program.to_account_info();
        let cpi_accounts = BorrowUSDC {
            pool: ctx.accounts.lending_market.to_account_info(),
            borrower: ctx.accounts.user.to_account_info(),
            borrower_account: ctx.accounts.borrower_account.to_account_info(),
            pool_vault: ctx.accounts.lending_vault.to_account_info(),
            borrower_usdc_account: ctx.accounts.user_usdc_account.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        // Call lending pool borrow_usdc instruction via CPI
        lending_pool_usdc::cpi::borrow_usdc(cpi_ctx, borrowed_usdc)?;
    }

    // Initialize position
    position.id = ctx.accounts.position_id.key();
    position.owner = ctx.accounts.user.key();
    position.token = ctx.accounts.base_mint.key();
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

    // Return the position creation slot as a unique identifier
    Ok(clock.slot)
}

/// Close a leveraged LP position
/// Close a leveraged LP position
/// Lending pool integration is complete - repays USDC to lending pool via CPI
pub fn close_leveraged_position(
    ctx: Context<CloseLeveragedPosition>,
    _position_id: Pubkey,
    max_slippage_bps: u64, // Maximum slippage in basis points (e.g., 100 = 1%)
) -> Result<()> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    // Get base_mint before mutable borrow of crucible
    let base_mint_key = ctx.accounts.crucible.base_mint;
    
    // Lending integration enabled - repay loan before closing
    let position = &mut ctx.accounts.position;
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;

    require!(position.is_open, CrucibleError::PositionNotOpen);
    require!(position.owner == ctx.accounts.user.key(), CrucibleError::Unauthorized);

    // Repay USDC loan to USDC-only lending pool (including accrued interest)
    // NOTE: Only USDC lending pool is supported for leverage in crucibles
    if position.borrowed_usdc > 0 {
        // Calculate repayment amount (borrowed + accrued interest)
        // Use fixed 10% APY from lending-pool state
        let slots_elapsed = clock.slot.checked_sub(position.created_at).unwrap_or(0);
        let slots_per_year = 78_840_000u128; // Approximate slots per year (400ms per slot)
        
        // Calculate interest: borrowedAmount × (borrowRate / 100) × (slotsElapsed / slotsPerYear)
        // borrow_rate is stored as 10 = 10% APY (scaled by 100)
        // Fetch borrow_rate from lending pool state (for now use fixed 10%)
        let borrow_rate = 10u64; // 10% APY (from lending-pool state, should be fetched)
        let rate_decimal = (borrow_rate as u128) * 1_000_000 / 100; // Convert to scaled decimal (10% = 100_000 in 1M scale)
        
        let years_elapsed = (slots_elapsed as u128)
            .checked_mul(1_000_000)
            .and_then(|v| v.checked_div(slots_per_year))
            .unwrap_or(0);
        
        // Interest = borrowed_usdc × (rate_decimal / 1_000_000) × (years_elapsed / 1_000_000)
        let interest = (position.borrowed_usdc as u128)
            .checked_mul(rate_decimal)
            .and_then(|v| v.checked_mul(years_elapsed))
            .and_then(|v| v.checked_div(1_000_000_000_000u128)) // 1M * 1M
            .unwrap_or(0);
        
        let total_owed = (position.borrowed_usdc as u128)
            .checked_add(interest)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        
        let repay_amount = if total_owed > u64::MAX as u128 {
            return Err(ProgramError::ArithmeticOverflow.into());
        } else {
            total_owed as u64
        };
        
        // Repay via CPI to lending-pool program
        let cpi_program = ctx.accounts.lending_program.to_account_info();
        let cpi_accounts = RepayUSDC {
            pool: ctx.accounts.lending_market.to_account_info(),
            borrower: ctx.accounts.user.to_account_info(),
            borrower_account: ctx.accounts.borrower_account.to_account_info(), // Anchor converts to borrowerAccount
            borrower_usdc_account: ctx.accounts.user_usdc_account.to_account_info(), // Anchor converts to borrowerUsdcAccount
            pool_vault: ctx.accounts.lending_vault.to_account_info(), // Anchor converts to poolVault
            token_program: ctx.accounts.token_program.to_account_info(), // Anchor converts to tokenProgram
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        // Call lending pool repay_usdc instruction via CPI
        lending_pool_usdc::cpi::repay_usdc(cpi_ctx, repay_amount)?;
    }

    // SECURITY FIX: Fetch current oracle price and validate slippage
    // base_mint_key already obtained above before mutable borrow
    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let current_base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        &base_mint_key,
    )?;
    
    // Calculate current position value using current oracle price
    let current_position_value_usdc = (position.collateral as u128)
        .checked_mul(current_base_token_price as u128)
        .and_then(|v| v.checked_div(1_000_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate entry position value using entry price
    let entry_position_value_usdc = (position.collateral as u128)
        .checked_mul(position.entry_price as u128)
        .and_then(|v| v.checked_div(1_000_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate slippage in basis points
    let value_diff = if current_position_value_usdc > entry_position_value_usdc {
        current_position_value_usdc.checked_sub(entry_position_value_usdc)
    } else {
        entry_position_value_usdc.checked_sub(current_position_value_usdc)
    }.ok_or(ProgramError::ArithmeticOverflow)?;
    
    let slippage_bps = value_diff
        .checked_mul(10_000)
        .and_then(|v| v.checked_div(entry_position_value_usdc.max(1)))
        .unwrap_or(10_000); // If calculation fails, assume max slippage
    
    // Validate slippage is within user's tolerance
    require!(
        slippage_bps <= max_slippage_bps as u128,
        CrucibleError::SlippageExceeded
    );
    
    // Calculate yield earned using exchange rate growth
    // Use current price for calculations (already fetched above)
    let current_exchange_rate = calculate_lvf_exchange_rate(
        crucible,
        position.collateral,
        position.borrowed_usdc,
        clock.slot.checked_sub(position.created_at).unwrap_or(0),
    )?;

    // Calculate tokens to return (includes yield) with checked arithmetic
    let tokens_to_return = (position.collateral as u128)
        .checked_mul(current_exchange_rate as u128)
        .and_then(|v| v.checked_div(1_000_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Ensure tokens_to_return fits in u64
    let tokens_to_return = if tokens_to_return > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        tokens_to_return as u64
    };

    // Calculate close fees: 2% principal + 10% yield
    let principal_fee = (position.collateral as u128)
        .checked_mul(2)
        .and_then(|v| v.checked_div(100))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;
    
    let yield_earned = tokens_to_return
        .checked_sub(position.collateral)
        .unwrap_or(0);
    let yield_fee = (yield_earned as u128)
        .checked_mul(10)
        .and_then(|v| v.checked_div(100))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;
    
    let total_fee = principal_fee
        .checked_add(yield_fee)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Split fee: 80% to vault, 20% to treasury
    let vault_fee_share = (total_fee as u128)
        .checked_mul(80)
        .and_then(|v| v.checked_div(100))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;
    let protocol_fee_share = total_fee
        .checked_sub(vault_fee_share)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let tokens_after_fee = tokens_to_return
        .checked_sub(total_fee)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Transfer vault fee share to vault (increases yield)
    if vault_fee_share > 0 {
        // Fee already accounted in tokens_to_return calculation
        crucible.total_fees_accrued = crucible
            .total_fees_accrued
            .checked_add(vault_fee_share)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }
    
    // Transfer protocol fee share to treasury
    if protocol_fee_share > 0 {
        // Validate treasury account matches crucible.treasury
        require!(
            ctx.accounts.treasury.key() == crucible.treasury,
            CrucibleError::InvalidTreasury
        );
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.crucible_vault.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
            authority: ctx.accounts.crucible_authority.to_account_info(),
        };
        let seeds = &[
            b"crucible",
            crucible.base_mint.as_ref(),
            &[crucible.bump],
        ];
        let signer = &[&seeds[..]];
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, protocol_fee_share)?;
    }

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
        .ok_or(ProgramError::ArithmeticOverflow)?;

    emit!(LeveragedPositionClosed {
        position_id: position.id,
        owner: position.owner,
        collateral_returned: tokens_after_fee,
        yield_earned: position.yield_earned,
    });

    Ok(())
}

/// Get price from oracle account with staleness and validation checks
/// Returns price scaled by 1_000_000 (e.g., $100.50 = 100_500_000)
pub fn get_oracle_price(
    crucible: &Crucible,
    oracle_account: &Option<&AccountInfo>,
    _base_mint: &Pubkey,
) -> Result<u64> {
    const MAX_STALENESS_SECONDS: u64 = 300; // 5 minutes max staleness
    const MIN_PRICE_USD: f64 = 0.000001; // $0.000001 minimum
    const MAX_PRICE_USD: f64 = 1_000_000.0; // $1,000,000 maximum
    
    if let Some(oracle_pubkey) = crucible.oracle {
        // Oracle is configured - must be provided
        let oracle = oracle_account
            .ok_or(CrucibleError::InvalidOraclePrice)?;
        
        require!(
            *oracle.key == oracle_pubkey,
            CrucibleError::InvalidOraclePrice
        );
        
        // Use Pyth SDK to validate account structure, then parse price data manually
        // The SDK deserialization validates the account is a valid PriceUpdateV2
        let account_data = oracle.try_borrow_data()?;
        
        // Validate account structure using SDK (ensures it's a valid PriceUpdateV2)
        let _price_update = PriceUpdateV2::try_deserialize(&mut &account_data[..])
            .map_err(|_| CrucibleError::InvalidOraclePrice)?;
        
        // After SDK validation, parse price fields manually from account data
        // Pyth PriceUpdateV2 structure has price data at specific offsets
        // This is safer than pure manual parsing since SDK validates the structure first
        if account_data.len() < 120 {
            return Err(CrucibleError::InvalidOraclePrice.into());
        }
        
        // Parse price (i64) at offset 96
        let price_offset = 96;
        let price_bytes = &account_data[price_offset..price_offset + 8];
        let price: i64 = i64::from_le_bytes([
            price_bytes[0], price_bytes[1], price_bytes[2], price_bytes[3],
            price_bytes[4], price_bytes[5], price_bytes[6], price_bytes[7],
        ]);
        
        // Parse exponent (i32) at offset 104
        let expo_offset = 104;
        let expo_bytes = &account_data[expo_offset..expo_offset + 4];
        let expo: i32 = i32::from_le_bytes([
            expo_bytes[0], expo_bytes[1], expo_bytes[2], expo_bytes[3],
        ]);
        
        // Parse publish_time (u64) at offset 112 for staleness check
        let pub_time_offset = 112;
        let pub_time_bytes = &account_data[pub_time_offset..pub_time_offset + 8];
        let publish_time: u64 = u64::from_le_bytes([
            pub_time_bytes[0], pub_time_bytes[1], pub_time_bytes[2], pub_time_bytes[3],
            pub_time_bytes[4], pub_time_bytes[5], pub_time_bytes[6], pub_time_bytes[7],
        ]);
        
        // Get current clock for staleness check
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp as u64;
        let age = current_time.saturating_sub(publish_time);
        
        require!(
            age <= MAX_STALENESS_SECONDS,
            CrucibleError::StaleOraclePrice
        );
        
        // Calculate actual price: price * 10^expo
        let price_value_f64 = price as f64;
        let expo_val = expo as i32;
        
        let price_usd = if expo_val >= 0 {
            price_value_f64 * (10.0_f64.powi(expo_val))
        } else {
            price_value_f64 / (10.0_f64.powi(-expo_val))
        };
        
        // Validate price bounds
        require!(
            price_usd >= MIN_PRICE_USD && price_usd <= MAX_PRICE_USD,
            CrucibleError::InvalidOraclePrice
        );
        
        // Scale to 1_000_000 (e.g., $100.50 = 100_500_000)
        let price_scaled = (price_usd * 1_000_000.0) as u64;
        
        require!(price_scaled > 0, CrucibleError::InvalidOraclePrice);
        
        Ok(price_scaled)
    } else {
        // No oracle configured - this is unsafe for production
        // Return error to force oracle setup
        return Err(CrucibleError::InvalidOraclePrice.into());
    }
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

    // Prevent division by zero
    require!(collateral > 0, CrucibleError::InvalidLeverage);

    // Calculate effective APY with leverage using checked arithmetic
    // Effective APY = Base APY * Leverage - Borrow Cost
    let collateral_128 = collateral as u128;
    let borrowed_128 = borrowed_usdc as u128;
    
    // Calculate leverage multiplier: (borrowed * 100) / collateral + 100
    let leverage_multiplier = borrowed_128
        .checked_mul(100)
        .and_then(|v| v.checked_div(collateral_128))
        .and_then(|v| v.checked_add(100))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let base_apy = crucible.fee_rate as u128; // Use crucible fee rate as base APY
    let borrow_rate = 10u128; // 10% APY (from lending-pool, scaled by 100: 10 = 10%)
    
    // Calculate: (base_apy * leverage_multiplier) / 100
    let leveraged_apy = base_apy
        .checked_mul(leverage_multiplier)
        .and_then(|v| v.checked_div(100))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate: (borrow_rate * (leverage_multiplier - 100)) / 100
    let leverage_excess = leverage_multiplier
        .checked_sub(100)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let borrow_cost = borrow_rate
        .checked_mul(leverage_excess)
        .and_then(|v| v.checked_div(100))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate effective APY: leveraged_apy - borrow_cost
    let effective_apy = leveraged_apy
        .checked_sub(borrow_cost)
        .unwrap_or(0); // If borrow cost exceeds leveraged APY, use 0

    // Convert slots to years (assuming 400ms per slot)
    // slots_per_year = 365 * 24 * 60 * 60 * 1000 / 400 = 78,840,000
    let slots_per_year = 78_840_000u128;
    
    // Calculate years_elapsed: (slots_elapsed * 1_000_000) / slots_per_year
    let years_elapsed = (slots_elapsed as u128)
        .checked_mul(1_000_000)
        .and_then(|v| v.checked_div(slots_per_year))
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // SECURITY FIX: Calculate exchange rate growth with proper precision
    // Multiply first, then divide to prevent precision loss
    // growth = (base_rate * effective_apy * years_elapsed) / (100 * 1_000_000 * 1_000_000)
    let growth_numerator = (base_rate as u128)
        .checked_mul(effective_apy)
        .and_then(|v| v.checked_mul(years_elapsed))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let growth_denominator = 100u128
        .checked_mul(1_000_000)
        .and_then(|v| v.checked_mul(1_000_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Ensure denominator is not zero
    require!(growth_denominator > 0, CrucibleError::InsufficientLiquidity);
    
    let growth = growth_numerator
        .checked_div(growth_denominator)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Add minimum threshold to prevent zero yields for small positions
    // Minimum growth of 1 unit (scaled) to ensure some yield accrual
    let min_growth = 1u128;
    let growth = growth.max(min_growth);
    
    // Calculate final exchange rate: base_rate + growth
    let exchange_rate = (base_rate as u128)
        .checked_add(growth)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Ensure exchange rate doesn't exceed u64::MAX
    if exchange_rate > u64::MAX as u128 {
        return Ok(u64::MAX);
    }

    Ok(exchange_rate as u64)
}

#[derive(Accounts)]
#[instruction(position_id: Pubkey)]
pub struct OpenLeveragedPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = crucible.base_mint == base_mint.key() @ CrucibleError::InvalidBaseMint,
    )]
    pub crucible: Box<Account<'info, Crucible>>,

    pub base_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump = crucible.vault_bump,
    )]
    pub crucible_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = user,
        space = 8 + LeveragedPosition::LEN,
        seeds = [b"position", user.key().as_ref(), crucible.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, LeveragedPosition>>,

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

    /// CHECK: Optional oracle account for price feeds
    /// If provided, must match crucible.oracle
    pub oracle: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Lending program for borrowing USDC (USDC-only lending pool)
    #[account(
        constraint = lending_program.key() == LENDING_POOL_PROGRAM_ID @ CrucibleError::InvalidLendingProgram
    )]
    pub lending_program: UncheckedAccount<'info>,
    /// CHECK: SECURITY FIX - Validate lending_market is owned by lending_program
    #[account(
        mut,
        constraint = *lending_market.owner == lending_program.key() @ CrucibleError::InvalidLendingProgram
    )]
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: Pool authority PDA (same as lending_market, used for signing)
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: Borrower account PDA (created by lending program if needed)
    #[account(mut)]
    pub borrower_account: UncheckedAccount<'info>,
    /// CHECK: SECURITY FIX - Validate lending_vault is owned by lending_program
    #[account(
        mut,
        constraint = *lending_vault.owner == lending_program.key() @ CrucibleError::InvalidLendingProgram
    )]
    pub lending_vault: UncheckedAccount<'info>,
    /// CHECK: User USDC account for receiving borrowed funds
    #[account(mut)]
    pub user_usdc_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(position_id: Pubkey)]
pub struct CloseLeveragedPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub crucible: Box<Account<'info, Crucible>>,

    #[account(
        mut,
        seeds = [b"position", user.key().as_ref(), crucible.key().as_ref()],
        bump = position.bump,
        constraint = position.id == position_id @ CrucibleError::InvalidPosition,
    )]
    pub position: Box<Account<'info, LeveragedPosition>>,

    #[account(mut)]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump = crucible.vault_bump,
    )]
    pub crucible_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: Crucible authority PDA
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    
    /// CHECK: Optional oracle account for price feeds (required for slippage protection)
    /// If provided, must match crucible.oracle
    pub oracle: Option<UncheckedAccount<'info>>,
    
    /// SECURITY FIX: Validate treasury is a TokenAccount for base_mint
    #[account(
        mut,
        constraint = treasury.mint == crucible.base_mint @ CrucibleError::InvalidTreasury
    )]
    pub treasury: Account<'info, TokenAccount>,
    
    /// CHECK: Lending program for repaying USDC (USDC-only lending pool)
    #[account(
        constraint = lending_program.key() == LENDING_POOL_PROGRAM_ID @ CrucibleError::InvalidLendingProgram
    )]
    pub lending_program: UncheckedAccount<'info>,
    /// CHECK: SECURITY FIX - Validate lending_market is owned by lending_program
    #[account(
        mut,
        constraint = *lending_market.owner == lending_program.key() @ CrucibleError::InvalidLendingProgram
    )]
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: Borrower account PDA
    #[account(mut)]
    pub borrower_account: UncheckedAccount<'info>,
    /// CHECK: SECURITY FIX - Validate lending_vault is owned by lending_program
    #[account(
        mut,
        constraint = *lending_vault.owner == lending_program.key() @ CrucibleError::InvalidLendingProgram
    )]
    pub lending_vault: UncheckedAccount<'info>,
    /// CHECK: User USDC account for repaying loan
    #[account(mut)]
    pub user_usdc_account: UncheckedAccount<'info>,

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

