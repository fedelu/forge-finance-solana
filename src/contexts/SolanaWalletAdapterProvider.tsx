import React, { useMemo, useCallback, ReactNode } from 'react';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork, type Adapter, type WalletError } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { SOLANA_TESTNET_CONFIG } from '../config/solana-testnet';

interface SolanaWalletAdapterProviderProps {
  children: ReactNode;
}

/** User-friendly message for wallet connection failures (Phantom often throws with no message). */
function getConnectionErrorMessage(error: WalletError, adapter?: Adapter | null): string {
  const msg = error?.message;
  if (msg && typeof msg === 'string' && !/unexpected error|unknown error/i.test(msg)) return msg;
  const inner = error?.error;
  if (inner instanceof Error && inner.message) return inner.message;

  const isPhantom = adapter?.name === 'Phantom';
  if (isPhantom) {
    return (
      'Phantom couldn’t connect. Unlock Phantom, approve the connection in the popup, and try again. ' +
      'If you closed the popup without approving, click Connect again.'
    );
  }
  return 'Could not connect. Please unlock your wallet, ensure you’re on Devnet if required, and try again.';
}

export const SolanaWalletAdapterProvider: React.FC<SolanaWalletAdapterProviderProps> = ({ children }) => {
  // The network can be set to 'devnet', 'testnet', or 'mainnet-beta'.
  const network = WalletAdapterNetwork.Devnet;

  // You can also provide a custom RPC endpoint.
  const endpoint = useMemo(() => SOLANA_TESTNET_CONFIG.RPC_URL, []);

  const onWalletError = useCallback((error: WalletError, adapter?: Adapter) => {
    const message = getConnectionErrorMessage(error, adapter);
    console.warn('[Wallet]', message, error);
  }, []);

  // @solana/wallet-adapter-wallets includes all the adapters but supports tree shaking --
  // Only the wallets you configure here will be compiled into your application
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network]
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect={false} onError={onWalletError}>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
};

