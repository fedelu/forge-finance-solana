import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PublicKey, Connection } from '@solana/web3.js';
// NOTE: FOGO Sessions logic has been deprecated. This file now provides a thin
// compatibility layer over the standard Solana wallet so existing components
// keep working while the app runs purely on Solana devnet.
import { useWallet } from '../contexts/WalletContext';
import WalletFallback from './WalletFallback';
import { useBalance } from '../contexts/BalanceContext';

// Phantom wallet types
interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  isConnected?: boolean;
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<{ signature: Uint8Array }>;
  on: (event: string, callback: (args: any) => void) => void;
  removeListener: (event: string, callback: (args: any) => void) => void;
}

// FOGO Sessions Context
interface FogoSessionContextType {
  isEstablished: boolean;
  walletPublicKey: PublicKey | null;
  sessionData: any | null;
  fogoBalance: number;
  liveAPYEarnings: number;
  connect: () => Promise<void>;
  endSession: () => Promise<void>;
  sendTransaction: (instructions: any[]) => Promise<string>;
  depositToCrucible: (amount: number, crucibleId?: string) => Promise<{ success: boolean; transactionId: string }>;
  withdrawFromCrucible: (amount: number, apyRewards?: number) => Promise<{ success: boolean; transactionId: string }>;
  calculateAPY: (principal: number, timeInDays: number) => number;
  calculateCompoundInterest: (principal: number, apy: number, timeInDays: number) => number;
  getCrucibleAPYEarnings: (crucibleId: string) => number;
  refreshBalance: () => Promise<void>;
  testDeposit: (amount: number) => Promise<{ success: boolean; transactionId: string }>;
  error: string | null;
}

const FogoSessionContext = createContext<FogoSessionContextType | null>(null);

// FOGO Sessions Provider
export function FogoSessionsProvider({ 
  children, 
  fogoClient 
}: { 
  children: React.ReactNode;
  fogoClient?: { context: any; connection: any };
}) {
  const [walletPublicKey, setWalletPublicKey] = useState<PublicKey | null>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [fogoBalance, setFogoBalance] = useState<number>(10000); // Fixed fake balance
  const [liveAPYEarnings, setLiveAPYEarnings] = useState<number>(0); // Live APY earnings
  const [deposits, setDeposits] = useState<Array<{amount: number, timestamp: number, apyRate: number, crucibleId: string}>>([]); // Track deposits
  const [error, setError] = useState<string | null>(null);
  const [isEstablished, setIsEstablished] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  
  // Deprecated: previously used FOGO wallet hook. We now rely on Solana WalletContext.
  const { publicKey, connected, connect: walletConnect, disconnect: walletDisconnect } = useWallet();
  
  // Use connection from fogoClient or create fallback (kept for compatibility)
  const connection = fogoClient?.connection || new Connection(process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');

  // Function to get fake FOGO balance
  const fetchFogoBalance = async (publicKey: PublicKey): Promise<number> => {
    console.log('💰 Using fake FOGO balance: 10,000 FOGO for wallet:', publicKey.toString());
    return 10000; // Always return 10,000 FOGO
  };

  // Sync with Solana wallet state
  useEffect(() => {
    if (connected && publicKey) {
      setWalletPublicKey(publicKey);
      setIsEstablished(true);
      setError(null);
    } else {
      setWalletPublicKey(null);
      setIsEstablished(false);
      setSessionData(null);
      setError(null);
    }
  }, [connected, publicKey, fogoClient]);

  // Live APY earnings tracking
  useEffect(() => {
    if (!isEstablished || !walletPublicKey) {
      setLiveAPYEarnings(0);
      return;
    }

    const updateLiveAPY = () => {
      // Calculate APY based on tracked deposits
      let totalAPY = 0;
      
      console.log(`📊 Updating live APY for ${deposits.length} deposits:`, deposits);
      
      deposits.forEach((deposit, index) => {
        // Calculate time elapsed since deposit (in days)
        const timeElapsed = (Date.now() - deposit.timestamp) / (1000 * 60 * 60 * 24);
        
        // Calculate APY for full year (365 days) by default
        const dailyRate = deposit.apyRate / 365;
        const earnedAPY = deposit.amount * (Math.pow(1 + dailyRate, 365) - 1);
        totalAPY += Math.max(0, earnedAPY);
        
        console.log(`📈 Deposit ${index + 1}: ${deposit.amount} FOGO, ${timeElapsed.toFixed(2)} days ago, APY: ${earnedAPY.toFixed(2)} FOGO`);
      });
      
      console.log(`💰 Total live APY earnings: ${totalAPY.toFixed(2)} FOGO`);
      setLiveAPYEarnings(totalAPY);
    };

    // Update immediately
    updateLiveAPY();

    // Update every minute
    const interval = setInterval(updateLiveAPY, 60000);

    return () => clearInterval(interval);
  }, [isEstablished, walletPublicKey, deposits]);

  // Initialize Fogo Sessions on mount
  useEffect(() => {
    const initializeSessions = async () => {
      // Guard against server-side rendering
      if (typeof window === "undefined" || !fogoClient) {
        return;
      }

      // Check for existing session
      if (fogoWallet.publicKey) {
        const publicKey = new PublicKey(fogoWallet.publicKey);
        // Always set fake balance
        setFogoBalance(10000);
        
        // Create fake session
        setSessionData({
          sessionId: 'fogo_session_' + Date.now(),
          sessionKey: {},
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          walletPublicKey: publicKey.toString(),
          success: true,
          message: 'Fogo Session re-established (Demo Mode)',
          sendTransaction: async (instructions: any[]) => {
            console.log('🔥 Simulating FOGO transaction with', instructions.length, 'instructions');
            return { type: 0, signature: 'fogo_tx_' + Date.now() };
          },
        });
        setIsEstablished(true);
        setWalletPublicKey(publicKey);
        console.log('✅ Re-established fake Fogo session');
      } else {
        console.log('ℹ️ No existing Fogo session found');
      }
    };

    initializeSessions();
  }, [fogoClient]);

  const connect = async (publicKey?: PublicKey) => {
    try {
      console.log('🔥 Connecting wallet (compat session)...');
      setError(null);
      
      // Use Solana wallet connection
      if (!connected) {
        await walletConnect();
      }
      
      if (!publicKey) {
        throw new Error('Failed to get public key from wallet');
      }
      
      const connectedPublicKey = publicKey;
      setWalletPublicKey(connectedPublicKey);
      console.log('✅ Connected to Solana wallet:', connectedPublicKey.toString());
      
      // Maintain simple sessionData object for backwards compatibility
      setSessionData({
        sessionId: 'fogo_session_' + Date.now(),
        sessionKey: {},
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        walletPublicKey: connectedPublicKey.toString(),
        success: true,
        message: 'Fogo Session established (Demo Mode)',
          sendTransaction: async (instructions: any[]) => {
            console.log('🔥 Placeholder session sendTransaction called with', instructions.length, 'instructions');
            return { type: 0, signature: 'session_tx_' + Date.now() };
          },
      });
      setIsEstablished(true);
      setError(null);
      console.log('✅ Compatibility session established');
      
    } catch (error: any) {
      console.error('❌ Failed to establish session:', error);
      setError(error.message);
      setIsEstablished(false);
      setShowFallback(true);
    }
  };

  // End session function
  const endSession = async () => {
    try {
      console.log('🔥 Ending compatibility session...');
      setError(null);
      setIsEstablished(false);
      setSessionData(null);
      setWalletPublicKey(null);
      setFogoBalance(0);
      setShowFallback(false);

      await walletDisconnect();
      console.log('✅ Compatibility session ended');
    } catch (error: any) {
      console.error('❌ Error ending session:', error);
      setError(error.message);
    }
  };

  // Send transaction function
  const sendTransaction = async (instructions: any[]): Promise<string> => {
    if (!sessionData) {
      setError('Fogo Session not established for transaction.');
      throw new Error('Fogo Session not established for transaction.');
    }
    try {
      if (sessionData.sendTransaction) {
        console.log('🔥 Using session sendTransaction placeholder');
        const result = await sessionData.sendTransaction(instructions);
        console.log('✅ Simulated transaction successful:', result.signature);
        return result.signature;
      } else {
        // Fallback simulation
        console.log('🔥 Using fallback simulation for transaction');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay
        const mockSignature = 'session_sim_tx_' + Date.now();
        console.log('✅ Fallback simulated transaction successful:', mockSignature);
        return mockSignature;
      }
    } catch (error: any) {
      console.error('❌ Error sending transaction:', error);
      setError(error.message);
      throw error;
    }
  };

  // Mock deposit/withdraw functions for demo
  const depositToCrucible = async (amount: number, crucibleId: string = 'default-crucible') => {
    console.log(`🎮 Simulating deposit of ${amount} FOGO to crucible: ${crucibleId}`);
    // Simulate a transaction
    const signature = await sendTransaction([]); // Send a mock transaction
    // Update simulated balance (deposit reduces wallet balance)
    setFogoBalance(prev => prev - amount);
    
    // Track the deposit for APY calculation
    const newDeposit = {
      amount: amount,
      timestamp: Date.now(),
      apyRate: 0.08, // 8% APY
      crucibleId: crucibleId
    };
    setDeposits(prev => [...prev, newDeposit]);
    
    console.log(`💰 Updated FOGO balance after deposit: ${fogoBalance - amount}`);
    console.log(`📈 Tracked deposit for APY calculation: ${amount} FOGO to ${crucibleId} at ${new Date().toISOString()}`);
    return { success: true, transactionId: signature };
  };

  const withdrawFromCrucible = async (amount: number, apyRewards: number = 0) => {
    const totalWithdrawal = amount + apyRewards;
    console.log(`🎮 Simulating withdrawal of ${amount} FOGO + ${apyRewards} APY rewards = ${totalWithdrawal} total from crucible`);
    // Simulate a transaction
    const signature = await sendTransaction([]); // Send a mock transaction
    // Update simulated balance (withdrawal increases wallet balance)
    setFogoBalance(prev => prev + totalWithdrawal);
    
    // Remove the corresponding deposit from tracking (FIFO - First In, First Out)
    setDeposits(prev => {
      const sortedDeposits = [...prev].sort((a, b) => a.timestamp - b.timestamp);
      let remainingAmount = amount;
      const newDeposits = [];
      
      for (const deposit of sortedDeposits) {
        if (remainingAmount <= 0) {
          newDeposits.push(deposit);
        } else if (deposit.amount <= remainingAmount) {
          remainingAmount -= deposit.amount;
          // Deposit fully withdrawn, don't add to newDeposits
        } else {
          // Partial withdrawal, reduce deposit amount
          newDeposits.push({
            ...deposit,
            amount: deposit.amount - remainingAmount
          });
          remainingAmount = 0;
        }
      }
      
      return newDeposits;
    });
    
    console.log(`💰 Updated FOGO balance after withdrawal: ${fogoBalance + totalWithdrawal}`);
    console.log(`📉 Removed deposit from APY tracking: ${amount} FOGO`);
    return { success: true, transactionId: signature };
  };

  // APY and Compound Interest calculations (can be real or mocked)
  const calculateAPY = (principal: number, timeInDays: number): number => {
    // Mock APY for demo
    return 0.08; // 8% APY for more realistic demo
  };

  const calculateCompoundInterest = (principal: number, apy: number, timeInDays: number): number => {
    const dailyRate = apy / 365;
    return principal * Math.pow(1 + dailyRate, timeInDays) - principal;
  };

  // Get APY earnings for a specific crucible
  const getCrucibleAPYEarnings = (crucibleId: string): number => {
    const crucibleDeposits = deposits.filter(deposit => deposit.crucibleId === crucibleId);
    let totalAPY = 0;
    
    crucibleDeposits.forEach(deposit => {
      // Calculate APY for full year (365 days) by default
      const dailyRate = deposit.apyRate / 365;
      const earnedAPY = deposit.amount * (Math.pow(1 + dailyRate, 365) - 1);
      totalAPY += Math.max(0, earnedAPY);
    });
    
    return totalAPY;
  };

  const refreshBalance = useCallback(async () => {
    if (walletPublicKey) {
      await fetchFogoBalance(walletPublicKey);
    }
  }, [walletPublicKey]);

  const testDeposit = async (amount: number) => {
    console.log(`🧪 Testing deposit of ${amount} FOGO`);
    // Simulate a transaction
    const signature = await sendTransaction([]); // Send a mock transaction
    // Update simulated balance
    setFogoBalance(prev => prev + amount);
    return { success: true, transactionId: signature };
  };

  const contextValue: FogoSessionContextType = {
    isEstablished,
    walletPublicKey,
    sessionData,
    fogoBalance,
    liveAPYEarnings,
    connect,
    endSession,
    sendTransaction,
    depositToCrucible,
    withdrawFromCrucible,
    calculateAPY,
    calculateCompoundInterest,
    getCrucibleAPYEarnings,
    refreshBalance,
    testDeposit,
    error,
  };

  return (
    <FogoSessionContext.Provider value={contextValue}>
      {children}
      {showFallback && (
        <WalletFallback
          walletStatus={{
            isInstalled: fogoWallet.isInstalled,
            isUnlocked: fogoWallet.isUnlocked,
            isAvailable: fogoWallet.connected,
            error: fogoWallet.error,
          }}
          onRetry={() => connect()}
        />
      )}
    </FogoSessionContext.Provider>
  );
}

// FOGO Sessions Hook
export function useSession() {
  const context = useContext(FogoSessionContext);
  // When no provider is mounted, fall back to WalletContext so callers still work
  const wallet = useWallet();

  if (!context) {
    return {
      isEstablished: wallet.connected && !!wallet.publicKey,
      walletPublicKey: wallet.publicKey,
      sessionData: null,
      fogoBalance: 0,
      liveAPYEarnings: 0,
      connect: async () => {
        await wallet.connect();
      },
      endSession: async () => {
        await wallet.disconnect();
      },
      sendTransaction: async (_instructions: any[]) => {
        // Callers usually track only the signature string
        console.log('📤 sendTransaction placeholder called via useSession fallback');
        return 'wallet_tx_' + Date.now();
      },
      depositToCrucible: async (_amount: number, _crucibleId?: string) => {
        console.warn('depositToCrucible is deprecated in useSession fallback');
        return { success: false, transactionId: '' };
      },
      withdrawFromCrucible: async (_amount: number, _apyRewards?: number) => {
        console.warn('withdrawFromCrucible is deprecated in useSession fallback');
        return { success: false, transactionId: '' };
      },
      calculateAPY: () => 0,
      calculateCompoundInterest: () => 0,
      getCrucibleAPYEarnings: () => 0,
      refreshBalance: async () => {},
      testDeposit: async () => ({ success: false, transactionId: '' }),
      error: null,
    };
  }

  return context;
}

// FOGO Sessions Button with Pyron/Brasa Finance style
export function FogoSessionsButton() {
  const { isEstablished, connect, endSession, walletPublicKey, sessionData, fogoBalance, liveAPYEarnings, refreshBalance, error } = useSession();
  const { balances, updateBalance } = useBalance();
  
  // Calculate LP balances from leveraged positions
  React.useEffect(() => {
    console.log('🔍 LP Balance Calculation Effect Triggered')
    console.log('   isEstablished:', isEstablished)
    console.log('   walletPublicKey:', walletPublicKey?.toBase58())
    
    // DON'T reset LP balances here - they might have been just added by deposit modals
    // We'll only update them if we calculate a different value
    console.log('🔄 Starting LP balance calculation (preserving existing balances)...')
    
    if (!isEstablished || !walletPublicKey) {
      // Wallet not connected - don't reset balances, just return
      console.log('🚫 Wallet not connected, skipping LP balance calculation')
      return
    }

    const calculateLPBalances = async () => {
      try {
        if (!walletPublicKey) {
          return
        }

        // Get current wallet address in base58 format (same format used when storing positions)
        const currentWalletAddress = walletPublicKey.toBase58()
        
        // Fetch leveraged positions from all crucibles
        // Note: In a real implementation, this would be done in a component with proper hooks
        // For now, we calculate based on stored positions
        let cFOGO_USDC_LP = 0
        let cFORGE_USDC_LP = 0

        // Calculate LP tokens from both standard LP positions and leveraged positions
        // LP token formula: sqrt(cToken_amount * USDC_amount) for constant product
        
        // 1. Get standard LP positions from localStorage
        const standardLPPositions = JSON.parse(localStorage.getItem('lp_positions') || '[]')
        console.log('📊 Checking standard LP positions:', standardLPPositions.length, 'Current wallet:', currentWalletAddress)
        
        // Filter positions strictly by owner - must match exactly AND be open AND have valid data
        const myStandardPositions = standardLPPositions.filter((position: any) => {
          const ownerMatch = position.owner === currentWalletAddress || 
                            position.owner === walletPublicKey.toString()
          const isActuallyOpen = position.isOpen === true // Strict check
          const hasValidAmounts = typeof position.baseAmount === 'number' && position.baseAmount > 0 && 
                                 typeof position.usdcAmount === 'number' && position.usdcAmount > 0
          
          // Log each position for debugging
          if (ownerMatch) {
            console.log('  Position:', position.id, 'isOpen:', position.isOpen, 'hasValidAmounts:', hasValidAmounts, 'baseAmount:', position.baseAmount, 'usdcAmount:', position.usdcAmount)
          }
          
          return ownerMatch && isActuallyOpen && hasValidAmounts
        })
        console.log('📊 My standard LP positions (after filtering):', myStandardPositions.length)
        
        myStandardPositions.forEach((position: any) => {
          // Validate position has required fields
          if (typeof position.baseAmount === 'number' && position.baseAmount > 0 && 
              typeof position.usdcAmount === 'number' && position.usdcAmount > 0) {
            if (position.baseToken === 'FOGO') {
              // For standard LP: baseAmount becomes cToken via exchange rate, USDC is deposited
              // Convert base amount to cToken amount
              const cTokenAmount = position.baseAmount * 1.045 // Exchange rate
              const baseTokenPrice = 0.5 // FOGO price
              const cTokenValueUSD = cTokenAmount * baseTokenPrice
              const usdcAmount = position.usdcAmount
              // LP tokens = sqrt(cTokenValueUSD * USDCAmount) - both in USD value terms
              const lpAmount = Math.sqrt(cTokenValueUSD * usdcAmount) || 0
              cFOGO_USDC_LP += lpAmount
              console.log('➕ Adding cFOGO/USDC LP:', lpAmount, 'from position:', position.id, 'cTokenValueUSD:', cTokenValueUSD, 'usdcAmount:', usdcAmount)
            } else if (position.baseToken === 'FORGE') {
              const cTokenAmount = position.baseAmount * 1.045
              const baseTokenPrice = 0.002 // FORGE price
              const cTokenValueUSD = cTokenAmount * baseTokenPrice
              const usdcAmount = position.usdcAmount
              const lpAmount = Math.sqrt(cTokenValueUSD * usdcAmount) || 0
              cFORGE_USDC_LP += lpAmount
              console.log('➕ Adding cFORGE/USDC LP:', lpAmount, 'from position:', position.id, 'cTokenValueUSD:', cTokenValueUSD, 'usdcAmount:', usdcAmount)
            }
          }
        })
        
        // 2. Get leveraged positions from localStorage
        const leveragedPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]')
        console.log('📊 Checking leveraged positions:', leveragedPositions.length)
        
        // Filter positions strictly by owner - must match exactly AND be open AND have valid data
        const myLeveragedPositions = leveragedPositions.filter((position: any) => {
          const ownerMatch = position.owner === currentWalletAddress || 
                            position.owner === walletPublicKey.toString() ||
                            position.owner === walletPublicKey.toBase58() // Try all formats
          const isActuallyOpen = position.isOpen === true // Strict check
          const hasValidAmounts = typeof position.collateral === 'number' && position.collateral > 0 && 
                                 typeof position.borrowedUSDC === 'number' && position.borrowedUSDC >= 0 // Allow 0 for 2x leverage
          
          // Log each position for debugging
          console.log('  Checking leveraged position:', {
            id: position.id,
            positionOwner: position.owner,
            currentWallet: currentWalletAddress,
            ownerMatch,
            isOpen: position.isOpen,
            isActuallyOpen,
            hasValidAmounts,
            collateral: position.collateral,
            borrowedUSDC: position.borrowedUSDC,
            leverageFactor: position.leverageFactor,
            matches: ownerMatch && isActuallyOpen && hasValidAmounts
          })
          
          return ownerMatch && isActuallyOpen && hasValidAmounts
        })
        console.log('📊 My leveraged positions (after filtering):', myLeveragedPositions.length, myLeveragedPositions)
        
        myLeveragedPositions.forEach((position: any) => {
          // Validate position has required fields
          if (typeof position.collateral === 'number' && position.collateral > 0 && 
              typeof position.borrowedUSDC === 'number' && position.borrowedUSDC >= 0) {
            console.log('✅ Processing leveraged position:', position.id, position.token, position.collateral, position.borrowedUSDC, 'depositUSDC:', position.depositUSDC)
            // For leveraged positions: calculate total USDC from leverage factor
            // For 1.5x: borrowedUSDC = 50%, depositUSDC = 50% (equal amounts)
            // For 2x: borrowedUSDC = 100%, depositUSDC = 0%
            const leverageFactor = position.leverageFactor || 2.0
            const baseTokenPrice = position.token === 'FOGO' ? 0.5 : 0.002
            const collateralValueUSD = position.collateral * baseTokenPrice
            
            // Calculate total USDC needed for the LP position
            // For leveraged positions: totalUSDC = deposited USDC + borrowed USDC
            // This represents the actual USDC in the LP pool
            
            // Calculate total USDC correctly based on leverage factor
            // For leveraged positions: we need to reconstruct the original collateral value from borrowedUSDC
            // borrowedUSDC = originalCollateralValue * (leverageFactor - 1)
            // So: originalCollateralValue = borrowedUSDC / (leverageFactor - 1)
            // For 1.5x: borrowedUSDC = 0.5 * originalCollateralValue, so originalCollateralValue = borrowedUSDC / 0.5 = borrowedUSDC * 2
            // For 2x: borrowedUSDC = 1.0 * originalCollateralValue, so originalCollateralValue = borrowedUSDC
            
            let originalCollateralValue: number
            if (leverageFactor === 1.5) {
              originalCollateralValue = position.borrowedUSDC / 0.5 // borrowedUSDC = 0.5 * originalCollateralValue
            } else if (leverageFactor === 2.0) {
              originalCollateralValue = position.borrowedUSDC // borrowedUSDC = 1.0 * originalCollateralValue
            } else {
              originalCollateralValue = collateralValueUSD // Fallback
            }
            
            // Get deposited USDC from position or calculate it
            // For 1.5x: depositUSDC = 0.5 * originalCollateralValue (equal to borrowedUSDC)
            // For 2x: depositUSDC = 0
            let depositUSDC = position.depositUSDC
            if (depositUSDC === undefined || depositUSDC === null) {
              if (leverageFactor === 1.5) {
                depositUSDC = originalCollateralValue * 0.5 // 50% deposited, 50% borrowed
              } else {
                depositUSDC = 0 // 2x: all borrowed, nothing deposited
              }
            }
            
            // Calculate total USDC: deposited + borrowed
            const totalUSDC = depositUSDC + position.borrowedUSDC
            
            // collateralValueUSD is already defined above (line 624)
            // It represents the collateral value AFTER fee (without exchange rate)
            
            // Calculate cToken value (with exchange rate) - for LP token calculation
            const cTokenAmount = position.collateral * 1.045 // Exchange rate
            const cTokenValueUSD = cTokenAmount * baseTokenPrice
            
            // Calculate LP token amount using constant product formula: LP = sqrt(valueA * valueB)
            // For LP pools, LP tokens represent a share of the pool
            // The LP token amount is calculated using the constant product formula
            const lpTokenAmount = Math.sqrt(cTokenValueUSD * totalUSDC) || 0
            
            // Calculate total position value: deposit + borrow - transaction fee
            // Total = collateral value (after fee) + deposited USDC + borrowed USDC
            // This represents: What I deposit + what I borrow - transaction fee
            const totalPositionValue = collateralValueUSD + totalUSDC
            
            // The LP token value should represent the total position value
            // LP tokens represent a share of the total liquidity in the pool
            // So the value of LP tokens = total liquidity = cTokenValueUSD + totalUSDC
            // But we want to show deposit + borrow - fee, so use collateralValueUSD (without exchange rate) + totalUSDC
            const lpTokenValue = totalPositionValue
            
            if (position.token === 'FOGO') {
              // Store LP token value (total position value) as LP balance
              // This is what the user sees in their wallet: deposit + borrow - fee
              cFOGO_USDC_LP += lpTokenValue
              console.log('➕ Adding leveraged cFOGO/USDC LP value:', lpTokenValue, 'from position:', position.id, 'collateral:', position.collateral, 'depositUSDC:', depositUSDC, 'borrowedUSDC:', position.borrowedUSDC, 'totalUSDC:', totalUSDC, 'collateralValueUSD:', collateralValueUSD, 'cTokenValueUSD:', cTokenValueUSD, 'totalPositionValue:', totalPositionValue, 'lpTokenAmount:', lpTokenAmount, 'lpTokenValue:', lpTokenValue, 'leverage:', leverageFactor)
            } else if (position.token === 'FORGE') {
              // collateralValueUSD is already defined above (same calculation for both tokens)
              // Calculate LP token value (total position value)
              const totalPositionValueForge = collateralValueUSD + totalUSDC
              const lpTokenAmountForge = Math.sqrt(cTokenValueUSD * totalUSDC) || 0
              const lpTokenValueForge = totalPositionValueForge
              cFORGE_USDC_LP += lpTokenValueForge
              console.log('➕ Adding leveraged cFORGE/USDC LP value:', lpTokenValueForge, 'from position:', position.id, 'collateral:', position.collateral, 'depositUSDC:', depositUSDC, 'borrowedUSDC:', position.borrowedUSDC, 'totalUSDC:', totalUSDC, 'collateralValueUSD:', collateralValueUSD, 'cTokenValueUSD:', cTokenValueUSD, 'totalPositionValue:', totalPositionValueForge, 'lpTokenAmount:', lpTokenAmountForge, 'lpTokenValue:', lpTokenValueForge, 'leverage:', leverageFactor)
            }
          }
        })
        
        console.log('💰 Final LP balances - cFOGO/USDC:', cFOGO_USDC_LP, 'cFORGE/USDC:', cFORGE_USDC_LP)
        
        // ALWAYS update balances with calculated values from positions
        // This is the single source of truth for LP balances
        console.log('💾 Updating BalanceContext with calculated positions: cFOGO/USDC LP =', cFOGO_USDC_LP, 'cFORGE/USDC LP =', cFORGE_USDC_LP)
        updateBalance('cFOGO/USDC LP', cFOGO_USDC_LP)
        updateBalance('cFORGE/USDC LP', cFORGE_USDC_LP)
        console.log('✅ LP balances updated in BalanceContext')
        
        // DEVELOPMENT: Auto-cleanup stale positions (positions with invalid data or zero amounts)
        // This helps remove test positions or corrupted data
        let cleanedStandard = false
        let cleanedLeveraged = false
        
        if (myStandardPositions.length > 0) {
          const invalidStandard = standardLPPositions.filter((position: any) => {
            const ownerMatch = position.owner === currentWalletAddress || 
                              position.owner === walletPublicKey.toString()
            if (!ownerMatch) return false
            
            // Mark as invalid if it's open but has zero or invalid amounts
            const hasZeroAmounts = !position.baseAmount || position.baseAmount <= 0 || 
                                  !position.usdcAmount || position.usdcAmount <= 0
            return position.isOpen === true && hasZeroAmounts
          })
          
          if (invalidStandard.length > 0) {
            console.log('🧹 Cleaning up invalid standard LP positions:', invalidStandard.map((p: any) => p.id))
            const validPositions = standardLPPositions.filter((position: any) => {
              const isInvalid = invalidStandard.some((inv: any) => inv.id === position.id)
              return !isInvalid
            })
            localStorage.setItem('lp_positions', JSON.stringify(validPositions))
            cleanedStandard = true
          }
        }
        
        if (myLeveragedPositions.length > 0) {
          const invalidLeveraged = leveragedPositions.filter((position: any) => {
            const ownerMatch = position.owner === currentWalletAddress || 
                              position.owner === walletPublicKey.toString()
            if (!ownerMatch) return false
            
            // Mark as invalid if it's open but has zero or invalid amounts
            const hasZeroAmounts = !position.collateral || position.collateral <= 0 || 
                                  !position.borrowedUSDC || position.borrowedUSDC <= 0
            return position.isOpen === true && hasZeroAmounts
          })
          
          if (invalidLeveraged.length > 0) {
            console.log('🧹 Cleaning up invalid leveraged positions:', invalidLeveraged.map((p: any) => p.id))
            const validPositions = leveragedPositions.filter((position: any) => {
              const isInvalid = invalidLeveraged.some((inv: any) => inv.id === position.id)
              return !isInvalid
            })
            localStorage.setItem('leveraged_positions', JSON.stringify(validPositions))
            cleanedLeveraged = true
          }
        }
        
        // If we cleaned up invalid positions, recalculate
        if (cleanedStandard || cleanedLeveraged) {
          console.log('🔄 Recalculating after cleanup...')
          setTimeout(() => calculateLPBalances(), 200)
          return // Exit early, recalculation will happen
        }
        
        // DEVELOPMENT: Log positions for debugging
        if (myStandardPositions.length > 0 || myLeveragedPositions.length > 0) {
          console.warn('⚠️ Found open positions in localStorage. If these should be closed:')
          console.warn('   1. Go to Portfolio page and close them through the UI')
          console.warn('   2. Or run: localStorage.removeItem("lp_positions") and localStorage.removeItem("leveraged_positions") in console')
          console.warn('   3. Or add a cleanup button (coming soon)')
          console.warn('   Positions found:', {
            standard: myStandardPositions.map((p: any) => ({ id: p.id, baseAmount: p.baseAmount, usdcAmount: p.usdcAmount })),
            leveraged: myLeveragedPositions.map((p: any) => ({ id: p.id, collateral: p.collateral, borrowedUSDC: p.borrowedUSDC }))
          })
        }
      } catch (error) {
        console.error('❌ Error calculating LP balances:', error)
        // On error, ALWAYS reset to 0
        updateBalance('cFOGO/USDC LP', 0)
        updateBalance('cFORGE/USDC LP', 0)
      }
    }
    
    // Run calculation immediately - don't wait
    calculateLPBalances()
    
    // Also run after multiple delays to catch any async updates
    const timeoutId1 = setTimeout(() => {
      console.log('🔄 Recalculating LP balances after 100ms...')
      calculateLPBalances()
    }, 100)
    
    const timeoutId2 = setTimeout(() => {
      console.log('🔄 Recalculating LP balances after 500ms...')
      calculateLPBalances()
    }, 500)
    
    const timeoutId3 = setTimeout(() => {
      console.log('🔄 Recalculating LP balances after 1000ms...')
      calculateLPBalances()
    }, 1000)
    
    // Listen for leveraged position changes - calculate after a short delay
    // This ensures localStorage is fully updated before we read it
    const handleLVFChange = () => {
      console.log('🔄 Position changed, recalculating LP balances...')
      // Delay slightly to ensure localStorage is fully written
      setTimeout(() => {
        calculateLPBalances()
      }, 100)
    }
    
    window.addEventListener('lvfPositionOpened', handleLVFChange)
    window.addEventListener('lvfPositionClosed', handleLVFChange)
    window.addEventListener('lpPositionOpened', handleLVFChange)
    window.addEventListener('lpPositionClosed', handleLVFChange)
    
    // Also listen for storage changes (in case localStorage is updated elsewhere)
    const handleStorageChange = (e: StorageEvent | Event) => {
      const key = (e as StorageEvent).key
      const eventType = e.type
      if (key === 'lp_positions' || key === 'leveraged_positions' || eventType === 'forceRecalculateLP') {
        console.log('🔄 Storage changed or forceRecalculateLP triggered, recalculating LP balances...', { key, eventType })
        // Calculate immediately for forceRecalculateLP, with delay for storage events
        if (eventType === 'forceRecalculateLP') {
          calculateLPBalances()
        } else {
          // Delay slightly to ensure localStorage is fully written
          setTimeout(() => {
            calculateLPBalances()
          }, 100)
        }
      }
    }
    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('forceRecalculateLP', handleStorageChange)
    
    return () => {
      clearTimeout(timeoutId1)
      clearTimeout(timeoutId2)
      clearTimeout(timeoutId3)
      window.removeEventListener('lvfPositionOpened', handleLVFChange)
      window.removeEventListener('lvfPositionClosed', handleLVFChange)
      window.removeEventListener('lpPositionOpened', handleLVFChange)
      window.removeEventListener('lpPositionClosed', handleLVFChange)
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('forceRecalculateLP', handleStorageChange)
    }
  }, [isEstablished, walletPublicKey, updateBalance])
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const walletPopupRef = useRef<HTMLDivElement>(null);
  
  // Listen for balance updates from crucible operations
  useEffect(() => {
    const handleBalanceUpdate = (event: CustomEvent) => {
      console.log('🔄 Balance update received:', event.detail);
      // Refresh the balance from context
      refreshBalance();
    };
    window.addEventListener('fogoBalanceUpdated', handleBalanceUpdate as EventListener);
    return () => {
      window.removeEventListener('fogoBalanceUpdated', handleBalanceUpdate as EventListener);
    };
  }, [refreshBalance]);

  // Handle click outside to close wallet popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (walletPopupRef.current && !walletPopupRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleConnect = async () => {
    console.log('🔥 FOGO Sessions button clicked!');
    setIsConnecting(true);
    try {
      await connect();
    } catch (e) {
      console.error('Error connecting:', e);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await endSession();
      setIsOpen(false);
    } catch (e) {
      console.error('Error during disconnect:', e);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleClearAllPositions = () => {
    if (!walletPublicKey) return
    
    const currentWalletAddress = walletPublicKey.toBase58()
    
    // Confirm action
    if (!window.confirm('⚠️ Clear ALL LP and leveraged positions from localStorage?\n\nThis will remove all positions for this wallet. This action cannot be undone.')) {
      return
    }
    
    try {
      // Clear standard LP positions for this wallet
      const standardLPPositions = JSON.parse(localStorage.getItem('lp_positions') || '[]')
      const filteredStandard = standardLPPositions.filter((position: any) => {
        const ownerMatch = position.owner === currentWalletAddress || 
                          position.owner === walletPublicKey.toString()
        return !ownerMatch // Keep positions that DON'T match this wallet
      })
      localStorage.setItem('lp_positions', JSON.stringify(filteredStandard))
      
      // Clear leveraged positions for this wallet
      const leveragedPositions = JSON.parse(localStorage.getItem('leveraged_positions') || '[]')
      const filteredLeveraged = leveragedPositions.filter((position: any) => {
        const ownerMatch = position.owner === currentWalletAddress || 
                          position.owner === walletPublicKey.toString()
        return !ownerMatch // Keep positions that DON'T match this wallet
      })
      localStorage.setItem('leveraged_positions', JSON.stringify(filteredLeveraged))
      
      console.log('🧹 Cleared all positions for wallet:', currentWalletAddress)
      
      // Reset LP balances to 0
      updateBalance('cFOGO/USDC LP', 0)
      updateBalance('cFORGE/USDC LP', 0)
      
      // Trigger recalculation
      window.dispatchEvent(new CustomEvent('lpPositionClosed'))
      window.dispatchEvent(new CustomEvent('lvfPositionClosed'))
      
      // Hard refresh to reset all state
      window.location.reload()
    } catch (error) {
      console.error('❌ Error clearing positions:', error)
      alert('❌ Error clearing positions. Check console for details.')
    }
  };

  const handleRefreshBalance = async () => {
    setIsLoadingBalance(true);
    await refreshBalance();
    setIsLoadingBalance(false);
  };

  const copyToClipboard = () => {
    if (walletPublicKey) {
      navigator.clipboard.writeText(walletPublicKey.toString());
    }
  };

  const openFaucet = () => {
    if (walletPublicKey) {
      window.open(`https://www.gas.zip/faucet/fogo?address=${walletPublicKey.toString()}`, '_blank');
    }
  };

  // Show connected state with Pyron/Brasa Finance style wallet popup
  if (isEstablished && sessionData && walletPublicKey) {
    const shortAddress = `${walletPublicKey.toString().slice(0, 6)}...${walletPublicKey.toString().slice(-6)}`;
    
    return (
           <div className="relative z-50">
             {/* Header Wallet Button - Dark Theme */}
        <button
          onClick={() => setIsOpen(true)}
          className="hidden md:flex items-center space-x-3 panel-muted text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 border border-fogo-gray-500 hover:border-fogo-primary/50"
        >
          <div className="w-6 h-6 bg-gradient-to-r from-fogo-primary to-fogo-secondary rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14.724 0h-8.36L5.166 4.804h-3.61L.038 10.898a1.28 1.28 0 0 0 1.238 1.591h3.056L1.465 24l9.744-10.309c.771-.816.195-2.162-.925-2.162h-4.66l1.435-5.765h7.863l1.038-4.172A1.28 1.28 0 0 0 14.723 0ZM26.09 18.052h-2.896V5.58h9.086v2.525h-6.19v2.401h5.636v2.525H26.09v5.02Zm13.543.185c-1.283 0-2.404-.264-3.365-.793a5.603 5.603 0 0 1-2.24-2.233c-.533-.96-.8-2.09-.8-3.394 0-1.304.267-2.451.8-3.41a5.55 5.55 0 0 1 2.24-2.225c.96-.523 2.08-.785 3.365-.785 1.285 0 2.42.259 3.381.777a5.474 5.474 0 0 1 2.233 2.218c.528.96.793 2.1.793 3.425 0 1.324-.268 2.437-.801 3.403a5.56 5.56 0 0 1-2.24 2.233c-.961.523-2.081.785-3.366.785v-.001Zm.016-2.525c1.118 0 1.98-.353 2.586-1.062.606-.708.91-1.652.91-2.833 0-1.182-.304-2.137-.91-2.84-.605-.704-1.473-1.055-2.602-1.055-1.128 0-1.984.351-2.595 1.054-.61.704-.916 1.645-.916 2.825 0 1.18.306 2.14.916 2.85.61.708 1.48 1.061 2.61 1.061Z" />
            </svg>
          </div>
          <span className="font-satoshi font-medium text-base">{shortAddress}</span>
        </button>

             {/* Modern Wallet Popup */}
             {isOpen && typeof window !== 'undefined' && createPortal(
               <div 
                 className="wallet-popup-overlay flex items-start justify-center p-4"
               >
                 {/* Backdrop */}
                 <div 
                   className="absolute inset-0 bg-black/20 backdrop-blur-sm"
                   onClick={() => setIsOpen(false)}
                 />
                 {/* Popup Container */}
                 <div className="max-w-7xl mx-auto w-full flex justify-end">
                   {/* Popup */}
                   <div 
                     ref={walletPopupRef} 
                     className="wallet-popup-content panel rounded-3xl shadow-2xl border border-fogo-primary/30 w-80 max-h-[90vh] overflow-hidden backdrop-blur-xl flex flex-col"
                   >
            {/* Header */}
            <div className="relative bg-gradient-to-r from-fogo-primary via-fogo-primary to-fogo-secondary p-4 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse"></div>
              <div className="relative flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="relative w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center backdrop-blur-sm ring-1 ring-white/10 hover:ring-white/20 transition-all duration-300">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M14.724 0h-8.36L5.166 4.804h-3.61L.038 10.898a1.28 1.28 0 0 0 1.238 1.591h3.056L1.465 24l9.744-10.309c.771-.816.195-2.162-.925-2.162h-4.66l1.435-5.765h7.863l1.038-4.172A1.28 1.28 0 0 0 14.723 0ZM26.09 18.052h-2.896V5.58h9.086v2.525h-6.19v2.401h5.636v2.525H26.09v5.02Zm13.543.185c-1.283 0-2.404-.264-3.365-.793a5.603 5.603 0 0 1-2.24-2.233c-.533-.96-.8-2.09-.8-3.394 0-1.304.267-2.451.8-3.41a5.55 5.55 0 0 1 2.24-2.225c.96-.523 2.08-.785 3.365-.785 1.285 0 2.42.259 3.381.777a5.474 5.474 0 0 1 2.233 2.218c.528.96.793 2.1.793 3.425 0 1.324-.268 2.437-.801 3.403a5.56 5.56 0 0 1-2.24 2.233c-.961.523-2.081.785-3.366.785v-.001Zm.016-2.525c1.118 0 1.98-.353 2.586-1.062.606-.708.91-1.652.91-2.833 0-1.182-.304-2.137-.91-2.84-.605-.704-1.473-1.055-2.602-1.055-1.128 0-1.984.351-2.595 1.054-.61.704-.916 1.645-.916 2.825 0 1.18.306 2.14.916 2.85.61.708 1.48 1.061 2.61 1.061Zm13.703 2.525c-1.211 0-2.28-.27-3.203-.808a5.647 5.647 0 0 1-2.163-2.256c-.517-.964-.776-2.079-.776-3.34 0-1.263.267-2.423.8-3.388a5.635 5.635 0 0 1 2.256-2.249c.97-.533 2.096-.801 3.38-.801 1.057 0 1.992.182 2.803.547a5.017 5.017 0 0 1 1.986 1.563c.513.677.837 1.489.971 2.432H56.39c-.103-.626-.394-1.113-.878-1.463-.482-.348-1.103-.523-1.863-.523-.718 0-1.344.16-1.878.476-.533.32-.945.77-1.231 1.356-.288.584-.43 1.277-.43 2.078 0 .801.148 1.515.445 2.11a3.27 3.27 0 0 0 1.262 1.379c.544.322 1.186.485 1.925.485.544 0 1.03-.084 1.454-.253.426-.17.762-.4 1.009-.693a1.5 1.5 0 0 0 .37-.993v-.37H53.51V11.31h3.865c.677 0 1.185.161 1.525.485.337.323.507.808.507 1.455v4.804h-2.648V16.73h-.077c-.299.503-.724.88-1.278 1.132-.554.252-1.237.377-2.048.377l-.003-.001Zm13.911 0c-1.283 0-2.405-.264-3.366-.793a5.603 5.603 0 0 1-2.24-2.233c-.533-.96-.8-2.09-.8-3.394 0-1.304.267-2.451.8-3.41a5.55 5.55 0 0 1 2.24-2.225c.961-.523 2.08-.785 3.366-.785 1.284 0 2.42.259 3.38.777a5.474 5.474 0 0 1 2.234 2.218c.528.96.792 2.1.792 3.425 0 1.324-.268 2.437-.801 3.403a5.56 5.56 0 0 1-2.24 2.233c-.96.523-2.08.785-3.365.785v-.001Zm.015-2.525c1.118 0 1.981-.353 2.587-1.062.605-.708.909-1.652.909-2.833 0-1.182-.304-2.137-.91-2.84-.605-.704-1.473-1.055-2.601-1.055-1.129 0-1.985.351-2.595 1.054-.611.704-.916 1.645-.916 2.825 0 1.18.305 2.14.916 2.85.61.708 1.48 1.061 2.61 1.061Z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-heading text-base text-white">FOGO Wallet</div>
                    <div className="text-xs text-white/90 font-mono font-medium">{shortAddress}</div>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 hover:bg-white/20 rounded-lg transition-all duration-200 group hover:scale-110"
                >
                  <svg className="w-4 h-4 text-white group-hover:rotate-90 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 panel-muted">
            {/* Token Balances */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-heading text-white">Assets</h3>
                <div className="w-1.5 h-1.5 bg-fogo-success rounded-full animate-pulse" title="Live"></div>
              </div>
              {balances.filter(balance => ['FOGO', 'USDC', 'FORGE', 'cFOGO', 'cFORGE', 'cFOGO/USDC LP', 'cFORGE/USDC LP'].includes(balance.symbol)).map((balance) => {
                const displaySymbol = balance.symbol
                return (
                  <div 
                    key={balance.symbol} 
                    className="group panel-muted rounded-xl p-3 border border-fogo-gray-700/50 hover:border-fogo-primary/50 transition-all duration-300 hover:shadow-md hover:shadow-fogo-primary/10"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <div className="relative w-6 h-6 rounded-lg flex items-center justify-center overflow-hidden bg-gradient-to-br from-fogo-gray-700 to-fogo-gray-800 ring-1 ring-fogo-gray-600/50 group-hover:ring-fogo-primary/30 transition-all duration-300">
                          {balance.symbol === 'FOGO' ? (
                            <img 
                              src="/fogo-logo.png" 
                              alt="FOGO" 
                              className="w-full h-full object-contain p-0.5 group-hover:scale-110 transition-transform duration-300"
                            />
                          ) : balance.symbol === 'FORGE' ? (
                            <img 
                              src="/forgo logo straight.png" 
                              alt="FORGE" 
                              className="w-full h-full object-contain p-0.5 group-hover:scale-110 transition-transform duration-300"
                            />
                          ) : balance.symbol === 'cFOGO' ? (
                            <img 
                              src="/fogo-logo.png" 
                              alt="cFOGO" 
                              className="w-full h-full object-contain p-0.5 group-hover:scale-110 transition-transform duration-300"
                            />
                          ) : balance.symbol === 'cFORGE' ? (
                            <img 
                              src="/forgo logo straight.png" 
                              alt="cFORGE" 
                              className="w-full h-full object-contain p-0.5 group-hover:scale-110 transition-transform duration-300"
                            />
                          ) : balance.symbol === 'USDC' ? (
                            <img 
                              src="/usd-coin-usdc-logo-last.png" 
                              alt="USDC" 
                              className="w-full h-full object-contain p-0.5 group-hover:scale-110 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-fogo-primary/20 to-fogo-secondary/20 rounded-lg flex items-center justify-center group-hover:from-fogo-primary/30 group-hover:to-fogo-secondary/30 transition-all duration-300">
                              <span className="text-fogo-primary font-bold text-[8px]">{displaySymbol.charAt(0)}</span>
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-fogo-gray-300 group-hover:text-white transition-colors duration-200">
                            {displaySymbol}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-base font-heading text-white group-hover:text-fogo-primary-light transition-colors duration-200">
                        {balance.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs font-satoshi-light text-fogo-gray-400">
                        ≈ ${balance.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                      </div>
                    </div>
                  </div>
                )
              })}
              </div>

            </div>

              {/* Action Buttons - Fixed at bottom */}
              <div className="p-3 border-t border-fogo-gray-700/50 bg-gradient-to-t from-fogo-gray-900 via-fogo-gray-900 to-transparent space-y-2 backdrop-blur-sm">
                {/* Get Tokens Button */}
                <button
                  onClick={openFaucet}
                  className="group relative w-full flex items-center justify-center space-x-2 p-2.5 bg-gradient-to-r from-fogo-primary via-fogo-primary to-fogo-secondary hover:from-fogo-primary-dark hover:via-fogo-primary hover:to-fogo-secondary-dark text-white rounded-xl transition-all duration-300 font-medium text-sm shadow-md hover:shadow-lg hover:shadow-fogo-primary/20 transform hover:-translate-y-0.5 border border-fogo-primary/20 hover:border-fogo-primary/40 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 -translate-x-full group-hover:translate-x-full"></div>
                  <svg className="w-4 h-4 relative z-10 transform group-hover:rotate-12 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="font-satoshi relative z-10 text-sm">Get FOGO Tokens</span>
                </button>

                {/* Clear All Positions Button */}
                <button
                  onClick={handleClearAllPositions}
                  className="w-full flex items-center justify-center space-x-1.5 p-2.5 bg-gradient-to-r from-fogo-warning/10 via-fogo-warning/5 to-fogo-warning/10 hover:from-fogo-warning/20 hover:via-fogo-warning/10 hover:to-fogo-warning/20 text-fogo-warning hover:text-fogo-warning-light rounded-xl transition-all duration-300 font-medium text-sm border border-fogo-warning/20 hover:border-fogo-warning/40 transform hover:-translate-y-0.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span className="font-satoshi text-sm">Clear All Positions</span>
                </button>

                {/* Disconnect Button */}
                <button
                  onClick={handleDisconnect}
                  className="w-full flex items-center justify-center space-x-1.5 p-2.5 bg-gradient-to-r from-fogo-gray-800/80 to-fogo-gray-800/60 hover:from-fogo-gray-700 hover:to-fogo-gray-700 text-fogo-gray-300 hover:text-white rounded-xl transition-all duration-300 font-medium text-sm border border-fogo-gray-600/50 hover:border-fogo-gray-500 transform hover:-translate-y-0.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span className="font-satoshi text-sm">Disconnect Wallet</span>
                </button>
              </div>
          </div>
                 </div>
               </div>,
               document.body
             )}
      </div>
    );
  }

       // Initial login button - FOGO style
  return (
             <div className="relative z-50">
      <button
            onClick={handleConnect}
        disabled={isConnecting}
            className="hidden md:flex items-center space-x-3 panel-muted text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 border border-fogo-gray-500 hover:border-fogo-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
        <div className="w-6 h-6 bg-gradient-to-r from-fogo-primary to-fogo-secondary rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14.724 0h-8.36L5.166 4.804h-3.61L.038 10.898a1.28 1.28 0 0 0 1.238 1.591h3.056L1.465 24l9.744-10.309c.771-.816.195-2.162-.925-2.162h-4.66l1.435-5.765h7.863l1.038-4.172A1.28 1.28 0 0 0 14.723 0ZM26.09 18.052h-2.896V5.58h9.086v2.525h-6.19v2.401h5.636v2.525H26.09v5.02Zm13.543.185c-1.283 0-2.404-.264-3.365-.793a5.603 5.603 0 0 1-2.24-2.233c-.533-.96-.8-2.09-.8-3.394 0-1.304.267-2.451.8-3.41a5.55 5.55 0 0 1 2.24-2.225c.96-.523 2.08-.785 3.365-.785 1.285 0 2.42.259 3.381.777a5.474 5.474 0 0 1 2.233 2.218c.528.96.793 2.1.793 3.425 0 1.324-.268 2.437-.801 3.403a5.56 5.56 0 0 1-2.24 2.233c-.961.523-2.081.785-3.366.785v-.001Zm.016-2.525c1.118 0 1.98-.353 2.586-1.062.606-.708.91-1.652.91-2.833 0-1.182-.304-2.137-.91-2.84-.605-.704-1.473-1.055-2.602-1.055-1.128 0-1.984.351-2.595 1.054-.61.704-.916 1.645-.916 2.825 0 1.18.306 2.14.916 2.85.61.708 1.48 1.061 2.61 1.061Zm13.703 2.525c-1.211 0-2.28-.27-3.203-.808a5.647 5.647 0 0 1-2.163-2.256c-.517-.964-.776-2.079-.776-3.34 0-1.263.267-2.423.8-3.388a5.635 5.635 0 0 1 2.256-2.249c.97-.533 2.096-.801 3.38-.801 1.057 0 1.992.182 2.803.547a5.017 5.017 0 0 1 1.986 1.563c.513.677.837 1.489.971 2.432H56.39c-.103-.626-.394-1.113-.878-1.463-.482-.348-1.103-.523-1.863-.523-.718 0-1.344.16-1.878.476-.533.32-.945.77-1.231 1.356-.288.584-.43 1.277-.43 2.078 0 .801.148 1.515.445 2.11a3.27 3.27 0 0 0 1.262 1.379c.544.322 1.186.485 1.925.485.544 0 1.03-.084 1.454-.253.426-.17.762-.4 1.009-.693a1.5 1.5 0 0 0 .37-.993v-.37H53.51V11.31h3.865c.677 0 1.185.161 1.525.485.337.323.507.808.507 1.455v4.804h-2.648V16.73h-.077c-.299.503-.724.88-1.278 1.132-.554.252-1.237.377-2.048.377l-.003-.001Zm13.911 0c-1.283 0-2.405-.264-3.366-.793a5.603 5.603 0 0 1-2.24-2.233c-.533-.96-.8-2.09-.8-3.394 0-1.304.267-2.451.8-3.41a5.55 5.55 0 0 1 2.24-2.225c.961-.523 2.08-.785 3.366-.785 1.284 0 2.42.259 3.38.777a5.474 5.474 0 0 1 2.234 2.218c.528.96.792 2.1.792 3.425 0 1.324-.268 2.437-.801 3.403a5.56 5.56 0 0 1-2.24 2.233c-.96.523-2.08.785-3.365.785v-.001Zm.015-2.525c1.118 0 1.981-.353 2.587-1.062.605-.708.909-1.652.909-2.833 0-1.182-.304-2.137-.91-2.84-.605-.704-1.473-1.055-2.601-1.055-1.129 0-1.985.351-2.595 1.054-.611.704-.916 1.645-.916 2.825 0 1.18.305 2.14.916 2.85.61.708 1.48 1.061 2.61 1.061Z" />
          </svg>
        </div>
        <span className="font-satoshi font-medium text-base">
          {isConnecting ? 'Connecting...' : 'Log in with FOGO'}
        </span>
      </button>
      
      {error && (
        <p className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}