use anchor_lang::prelude::*;

pub mod ctoken;
pub mod lvf;
pub mod lp;
pub mod state;

use ctoken::*;
use lvf::*;
use lp::*;
use state::*;

declare_id!("Crucible111111111111111111111111111111111");

#[program]
pub mod forge_crucibles {
    use super::*;

    // Existing crucible initialization (keep your existing implementation)
    // pub fn initialize_crucible(ctx: Context<InitializeCrucible>, ...) -> Result<()> { ... }

    /// Mint cToken when user deposits base token
    pub fn mint_ctoken(ctx: Context<MintCToken>, amount: u64) -> Result<()> {
        ctoken::mint_ctoken(ctx, amount)
    }

    /// Burn cToken and return base tokens to user
    pub fn burn_ctoken(ctx: Context<BurnCToken>, ctokens_amount: u64) -> Result<()> {
        ctoken::burn_ctoken(ctx, ctokens_amount)
    }

    /// Open a leveraged LP position (TOKEN/USDC)
    pub fn open_leveraged_position(
        ctx: Context<OpenLeveragedPosition>,
        collateral_amount: u64,
        leverage_factor: u64,
    ) -> Result<u64> {
        lvf::open_leveraged_position(ctx, collateral_amount, leverage_factor)
    }

    /// Close a leveraged LP position
    pub fn close_leveraged_position(
        ctx: Context<CloseLeveragedPosition>,
        position_id: Pubkey,
    ) -> Result<()> {
        lvf::close_leveraged_position(ctx, position_id)
    }

    /// Open a standard LP position (base token + USDC, equal value)
    pub fn open_lp_position(
        ctx: Context<OpenLPPosition>,
        base_amount: u64,
        usdc_amount: u64,
    ) -> Result<u64> {
        lp::open_lp_position(ctx, base_amount, usdc_amount)
    }

    /// Close a standard LP position
    pub fn close_lp_position(
        ctx: Context<CloseLPPosition>,
        position_id: u64,
    ) -> Result<()> {
        lp::close_lp_position(ctx, position_id)
    }
}
