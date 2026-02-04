import React, { useMemo, useCallback, ReactNode } from 'react';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { type Adapter, type WalletError } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { SOLANA_TESTNET_CONFIG } from '../config/solana-testnet';

interface SolanaWalletAdapterProviderProps {
  children: ReactNode;
}

const PHANTOM_CONNECT_HINT =
  'Phantom couldn’t connect. Unlock Phantom, approve the connection in the popup, and try again. ' +
  'If you closed the popup without approving, click Connect again.';

/** User-friendly message for wallet connection failures (Phantom often throws with no message). */
function getConnectionErrorMessage(error: WalletError, adapter?: Adapter | null): string {
  const msg = error?.message;
  if (msg && typeof msg === 'string' && !/unexpected error|unknown error/i.test(msg)) return msg;
  const inner = error?.error;
  if (inner instanceof Error && inner.message) return inner.message;

  if (adapter?.name === 'Phantom') return PHANTOM_CONNECT_HINT;
  // When adapter is cleared on error, assume Phantom for the common "Unexpected error" case
  if (error?.name === 'WalletConnectionError' && (!msg || /unexpected|unknown/i.test(msg))) {
    return PHANTOM_CONNECT_HINT;
  }
  return 'Could not connect. Please unlock your wallet, ensure you’re on Devnet if required, and try again.';
}

export const SolanaWalletAdapterProvider: React.FC<SolanaWalletAdapterProviderProps> = ({ children }) => {
  const endpoint = useMemo(() => SOLANA_TESTNET_CONFIG.RPC_URL, []);

  const onWalletError = useCallback((error: WalletError, adapter?: Adapter) => {
    const message = getConnectionErrorMessage(error, adapter);
    console.warn('[Wallet]', message);
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
      console.debug('[Wallet] raw error', error);
    }
  }, []);

  // Use empty array so we only use Wallet Standard adapters (Phantom, Solflare, etc. auto-register).
  // Explicit PhantomWalletAdapter/SolflareWalletAdapter would duplicate them and trigger the warning.
  const wallets = useMemo(() => [], []);

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

