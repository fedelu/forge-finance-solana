use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use anchor_spl::metadata::{create_metadata_accounts_v3, CreateMetadataAccountsV3};
use mpl_token_metadata::types::DataV2;

use crate::state::{InfernoCrucible, InfernoCrucibleError};

/// Create Metaplex Token Metadata for an LP token mint
pub fn create_lp_metadata(
    ctx: Context<CreateLPMetadata>,
    name: String,
    symbol: String,
    uri: String,
    seller_fee_basis_points: u16,
    is_mutable: bool,
) -> Result<()> {
    let crucible = &ctx.accounts.crucible;
    require!(!crucible.paused, InfernoCrucibleError::ProtocolPaused);

    require!(
        ctx.accounts.lp_token_mint.key() == crucible.lp_token_mint,
        InfernoCrucibleError::InvalidMint
    );

    let metadata_program_id = ctx.accounts.token_metadata_program.key();
    let (metadata_pda, _bump) = Pubkey::find_program_address(
        &[
            b"metadata",
            metadata_program_id.as_ref(),
            ctx.accounts.lp_token_mint.key().as_ref(),
        ],
        &metadata_program_id,
    );
    require!(
        metadata_pda == ctx.accounts.metadata.key(),
        InfernoCrucibleError::InvalidMetadataAccount
    );

    const MAX_URI_LENGTH: usize = 200;
    require!(uri.len() <= MAX_URI_LENGTH, InfernoCrucibleError::InvalidConfig);

    let metadata_account = &ctx.accounts.metadata;
    if metadata_account.data_len() > 0 {
        return Err(InfernoCrucibleError::InvalidMetadataAccount.into());
    }

    const MAX_NAME_LENGTH: usize = 32;
    const MAX_SYMBOL_LENGTH: usize = 10;
    require!(
        name.len() > 0 && name.len() <= MAX_NAME_LENGTH,
        InfernoCrucibleError::InvalidConfig
    );
    require!(
        symbol.len() > 0 && symbol.len() <= MAX_SYMBOL_LENGTH,
        InfernoCrucibleError::InvalidConfig
    );

    let data = DataV2 {
        name,
        symbol,
        uri,
        seller_fee_basis_points,
        creators: None,
        collection: None,
        uses: None,
    };

    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = CreateMetadataAccountsV3 {
        metadata: ctx.accounts.metadata.to_account_info(),
        mint: ctx.accounts.lp_token_mint.to_account_info(),
        mint_authority: ctx.accounts.crucible_authority.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        update_authority: ctx.accounts.crucible_authority.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_metadata_program.to_account_info(),
        cpi_accounts,
        signer,
    );

    create_metadata_accounts_v3(
        cpi_ctx,
        data,
        is_mutable,
        true,
        None,
    )?;

    msg!("LP token metadata created for mint: {}", ctx.accounts.lp_token_mint.key());
    Ok(())
}

#[derive(Accounts)]
pub struct CreateLPMetadata<'info> {
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump
    )]
    pub crucible: Account<'info, InfernoCrucible>,

    #[account(mut)]
    pub lp_token_mint: Account<'info, Mint>,

    /// CHECK: Metadata PDA account
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Crucible authority PDA
    pub crucible_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Token Metadata Program
    pub token_metadata_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
