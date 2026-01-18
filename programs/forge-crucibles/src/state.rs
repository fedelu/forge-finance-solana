use anchor_lang::prelude::*;

#[account]
pub struct Crucible {
    pub base_mint: Pubkey,
    pub ctoken_mint: Pubkey,
    pub vault: Pubkey,
    pub vault_bump: u8,
    pub bump: u8,
    pub total_base_deposited: u64,
    pub total_ctoken_supply: u64,
    pub exchange_rate: u64, // Scaled by 1_000_000 (1.0 = 1_000_000)
    pub last_update_slot: u64,
    pub fee_rate: u64, // Fee rate (e.g., 200 = 0.2% = 2 bps)
    pub paused: bool,
    pub total_leveraged_positions: u64, // Number of open LVF positions
    pub total_lp_positions: u64, // Number of open LP positions
    pub expected_vault_balance: u64, // Track expected vault balance to prevent manipulation
    pub oracle: Option<Pubkey>, // Optional oracle account for price feeds
    pub treasury: Pubkey, // Protocol treasury account for fee collection
    pub total_fees_accrued: u64, // Total fees accrued to vault (for analytics)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LPPosition {
    pub id: u64,
    pub owner: Pubkey,
    pub base_token: String, // "SOL"
    pub base_amount: u64,
    pub usdc_amount: u64,
    pub entry_price: u64, // Entry price in USDC (scaled)
    pub current_value: u64, // Current position value in USDC
    pub yield_earned: u64, // Yield earned in USD
    pub is_open: bool,
    pub created_at: i64, // Unix timestamp
}

#[account]
pub struct LPPositionAccount {
    pub position_id: u64,
    pub owner: Pubkey,
    pub crucible: Pubkey,
    pub base_mint: Pubkey,
    pub base_amount: u64,
    pub usdc_amount: u64,
    pub entry_price: u64, // Entry price in USDC (scaled by 1M)
    pub created_at: u64, // Slot when created
    pub is_open: bool,
    pub bump: u8,
}

impl LPPositionAccount {
    pub const LEN: usize = 8 + // discriminator
        8 +  // position_id
        32 + // owner
        32 + // crucible
        32 + // base_mint
        8 +  // base_amount
        8 +  // usdc_amount
        8 +  // entry_price
        8 +  // created_at
        1 +  // is_open
        1;   // bump
}

impl Crucible {
    pub const LEN: usize = 8 + // discriminator
        32 + // base_mint
        32 + // ctoken_mint
        32 + // vault
        1 +  // vault_bump
        1 +  // bump
        8 +  // total_base_deposited
        8 +  // total_ctoken_supply
        8 +  // exchange_rate
        8 +  // last_update_slot
        8 +  // fee_rate
        1 +  // paused
        8 +  // total_leveraged_positions
        8 +  // total_lp_positions
        8 +  // expected_vault_balance
        1 +  // oracle Option discriminator
        32 + // oracle Pubkey (if Some)
        32 + // treasury
        8;   // total_fees_accrued
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
    #[msg("Invalid LP amounts - must be equal value")]
    InvalidLPAmounts,
    #[msg("Position not found")]
    PositionNotFound,
    #[msg("Vault balance mismatch - potential manipulation detected")]
    VaultBalanceMismatch,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Feature not implemented - lending integration required")]
    FeatureNotImplemented,
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
}

