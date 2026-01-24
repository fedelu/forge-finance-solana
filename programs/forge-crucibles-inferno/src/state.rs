use anchor_lang::prelude::*;

#[account]
pub struct InfernoCrucible {
    pub base_mint: Pubkey,
    pub lp_token_mint: Pubkey,
    pub vault: Pubkey,
    pub usdc_vault: Pubkey,
    pub vault_bump: u8,
    pub bump: u8,
    pub total_lp_token_supply: u64,
    pub total_lp_positions: u64,
    pub exchange_rate: u64, // Scaled by 1_000_000 (1.0 = 1_000_000)
    pub last_update_slot: u64,
    pub fee_rate: u64, // Fee rate (e.g., 200 = 0.2% = 2 bps)
    pub paused: bool,
    pub expected_vault_balance: u64,
    pub expected_usdc_vault_balance: u64,
    pub oracle: Option<Pubkey>,
    pub treasury_base: Pubkey,
    pub treasury_usdc: Pubkey,
    pub total_fees_accrued: u64,
}

#[account]
pub struct InfernoLPPositionAccount {
    pub position_id: u64,
    pub owner: Pubkey,
    pub crucible: Pubkey,
    pub base_mint: Pubkey,
    pub base_amount: u64,
    pub usdc_amount: u64,
    pub borrowed_usdc: u64,
    pub leverage_factor: u64, // 100 = 1x, 150 = 1.5x, 200 = 2x
    pub entry_price: u64, // Entry price in USDC (scaled by 1M)
    pub created_at: u64,
    pub is_open: bool,
    pub bump: u8,
}

impl InfernoLPPositionAccount {
    pub const LEN: usize = 8 + // discriminator
        8 +  // position_id
        32 + // owner
        32 + // crucible
        32 + // base_mint
        8 +  // base_amount
        8 +  // usdc_amount
        8 +  // borrowed_usdc
        8 +  // leverage_factor
        8 +  // entry_price
        8 +  // created_at
        1 +  // is_open
        1;   // bump
}

impl InfernoCrucible {
    pub const LEN: usize = 8 + // discriminator
        32 + // base_mint
        32 + // lp_token_mint
        32 + // vault
        32 + // usdc_vault
        1 +  // vault_bump
        1 +  // bump
        8 +  // total_lp_token_supply
        8 +  // total_lp_positions
        8 +  // exchange_rate
        8 +  // last_update_slot
        8 +  // fee_rate
        1 +  // paused
        8 +  // expected_vault_balance
        8 +  // expected_usdc_vault_balance
        1 +  // oracle option discriminator
        32 + // oracle pubkey (if Some)
        32 + // treasury_base
        32 + // treasury_usdc
        8;   // total_fees_accrued
}

#[error_code]
pub enum InfernoCrucibleError {
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
    #[msg("Invalid LP amounts - must be equal value")]
    InvalidLPAmounts,
    #[msg("Position not found")]
    PositionNotFound,
    #[msg("Vault balance mismatch - potential manipulation detected")]
    VaultBalanceMismatch,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Oracle price is stale")]
    StaleOraclePrice,
    #[msg("Invalid oracle price")]
    InvalidOraclePrice,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Invalid treasury account")]
    InvalidTreasury,
    #[msg("Invalid lending program")]
    InvalidLendingProgram,
    #[msg("Invalid mint account")]
    InvalidMint,
    #[msg("Invalid metadata account")]
    InvalidMetadataAccount,
    #[msg("Invalid program")]
    InvalidProgram,
    #[msg("Invalid amount - must be greater than zero")]
    InvalidAmount,
    #[msg("Invalid configuration")]
    InvalidConfig,
    #[msg("Invalid borrower account")]
    InvalidBorrower,
    #[msg("Repay amount exceeds debt")]
    RepayAmountExceedsDebt,
    #[msg("Position is not liquidatable")]
    PositionNotLiquidatable,
}
