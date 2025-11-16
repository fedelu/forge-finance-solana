// TypeScript declarations for Solana wallet integration
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      publicKey?: PublicKey;
      isConnected?: boolean;
      connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
      disconnect(): Promise<void>;
      signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
      signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
      signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>;
      on(event: string, callback: (args: any) => void): void;
      removeListener(event: string, callback: (args: any) => void): void;
    };
  }
}

export {};
