/**
 * USDC Faucet Utility for Solana Devnet
 * 
 * On devnet, USDC can be obtained via:
 * 1. Direct faucet (if available)
 * 2. Jupiter swap (SOL -> USDC)
 * 3. Manual airdrop from a devnet USDC mint authority
 */

import { Connection, PublicKey, Transaction, SystemProgram, Keypair } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getMint,
  getAccount,
  MINT_SIZE,
  createInitializeMint2Instruction
} from '@solana/spl-token';
import { SOLANA_TESTNET_CONFIG } from '../config/solana-testnet';

/**
 * Get USDC from devnet faucet
 * This creates a mint-to instruction if the user has permission, or uses a swap
 */
export async function getUSDCFromFaucet(
  connection: Connection,
  userPublicKey: PublicKey,
  amount: number = 1000, // 1000 USDC
  signTransaction?: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC);
  
  try {
    // Check if user already has USDC
    const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, userPublicKey);
    try {
      const account = await getAccount(connection, userUsdcAccount);
      const currentBalance = Number(account.amount) / 1e6;
      if (currentBalance >= amount) {
        console.log(`✅ User already has ${currentBalance} USDC`);
        return 'already_has_usdc';
      }
    } catch (e) {
      // Account doesn't exist, we'll create it
    }

    // Try to get USDC via Jupiter swap (SOL -> USDC)
    // This is the most reliable method on devnet
    console.log('🔄 Attempting to swap SOL for USDC via Jupiter...');
    
    const swapResult = await swapSOLForUSDC(connection, userPublicKey, amount, signTransaction);
    return swapResult;
  } catch (error: any) {
    console.error('❌ Error getting USDC from faucet:', error);
    throw new Error(`Failed to get USDC: ${error.message}`);
  }
}

/**
 * Swap SOL for USDC using Jupiter aggregator
 */
async function swapSOLForUSDC(
  connection: Connection,
  userPublicKey: PublicKey,
  usdcAmount: number,
  signTransaction?: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  try {
    // Jupiter API endpoint for devnet
    const jupiterApiUrl = 'https://quote-api.jup.ag/v6/quote';
    
    // Get SOL price to calculate how much SOL to swap
    // Rough estimate: 1 SOL ≈ $200, so for 1000 USDC we need ~5 SOL
    const solPrice = 200; // Approximate
    const solAmount = (usdcAmount / solPrice) * 1.1; // Add 10% slippage buffer
    
    const inputMint = 'So11111111111111111111111111111111111111112'; // WSOL
    const outputMint = SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC;
    
    // Get quote from Jupiter
    const quoteUrl = `${jupiterApiUrl}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(solAmount * 1e9)}&slippageBps=100`;
    
    console.log('📡 Fetching quote from Jupiter...');
    const quoteResponse = await fetch(quoteUrl);
    
    if (!quoteResponse.ok) {
      // If Jupiter doesn't work, try direct mint-to (for devnet testing)
      console.log('⚠️ Jupiter swap not available, trying direct mint...');
      return await mintUSDCDirect(connection, userPublicKey, usdcAmount, signTransaction);
    }
    
    const quote = await quoteResponse.json();
    
    if (!quote || !quote.swapTransaction) {
      throw new Error('Jupiter quote failed');
    }
    
    // Decode and send swap transaction
    const swapTransactionBuf = Buffer.from(quote.swapTransaction, 'base64');
    const transaction = Transaction.from(swapTransactionBuf);
    
    if (signTransaction) {
      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3
      });
      await connection.confirmTransaction(signature, 'confirmed');
      return signature;
    } else {
      throw new Error('signTransaction function required');
    }
  } catch (error: any) {
    console.error('❌ Jupiter swap failed:', error);
    // Fallback to direct mint
    return await mintUSDCDirect(connection, userPublicKey, usdcAmount, signTransaction);
  }
}

/**
 * Direct mint USDC (for devnet testing only)
 * Note: This only works if the mint has a mint authority that we control
 * On real devnet, you typically need to use a faucet or swap
 */
async function mintUSDCDirect(
  connection: Connection,
  userPublicKey: PublicKey,
  amount: number,
  signTransaction?: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  const usdcMint = new PublicKey(SOLANA_TESTNET_CONFIG.TOKEN_ADDRESSES.USDC);
  const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, userPublicKey);
  
  const transaction = new Transaction();
  
  // Check if token account exists
  try {
    await getAccount(connection, userUsdcAccount);
  } catch (e) {
    // Create associated token account if it doesn't exist
    transaction.add(
      createAssociatedTokenAccountInstruction(
        userPublicKey,
        userUsdcAccount,
        userPublicKey,
        usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  
  // Try to mint (this will fail if we don't have mint authority)
  // On devnet, you typically need to use a faucet service
  const mintInfo = await getMint(connection, usdcMint);
  
  // If mint has no mint authority, we can't mint directly
  if (!mintInfo.mintAuthority) {
    throw new Error('USDC mint has no mint authority. Please use a devnet USDC faucet or swap SOL for USDC.');
  }
  
  // Note: This will only work if the mint authority is set to a keypair we control
  // For production, use Jupiter swap or a proper faucet service
  throw new Error('Direct minting not available. Please use Jupiter swap or a devnet USDC faucet.');
}

/**
 * Get USDC from a devnet faucet URL
 * Many devnet faucets provide USDC via HTTP endpoints
 */
export async function getUSDCFromFaucetURL(
  connection: Connection,
  userPublicKey: PublicKey,
  faucetUrl?: string
): Promise<string> {
  const defaultFaucetUrl = 'https://faucet.solana.com/usdc';
  
  try {
    const response = await fetch(faucetUrl || defaultFaucetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address: userPublicKey.toString(),
        amount: 1000, // Request 1000 USDC
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Faucet request failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.signature || 'pending';
  } catch (error: any) {
    console.error('❌ Faucet request failed:', error);
    throw new Error(`Faucet unavailable: ${error.message}`);
  }
}

/**
 * Simple helper to check if user has USDC and provide instructions
 */
export function getUSDCInstructions(): string {
  return `
To get USDC on Solana devnet:

1. **Jupiter Swap (Recommended)**:
   - Go to https://jup.ag/swap
   - Connect your wallet
   - Swap SOL for USDC (devnet)
   - Minimum: ~0.1 SOL for 20 USDC

2. **Devnet Faucet**:
   - Visit: https://spl-token-faucet.com/
   - Select USDC
   - Enter your wallet address
   - Request airdrop

3. **Alternative**:
   - Use the lending pool: Supply SOL, then borrow USDC
   - Or use the protocol's swap feature if available
  `;
}
