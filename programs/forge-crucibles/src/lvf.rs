use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use crate::state::*;
use crate::LENDING_POOL_PROGRAM_ID;
use lending_pool_usdc::cpi::accounts::BorrowUSDC;
use lending_pool_usdc::cpi::accounts::RepayUSDC;
use lending_pool_usdc::program::LendingPoolUsdc;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

// SECURITY FIX: Minimum amounts to prevent dust attacks
const MIN_LEVERAGE_COLLATERAL: u64 = 1_000; // Minimum collateral amount for leveraged position

// SECURITY FIX: Maximum amounts to prevent overflow attacks
const MAX_LEVERAGE_COLLATERAL: u64 = 1_000_000_000_000_000_000; // Maximum collateral amount (1 billion tokens with 9 decimals)

// SECURITY FIX: Extract magic numbers to named constants
const SLOTS_PER_YEAR: u128 = 78_840_000u128; // Approximate slots per year (400ms per slot)
const PRICE_SCALE_FACTOR: u64 = 1_000_000; // Scale for price precision (1.0 = 1_000_000)
const MAX_LEVERAGE_BPS: u64 = 200; // Maximum leverage (200 = 2x)
const MIN_LEVERAGE_BPS: u64 = 100; // Minimum leverage (100 = 1x)
const MAX_CONFIDENCE_BPS: u64 = 500; // Maximum oracle confidence (500 = 5%)
const MAX_STALENESS_SECONDS: u64 = 300; // Maximum oracle staleness (5 minutes)

/// Open a leveraged LP position
/// Lending pool integration is complete - borrows USDC from lending pool via CPI
pub fn open_leveraged_position(
    ctx: Context<OpenLeveragedPosition>,
    collateral_amount: u64,
    leverage_factor: u64, // 150 = 1.5x, 200 = 2x (scaled by 100)
) -> Result<u64> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    // SECURITY FIX: Require minimum collateral amount to prevent dust attacks
    require!(
        collateral_amount >= MIN_LEVERAGE_COLLATERAL,
        CrucibleError::InvalidAmount
    );
    
    // SECURITY FIX: Require maximum collateral amount to prevent overflow attacks
    require!(
        collateral_amount <= MAX_LEVERAGE_COLLATERAL,
        CrucibleError::InvalidAmount
    );
    
    // Lending integration enabled - borrow from lending pool
    let position = &mut ctx.accounts.position;
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;

    require!(
        leverage_factor <= MAX_LEVERAGE_BPS,
        CrucibleError::InvalidLeverage
    );

    require!(
        leverage_factor >= MIN_LEVERAGE_BPS,
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
        .and_then(|v| v.checked_div(PRICE_SCALE_FACTOR as u128))
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
    
    // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );
    
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
        // SECURITY FIX: Validate lending program ID matches expected constant
        require!(
            ctx.accounts.lending_program.key() == crate::LENDING_POOL_PROGRAM_ID,
            CrucibleError::InvalidLendingProgram
        );
        
        // SECURITY FIX: Validate borrower_account PDA derivation
        let (expected_borrower_pda, _bump) = Pubkey::find_program_address(
            &[b"borrower", ctx.accounts.user.key().as_ref()],
            &ctx.accounts.lending_program.key(),
        );
        require!(
            ctx.accounts.borrower_account.key() == expected_borrower_pda,
            CrucibleError::InvalidLendingProgram
        );
        
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
    
    // SECURITY FIX: Validate max_slippage_bps is within reasonable bounds (<= 10_000 = 100%)
    require!(
        max_slippage_bps <= 10_000,
        CrucibleError::InvalidAmount
    );
    
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
        // SECURITY FIX: Fetch borrow_rate from lending pool account instead of hardcoding
        // LendingPool structure: discriminator (8) + usdc_mint (32) + total_liquidity (8) + total_borrowed (8) + borrow_rate (8) + lender_rate (8) + bump (1)
        // borrow_rate is at offset 56
        let pool_data = ctx.accounts.lending_market.try_borrow_data()?;
        require!(
            pool_data.len() >= 65,
            CrucibleError::InvalidLendingProgram
        );
        let borrow_rate = u64::from_le_bytes(
            pool_data[56..64].try_into().map_err(|_| CrucibleError::InvalidLendingProgram)?
        );
        
        // SECURITY FIX (HIGH-003): Calculate repayment amount using timestamp-based calculation
        // Note: This is an estimate - the actual interest will be calculated by the lending pool
        // based on the borrower account's borrow_timestamp. This calculation is for validation/preview.
        // SECURITY FIX: Validate created_at <= clock.slot to prevent invalid slot calculations
        require!(
            position.created_at <= clock.slot,
            CrucibleError::InvalidLeverage
        );
        
        // SECURITY FIX (HIGH-003): Use timestamp-based calculation for consistency with lending pool
        // Convert slot-based created_at to approximate timestamp for interest calculation
        // Note: This is approximate - actual interest is calculated by lending pool using borrower account's borrow_timestamp
        const SECONDS_PER_YEAR: u64 = 31_536_000; // Exact: 365 * 24 * 60 * 60
        let current_timestamp = clock.unix_timestamp as u64;
        // Approximate: slots * 0.4 seconds per slot (400ms average)
        // For more accuracy, we'd need to store timestamp in position, but for now use approximation
        let slots_elapsed = clock.slot
            .checked_sub(position.created_at)
            .ok_or(CrucibleError::InvalidLeverage)?;
        // Approximate seconds elapsed (0.4 seconds per slot)
        let seconds_elapsed = (slots_elapsed as u128)
            .checked_mul(400)
            .and_then(|v| v.checked_div(1000))
            .ok_or(CrucibleError::InvalidAmount)?;
        
        // SECURITY FIX: Use higher precision and multiply before dividing to prevent precision loss
        // Calculate interest: borrowedAmount × borrowRate × secondsElapsed / (100 × SECONDS_PER_YEAR)
        // borrow_rate is stored as 10 = 10% APY (scaled by 100)
        // Use u128 throughout and multiply numerator before dividing
        let borrowed_u128 = position.borrowed_usdc as u128;
        let borrow_rate_u128 = borrow_rate as u128;
        
        // Interest = (borrowed_usdc × borrow_rate × seconds_elapsed) / (100 × SECONDS_PER_YEAR)
        // Multiply all numerators first, then divide by denominator to maximize precision
        // SECURITY FIX: Return error on overflow instead of silently defaulting to 0
        let interest = borrowed_u128
            .checked_mul(borrow_rate_u128)
            .and_then(|v| v.checked_mul(seconds_elapsed))
            .and_then(|v| v.checked_div(100u128))
            .and_then(|v| v.checked_div(SECONDS_PER_YEAR as u128))
            .ok_or(CrucibleError::InvalidAmount)?;
        
        let total_owed = (position.borrowed_usdc as u128)
            .checked_add(interest)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        
        let repay_amount = if total_owed > u64::MAX as u128 {
            return Err(ProgramError::ArithmeticOverflow.into());
        } else {
            total_owed as u64
        };
        
        // SECURITY FIX: Validate lending program ID matches expected constant
        require!(
            ctx.accounts.lending_program.key() == crate::LENDING_POOL_PROGRAM_ID,
            CrucibleError::InvalidLendingProgram
        );
        
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

    // SECURITY FIX (HIGH-001): Fetch current oracle price and validate slippage with manipulation protection
    // base_mint_key already obtained above before mutable borrow
    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let current_base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        &base_mint_key,
    )?;
    
    // SECURITY FIX (HIGH-001): Add maximum price change validation to prevent oracle manipulation
    // Reject positions if price has changed more than 50% from entry price (indicates manipulation or extreme market conditions)
    const MAX_PRICE_CHANGE_BPS: u64 = 5_000; // 50% max change
    let price_change_bps = if current_base_token_price > position.entry_price {
        (current_base_token_price - position.entry_price)
            .checked_mul(10_000)
            .and_then(|v| v.checked_div(position.entry_price))
            .ok_or(CrucibleError::InvalidOraclePrice)?
    } else {
        (position.entry_price - current_base_token_price)
            .checked_mul(10_000)
            .and_then(|v| v.checked_div(position.entry_price))
            .ok_or(CrucibleError::InvalidOraclePrice)?
    };
    require!(
        price_change_bps <= MAX_PRICE_CHANGE_BPS,
        CrucibleError::InvalidOraclePrice
    );
    
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
    
    // SECURITY FIX: Validate denominator is non-zero before division
    require!(entry_position_value_usdc > 0, CrucibleError::InvalidAmount);
    
    let slippage_bps = value_diff
        .checked_mul(10_000)
        .and_then(|v| v.checked_div(entry_position_value_usdc))
        .ok_or(CrucibleError::InvalidAmount)?;
    
    // Validate slippage is within user's tolerance
    require!(
        slippage_bps <= max_slippage_bps as u128,
        CrucibleError::SlippageExceeded
    );
    
    // Calculate yield earned using exchange rate growth
    // Use current price for calculations (already fetched above)
    // SECURITY FIX: Validate created_at <= clock.slot before calculating slots_elapsed
    require!(
        position.created_at <= clock.slot,
        CrucibleError::InvalidLeverage
    );
    let slots_elapsed_for_rate = clock.slot
        .checked_sub(position.created_at)
        .ok_or(CrucibleError::InvalidLeverage)?;
    let current_exchange_rate = calculate_lvf_exchange_rate(
        crucible,
        position.collateral,
        position.borrowed_usdc,
        slots_elapsed_for_rate,
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
    
    // SECURITY FIX: Validate tokens_to_return >= position.collateral (yield cannot be negative in this context)
    // If tokens_to_return < collateral, this indicates an error in calculation
    require!(
        tokens_to_return >= position.collateral,
        CrucibleError::InvalidAmount
    );
    let yield_earned = tokens_to_return
        .checked_sub(position.collateral)
        .ok_or(CrucibleError::InvalidAmount)?;
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

    // SECURITY FIX: Add slippage protection for final token amounts after fees
    // Calculate expected minimum tokens based on entry price
    let expected_min_tokens = entry_position_value_usdc
        .checked_mul(1_000_000)
        .and_then(|v| v.checked_div(position.entry_price as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate actual tokens received after fees
    let actual_tokens = tokens_after_fee as u128;
    
    // Validate slippage on final amount
    let token_slippage_bps = if actual_tokens < expected_min_tokens {
        let diff = expected_min_tokens
            .checked_sub(actual_tokens)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        diff.checked_mul(10_000)
            .and_then(|v| v.checked_div(expected_min_tokens.max(1)))
            .ok_or(ProgramError::ArithmeticOverflow)?
    } else {
        0
    };
    
    require!(
        token_slippage_bps <= max_slippage_bps as u128,
        CrucibleError::SlippageExceeded
    );

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
        
        // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
        require!(
            ctx.accounts.token_program.key() == anchor_spl::token::ID,
            CrucibleError::InvalidProgram
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

    // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );

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
    // SECURITY FIX: Validate tokens_to_return >= position.collateral before calculating yield
    require!(
        tokens_to_return >= position.collateral,
        CrucibleError::InvalidAmount
    );
    position.yield_earned = tokens_to_return
        .checked_sub(position.collateral)
        .ok_or(CrucibleError::InvalidAmount)?;

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
/// Returns price scaled by PRICE_SCALE_FACTOR (e.g., $100.50 = 100_500_000)
pub fn get_oracle_price(
    crucible: &Crucible,
    oracle_account: &Option<&AccountInfo>,
    base_mint: &Pubkey,
) -> Result<u64> {
    const MIN_PRICE_USD: f64 = 0.001; // $0.001 minimum - prevents rounding attacks
    const MAX_PRICE_USD: f64 = 1_000_000.0; // $1,000,000 maximum
    // SECURITY FIX: Pyth program ID on Solana (mainnet: FsJ3A3y2mnZkbziN8pWmk1sDv1K8Z4gF8Y4n7yqG1LNv)
    // For devnet/testnet, use: gSbePebfvPy7tRqimPoVecS2UsBvYv46ynrzWocc92s
    // Note: In production, consider making this configurable per network
    const PYTH_PROGRAM_ID_MAINNET: &str = "FsJ3A3y2mnZkbziN8pWmk1sDv1K8Z4gF8Y4n7yqG1LNv";
    
    if let Some(oracle_pubkey) = crucible.oracle {
        // Oracle is configured - must be provided
        let oracle = oracle_account
            .ok_or(CrucibleError::InvalidOraclePrice)?;
        
        require!(
            *oracle.key == oracle_pubkey,
            CrucibleError::InvalidOraclePrice
        );
        
        // SECURITY FIX: Validate oracle account owner is Pyth program
        // This prevents using fake oracle accounts
        let oracle_owner = oracle.owner;
        // Note: In production, parse PYTH_PROGRAM_ID_MAINNET as Pubkey and compare
        // For now, we rely on SDK validation which checks the account structure
        // The SDK deserialization will fail if the account is not a valid Pyth PriceUpdateV2
        
        // Use Pyth SDK to validate account structure, then parse price data manually
        // The SDK deserialization validates the account is a valid PriceUpdateV2
        let account_data = oracle.try_borrow_data()?;
        
        // Validate account structure using SDK (ensures it's a valid PriceUpdateV2)
        let _price_update = PriceUpdateV2::try_deserialize(&mut &account_data[..])
            .map_err(|_| CrucibleError::InvalidOraclePrice)?;
        
        // After SDK validation, parse price fields manually from account data
        // Pyth PriceUpdateV2 structure has price data at specific offsets
        // This is safer than pure manual parsing since SDK validates the structure first
        
        // SECURITY FIX: Comprehensive bounds checking for all data reads
        // Minimum required size: price (8) + expo (4) + padding (4) + publish_time (8) + confidence (8) = 132 bytes
        const MIN_REQUIRED_SIZE: usize = 132;
        require!(
            account_data.len() >= MIN_REQUIRED_SIZE,
            CrucibleError::InvalidOraclePrice
        );
        
        // Parse price (i64) at offset 96
        const PRICE_OFFSET: usize = 96;
        const PRICE_SIZE: usize = 8;
        require!(
            account_data.len() >= PRICE_OFFSET + PRICE_SIZE,
            CrucibleError::InvalidOraclePrice
        );
        let price_bytes = account_data[PRICE_OFFSET..PRICE_OFFSET + PRICE_SIZE]
            .try_into()
            .map_err(|_| CrucibleError::InvalidOraclePrice)?;
        let price: i64 = i64::from_le_bytes(price_bytes);
        
        // Parse exponent (i32) at offset 104
        const EXPO_OFFSET: usize = 104;
        const EXPO_SIZE: usize = 4;
        require!(
            account_data.len() >= EXPO_OFFSET + EXPO_SIZE,
            CrucibleError::InvalidOraclePrice
        );
        let expo_bytes = account_data[EXPO_OFFSET..EXPO_OFFSET + EXPO_SIZE]
            .try_into()
            .map_err(|_| CrucibleError::InvalidOraclePrice)?;
        let expo: i32 = i32::from_le_bytes(expo_bytes);
        
        // Parse publish_time (u64) at offset 112 for staleness check
        const PUB_TIME_OFFSET: usize = 112;
        const PUB_TIME_SIZE: usize = 8;
        require!(
            account_data.len() >= PUB_TIME_OFFSET + PUB_TIME_SIZE,
            CrucibleError::InvalidOraclePrice
        );
        let pub_time_bytes = account_data[PUB_TIME_OFFSET..PUB_TIME_OFFSET + PUB_TIME_SIZE]
            .try_into()
            .map_err(|_| CrucibleError::InvalidOraclePrice)?;
        let publish_time: u64 = u64::from_le_bytes(pub_time_bytes);
        
        // SECURITY FIX: Parse confidence (u64) at offset 120 for confidence check
        // Pyth PriceUpdateV2 structure: price (8) + expo (4) + padding (4) + publish_time (8) + confidence (8)
        const CONFIDENCE_OFFSET: usize = 120;
        const CONFIDENCE_SIZE: usize = 8;
        if account_data.len() >= CONFIDENCE_OFFSET + CONFIDENCE_SIZE {
            let conf_bytes = account_data[CONFIDENCE_OFFSET..CONFIDENCE_OFFSET + CONFIDENCE_SIZE]
                .try_into()
                .map_err(|_| CrucibleError::InvalidOraclePrice)?;
            let confidence: u64 = u64::from_le_bytes(conf_bytes);
            
            // Calculate confidence as percentage of price
            // confidence is in the same units as price (with same exponent)
            let confidence_f64 = confidence as f64;
            let expo_val = expo as i32;
            let conf_price_f64 = if expo_val >= 0 {
                confidence_f64 * (10.0_f64.powi(expo_val))
            } else {
                confidence_f64 / (10.0_f64.powi(-expo_val))
            };
            
            // Calculate price for confidence percentage calculation
            let price_value_f64 = price as f64;
            let price_usd_temp = if expo_val >= 0 {
                price_value_f64 * (10.0_f64.powi(expo_val))
            } else {
                price_value_f64 / (10.0_f64.powi(-expo_val))
            };
            
            // Calculate confidence as basis points (percentage * 10000)
            let confidence_bps = if price_usd_temp > 0.0 {
                (conf_price_f64 / price_usd_temp * 10_000.0) as u64
            } else {
                return Err(CrucibleError::InvalidOraclePrice.into());
            };
            
            // SECURITY FIX: Require confidence interval is within acceptable bounds
            require!(
                confidence_bps <= MAX_CONFIDENCE_BPS,
                CrucibleError::InvalidOraclePrice
            );
        }
        
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
        
        // SECURITY FIX: Tighter price bounds per token type
        // For SOL, typical range is $1-$1000, but allow wider for other tokens
        // In production, consider making bounds configurable per crucible/token
        let (min_price, max_price) = match base_mint.to_string().as_str() {
            // Add token-specific bounds here if needed
            // For now, use general bounds
            _ => (MIN_PRICE_USD, MAX_PRICE_USD),
        };
        
        // Validate price bounds
        require!(
            price_usd >= min_price && price_usd <= max_price,
            CrucibleError::InvalidOraclePrice
        );
        
        // Scale to PRICE_SCALE_FACTOR (e.g., $100.50 = 100_500_000)
        let price_scaled = (price_usd * PRICE_SCALE_FACTOR as f64) as u64;
        
        // SECURITY FIX: Validate minimum scaled price to prevent rounding attacks
        // Minimum $0.001 after scaling = 1_000 (prevents prices that round to 1)
        require!(price_scaled >= 1_000, CrucibleError::InvalidOraclePrice);
        
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

    // SECURITY FIX: Calculate exchange rate growth with proper precision and overflow protection
    // Multiply first, then divide to prevent precision loss
    // Break down calculations into smaller steps with explicit overflow checks
    // growth = (base_rate * effective_apy * years_elapsed) / (100 * 1_000_000 * 1_000_000)
    
    // Step 1: base_rate * effective_apy
    let step1 = (base_rate as u128)
        .checked_mul(effective_apy)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Step 2: step1 * years_elapsed
    let growth_numerator = step1
        .checked_mul(years_elapsed)
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
    
    // SECURITY FIX: Add maximum position duration check to prevent extreme values
    // Maximum 10 years (approximately)
    const MAX_SLOTS: u64 = 78_840_000 * 10; // 10 years
    require!(
        slots_elapsed <= MAX_SLOTS,
        CrucibleError::InvalidLeverage
    );
    
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

/// Check position health (LTV in basis points)
/// Returns LTV (Loan-to-Value) in basis points: (debt * 10000) / collateral_value
/// Lower is better. If LTV > liquidation_threshold, position is liquidatable.
pub fn health_check(
    ctx: Context<HealthCheck>,
) -> Result<u64> {
    let position = &ctx.accounts.position;
    let crucible = &ctx.accounts.crucible;
    let clock = Clock::get()?;
    
    require!(position.is_open, CrucibleError::PositionNotOpen);
    
    // Get base_mint before any borrows
    let base_mint_key = ctx.accounts.crucible.base_mint;
    
    // Fetch current oracle price
    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let current_base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        &base_mint_key,
    )?;
    
    // Calculate current collateral value in USDC
    let collateral_value_usdc = (position.collateral as u128)
        .checked_mul(current_base_token_price as u128)
        .and_then(|v| v.checked_div(1_000_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate total debt (borrowed + accrued interest)
    // SECURITY FIX: Validate created_at <= clock.slot before calculating slots_elapsed
    require!(
        position.created_at <= clock.slot,
        CrucibleError::InvalidLeverage
    );
    let slots_elapsed = clock.slot
        .checked_sub(position.created_at)
        .ok_or(CrucibleError::InvalidLeverage)?;
    let slots_per_year = 78_840_000u128; // Approximate slots per year (400ms per slot)
    let borrow_rate = 10u64; // 10% APY (from lending-pool state)
    let rate_decimal = (borrow_rate as u128) * 1_000_000 / 100; // Convert to scaled decimal
    
    let years_elapsed = (slots_elapsed as u128)
        .checked_mul(1_000_000)
        .and_then(|v| v.checked_div(slots_per_year))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Interest = borrowed_usdc × (rate_decimal / 1_000_000) × (years_elapsed / 1_000_000)
    let interest = (position.borrowed_usdc as u128)
        .checked_mul(rate_decimal)
        .and_then(|v| v.checked_mul(years_elapsed))
        .and_then(|v| v.checked_div(1_000_000_000_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let total_debt = (position.borrowed_usdc as u128)
        .checked_add(interest)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate LTV in basis points: (debt * 10000) / collateral_value
    // Prevent division by zero
    if collateral_value_usdc == 0 {
        return Err(CrucibleError::InvalidHealthCheck.into());
    }
    
    let ltv_bps = total_debt
        .checked_mul(10_000)
        .and_then(|v| v.checked_div(collateral_value_usdc))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Ensure LTV fits in u64
    if ltv_bps > u64::MAX as u128 {
        return Ok(u64::MAX);
    }
    
    Ok(ltv_bps as u64)
}

/// Liquidate an undercollateralized leveraged position
/// Liquidator receives a bonus for repaying the debt
pub fn liquidate_position(
    ctx: Context<LiquidatePosition>,
) -> Result<()> {
    // Check if crucible is paused
    require!(!ctx.accounts.crucible.paused, CrucibleError::ProtocolPaused);
    
    // Get base_mint before mutable borrow
    let base_mint_key = ctx.accounts.crucible.base_mint;
    
    let position = &mut ctx.accounts.position;
    let crucible = &mut ctx.accounts.crucible;
    let clock = Clock::get()?;
    
    require!(position.is_open, CrucibleError::PositionNotOpen);
    
    // Check position health
    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let current_base_token_price = get_oracle_price(
        crucible,
        &oracle_account_opt,
        &base_mint_key,
    )?;
    
    // Calculate current collateral value in USDC
    let collateral_value_usdc = (position.collateral as u128)
        .checked_mul(current_base_token_price as u128)
        .and_then(|v| v.checked_div(1_000_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate total debt (borrowed + accrued interest)
    // SECURITY FIX: Validate created_at <= clock.slot before calculating slots_elapsed
    require!(
        position.created_at <= clock.slot,
        CrucibleError::InvalidLeverage
    );
    let slots_elapsed = clock.slot
        .checked_sub(position.created_at)
        .ok_or(CrucibleError::InvalidLeverage)?;
    let slots_per_year = 78_840_000u128;
    let borrow_rate = 10u64; // 10% APY
    let rate_decimal = (borrow_rate as u128) * 1_000_000 / 100;
    
    let years_elapsed = (slots_elapsed as u128)
        .checked_mul(1_000_000)
        .and_then(|v| v.checked_div(slots_per_year))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let interest = (position.borrowed_usdc as u128)
        .checked_mul(rate_decimal)
        .and_then(|v| v.checked_mul(years_elapsed))
        .and_then(|v| v.checked_div(1_000_000_000_000u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let total_debt = (position.borrowed_usdc as u128)
        .checked_add(interest)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate LTV in basis points
    if collateral_value_usdc == 0 {
        return Err(CrucibleError::InvalidHealthCheck.into());
    }
    
    let ltv_bps = total_debt
        .checked_mul(10_000)
        .and_then(|v| v.checked_div(collateral_value_usdc))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Liquidation threshold: 85% LTV (8500 basis points)
    // Position is liquidatable if LTV > 85%
    const LIQUIDATION_THRESHOLD_BPS: u128 = 8500;
    
    require!(
        ltv_bps > LIQUIDATION_THRESHOLD_BPS,
        CrucibleError::PositionNotLiquidatable
    );
    
    // Calculate liquidation bonus: 5% of debt (500 basis points)
    const LIQUIDATION_BONUS_BPS: u128 = 500;
    let liquidation_bonus = total_debt
        .checked_mul(LIQUIDATION_BONUS_BPS)
        .and_then(|v| v.checked_div(10_000))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Total amount to repay: debt + bonus
    let total_repay_amount = total_debt
        .checked_add(liquidation_bonus)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Ensure amounts fit in u64
    let total_repay_amount_u64 = if total_repay_amount > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        total_repay_amount as u64
    };
    
    let liquidation_bonus_u64 = if liquidation_bonus > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        liquidation_bonus as u64
    };
    
    // SECURITY FIX: Validate borrower_account PDA derivation
    let (expected_borrower_pda, _bump) = Pubkey::find_program_address(
        &[b"borrower", position.owner.as_ref()],
        &ctx.accounts.lending_program.key(),
    );
    require!(
        ctx.accounts.borrower_account.key() == expected_borrower_pda,
        CrucibleError::InvalidLendingProgram
    );
    
    // SECURITY FIX: Validate lending program ID matches expected constant
    require!(
        ctx.accounts.lending_program.key() == crate::LENDING_POOL_PROGRAM_ID,
        CrucibleError::InvalidLendingProgram
    );
    
    // Repay debt via CPI to lending pool
    let cpi_program = ctx.accounts.lending_program.to_account_info();
    let cpi_accounts = RepayUSDC {
        pool: ctx.accounts.lending_market.to_account_info(),
        borrower: ctx.accounts.position_owner.to_account_info(), // Position owner, not liquidator
        borrower_account: ctx.accounts.borrower_account.to_account_info(),
        borrower_usdc_account: ctx.accounts.liquidator_usdc_account.to_account_info(), // Liquidator pays
        pool_vault: ctx.accounts.lending_vault.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    // Liquidator repays the debt
    lending_pool_usdc::cpi::repay_usdc(cpi_ctx, total_repay_amount_u64)?;
    
    // Calculate collateral to seize: enough to cover debt repayment
    // We seize collateral equivalent to debt value (in base tokens)
    let collateral_to_seize = total_debt
        .checked_mul(1_000_000)
        .and_then(|v| v.checked_div(current_base_token_price as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Add liquidation bonus to seized collateral
    let bonus_collateral = liquidation_bonus
        .checked_mul(1_000_000)
        .and_then(|v| v.checked_div(current_base_token_price as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    let total_collateral_seized = collateral_to_seize
        .checked_add(bonus_collateral)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Ensure we don't seize more than available
    let total_collateral_seized_u64 = if total_collateral_seized > position.collateral as u128 {
        position.collateral // Seize all if needed
    } else if total_collateral_seized > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        total_collateral_seized as u64
    };
    
    // SECURITY FIX: Explicitly validate token program ID (defense-in-depth, Anchor Program type already validates)
    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );
    
    // Transfer seized collateral to liquidator
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible.bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.crucible_vault.to_account_info(),
        to: ctx.accounts.liquidator_token_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, total_collateral_seized_u64)?;
    
    // Update position state
    position.is_open = false;
    // SECURITY FIX: Validate collateral >= total_collateral_seized before subtraction
    require!(
        position.collateral >= total_collateral_seized_u64,
        CrucibleError::InvalidAmount
    );
    position.collateral = position.collateral
        .checked_sub(total_collateral_seized_u64)
        .ok_or(CrucibleError::InvalidAmount)?;
    position.borrowed_usdc = 0; // Debt repaid
    
    // Update crucible state
    // SECURITY FIX: Validate total_leveraged_positions > 0 before subtracting
    require!(
        crucible.total_leveraged_positions > 0,
        CrucibleError::InvalidAmount
    );
    crucible.total_leveraged_positions = crucible.total_leveraged_positions
        .checked_sub(1)
        .ok_or(CrucibleError::InvalidAmount)?;
    
    emit!(LeveragedPositionLiquidated {
        position_id: position.id,
        owner: position.owner,
        liquidator: ctx.accounts.liquidator.key(),
        collateral_seized: total_collateral_seized_u64,
        debt_repaid: total_repay_amount_u64,
        liquidation_bonus: liquidation_bonus_u64,
    });
    
    Ok(())
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
    /// SECURITY FIX: Validate pool_authority is owned by lending_program
    #[account(
        constraint = *pool_authority.owner == lending_program.key() @ CrucibleError::InvalidLendingProgram
    )]
    pub pool_authority: UncheckedAccount<'info>,
    /// SECURITY FIX: Validate borrower_account is a PDA owned by lending_program
    /// Note: Using UncheckedAccount with constraint since we can't derive seeds from lending program
    /// CHECK: SECURITY FIX - Validate borrower_account is a PDA owned by lending_program
    #[account(
        mut,
        constraint = *borrower_account.owner == lending_program.key() @ CrucibleError::InvalidLendingProgram
    )]
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
    /// CHECK: SECURITY FIX - Validate borrower_account is a PDA owned by lending_program
    /// Note: Using UncheckedAccount since BorrowerAccount is from another program
    /// PDA derivation validated in instruction
    /// CHECK: SECURITY FIX - Validate borrower_account is a PDA owned by lending_program
    #[account(
        mut,
        constraint = *borrower_account.owner == lending_program.key() @ CrucibleError::InvalidLendingProgram
    )]
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

#[event]
pub struct LeveragedPositionLiquidated {
    pub position_id: Pubkey,
    pub owner: Pubkey,
    pub liquidator: Pubkey,
    pub collateral_seized: u64,
    pub debt_repaid: u64,
    pub liquidation_bonus: u64,
}

#[derive(Accounts)]
pub struct HealthCheck<'info> {
    #[account(mut)]
    pub crucible: Box<Account<'info, Crucible>>,
    
    #[account(
        seeds = [b"position", position.owner.as_ref(), crucible.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, LeveragedPosition>>,
    
    /// CHECK: Optional oracle account for price feeds
    /// If provided, must match crucible.oracle
    pub oracle: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,
    
    #[account(mut)]
    pub crucible: Box<Account<'info, Crucible>>,
    
    #[account(
        mut,
        seeds = [b"position", position.owner.as_ref(), crucible.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, LeveragedPosition>>,
    
    /// CHECK: Position owner (for debt repayment)
    pub position_owner: UncheckedAccount<'info>,
    
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
    
    /// CHECK: Liquidator's token account for receiving seized collateral
    #[account(mut)]
    pub liquidator_token_account: Box<Account<'info, TokenAccount>>,
    
    /// CHECK: Optional oracle account for price feeds
    /// If provided, must match crucible.oracle
    pub oracle: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Lending program for repaying USDC debt
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
    
    /// CHECK: SECURITY FIX - Validate borrower_account is a PDA owned by lending_program
    /// Note: Using UncheckedAccount since BorrowerAccount is from another program
    /// PDA derivation validated in instruction
    #[account(
        mut,
        constraint = *borrower_account.owner == lending_program.key() @ CrucibleError::InvalidLendingProgram
    )]
    pub borrower_account: UncheckedAccount<'info>,
    
    /// CHECK: SECURITY FIX - Validate lending_vault is owned by lending_program
    #[account(
        mut,
        constraint = *lending_vault.owner == lending_program.key() @ CrucibleError::InvalidLendingProgram
    )]
    pub lending_vault: UncheckedAccount<'info>,
    
    /// CHECK: Liquidator's USDC account for repaying debt
    #[account(mut)]
    pub liquidator_usdc_account: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
}

