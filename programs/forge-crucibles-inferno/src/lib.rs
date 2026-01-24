use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

pub mod lp;
pub mod metadata;
pub mod state;

use lp::*;
use metadata::*;
use state::*;

declare_id!("HbhXC9vgDfrgq3gAj22TwXPtEkxmBrKp9MidEY4Y3vMk");

// Lending pool program ID (devnet)
pub const LENDING_POOL_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    137, 222, 203, 196, 146, 24, 161, 22, 41, 201, 75, 126, 144, 122, 64, 116,
    179, 147, 109, 91, 72, 21, 38, 67, 41, 67, 7, 116, 219, 160, 219, 45
]);

#[program]
pub mod forge_crucibles_inferno {
    use super::*;

    pub fn initialize_inferno_crucible(
        ctx: Context<InitializeInfernoCrucible>,
        fee_rate: u64,
    ) -> Result<()> {
        // Fee rate bounds (0-10,000 bps)
        require!(fee_rate <= 10_000, InfernoCrucibleError::InvalidConfig);

        let clock = Clock::get()?;
        let base_mint_key = ctx.accounts.base_mint.key();
        let crucible_key = ctx.accounts.crucible.key();

        let crucible_bump = ctx.bumps.crucible;
        let vault_bump = ctx.bumps.vault;
        let usdc_vault_bump = ctx.bumps.usdc_vault;

        let base_mint_data = ctx.accounts.base_mint.try_borrow_data()?;
        let base_mint = Mint::try_deserialize(&mut &base_mint_data[..])?;
        drop(base_mint_data);

        // Initialize LP token mint
        let lp_mint_key = ctx.accounts.lp_token_mint.key();
        let init_lp_mint_ix = anchor_spl::token::spl_token::instruction::initialize_mint(
            &ctx.accounts.token_program.key(),
            &lp_mint_key,
            &crucible_key,
            Some(&crucible_key),
            base_mint.decimals,
        )?;
        anchor_lang::solana_program::program::invoke(
            &init_lp_mint_ix,
            &[
                ctx.accounts.lp_token_mint.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        // Create vault token account (PDA)
        let vault_seeds = &[
            b"vault",
            crucible_key.as_ref(),
            &[vault_bump],
        ];
        let vault_signer = &[&vault_seeds[..]];

        let rent = ctx.accounts.rent.to_account_info();
        let rent_data = Rent::from_account_info(&rent)?;
        let vault_lamports = rent_data.minimum_balance(165);

        let create_vault_ix = anchor_lang::solana_program::system_instruction::create_account(
            &ctx.accounts.authority.key(),
            &ctx.accounts.vault.key(),
            vault_lamports,
            165,
            &ctx.accounts.token_program.key(),
        );
        anchor_lang::solana_program::program::invoke_signed(
            &create_vault_ix,
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            vault_signer,
        )?;

        let init_account_ix = anchor_spl::token::spl_token::instruction::initialize_account(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.vault.key(),
            &base_mint_key,
            &crucible_key,
        )?;
        anchor_lang::solana_program::program::invoke(
            &init_account_ix,
            &[
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.base_mint.to_account_info(),
                ctx.accounts.crucible.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        // Create USDC vault token account (PDA)
        let usdc_vault_seeds = &[
            b"usdc_vault",
            crucible_key.as_ref(),
            &[usdc_vault_bump],
        ];
        let usdc_vault_signer = &[&usdc_vault_seeds[..]];

        let create_usdc_vault_ix = anchor_lang::solana_program::system_instruction::create_account(
            &ctx.accounts.authority.key(),
            &ctx.accounts.usdc_vault.key(),
            vault_lamports,
            165,
            &ctx.accounts.token_program.key(),
        );
        anchor_lang::solana_program::program::invoke_signed(
            &create_usdc_vault_ix,
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.usdc_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            usdc_vault_signer,
        )?;

        let init_usdc_vault_ix = anchor_spl::token::spl_token::instruction::initialize_account(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.usdc_vault.key(),
            &ctx.accounts.usdc_mint.key(),
            &crucible_key,
        )?;
        anchor_lang::solana_program::program::invoke(
            &init_usdc_vault_ix,
            &[
                ctx.accounts.usdc_vault.to_account_info(),
                ctx.accounts.usdc_mint.to_account_info(),
                ctx.accounts.crucible.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        // Initialize state
        let crucible = &mut ctx.accounts.crucible;
        crucible.base_mint = base_mint_key;
        crucible.lp_token_mint = lp_mint_key;
        crucible.vault = ctx.accounts.vault.key();
        crucible.usdc_vault = ctx.accounts.usdc_vault.key();
        crucible.vault_bump = vault_bump;
        crucible.bump = crucible_bump;
        crucible.total_lp_token_supply = 0;
        crucible.total_lp_positions = 0;
        crucible.exchange_rate = 1_000_000;
        crucible.last_update_slot = clock.slot;
        crucible.fee_rate = fee_rate;
        crucible.paused = false;
        crucible.expected_vault_balance = 0;
        crucible.expected_usdc_vault_balance = 0;
        let oracle_key = ctx.accounts.oracle.key();
        crucible.oracle = if oracle_key == System::id() { None } else { Some(oracle_key) };
        crucible.treasury_base = ctx.accounts.treasury_base.key();
        crucible.treasury_usdc = ctx.accounts.treasury_usdc.key();
        crucible.total_fees_accrued = 0;

        emit!(InfernoCrucibleInitialized {
            crucible: crucible.key(),
            base_mint: crucible.base_mint,
            lp_token_mint: crucible.lp_token_mint,
            vault: crucible.vault,
            treasury_base: crucible.treasury_base,
            treasury_usdc: crucible.treasury_usdc,
            oracle: crucible.oracle,
            fee_rate,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn open_inferno_lp_position(
        ctx: Context<OpenInfernoLPPosition>,
        base_amount: u64,
        usdc_amount: u64,
        borrowed_usdc: u64,
        leverage_factor: u64,
        max_slippage_bps: u64,
    ) -> Result<u64> {
        lp::open_inferno_lp_position(
            ctx,
            base_amount,
            usdc_amount,
            borrowed_usdc,
            leverage_factor,
            max_slippage_bps,
        )
    }

    pub fn close_inferno_lp_position(
        ctx: Context<CloseInfernoLPPosition>,
        max_slippage_bps: u64,
    ) -> Result<()> {
        lp::close_inferno_lp_position(ctx, max_slippage_bps)
    }

    pub fn health_check_inferno(
        ctx: Context<HealthCheckInferno>,
    ) -> Result<u64> {
        lp::health_check_inferno(ctx)
    }

    pub fn liquidate_inferno_lp_position(
        ctx: Context<CloseInfernoLPPosition>,
        max_slippage_bps: u64,
    ) -> Result<()> {
        lp::liquidate_inferno_lp_position(ctx, max_slippage_bps)
    }

    pub fn create_lp_metadata(
        ctx: Context<CreateLPMetadata>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16,
        is_mutable: bool,
    ) -> Result<()> {
        metadata::create_lp_metadata(ctx, name, symbol, uri, seller_fee_basis_points, is_mutable)
    }
}

#[derive(Accounts)]
#[instruction(fee_rate: u64)]
pub struct InitializeInfernoCrucible<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = InfernoCrucible::LEN,
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump
    )]
    pub crucible: Account<'info, InfernoCrucible>,

    /// CHECK: Base token mint - validated in instruction
    pub base_mint: UncheckedAccount<'info>,

    /// CHECK: LP token mint to be initialized
    #[account(mut)]
    pub lp_token_mint: Signer<'info>,

    /// CHECK: Vault token account - initialized via CPI
    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: USDC vault token account - initialized via CPI
    #[account(
        mut,
        seeds = [b"usdc_vault", crucible.key().as_ref()],
        bump
    )]
    pub usdc_vault: UncheckedAccount<'info>,

    /// CHECK: USDC mint
    pub usdc_mint: UncheckedAccount<'info>,

    /// CHECK: Base token treasury account
    #[account(mut)]
    pub treasury_base: UncheckedAccount<'info>,

    /// CHECK: USDC treasury account
    #[account(mut)]
    pub treasury_usdc: UncheckedAccount<'info>,

    /// CHECK: Oracle account for price feeds. Pass system program if not used.
    pub oracle: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[event]
pub struct InfernoCrucibleInitialized {
    pub crucible: Pubkey,
    pub base_mint: Pubkey,
    pub lp_token_mint: Pubkey,
    pub vault: Pubkey,
    pub treasury_base: Pubkey,
    pub treasury_usdc: Pubkey,
    pub oracle: Option<Pubkey>,
    pub fee_rate: u64,
    pub timestamp: i64,
}
