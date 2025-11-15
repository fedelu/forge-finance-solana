import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import { Connection, PublicKey, Transaction, VersionedTransaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
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
  const [network, setNetwork] = useState<'devnet'>('devnet');
  const [connection, setConnection] = useState(
    () => new Connection(SOLANA_TESTNET_CONFIG.RPC_URL, SOLANA_TESTNET_CONFIG.COMMITMENT as any)
  );
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [wallet, setWallet] = useState<PhantomWallet | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>({
    isInstalled: false,
    isUnlocked: false,
    isAvailable: false,
    error: undefined
  });

  // Check for Phantom wallet on mount and listen for changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const detectPhantom = () => {
      const phantom = (window as any).solana;
      if (phantom?.isPhantom) {
        setWallet(phantom);
        const isConnected = phantom.isConnected && !!phantom.publicKey;
        setWalletStatus({
          isInstalled: true,
          isUnlocked: !!phantom.publicKey,
          isAvailable: true,
          error: undefined
        });
        
        // If already connected, set the public key
        if (isConnected && phantom.publicKey) {
          setPublicKey(phantom.publicKey);
          setConnected(true);
        }
      } else {
        setWalletStatus({
          isInstalled: false,
          isUnlocked: false,
          isAvailable: false,
          error: 'Phantom wallet not found'
        });
      }
    };

    // Initial detection
    detectPhantom();

    // Listen for Phantom wallet events
    const handleAccountChange = (publicKey: PublicKey | null) => {
      if (publicKey) {
        setPublicKey(publicKey);
        setConnected(true);
      } else {
        setPublicKey(null);
        setConnected(false);
      }
    };

    const handleDisconnect = () => {
      setPublicKey(null);
      setConnected(false);
    };

    const phantom = (window as any).solana;
    if (phantom?.isPhantom) {
      phantom.on('accountChanged', handleAccountChange);
      phantom.on('disconnect', handleDisconnect);
    }

    // Listen for provider injection
    window.addEventListener('load', detectPhantom);

    return () => {
      if (phantom?.isPhantom) {
        phantom.removeListener('accountChanged', handleAccountChange);
        phantom.removeListener('disconnect', handleDisconnect);
      }
      window.removeEventListener('load', detectPhantom);
    };
  }, []);

  const connect = useCallback(async (publicKey?: PublicKey) => {
    if (!wallet) {
      const error = 'Phantom wallet not found. Please install Phantom wallet.';
      setWalletStatus(prev => ({
        ...prev,
        error
      }));
      throw new Error(error);
    }

    setConnecting(true);
    try {
      // Request connection to Phantom wallet
      const response = await wallet.connect({ onlyIfTrusted: false });
      const newPublicKey = response.publicKey;
      
      if (!newPublicKey) {
        throw new Error('Failed to get public key from wallet');
      }
      
      setPublicKey(newPublicKey);
      setConnected(true);
      setWalletStatus({
        isInstalled: true,
        isUnlocked: true,
        isAvailable: true,
        error: undefined
      });
      
      console.log('✅ Wallet connected successfully to Solana devnet:', newPublicKey.toString());
    } catch (error: any) {
      console.error('❌ Wallet connection failed:', error);
      setWalletStatus(prev => ({
        ...prev,
        error: error.message || 'Connection failed'
      }));
      throw error;
    } finally {
      setConnecting(false);
    }
  }, [wallet]);

  const disconnect = useCallback(async () => {
    if (!wallet || !connected) return;

    try {
      await wallet.disconnect();
      setPublicKey(null);
      setConnected(false);
      setWalletStatus(prev => ({
        ...prev,
        isUnlocked: false,
        error: undefined
      }));
      console.log('🔌 Wallet disconnected');
    } catch (error) {
      console.error('❌ Wallet disconnect failed:', error);
    }
  }, [wallet, connected]);

  const switchNetwork = useCallback((newNetwork: 'devnet') => {
    // Single-network app in this project: always Solana devnet
    setNetwork(newNetwork);
    setConnection(new Connection(SOLANA_TESTNET_CONFIG.RPC_URL, SOLANA_TESTNET_CONFIG.COMMITMENT as any));
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
    if (!wallet || !publicKey) {
      throw new Error('Wallet not connected');
    }

    try {
      return await wallet.signTransaction(transaction);
    } catch (error) {
      console.error('❌ Transaction signing failed:', error);
      throw error;
    }
  }, [wallet, publicKey]);

  const signAllTransactions = useCallback(async (transactions: Transaction[]): Promise<Transaction[]> => {
    if (!wallet || !publicKey) {
      throw new Error('Wallet not connected');
    }

    try {
      return await wallet.signAllTransactions(transactions);
    } catch (error) {
      console.error('❌ Transaction signing failed:', error);
      throw error;
    }
  }, [wallet, publicKey]);

  const sendTransaction = useCallback(async (transaction: Transaction | VersionedTransaction): Promise<string> => {
    if (!publicKey || !wallet) {
      throw new Error('No wallet connected');
    }

    try {
      // Sign the transaction with Phantom
      let signedTransaction: Transaction | VersionedTransaction;
      
      if (transaction instanceof VersionedTransaction) {
        // For versioned transactions, use signTransaction
        signedTransaction = await wallet.signTransaction(transaction as any);
      } else {
        // For legacy transactions
        signedTransaction = await wallet.signTransaction(transaction);
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
  }, [publicKey, connection, wallet]);

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
  }), [connection, publicKey, connected, connecting, network, connect, disconnect, switchNetwork, signTransaction, signAllTransactions, sendTransaction, getBalance, getTokenBalance, getSolBalance, wallet, walletStatus]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};