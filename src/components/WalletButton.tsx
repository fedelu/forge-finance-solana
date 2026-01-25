import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// Dynamically import WalletMultiButton to avoid SSR issues
const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
);

export const WalletButton: React.FC = () => {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  // Fetch balance when connected and refresh after transactions
  useEffect(() => {
    if (!connected || !publicKey) return;

    const fetchBalance = async () => {
      try {
        // Force refresh by fetching fresh balance from the network
        const balance = await connection.getBalance(publicKey, 'confirmed');
        // Trigger a custom event so other components know balance was refreshed
        window.dispatchEvent(new CustomEvent('walletBalanceRefreshed', { 
          detail: { balance: balance / LAMPORTS_PER_SOL } 
        }));
      } catch (error) {
        console.error('Failed to fetch balance:', error);
      }
    };
    
    // Initial fetch
    fetchBalance();
    
    // Refresh balance every 5 seconds
    const interval = setInterval(fetchBalance, 30000); // Reduced from 5s to 30s to avoid rate limits
    
    // Listen for deposit/transaction events to refresh balance immediately
    const handleTransaction = () => {
      // Small delay to ensure transaction is confirmed
      setTimeout(fetchBalance, 1000);
    };
    
    window.addEventListener('wrapPositionOpened', handleTransaction);
    window.addEventListener('lpPositionOpened', handleTransaction);
    window.addEventListener('transactionComplete', handleTransaction);
    window.addEventListener('depositComplete', handleTransaction);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('wrapPositionOpened', handleTransaction);
      window.removeEventListener('lpPositionOpened', handleTransaction);
      window.removeEventListener('transactionComplete', handleTransaction);
      window.removeEventListener('depositComplete', handleTransaction);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toString()]);

  return (
    <WalletMultiButton 
      className="!rounded-xl !bg-white/10 !px-5 !py-2.5 !text-white hover:!bg-white/20 !backdrop-blur !border !border-white/15 !shadow-[0_15px_35px_rgba(4,5,15,0.4)] !font-heading !transition-all !duration-300"
    />
  );
};

export default WalletButton;

