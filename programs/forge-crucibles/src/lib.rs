use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

pub mod ctoken;
pub mod lvf;
pub mod lp;
pub mod metadata;
pub mod state;

use ctoken::*;
use lvf::*;
use lp::*;
use metadata::*;
use state::*;

// Using legacy program ID to enable upgrading old deployment
declare_id!("B9qek9NaR3xmBro8pdxixaA2SHzDUExB5KaBt9Kb4fry");

// Lending pool program ID - deployed to devnet (Jan 25, 2026)
// Program ID: 7hwTzKPSKdio6TZdi4SY7wEuGpFha15ebsaiTPp2y3G2
pub const LENDING_POOL_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    99, 162, 240, 35, 237, 200, 110, 145, 33, 117, 136, 121, 38, 152, 12, 130,
    188, 246, 212, 123, 9, 79, 26, 42, 207, 80, 248, 200, 166, 46, 33, 95
]);

#[program]
pub mod forge_crucibles {
    use super::*;

    /// Initialize a new crucible for a base token
    pub fn initialize_crucible(
        ctx: Context<InitializeCrucible>,
        fee_rate: u64, // Fee rate in basis points (e.g., 200 = 0.2% = 2 bps)
    ) -> Result<()> {
        // SECURITY FIX (AUDIT-011): Validate fee_rate bounds (0-10,000 bps)
        require!(
            fee_rate <= 10_000,
            CrucibleError::InvalidConfig
        );
        
        let clock = Clock::get()?;
        let base_mint_key = ctx.accounts.base_mint.key();
        let crucible_key = ctx.accounts.crucible.key();
        
        // Get bumps
        let crucible_bump = ctx.bumps.crucible;
        let vault_bump = ctx.bumps.vault;
        let usdc_vault_bump = ctx.bumps.usdc_vault;
        
        // Deserialize base_mint to get decimals
        let base_mint_data = ctx.accounts.base_mint.try_borrow_data()?;
        let base_mint = Mint::try_deserialize(&mut &base_mint_data[..])?;
        drop(base_mint_data);
        
        // SECURITY FIX (AUDIT-007): Verify mint decimals match base_mint decimals
        // This is handled by using base_mint.decimals in initialize_mint call below
        
        // Create crucible authority seeds for signing
        let seeds = &[
            b"crucible",
            base_mint_key.as_ref(),
            &[crucible_bump],
        ];
        let signer = &[&seeds[..]];
        
        // Initialize cToken mint
        let init_mint_ix = anchor_spl::token::spl_token::instruction::initialize_mint(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.ctoken_mint.key(),
            &crucible_key,  // Mint authority is the crucible PDA
            Some(&crucible_key), // Freeze authority is also crucible PDA
            base_mint.decimals,
        )?;
        anchor_lang::solana_program::program::invoke(
            &init_mint_ix,
            &[
                ctx.accounts.ctoken_mint.to_account_info(),
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
        
        // Get rent for token account
        let rent = ctx.accounts.rent.to_account_info();
        let rent_data = Rent::from_account_info(&rent)?;
        let vault_lamports = rent_data.minimum_balance(165); // Token account size
        
        // Create vault account (PDA) via system program
        let create_vault_ix = anchor_lang::solana_program::system_instruction::create_account(
            &ctx.accounts.authority.key(),
            &ctx.accounts.vault.key(),
            vault_lamports,
            165, // Token account size
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
        
        // Initialize vault as token account
        let init_account_ix = anchor_spl::token::spl_token::instruction::initialize_account(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.vault.key(),
            &base_mint_key,
            &crucible_key, // Owner is crucible PDA
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
        
        // SECURITY FIX (AUDIT-010): Verify vault mint matches base_mint after initialization
        // This is ensured by passing base_mint_key to initialize_account above
        // Additional validation: verify vault account data matches expected mint
        // Token account structure: [discriminator(8), mint(32), owner(32), amount(8), ...]
        let vault_data = ctx.accounts.vault.try_borrow_data()?;
        if vault_data.len() >= 40 {
            // Extract mint from vault account (offset 8 after discriminator)
            let vault_mint_bytes: [u8; 32] = vault_data[8..40].try_into()
                .map_err(|_| CrucibleError::InvalidConfig)?;
            let vault_mint = Pubkey::try_from(vault_mint_bytes)
                .map_err(|_| CrucibleError::InvalidConfig)?;
            require!(
                vault_mint == base_mint_key,
                CrucibleError::InvalidConfig
            );
        }
        drop(vault_data);

        // Create USDC vault token account (PDA) for LP positions
        // USDC mint address for devnet: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
        // Note: We'll need to pass USDC mint as a parameter or derive it
        // For now, we'll create the vault but it needs to be initialized with the correct USDC mint
        // The USDC mint should be passed as an account or we need to hardcode it
        // Let's add it as an account parameter
        
        let usdc_vault_seeds = &[
            b"usdc_vault",
            crucible_key.as_ref(),
            &[usdc_vault_bump],
        ];
        let usdc_vault_signer = &[&usdc_vault_seeds[..]];
        
        // Create USDC vault account (PDA) via system program
        let create_usdc_vault_ix = anchor_lang::solana_program::system_instruction::create_account(
            &ctx.accounts.authority.key(),
            &ctx.accounts.usdc_vault.key(),
            vault_lamports, // Same rent as base vault
            165, // Token account size
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
        
        // Initialize USDC vault as token account
        let init_usdc_vault_ix = anchor_spl::token::spl_token::instruction::initialize_account(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.usdc_vault.key(),
            &ctx.accounts.usdc_mint.key(),
            &crucible_key, // Owner is crucible PDA
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
        
        // Initialize LP token mint (for LP positions - cToken/USDC pairs)
        let lp_mint_key = ctx.accounts.lp_token_mint.key();
        let init_lp_mint_ix = anchor_spl::token::spl_token::instruction::initialize_mint(
            &ctx.accounts.token_program.key(),
            &lp_mint_key,
            &crucible_key,  // Mint authority is the crucible PDA
            Some(&crucible_key), // Freeze authority is also crucible PDA
            9, // LP tokens use 9 decimals (same as base token)
        )?;
        anchor_lang::solana_program::program::invoke(
            &init_lp_mint_ix,
            &[
                ctx.accounts.lp_token_mint.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        // Initialize crucible state
        let crucible = &mut ctx.accounts.crucible;
        crucible.base_mint = base_mint_key;
        crucible.ctoken_mint = ctx.accounts.ctoken_mint.key();
        crucible.lp_token_mint = lp_mint_key;
        crucible.vault = ctx.accounts.vault.key();
        crucible.vault_bump = vault_bump;
        crucible.bump = crucible_bump;
        crucible.total_base_deposited = 0;
        crucible.total_ctoken_supply = 0;
        crucible.total_lp_token_supply = 0;
        crucible.exchange_rate = 1_000_000; // Initial exchange rate: 1.0 (scaled by 1M)
        crucible.last_update_slot = clock.slot;
        crucible.fee_rate = fee_rate;
        crucible.paused = false;
        crucible.total_leveraged_positions = 0;
        crucible.total_lp_positions = 0;
        crucible.expected_vault_balance = 0;
        // Set oracle if provided (not system program)
        let oracle_key = ctx.accounts.oracle.key();
        crucible.oracle = if oracle_key == System::id() {
            None
        } else {
            Some(oracle_key)
        };
        crucible.treasury = ctx.accounts.treasury.key();
        crucible.total_fees_accrued = 0;

        emit!(CrucibleInitialized {
            crucible: crucible.key(),
            base_mint: crucible.base_mint,
            ctoken_mint: crucible.ctoken_mint,
            lp_token_mint: crucible.lp_token_mint,
            vault: crucible.vault,
            treasury: crucible.treasury,
            oracle: crucible.oracle,
            fee_rate,
            timestamp: clock.unix_timestamp,
        });

        msg!("Crucible initialized for base mint: {}", crucible.base_mint);
        Ok(())
    }

    /// Mint cToken when user deposits base token
    pub fn mint_ctoken(ctx: Context<MintCToken>, amount: u64) -> Result<()> {
        ctoken::mint_ctoken(ctx, amount)
    }

    /// Burn cToken and return base tokens to user
    pub fn burn_ctoken(ctx: Context<BurnCToken>, ctokens_amount: u64) -> Result<()> {
        ctoken::burn_ctoken(ctx, ctokens_amount)
    }

    /// Burn cToken (legacy) - supports old crucible account format
    /// Use this to close cToken positions created before LP token feature
    pub fn burn_ctoken_legacy(ctx: Context<BurnCTokenLegacy>, ctokens_amount: u64) -> Result<()> {
        ctoken::burn_ctoken_legacy(ctx, ctokens_amount)
    }

    /// Mint cToken (legacy) - supports old crucible account format
    /// Use this for crucibles created before LP token feature
    pub fn mint_ctoken_legacy(ctx: Context<MintCTokenLegacy>, amount: u64) -> Result<()> {
        ctoken::mint_ctoken_legacy(ctx, amount)
    }

    /// Deposit arbitrage profits directly to crucible vault
    /// 80% goes to vault (increases yield), 20% goes to treasury (protocol revenue)
    pub fn deposit_arbitrage_profit(
        ctx: Context<DepositArbitrageProfit>,
        amount: u64,
    ) -> Result<()> {
        ctoken::deposit_arbitrage_profit(ctx, amount)
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
        max_slippage_bps: u64,
    ) -> Result<()> {
        lvf::close_leveraged_position(ctx, position_id, max_slippage_bps)
    }

    /// Check position health (LTV in basis points)
    pub fn health_check(
        ctx: Context<HealthCheck>,
    ) -> Result<u64> {
        lvf::health_check(ctx)
    }

    /// Liquidate an undercollateralized leveraged position
    pub fn liquidate_position(
        ctx: Context<LiquidatePosition>,
    ) -> Result<()> {
        lvf::liquidate_position(ctx)
    }

    /// Open a standard LP position (base token + USDC, equal value)
    /// position_nonce allows multiple positions per user per base_mint
    pub fn open_lp_position(
        ctx: Context<OpenLPPosition>,
        base_amount: u64,
        usdc_amount: u64,
        max_slippage_bps: u64,
        position_nonce: u64,
    ) -> Result<u64> {
        lp::open_lp_position(ctx, base_amount, usdc_amount, max_slippage_bps, position_nonce)
    }

    /// Close a standard LP position
    /// position_nonce must match the nonce used when opening the position
    pub fn close_lp_position(
        ctx: Context<CloseLPPosition>,
        max_slippage_bps: u64,
        position_nonce: u64,
    ) -> Result<()> {
        lp::close_lp_position(ctx, max_slippage_bps, position_nonce)
    }

    /// Create Metaplex Token Metadata for a cToken mint
    /// Allows the crucible PDA (mint authority) to sign metadata creation
    pub fn create_ctoken_metadata(
        ctx: Context<CreateCTokenMetadata>,
        name: String,
        symbol: String,
        uri: String,
        seller_fee_basis_points: u16,
        is_mutable: bool,
    ) -> Result<()> {
        metadata::create_ctoken_metadata(ctx, name, symbol, uri, seller_fee_basis_points, is_mutable)
    }

    /// Initialize USDC vault for existing crucibles
    /// This allows crucibles initialized before USDC vault support to add the vault
    pub fn initialize_usdc_vault(
        ctx: Context<InitializeUsdcVault>,
    ) -> Result<()> {
        let crucible_key = ctx.accounts.crucible.key();
        let base_mint_key = ctx.accounts.base_mint.key();
        
        // Validate crucible PDA matches expected derivation
        let (expected_crucible_pda, expected_bump) = Pubkey::find_program_address(
            &[b"crucible", base_mint_key.as_ref()],
            ctx.program_id,
        );
        require!(
            crucible_key == expected_crucible_pda,
            CrucibleError::InvalidConfig
        );
        
        // Get crucible bump for signing (from context)
        let crucible_bump = ctx.bumps.crucible;
        // Note: We don't actually need to sign with crucible authority for this operation
        // The USDC vault is created by the authority, not the crucible PDA
        // But we keep the seeds for potential future use
        
        // Get USDC vault bump
        let usdc_vault_bump = ctx.bumps.usdc_vault;
        let usdc_vault_seeds = &[
            b"usdc_vault",
            crucible_key.as_ref(),
            &[usdc_vault_bump],
        ];
        let usdc_vault_signer = &[&usdc_vault_seeds[..]];
        
        // Get rent for token account
        let rent = ctx.accounts.rent.to_account_info();
        let rent_data = Rent::from_account_info(&rent)?;
        let vault_lamports = rent_data.minimum_balance(165); // Token account size
        
        // Create USDC vault account (PDA) via system program
        let create_usdc_vault_ix = anchor_lang::solana_program::system_instruction::create_account(
            &ctx.accounts.authority.key(),
            &ctx.accounts.usdc_vault.key(),
            vault_lamports,
            165, // Token account size
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
        
        // Initialize USDC vault as token account
        let init_usdc_vault_ix = anchor_spl::token::spl_token::instruction::initialize_account(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.usdc_vault.key(),
            &ctx.accounts.usdc_mint.key(),
            &crucible_key, // Owner is crucible PDA
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
        
        msg!("USDC vault initialized for crucible: {}", crucible_key);
        Ok(())
    }
}

// Re-export account structs for use in client code
pub use lvf::{HealthCheck, LiquidatePosition};

/// Initialize crucible accounts struct - optimized for stack size
#[derive(Accounts)]
#[instruction(fee_rate: u64)]
pub struct InitializeCrucible<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Crucible::LEN,
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump
    )]
    pub crucible: Account<'info, Crucible>,

    /// CHECK: Base token mint - validated in instruction
    pub base_mint: UncheckedAccount<'info>,

    /// CHECK: cToken mint to be initialized
    #[account(mut)]
    pub ctoken_mint: Signer<'info>,

    /// CHECK: LP token mint to be initialized (for LP positions)
    #[account(mut)]
    pub lp_token_mint: Signer<'info>,

    /// CHECK: Vault token account - initialized via CPI
    #[account(
        mut,
        seeds = [b"vault", crucible.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: USDC vault token account - initialized via CPI for LP positions
    #[account(
        mut,
        seeds = [b"usdc_vault", crucible.key().as_ref()],
        bump
    )]
    pub usdc_vault: UncheckedAccount<'info>,

    /// CHECK: USDC mint - needed to initialize USDC vault
    pub usdc_mint: UncheckedAccount<'info>,

    /// CHECK: Protocol treasury token account for fee collection
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,

    /// CHECK: Oracle account for price feeds. Pass system program if not used.
    pub oracle: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize USDC vault for existing crucibles
#[derive(Accounts)]
pub struct InitializeUsdcVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Crucible account - using UncheckedAccount to handle old account formats
    /// The PDA constraint validates it's the correct crucible
    #[account(
        mut,
        seeds = [b"crucible", base_mint.key().as_ref()],
        bump,
    )]
    pub crucible: UncheckedAccount<'info>,
    
    /// CHECK: Base mint for crucible PDA derivation
    pub base_mint: UncheckedAccount<'info>,

    /// CHECK: USDC vault token account - will be created
    #[account(
        mut,
        seeds = [b"usdc_vault", crucible.key().as_ref()],
        bump
    )]
    pub usdc_vault: UncheckedAccount<'info>,

    /// CHECK: USDC mint
    pub usdc_mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[event]
pub struct CrucibleInitialized {
    pub crucible: Pubkey,
    pub base_mint: Pubkey,
    pub ctoken_mint: Pubkey,
    pub lp_token_mint: Pubkey,
    pub vault: Pubkey,
    pub treasury: Pubkey,
    pub oracle: Option<Pubkey>,
    pub fee_rate: u64,
    pub timestamp: i64,
}
