use anchor_lang::prelude::*;

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub base_mint: Pubkey,
    pub vault: Pubkey,
    pub receipt_mint: Pubkey,
    pub total_supply: u128,
    pub total_borrowed: u128,
    pub accumulated_index: u128,
    pub last_accrued_ts: u64,
    pub interest_model: InterestRateModelConfig,
    pub liquidation_threshold_bps: u64,
    pub paused: bool,
    pub pause_proposed_at: Option<u64>, // Timestamp when pause was proposed (for timelock)
    pub bump: u8,
}

impl Market {
    pub const SIZE: usize = 8 + // discriminator
        32 + // authority
        32 + // base_mint
        32 + // vault
        32 + // receipt_mint
        16 + // total_supply
        16 + // total_borrowed
        16 + // accumulated_index
        8 +  // last_accrued_ts
        InterestRateModelConfig::SIZE +
        8 +  // liquidation_threshold_bps
        1 +  // paused
        1 +  // pause_proposed_at Option discriminator
        8 +  // pause_proposed_at u64 (if Some)
        1;   // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct InterestRateModelConfig {
    pub base_rate_bps: u64,
    pub slope1_bps: u64,
    pub slope2_bps: u64,
    pub kink_bps: u64,
}

impl InterestRateModelConfig {
    pub const SIZE: usize = 8 * 4;
}


