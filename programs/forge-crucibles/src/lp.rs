use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer, MintTo, Burn};

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

// Old format crucible size: 244 bytes total (8 discriminator + 236 struct)
// New format crucible size: 276 bytes total (8 discriminator + 268 struct)
const OLD_FORMAT_SIZE: usize = 244;
const NEW_FORMAT_SIZE: usize = 276;

/// Manually deserialize old format crucible account
/// Old format doesn't have: lp_token_mint, total_lp_token_supply, oracle, treasury, total_fees_accrued
fn deserialize_old_format_crucible(
    data: &[u8],
    ctoken_mint: Pubkey, // Use ctoken_mint as placeholder for lp_token_mint
    treasury: Pubkey, // Use passed treasury account
) -> Result<Crucible> {
    require!(data.len() >= 8, CrucibleError::InvalidConfig);
    
    let mut offset = 8; // Skip discriminator
    
    // Read base_mint (32 bytes)
    require!(data.len() >= offset + 32, CrucibleError::InvalidConfig);
    let base_mint = Pubkey::try_from(&data[offset..offset+32])
        .map_err(|_| CrucibleError::InvalidConfig)?;
    offset += 32;
    
    // Read ctoken_mint (32 bytes) - already passed as parameter, but read for validation
    require!(data.len() >= offset + 32, CrucibleError::InvalidConfig);
    let _ctoken_mint_read = Pubkey::try_from(&data[offset..offset+32])
        .map_err(|_| CrucibleError::InvalidConfig)?;
    require!(_ctoken_mint_read == ctoken_mint, CrucibleError::InvalidConfig);
    offset += 32;
    
    // Old format: no lp_token_mint, use ctoken_mint as placeholder
    let lp_token_mint = ctoken_mint;
    
    // Read vault (32 bytes)
    require!(data.len() >= offset + 32, CrucibleError::InvalidConfig);
    let vault = Pubkey::try_from(&data[offset..offset+32])
        .map_err(|_| CrucibleError::InvalidConfig)?;
    offset += 32;
    
    // Read vault_bump (1 byte)
    require!(data.len() >= offset + 1, CrucibleError::InvalidConfig);
    let vault_bump = data[offset];
    offset += 1;
    
    // Read bump (1 byte)
    require!(data.len() >= offset + 1, CrucibleError::InvalidConfig);
    let bump = data[offset];
    offset += 1;
    
    // Read total_base_deposited (8 bytes)
    require!(data.len() >= offset + 8, CrucibleError::InvalidConfig);
    let total_base_deposited = u64::from_le_bytes(
        data[offset..offset+8].try_into().map_err(|_| CrucibleError::InvalidConfig)?
    );
    offset += 8;
    
    // Read total_ctoken_supply (8 bytes)
    require!(data.len() >= offset + 8, CrucibleError::InvalidConfig);
    let total_ctoken_supply = u64::from_le_bytes(
        data[offset..offset+8].try_into().map_err(|_| CrucibleError::InvalidConfig)?
    );
    offset += 8;
    
    // Old format: no total_lp_token_supply, default to 0
    let total_lp_token_supply = 0u64;
    
    // Read exchange_rate (8 bytes)
    require!(data.len() >= offset + 8, CrucibleError::InvalidConfig);
    let exchange_rate = u64::from_le_bytes(
        data[offset..offset+8].try_into().map_err(|_| CrucibleError::InvalidConfig)?
    );
    offset += 8;
    
    // Read last_update_slot (8 bytes)
    require!(data.len() >= offset + 8, CrucibleError::InvalidConfig);
    let last_update_slot = u64::from_le_bytes(
        data[offset..offset+8].try_into().map_err(|_| CrucibleError::InvalidConfig)?
    );
    offset += 8;
    
    // Read fee_rate (8 bytes)
    require!(data.len() >= offset + 8, CrucibleError::InvalidConfig);
    let fee_rate = u64::from_le_bytes(
        data[offset..offset+8].try_into().map_err(|_| CrucibleError::InvalidConfig)?
    );
    offset += 8;
    
    // Read paused (1 byte)
    require!(data.len() >= offset + 1, CrucibleError::InvalidConfig);
    let paused = data[offset] != 0;
    offset += 1;
    
    // Read total_leveraged_positions (8 bytes)
    require!(data.len() >= offset + 8, CrucibleError::InvalidConfig);
    let total_leveraged_positions = u64::from_le_bytes(
        data[offset..offset+8].try_into().map_err(|_| CrucibleError::InvalidConfig)?
    );
    offset += 8;
    
    // Read total_lp_positions (8 bytes)
    require!(data.len() >= offset + 8, CrucibleError::InvalidConfig);
    let total_lp_positions = u64::from_le_bytes(
        data[offset..offset+8].try_into().map_err(|_| CrucibleError::InvalidConfig)?
    );
    offset += 8;
    
    // Read expected_vault_balance (8 bytes)
    require!(data.len() >= offset + 8, CrucibleError::InvalidConfig);
    let expected_vault_balance = u64::from_le_bytes(
        data[offset..offset+8].try_into().map_err(|_| CrucibleError::InvalidConfig)?
    );
    offset += 8;
    
    // Old format: no oracle, treasury, total_fees_accrued
    let oracle: Option<Pubkey> = None;
    let total_fees_accrued = 0u64;
    
    Ok(Crucible {
        base_mint,
        ctoken_mint,
        lp_token_mint,
        vault,
        vault_bump,
        bump,
        total_base_deposited,
        total_ctoken_supply,
        total_lp_token_supply,
        exchange_rate,
        last_update_slot,
        fee_rate,
        paused,
        total_leveraged_positions,
        total_lp_positions,
        expected_vault_balance,
        oracle,
        treasury,
        total_fees_accrued,
    })
}

pub fn open_lp_position(
    ctx: Context<OpenLPPosition>,
    base_amount: u64,
    usdc_amount: u64,
    max_slippage_bps: u64, // Maximum slippage in basis points (e.g., 100 = 1%)
    position_nonce: u64, // Nonce to allow multiple positions per user
) -> Result<u64> {
    // #region agent log
    msg!("[DEBUG] open_lp_position: entry - base_amount={}, usdc_amount={}, max_slippage_bps={}", base_amount, usdc_amount, max_slippage_bps);
    msg!("[DEBUG] crucible key: {}", ctx.accounts.crucible.key());
    msg!("[DEBUG] user key: {}", ctx.accounts.user.key());
    msg!("[DEBUG] position key: {}", ctx.accounts.position.key());
    msg!("[DEBUG] base_mint key: {}", ctx.accounts.base_mint.key());
    // #endregion
    
    require!(
        max_slippage_bps <= 10_000 &&
        base_amount >= MIN_LP_BASE_AMOUNT && base_amount <= MAX_LP_BASE_AMOUNT &&
        usdc_amount >= MIN_LP_USDC_AMOUNT && usdc_amount <= MAX_LP_USDC_AMOUNT,
        CrucibleError::InvalidAmount
    );
    
    // #region agent log
    msg!("[DEBUG] Amount validation passed");
    // #endregion
    
    // Manually deserialize crucible account to handle old and new formats
    let crucible_data = ctx.accounts.crucible.try_borrow_data()?;
    
    // #region agent log
    let crucible_data_len = crucible_data.len();
    let expected_len = 8 + Crucible::LEN; // discriminator + struct size
    msg!("[DEBUG] crucible_data length: {}, expected: {}", crucible_data_len, expected_len);
    // #endregion
    
    // SECURITY FIX: Check bounds before slicing to prevent access violations
    if crucible_data_len < 8 {
        msg!("[DEBUG] ERROR: crucible_data too small (< 8 bytes)");
        return Err(CrucibleError::InvalidConfig.into());
    }
    
    // Detect format: old format is 244 bytes, new format is 276 bytes
    let is_old_format = crucible_data_len < NEW_FORMAT_SIZE;
    
    // #region agent log
    msg!("[DEBUG] Format detection: is_old_format={}, data_len={}", is_old_format, crucible_data_len);
    // #endregion
    
    let mut crucible: Crucible;
    
    if is_old_format {
        // OLD FORMAT: Manually read fields
        msg!("[DEBUG] Reading old format crucible manually");
        
        require!(
            crucible_data_len >= OLD_FORMAT_SIZE,
            CrucibleError::InvalidConfig
        );
        
        // Get ctoken_mint from accounts to use as placeholder for lp_token_mint
        let ctoken_mint = ctx.accounts.crucible.key(); // We'll read it from data
        // Actually, we need to read ctoken_mint from the data first
        // Let's read it temporarily to get the value
        require!(crucible_data_len >= 8 + 32 + 32, CrucibleError::InvalidConfig);
        let ctoken_mint_from_data = Pubkey::try_from(&crucible_data[8+32..8+32+32])
            .map_err(|_| CrucibleError::InvalidConfig)?;
        
        // Use treasury_base as treasury for old format
        let treasury = ctx.accounts.treasury_base.key();
        
        crucible = deserialize_old_format_crucible(
            &crucible_data,
            ctoken_mint_from_data,
            treasury,
        )?;
        
        msg!("[DEBUG] Old format crucible read successfully, using passed lp_token_mint account");
    } else {
        // NEW FORMAT: Deserialize normally
        msg!("[DEBUG] Attempting to deserialize new format crucible account...");
        
        crucible = Crucible::try_deserialize(&mut &crucible_data[8..])
            .map_err(|e| {
                msg!("[DEBUG] ERROR: Crucible deserialization failed: {:?}", e);
                CrucibleError::InvalidConfig
            })?;
        
        msg!("[DEBUG] New format crucible deserialized successfully");
    }
    
    // Check if crucible is paused
    require!(!crucible.paused, CrucibleError::ProtocolPaused);
    
    // Handle old format crucibles: if lp_token_mint equals ctoken_mint, use the passed lp_token_mint account
    // This allows old crucibles to work with LP positions by passing the LP token mint separately
    let crucible_lp_mint = if crucible.lp_token_mint == crucible.ctoken_mint {
        // Old format: use the LP token mint from accounts (must be passed)
        ctx.accounts.lp_token_mint.key()
    } else {
        // New format: use the LP token mint from crucible account
        crucible.lp_token_mint
    };
    
    // Validate that the passed LP token mint matches what we expect
    require!(
        ctx.accounts.lp_token_mint.key() == crucible_lp_mint,
        CrucibleError::InvalidConfig
    );
    let clock = Clock::get()?;

    // Get base token price from oracle
    // SAFETY: Handle optional oracle account safely to prevent access violations
    let oracle_account_opt = match (crucible.oracle, ctx.accounts.oracle.as_ref()) {
        (Some(crucible_oracle), Some(oracle_acc)) => {
            // Validate the oracle account matches what crucible expects
            require!(
                oracle_acc.key() == crucible_oracle,
                CrucibleError::InvalidOraclePrice
            );
            // SAFETY: Only access account data if account is valid
            // UncheckedAccount doesn't validate account data, so we need to be careful
            // We'll pass the account info to get_oracle_price which will handle validation
            Some(oracle_acc.as_ref())
        }
        (Some(_), None) => {
            // Crucible expects an oracle but none was provided
            return Err(CrucibleError::InvalidOraclePrice.into());
        }
        (None, _) => {
            // Crucible doesn't have an oracle configured, oracle account should be None
            None
        }
    };
    
    let base_token_price = get_oracle_price(
        &crucible,
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

    // Note: tolerance calculation removed - using direct slippage calculation below
    let _tolerance = base_value
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
    // Protocol fee share is calculated per-token below, not needed here
    let _protocol_fee_share = open_fee_usdc
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

    // Calculate LP tokens to mint using constant product formula: sqrt(base_value * usdc_value)
    // Both values are in USDC (base_value already converted)
    // Use integer square root: sqrt(x) ≈ x / sqrt(x) for large numbers, but for exact we use:
    // sqrt(a * b) where a and b are in USDC units (scaled by 1e6)
    // To maintain precision, we calculate: sqrt((base_value * usdc_value) / 1e6) * 1e3
    // This gives us LP tokens with 9 decimals (same as base token)
    let product = base_value
        .checked_mul(usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate integer square root using Newton's method
    // Start with an initial guess
    if product == 0 {
        return Err(CrucibleError::InvalidAmount.into());
    }
    let mut guess = product;
    let mut prev_guess = 0u128;
    // Newton's method: x_new = (x + n/x) / 2
    while guess != prev_guess {
        prev_guess = guess;
        let quotient = product.checked_div(guess).ok_or(ProgramError::ArithmeticOverflow)?;
        guess = (guess.checked_add(quotient).ok_or(ProgramError::ArithmeticOverflow)?) / 2;
    }
    let sqrt_product = guess;
    
    // Scale to LP tokens with 9 decimals
    // base_value and usdc_value are in USDC (6 decimals), product has 12 decimals
    // sqrt(product) has 6 decimals, scale to 9 decimals: multiply by 1000
    let lp_tokens_scaled = sqrt_product
        .checked_mul(1_000u128) // Scale up to 9 decimals
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Ensure LP tokens fit in u64
    let lp_tokens_to_mint = if lp_tokens_scaled > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        lp_tokens_scaled as u64
    };

    // Mint LP tokens to user
    // Get bump from context (populated by account constraint)
    let crucible_bump = ctx.bumps.crucible;
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible_bump],
    ];
    let signer = &[&seeds[..]];
    
    // Mint LP tokens to user
    // For old format crucibles, we need to use the crucible PDA as mint authority
    // For new format, the crucible PDA is already the mint authority
    let mint_to_accounts = MintTo {
        mint: ctx.accounts.lp_token_mint.to_account_info(),
        to: ctx.accounts.user_lp_token_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let mint_to_program = ctx.accounts.token_program.to_account_info();
    let mint_to_ctx = CpiContext::new_with_signer(mint_to_program, mint_to_accounts, signer);
    token::mint_to(mint_to_ctx, lp_tokens_to_mint)?;
    
    // #region agent log
    msg!("[DEBUG] LP tokens minted: {} to user {}", lp_tokens_to_mint, ctx.accounts.user.key());
    // #endregion

    // #region agent log
    msg!("[DEBUG] Initializing position account...");
    msg!("[DEBUG] position_id: {}, bump: {}", position_id, ctx.bumps.position);
    // #endregion
    
    // Initialize position account
    let position = &mut ctx.accounts.position;
    
    // #region agent log
    msg!("[DEBUG] Position account mutable reference obtained");
    // #endregion
    
    position.position_id = position_id;
    position.owner = ctx.accounts.user.key();
    position.crucible = ctx.accounts.crucible.key();
    position.base_mint = ctx.accounts.base_mint.key();
    position.base_amount = net_base_amount;
    position.usdc_amount = net_usdc_amount;
    position.entry_price = base_token_price;
    position.entry_exchange_rate = crucible.exchange_rate; // Store exchange rate at entry for yield calculation
    position.created_at = clock.slot;
    position.is_open = true;
    position.bump = ctx.bumps.position;
    position.nonce = position_nonce; // Store nonce for PDA derivation
    
    // #region agent log
    msg!("[DEBUG] Position account fields set successfully");
    // #endregion

    // Update crucible state and track fees
    crucible.total_lp_positions = position_id;
    crucible.total_lp_token_supply = crucible
        .total_lp_token_supply
        .checked_add(lp_tokens_to_mint)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Track vault fee share in total fees accrued (for base token crucible)
    // Note: USDC fees go to USDC vault, not base token crucible vault
    // For analytics, we could track separately, but for now just track base fees
    if vault_fee_base > 0 {
        crucible.total_fees_accrued = crucible
            .total_fees_accrued
            .checked_add(vault_fee_base)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }
    
    // Update stored exchange rate for frontend yield tracking
    // Use total_ctoken_supply from mint (which we can estimate from base deposits)
    // For LP positions, exchange rate reflects fee growth
    let tracked_balance = (crucible.total_base_deposited as u128)
        .checked_add(crucible.total_fees_accrued as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    // Estimate cToken supply proportional to base deposited (assuming 1:1 at start)
    if crucible.total_ctoken_supply > 0 {
        let new_exchange_rate = tracked_balance
            .checked_mul(1_000_000u128)
            .and_then(|scaled| scaled.checked_div(crucible.total_ctoken_supply as u128))
            .and_then(|rate| if rate > u64::MAX as u128 { None } else { Some(rate as u64) })
            .ok_or(ProgramError::ArithmeticOverflow)?;
        crucible.exchange_rate = new_exchange_rate;
    }
    
    // Serialize crucible back to account data
    let mut crucible_data = ctx.accounts.crucible.try_borrow_mut_data()?;
    let mut crucible_slice = &mut crucible_data[8..]; // Skip discriminator
    crucible.serialize(&mut crucible_slice)?;
    
    // SECURITY FIX: Emit event for LP position opening
    emit!(LPPositionOpened {
        position_id,
        owner: ctx.accounts.user.key(),
        crucible: ctx.accounts.crucible.key(),
        base_mint: ctx.accounts.base_mint.key(),
        base_amount: net_base_amount,
        usdc_amount: net_usdc_amount,
        entry_price: base_token_price,
        entry_exchange_rate: crucible.exchange_rate, // Store for yield tracking
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
    position_nonce: u64, // Nonce used when opening the position
) -> Result<()> {
    require!(
        max_slippage_bps <= 10_000,
        CrucibleError::InvalidAmount
    );
    
    // Manually deserialize crucible account to handle old and new formats
    let crucible_data = ctx.accounts.crucible.try_borrow_data()?;
    let crucible_data_len = crucible_data.len();
    
    // Detect format: old format is 244 bytes, new format is 276 bytes
    let is_old_format = crucible_data_len < NEW_FORMAT_SIZE;
    
    let mut crucible: Crucible;
    
    if is_old_format {
        // OLD FORMAT: Manually read fields
        msg!("[DEBUG] Reading old format crucible manually in close_lp_position");
        
        require!(
            crucible_data_len >= OLD_FORMAT_SIZE,
            CrucibleError::InvalidConfig
        );
        
        // Read ctoken_mint from data
        require!(crucible_data_len >= 8 + 32 + 32, CrucibleError::InvalidConfig);
        let ctoken_mint_from_data = Pubkey::try_from(&crucible_data[8+32..8+32+32])
            .map_err(|_| CrucibleError::InvalidConfig)?;
        
        // Use treasury_base as treasury for old format
        let treasury = ctx.accounts.treasury_base.key();
        
        crucible = deserialize_old_format_crucible(
            &crucible_data,
            ctoken_mint_from_data,
            treasury,
        )?;
        
        msg!("[DEBUG] Old format crucible read successfully in close_lp_position");
    } else {
        // NEW FORMAT: Deserialize normally
        crucible = Crucible::try_deserialize(&mut &crucible_data[8..])
            .map_err(|_| CrucibleError::InvalidConfig)?;
    }
    
    // Check if crucible is paused
    require!(!crucible.paused, CrucibleError::ProtocolPaused);
    
    let position = &mut ctx.accounts.position;
    
    // Read crucible LP token mint before we use it later (after mutable operations)
    // For old format, use the passed lp_token_mint account
    let crucible_lp_mint = if crucible.lp_token_mint == crucible.ctoken_mint {
        // Old format: use the LP token mint from accounts (must be passed)
        ctx.accounts.lp_token_mint.key()
    } else {
        // New format: use the LP token mint from crucible account
        crucible.lp_token_mint
    };

    // Validate position exists and is open
    require!(position.is_open, CrucibleError::PositionNotOpen);
    require!(position.owner == ctx.accounts.user.key(), CrucibleError::Unauthorized);
    require!(position.crucible == ctx.accounts.crucible.key(), CrucibleError::InvalidLPAmounts);

    // SECURITY FIX: Fetch current oracle price and validate slippage
    let base_mint_key = crucible.base_mint;
    
    // Get current base token price from oracle
    let oracle_account_opt = ctx.accounts.oracle.as_ref().map(|o| o.as_ref());
    let current_base_token_price = get_oracle_price(
        &crucible,
        &oracle_account_opt,
        &ctx.accounts.base_mint.key(),
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
    
    // Calculate initial position value using entry price
    let initial_base_value = (position.base_amount as u128)
        .checked_mul(position.entry_price as u128)
        .and_then(|v| v.checked_div(PRICE_SCALE as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let initial_usdc_value = position.usdc_amount as u128;
    let initial_total_value = initial_base_value
        .checked_add(initial_usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate REAL yield from exchange rate growth
    // Exchange rate grows as fees are deposited into the vault
    // Yield = position_value * (current_exchange_rate - entry_exchange_rate) / entry_exchange_rate
    let entry_exchange_rate = position.entry_exchange_rate;
    let current_exchange_rate = crucible.exchange_rate;
    
    // Calculate exchange rate growth (can be 0 if no growth, never negative in practice)
    let exchange_rate_yield = if current_exchange_rate > entry_exchange_rate {
        // Calculate yield: position_value * rate_growth / entry_rate
        initial_total_value
            .checked_mul((current_exchange_rate - entry_exchange_rate) as u128)
            .and_then(|v| v.checked_div(entry_exchange_rate as u128))
            .unwrap_or(0)
    } else {
        0u128
    };
    
    // Calculate price-based P&L (from SOL price changes)
    let price_pnl = if current_total_value > initial_total_value {
        current_total_value.checked_sub(initial_total_value).unwrap_or(0)
    } else {
        0u128 // No positive price P&L if loss
    };
    
    // Total yield = exchange rate yield (from fees) + price P&L (from price appreciation)
    // Note: For fee calculations, we use the total yield
    let yield_value = exchange_rate_yield
        .checked_add(price_pnl)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    msg!("[DEBUG] Real yield calculation: entry_rate={}, current_rate={}, exchange_rate_yield={}, price_pnl={}, total_yield={}",
         entry_exchange_rate, current_exchange_rate, exchange_rate_yield, price_pnl, yield_value);
    
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

    // INFERNO MODE: Convert USDC to SOL (like cSOL unwrap)
    // Calculate SOL equivalent of USDC to return (after fees)
    // USDC has 6 decimals, base token (SOL) has 9 decimals
    // Convert: (usdc_to_return * PRICE_SCALE) / base_token_price
    let usdc_to_sol_amount = (usdc_to_return as u128)
        .checked_mul(PRICE_SCALE as u128)
        .and_then(|v| v.checked_div(base_token_price as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Ensure it fits in u64
    let usdc_to_sol_amount = if usdc_to_sol_amount > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        usdc_to_sol_amount as u64
    };
    
    // Add converted SOL amount to base_to_return
    // Now user gets all value back as SOL (like cSOL unwrap)
    let total_sol_to_return = base_to_return
        .checked_add(usdc_to_sol_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // SECURITY FIX: Verify vault has enough SOL to cover the total return
    // This prevents transaction failures when vault is depleted
    require!(
        ctx.accounts.crucible_base_vault.amount >= total_sol_to_return + protocol_fee_base,
        CrucibleError::InsufficientLiquidity
    );

    // Transfer base tokens back to user (net amount + converted USDC)
    // INFERNO MODE: User gets all value back as SOL (like cSOL unwrap)
    // Get bump from context (populated by account constraint)
    let crucible_bump = ctx.bumps.crucible;
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible_bump],
    ];
    let signer = &[&seeds[..]];

    require!(
        ctx.accounts.token_program.key() == anchor_spl::token::ID,
        CrucibleError::InvalidProgram
    );
    
    // Transfer total SOL (base + converted USDC) to user
    // This matches cSOL flow: user deposits SOL, gets cSOL, then unwraps to get SOL back
    let cpi_accounts = Transfer {
        from: ctx.accounts.crucible_base_vault.to_account_info(),
        to: ctx.accounts.user_base_token_account.to_account_info(),
        authority: ctx.accounts.crucible_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, total_sol_to_return)?;

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
    
    // INFERNO MODE IMPROVEMENT: Convert USDC to SOL (like cSOL unwrap)
    // Transfer USDC from vault to treasury (we're converting it, not returning it)
    // Protocol fee USDC goes to treasury
    if protocol_fee_usdc > 0 && protocol_fee_usdc <= position.usdc_amount {
        require!(
            ctx.accounts.treasury_usdc.mint == ctx.accounts.user_usdc_account.mint,
            CrucibleError::InvalidTreasury
        );
        
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
    
    // Transfer remaining USDC (after protocol fee) from vault to treasury
    // This USDC is being "converted" to SOL, so we move it to treasury
    // The equivalent SOL amount is already added to total_sol_to_return above
    let usdc_remaining_after_protocol_fee = usdc_to_return
        .checked_sub(protocol_fee_usdc.min(usdc_to_return))
        .ok_or(CrucibleError::InvalidAmount)?;
    
    if usdc_remaining_after_protocol_fee > 0 {
        // Move USDC to treasury (it's being converted to SOL)
        // In a real DEX, you'd swap USDC for SOL, but for simplicity we:
        // 1. Move USDC to treasury (protocol keeps it)
        // 2. Add equivalent SOL amount to base_to_return (already done above)
        // This maintains the value while simplifying the flow
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.crucible_usdc_vault.to_account_info(),
            to: ctx.accounts.treasury_usdc.to_account_info(),
            authority: ctx.accounts.crucible_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, usdc_remaining_after_protocol_fee)?;
    }
    
    // Track vault fee share in total fees accrued (for base token crucible)
    if vault_fee_base > 0 {
        crucible.total_fees_accrued = crucible
            .total_fees_accrued
            .checked_add(vault_fee_base)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }
    
    // Update stored exchange rate for frontend yield tracking
    let tracked_balance = (crucible.total_base_deposited as u128)
        .checked_add(crucible.total_fees_accrued as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if crucible.total_ctoken_supply > 0 {
        let new_exchange_rate = tracked_balance
            .checked_mul(1_000_000u128)
            .and_then(|scaled| scaled.checked_div(crucible.total_ctoken_supply as u128))
            .and_then(|rate| if rate > u64::MAX as u128 { None } else { Some(rate as u64) })
            .ok_or(ProgramError::ArithmeticOverflow)?;
        crucible.exchange_rate = new_exchange_rate;
    }

    // Calculate LP tokens to burn (same formula as mint: sqrt(base_value * usdc_value))
    // Use current position values to calculate proportional LP tokens
    let current_base_value = (position.base_amount as u128)
        .checked_mul(base_token_price as u128)
        .and_then(|v| v.checked_div(PRICE_SCALE as u128))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let current_usdc_value = position.usdc_amount as u128;
    let product = current_base_value
        .checked_mul(current_usdc_value)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    
    // Calculate integer square root
    if product == 0 {
        return Err(CrucibleError::InvalidAmount.into());
    }
    let mut guess = product;
    let mut prev_guess = 0u128;
    while guess != prev_guess {
        prev_guess = guess;
        let quotient = product.checked_div(guess).ok_or(ProgramError::ArithmeticOverflow)?;
        guess = (guess.checked_add(quotient).ok_or(ProgramError::ArithmeticOverflow)?) / 2;
    }
    let sqrt_product = guess;
    let lp_tokens_to_burn_scaled = sqrt_product
        .checked_mul(1_000u128)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let lp_tokens_to_burn = if lp_tokens_to_burn_scaled > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow.into());
    } else {
        lp_tokens_to_burn_scaled as u64
    };

    // Burn LP tokens from user
    // Validate that the passed LP token mint matches what we expect
    // (crucible_lp_mint was already set earlier in the function)
    require!(
        ctx.accounts.lp_token_mint.key() == crucible_lp_mint,
        CrucibleError::InvalidConfig
    );
    
    let burn_accounts = anchor_spl::token::Burn {
        mint: ctx.accounts.lp_token_mint.to_account_info(),
        from: ctx.accounts.user_lp_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let burn_program = ctx.accounts.token_program.to_account_info();
    let burn_ctx = CpiContext::new(burn_program, burn_accounts);
    token::burn(burn_ctx, lp_tokens_to_burn)?;
    
    // #region agent log
    msg!("[DEBUG] LP tokens burned: {} from user {}", lp_tokens_to_burn, ctx.accounts.user.key());
    // #endregion

    // Update crucible LP token supply
    crucible.total_lp_token_supply = crucible
        .total_lp_token_supply
        .checked_sub(lp_tokens_to_burn)
        .ok_or(CrucibleError::InvalidAmount)?;

    // Mark position as closed
    position.is_open = false;

    // SECURITY FIX: Don't decrement total_lp_positions counter
    // This prevents position ID collisions. Positions are stored in PDA accounts
    // with unique addresses, so we don't need to reuse IDs. The counter only
    // tracks the next available ID and should never decrease.
    // crucible.total_lp_positions remains unchanged
    
    // Serialize crucible back to account data
    let mut crucible_data = ctx.accounts.crucible.try_borrow_mut_data()?;
    let mut crucible_slice = &mut crucible_data[8..]; // Skip discriminator
    crucible.serialize(&mut crucible_slice)?;

    // SECURITY FIX: Emit event for LP position closure
    // INFERNO MODE: User gets SOL back (converted from USDC), matching cSOL flow
    emit!(LPPositionClosed {
        position_id: position.position_id,
        owner: position.owner,
        crucible: position.crucible,
        base_amount_returned: total_sol_to_return, // Total SOL returned (base + converted USDC)
        usdc_amount_returned: 0, // USDC was converted to SOL, so 0 returned
        total_fee: total_fee_value as u64,
        yield_earned: yield_value as u64, // Real yield from exchange rate growth + price appreciation
        entry_exchange_rate: position.entry_exchange_rate,
        exit_exchange_rate: crucible.exchange_rate,
    });

    msg!("LP position closed: {} (returned {} SOL total, converted from {} base + {} USDC)", 
         position.position_id, total_sol_to_return, base_to_return, usdc_to_return);
    Ok(())
}

#[derive(Accounts)]
#[instruction(base_amount: u64, usdc_amount: u64, max_slippage_bps: u64, position_nonce: u64)]
pub struct OpenLPPosition<'info> {
    /// CHECK: Crucible account - using UncheckedAccount to handle old account formats
    /// We manually deserialize it in the instruction to handle backward compatibility
    #[account(
        mut,
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
    )]
    pub crucible: UncheckedAccount<'info>,
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
    /// LP Position account - now includes nonce to allow multiple positions per user
    #[account(
        init,
        payer = user,
        space = 8 + LPPositionAccount::LEN,
        seeds = [b"lp_position", user.key().as_ref(), base_mint.key().as_ref(), &position_nonce.to_le_bytes()],
        bump
    )]
    pub position: Box<Account<'info, LPPositionAccount>>,
    /// CHECK: Crucible authority PDA
    /// We derive this from base_mint since crucible is UncheckedAccount
    #[account(
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
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
    pub treasury_base: Box<Account<'info, TokenAccount>>,
    /// Treasury account for USDC
    #[account(
        mut,
        constraint = treasury_usdc.mint == user_usdc_account.mint @ CrucibleError::InvalidTreasury
    )]
    pub treasury_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(max_slippage_bps: u64, position_nonce: u64)]
pub struct CloseLPPosition<'info> {
    /// CHECK: Crucible account - using UncheckedAccount to handle old account formats
    #[account(
        mut,
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
    )]
    pub crucible: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub base_mint: Account<'info, Mint>,
    /// LP Position account - uses nonce for PDA to allow multiple positions
    #[account(
        mut,
        seeds = [b"lp_position", user.key().as_ref(), base_mint.key().as_ref(), &position_nonce.to_le_bytes()],
        bump = position.bump,
        constraint = position.owner == user.key() @ CrucibleError::Unauthorized,
        constraint = position.nonce == position_nonce @ CrucibleError::InvalidPosition,
    )]
    pub position: Box<Account<'info, LPPositionAccount>>,
    #[account(mut)]
    pub user_base_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user_usdc_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: User's LP token account (for burning LP tokens)
    #[account(mut)]
    pub user_lp_token_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: LP token mint (validated to match crucible.lp_token_mint)
    pub lp_token_mint: Account<'info, Mint>,
    #[account(mut)]
    pub crucible_base_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub crucible_usdc_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: Crucible authority PDA
    /// We derive this from base_mint since crucible is UncheckedAccount
    #[account(
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
    )]
    pub crucible_authority: UncheckedAccount<'info>,
    /// CHECK: Optional oracle account for price feeds (required for slippage protection)
    /// If provided, must match crucible.oracle
    pub oracle: Option<UncheckedAccount<'info>>,
    /// SECURITY FIX: Validate treasury_base is a TokenAccount for base_mint
    #[account(
        mut,
        constraint = treasury_base.mint == base_mint.key() @ CrucibleError::InvalidTreasury
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
    pub entry_exchange_rate: u64, // Crucible exchange rate at open for yield tracking
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
    pub yield_earned: u64, // Real yield from exchange rate growth
    pub entry_exchange_rate: u64,
    pub exit_exchange_rate: u64,
}

