import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import { Connection, PublicKey, Transaction, VersionedTransaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useConnection, useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { SOLANA_TESTNET_CONFIG } from '../config/solana-testnet';

// Phantom wallet types
interface PhantomWallet {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signTransaction(transaction: Transaction): Promise<Transaction>;
  signAllTransactions(transactions: Transaction[]): Promise<Transaction[]>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  publicKey?: PublicKey;
  isConnected?: boolean;
}

interface WalletStatus {
  isInstalled: boolean;
  isUnlocked: boolean;
  isAvailable: boolean;
  error?: string;
}

interface WalletContextType {
  connection: Connection;
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  network: 'devnet';
  connect: (publicKey?: PublicKey) => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: (network: 'devnet') => void;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signAllTransactions: (transactions: Transaction[]) => Promise<Transaction[]>;
  sendTransaction: (transaction: Transaction | VersionedTransaction) => Promise<string>;
  getBalance: () => Promise<number | null>;
  getTokenBalance: (mintAddress: string) => Promise<number | null>;
  getSolBalance: () => Promise<number | null>;
  wallet: PhantomWallet | null;
  walletStatus: WalletStatus;
}

const WalletContext = createContext<WalletContextType | null>(null);

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

interface WalletProviderProps {
  children: ReactNode;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  // Use Solana Wallet Adapter hooks
  const { connection: adapterConnection } = useConnection();
  const {
    publicKey: adapterPublicKey,
    connected: adapterConnected,
    connecting: adapterConnecting,
    disconnect: adapterDisconnect,
    wallet: adapterWallet,
    signTransaction: adapterSignTransaction,
    signAllTransactions: adapterSignAllTransactions,
    sendTransaction: adapterSendTransaction,
  } = useSolanaWallet();

  const [network, setNetwork] = useState<'devnet'>('devnet');
  
  // Memoize connection to prevent infinite re-renders
  const connection = useMemo(() => {
    return adapterConnection || new Connection(SOLANA_TESTNET_CONFIG.RPC_URL, SOLANA_TESTNET_CONFIG.COMMITMENT as any);
  }, [adapterConnection]);
  
  // Use adapter state, fallback to local state for compatibility
  const publicKey = adapterPublicKey;
  const connected = adapterConnected;
  const connecting = adapterConnecting;
  
  const [wallet, setWallet] = useState<PhantomWallet | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>({
    isInstalled: false,
    isUnlocked: false,
    isAvailable: false,
    error: undefined
  });

  // Update wallet status based on adapter state
  useEffect(() => {
    const isInstalled = typeof window !== 'undefined' && (
      !!(window as any).solana?.isPhantom || 
      !!(window as any).phantom?.solana?.isPhantom ||
      !!(window as any).solflare
    );
    
    setWalletStatus({
      isInstalled: isInstalled || !!adapterWallet,
      isUnlocked: !!adapterPublicKey,
      isAvailable: adapterConnected,
      error: undefined
    });

    // Set wallet adapter for compatibility - only update if adapter actually changed
    if (adapterWallet?.adapter) {
      const adapter = adapterWallet.adapter as any;
      setWallet(prev => {
        // Only update if the adapter or key values actually changed
        if (prev?.publicKey?.toString() === adapter.publicKey?.toString() && 
            prev?.isConnected === adapter.connected) {
          return prev;
        }
        return {
          isPhantom: adapter.name === 'Phantom',
          connect: async () => {
            await adapter.connect();
            return { publicKey: adapter.publicKey };
          },
          disconnect: async () => {
            await adapter.disconnect();
          },
          signTransaction: async (tx: Transaction) => {
            return await adapter.signTransaction(tx);
          },
          signAllTransactions: async (txs: Transaction[]) => {
            return await adapter.signAllTransactions(txs);
          },
          signMessage: async (msg: Uint8Array) => {
            return await adapter.signMessage(msg);
          },
          publicKey: adapter.publicKey,
          isConnected: adapter.connected,
        };
      });
    } else {
      setWallet(null);
    }
  }, [adapterWallet, adapterPublicKey?.toString(), adapterConnected]);

  const connect = useCallback(async (publicKey?: PublicKey) => {
    // The Solana Wallet Adapter handles connection automatically via WalletMultiButton
    // This function is kept for backward compatibility but the actual connection
    // should be done through the WalletMultiButton component
    if (adapterConnected && adapterPublicKey) {
      console.log('✅ Wallet already connected:', adapterPublicKey.toString());
      return;
    }

    // Check if wallets are available in the window first
    const hasPhantom = typeof window !== 'undefined' && (
      !!(window as any).solana?.isPhantom || 
      !!(window as any).phantom?.solana?.isPhantom
    );
    const hasSolflare = typeof window !== 'undefined' && !!(window as any).solflare;
    
    if (!hasPhantom && !hasSolflare) {
      const errorMessage = 'No wallet adapter available. Please install a Solana wallet (Phantom or Solflare).';
      setWalletStatus(prev => ({
        ...prev,
        error: errorMessage
      }));
      throw new Error(errorMessage);
    }

    // Wait for adapter to initialize if it's not ready yet (with timeout)
    // Note: adapterWallet might be null initially until a wallet is selected
    if (!adapterWallet?.adapter) {
      console.log('⏳ Wallet adapter not ready yet. Please use the wallet connection button in the header to select a wallet.');
      const errorMessage = 'Please use the wallet connection button in the header to connect your wallet. The adapter will be ready once you select a wallet.';
      setWalletStatus(prev => ({
        ...prev,
        error: errorMessage
      }));
      throw new Error(errorMessage);
    }

    // If adapter is available, trigger connection through the adapter
    try {
      await adapterWallet.adapter.connect();
    } catch (error: any) {
      const errorMessage = error.message || 'Connection failed. Please make sure your wallet is unlocked.';
      setWalletStatus(prev => ({
        ...prev,
        error: errorMessage
      }));
      throw new Error(errorMessage);
    }
  }, [adapterConnected, adapterPublicKey, adapterWallet]);

  const disconnect = useCallback(async () => {
    if (!adapterConnected) return;

    try {
      await adapterDisconnect();
      setWalletStatus(prev => ({
        ...prev,
        isUnlocked: false,
        error: undefined
      }));
      console.log('🔌 Wallet disconnected');
    } catch (error) {
      console.error('❌ Wallet disconnect failed:', error);
    }
  }, [adapterConnected, adapterDisconnect]);

  const switchNetwork = useCallback((newNetwork: 'devnet') => {
    // Single-network app in this project: always Solana devnet
    // The connection is managed by the Solana Wallet Adapter
    setNetwork(newNetwork);
  }, []);

  const getBalance = useCallback(async (): Promise<number | null> => {
    if (!publicKey) {
      return null;
    }

    try {
      const balance = await connection.getBalance(publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('❌ Failed to get balance:', error);
      return null;
    }
  }, [publicKey, connection]);

  const getTokenBalance = useCallback(async (mintAddress: string): Promise<number | null> => {
    if (!publicKey) {
      return null;
    }

    try {
      // This is a simplified version - in a real app you'd use SPL Token functions
      console.log('Token balance check for mint:', mintAddress);
      return 0; // Placeholder
    } catch (error) {
      console.error('❌ Failed to get token balance:', error);
      return null;
    }
  }, [publicKey]);

  const getSolBalance = useCallback(async (): Promise<number | null> => {
    return getBalance(); // SOL balance is the same as native balance
  }, [getBalance]);

  const signTransaction = useCallback(async (transaction: Transaction): Promise<Transaction> => {
    if (!adapterPublicKey || !adapterSignTransaction) {
      throw new Error('Wallet not connected');
    }

    try {
      return await adapterSignTransaction(transaction);
    } catch (error) {
      console.error('❌ Transaction signing failed:', error);
      throw error;
    }
  }, [adapterPublicKey, adapterSignTransaction]);

  const signAllTransactions = useCallback(async (transactions: Transaction[]): Promise<Transaction[]> => {
    if (!adapterPublicKey || !adapterSignAllTransactions) {
      throw new Error('Wallet not connected');
    }

    try {
      return await adapterSignAllTransactions(transactions);
    } catch (error) {
      console.error('❌ Transaction signing failed:', error);
      throw error;
    }
  }, [adapterPublicKey, adapterSignAllTransactions]);

  const sendTransaction = useCallback(async (transaction: Transaction | VersionedTransaction): Promise<string> => {
    if (!adapterPublicKey) {
      throw new Error('No wallet connected');
    }

    try {
      // Sign the transaction first
      let signedTransaction: Transaction | VersionedTransaction;
      
      if (transaction instanceof VersionedTransaction) {
        if (!adapterSignTransaction) {
          throw new Error('Cannot sign versioned transaction');
        }
        signedTransaction = await adapterSignTransaction(transaction as any);
      } else {
        if (!adapterSignTransaction) {
          throw new Error('Cannot sign transaction');
        }
        signedTransaction = await adapterSignTransaction(transaction);
      }
      
      // Send the signed transaction to the network
      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize(),
        { skipPreflight: false, maxRetries: 3 }
      );
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');
      
      console.log('✅ Transaction sent successfully:', signature);
      return signature;
    } catch (error: any) {
      console.error('❌ Transaction failed:', error);
      throw error;
    }
  }, [adapterPublicKey, adapterSignTransaction, connection]);

  const value = useMemo(() => ({
    connection,
    publicKey,
    connected,
    connecting,
    network,
    connect,
    disconnect,
    switchNetwork,
    signTransaction,
    signAllTransactions,
    sendTransaction,
    getBalance,
    getTokenBalance,
    getSolBalance,
    wallet,
    walletStatus,
  }), [
    connection, 
    publicKey, 
    connected, 
    connecting, 
    network, 
    connect, 
    disconnect, 
    switchNetwork, 
    signTransaction, 
    signAllTransactions, 
    sendTransaction, 
    getBalance, 
    getTokenBalance, 
    getSolBalance, 
    wallet, 
    walletStatus
  ]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};