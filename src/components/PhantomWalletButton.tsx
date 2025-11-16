import React from 'react';
import dynamic from 'next/dynamic';

// Dynamically import WalletMultiButton to avoid SSR issues
const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
);

/**
 * PhantomWalletButton - Legacy component name, now uses WalletMultiButton
 * This component is kept for backward compatibility but now uses the standard
 * Solana Wallet Adapter WalletMultiButton component.
 */
export const PhantomWalletButton: React.FC = () => {
  // This component is kept for backward compatibility but now only renders WalletMultiButton
  // All wallet functionality is handled by the Solana Wallet Adapter

  return (
    <WalletMultiButton 
      className="!rounded-xl !bg-white/10 !px-5 !py-2.5 !text-white hover:!bg-white/20 !backdrop-blur !border !border-white/15 !shadow-[0_15px_35px_rgba(4,5,15,0.4)] !font-heading !transition-all !duration-300"
    />
  );
};

export default PhantomWalletButton;