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
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LPPosition {
    pub id: u64,
    pub owner: Pubkey,
    pub base_token: String, // "SOL" or "FORGE"
    pub base_amount: u64,
    pub usdc_amount: u64,
    pub entry_price: u64, // Entry price in USDC (scaled)
    pub current_value: u64, // Current position value in USDC
    pub yield_earned: u64, // Yield earned in USD
    pub is_open: bool,
    pub created_at: i64, // Unix timestamp
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
        8;   // total_lp_positions
}

