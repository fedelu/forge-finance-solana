import React from 'react';
import { useWallet } from '../contexts/WalletContext';

export const PhantomWalletButton: React.FC = () => {
  const {
    publicKey,
    connected,
    connecting,
    walletStatus,
    connect,
    disconnect,
    getBalance,
  } = useWallet();

  const [balance, setBalance] = React.useState<number | null>(null);

  // Fetch balance when connected
  React.useEffect(() => {
    if (connected && publicKey) {
      getBalance().then(setBalance);
      // Refresh balance every 5 seconds
      const interval = setInterval(() => {
        getBalance().then(setBalance);
      }, 5000);
      return () => clearInterval(interval);
    } else {
      setBalance(null);
    }
  }, [connected, publicKey, getBalance]);

  const handleConnect = async () => {
    try {
      console.log('🚀 PhantomWalletButton: Starting connection...');
      await connect();
      console.log('✅ PhantomWalletButton: Connected successfully');
    } catch (error: any) {
      console.error('❌ PhantomWalletButton: Connection failed:', error);
      alert(`Failed to connect wallet: ${error.message || 'Unknown error'}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      console.log('🔌 PhantomWalletButton: Disconnecting...');
      await disconnect();
      console.log('✅ PhantomWalletButton: Disconnected successfully');
    } catch (error: any) {
      console.error('❌ PhantomWalletButton: Disconnect failed:', error);
      alert(`Failed to disconnect wallet: ${error.message || 'Unknown error'}`);
    }
  };

  const getButtonText = () => {
    if (connecting) return 'Connecting...';
    if (connected) {
      const shortAddress = publicKey?.toString().slice(0, 4) + '...' + publicKey?.toString().slice(-4);
      return shortAddress || 'Connected';
    }
    if (!walletStatus.isInstalled) return 'Install Phantom';
    if (!walletStatus.isUnlocked) return 'Unlock Phantom';
    return 'Connect Wallet';
  };

  const getButtonColor = () => {
    if (connected) return 'bg-gradient-to-r from-fogo-primary to-fogo-secondary hover:from-fogo-primary-dark hover:to-fogo-secondary-dark';
    if (!walletStatus.isInstalled || !walletStatus.isUnlocked) return 'bg-fogo-gray-700 hover:bg-fogo-gray-600';
    return 'bg-gradient-to-r from-fogo-primary to-fogo-secondary hover:from-fogo-primary-dark hover:to-fogo-secondary-dark';
  };

  const isButtonDisabled = () => {
    return connecting || (!walletStatus.isInstalled && !connected);
  };

  return (
    <div className="relative flex items-center gap-3">
      {connected && publicKey && (
        <div className="hidden md:flex items-center gap-2 px-3 py-2 panel-muted rounded-lg border border-fogo-gray-700">
          <div className="w-2 h-2 rounded-full bg-green-400"></div>
          <span className="text-fogo-gray-300 text-sm font-medium">
            {publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)}
          </span>
          {balance !== null && (
            <span className="text-fogo-gray-400 text-sm">
              {balance.toFixed(2)} SOL
            </span>
          )}
        </div>
      )}
      
      <button
        onClick={connected ? handleDisconnect : handleConnect}
        disabled={isButtonDisabled()}
        className={`px-6 py-3 text-white rounded-lg font-medium transition-all duration-200 border border-fogo-gray-500 hover:border-fogo-primary/50 disabled:opacity-50 disabled:cursor-not-allowed ${getButtonColor()}`}
      >
        {getButtonText()}
      </button>

      {walletStatus.error && (
        <div className="absolute top-full mt-2 right-0 p-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-xs max-w-xs">
          {walletStatus.error}
        </div>
      )}
    </div>
  );
};

export default PhantomWalletButton;