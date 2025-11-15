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
  getFogoBalance: () => Promise<number | null>;
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

  // Check for Phantom wallet on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const phantom = (window as any).phantom?.solana;
    if (phantom?.isPhantom) {
      setWallet(phantom);
      setWalletStatus({
        isInstalled: true,
        isUnlocked: !!phantom.publicKey,
        isAvailable: true,
        error: undefined
      });
    } else {
      setWalletStatus({
        isInstalled: false,
        isUnlocked: false,
        isAvailable: false,
        error: 'Phantom wallet not found'
      });
    }
  }, []);

  const connect = useCallback(async (publicKey?: PublicKey) => {
    if (!wallet) {
      throw new Error('Phantom wallet not found');
    }

    setConnecting(true);
    try {
      const response = await wallet.connect();
      const newPublicKey = response.publicKey;
      
      setPublicKey(newPublicKey);
      setConnected(true);
      setWalletStatus({
        isInstalled: true,
        isUnlocked: true,
        isAvailable: true,
        error: undefined
      });
      
      console.log('✅ Wallet connected successfully to Solana testnet');
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

  const getFogoBalance = useCallback(async (): Promise<number | null> => {
    if (!publicKey) {
      return null;
    }

    try {
      // This is a simplified version - in a real app you'd use SPL Token functions
      console.log('FOGO balance check for wallet:', publicKey.toString());
      return 0; // Placeholder
    } catch (error) {
      console.error('❌ Failed to get FOGO balance:', error);
      return null;
    }
  }, [publicKey]);

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
    if (!publicKey) {
      throw new Error('No wallet connected');
    }

    try {
      // For now, we'll just log that the transaction was received
      // In a real implementation, you'd handle the transaction properly
      console.log('📤 Transaction received for sending:', transaction);
      
      // Return a mock signature for now
      const mockSignature = 'mock_signature_' + Date.now();
      console.log('✅ Transaction sent successfully (mock):', mockSignature);
      return mockSignature;
    } catch (error: any) {
      console.error('❌ Transaction failed:', error);
      throw error;
    }
  }, [publicKey, connection]);

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
    getFogoBalance,
    wallet,
    walletStatus,
  }), [connection, publicKey, connected, connecting, network, connect, disconnect, switchNetwork, signTransaction, signAllTransactions, sendTransaction, getBalance, getTokenBalance, getFogoBalance, wallet, walletStatus]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};