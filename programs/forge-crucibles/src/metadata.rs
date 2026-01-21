use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use anchor_spl::metadata::{create_metadata_accounts_v3, CreateMetadataAccountsV3};
use mpl_token_metadata::types::DataV2;

use crate::state::{Crucible, CrucibleError};

/// Create Metaplex Token Metadata for a cToken mint
/// This instruction allows the crucible PDA (mint authority) to sign metadata creation
pub fn create_ctoken_metadata(
    ctx: Context<CreateCTokenMetadata>,
    name: String,
    symbol: String,
    uri: String,
    seller_fee_basis_points: u16,
    is_mutable: bool,
) -> Result<()> {
    let crucible = &ctx.accounts.crucible;
    
    // SECURITY FIX: Check if crucible is paused before allowing metadata creation
    require!(!crucible.paused, CrucibleError::ProtocolPaused);
    
    // Validate that ctoken_mint matches crucible's ctoken_mint
    require!(
        ctx.accounts.ctoken_mint.key() == crucible.ctoken_mint,
        CrucibleError::InvalidMint
    );
    
    // Derive metadata PDA manually and validate it matches the provided account
    // Seeds: ["metadata", TOKEN_METADATA_PROGRAM_ID, mint]
    let metadata_program_id = ctx.accounts.token_metadata_program.key();
    let (metadata_pda, _bump) = Pubkey::find_program_address(
        &[
            b"metadata",
            metadata_program_id.as_ref(),
            ctx.accounts.ctoken_mint.key().as_ref(),
        ],
        &metadata_program_id,
    );
    require!(
        metadata_pda == ctx.accounts.metadata.key(),
        CrucibleError::InvalidMetadataAccount
    );
    
    // SECURITY FIX (AUDIT-046): Verify URI validation (length limits)
    // Maximum URI length: 200 characters (Metaplex standard)
    const MAX_URI_LENGTH: usize = 200;
    require!(
        uri.len() <= MAX_URI_LENGTH,
        CrucibleError::InvalidConfig
    );
    
    // SECURITY FIX (AUDIT-045): Verify metadata cannot be overwritten
    // Check if metadata account already exists and has data
    // If account exists and is initialized, reject (prevent overwrite)
    let metadata_account = &ctx.accounts.metadata;
    if metadata_account.data_len() > 0 {
        // Account exists - check if it's already initialized
        // Metaplex metadata accounts have a discriminator at the start
        // If account has data, it's likely already initialized
        return Err(CrucibleError::InvalidMetadataAccount.into());
    }
    
    // Validate name and symbol lengths
    const MAX_NAME_LENGTH: usize = 32;
    const MAX_SYMBOL_LENGTH: usize = 10;
    require!(
        name.len() > 0 && name.len() <= MAX_NAME_LENGTH,
        CrucibleError::InvalidConfig
    );
    require!(
        symbol.len() > 0 && symbol.len() <= MAX_SYMBOL_LENGTH,
        CrucibleError::InvalidConfig
    );
    
    // Build DataV2 struct for metadata
    let data = DataV2 {
        name,
        symbol,
        uri,
        seller_fee_basis_points,
        creators: None,
        collection: None,
        uses: None,
    };
    
    // Create crucible authority seeds for signing as mint authority
    let seeds = &[
        b"crucible",
        crucible.base_mint.as_ref(),
        &[crucible.bump],
    ];
    let signer = &[&seeds[..]];
    
    // Build CPI accounts for create_metadata_accounts_v3
    let cpi_accounts = CreateMetadataAccountsV3 {
        metadata: ctx.accounts.metadata.to_account_info(),
        mint: ctx.accounts.ctoken_mint.to_account_info(),
        mint_authority: ctx.accounts.crucible_authority.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        update_authority: ctx.accounts.crucible_authority.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };
    
    // Invoke Metaplex CPI with PDA signer
    // update_authority_is_signer = true because crucible_authority (PDA) is signing
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_metadata_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    
    create_metadata_accounts_v3(
        cpi_ctx,
        data,
        is_mutable,
        true, // update_authority_is_signer = true (crucible PDA is signing)
        None, // collection_details = None
    )?;
    
    msg!("Token metadata created for mint: {}", ctx.accounts.ctoken_mint.key());
    
    Ok(())
}

#[derive(Accounts)]
pub struct CreateCTokenMetadata<'info> {
    /// CHECK: Crucible account - validated in instruction
    #[account(
        seeds = [b"crucible", crucible.base_mint.as_ref()],
        bump = crucible.bump
    )]
    pub crucible: Account<'info, Crucible>,
    
    /// cToken mint account
    #[account(mut)]
    pub ctoken_mint: Account<'info, Mint>,
    
    /// CHECK: Metadata PDA account - will be created by Metaplex program
    /// Seeds: ["metadata", TOKEN_METADATA_PROGRAM_ID, mint]
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    
    /// CHECK: Crucible authority PDA (mint authority) - signs for metadata creation
    /// Seeds: [b"crucible", base_mint.as_ref(), bump]
    pub crucible_authority: UncheckedAccount<'info>,
    
    /// Payer for metadata account creation (rent)
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// CHECK: Token Metadata Program - validated in instruction
    pub token_metadata_program: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
