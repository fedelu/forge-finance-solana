import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWalletMultiButton } from '@solana/wallet-adapter-base-ui';
import { useWalletModal, WalletIcon } from '@solana/wallet-adapter-react-ui';

/**
 * PhantomWalletButton - Legacy component name, now uses WalletMultiButton
 * This component is kept for backward compatibility but now uses the standard
 * Solana Wallet Adapter WalletMultiButton component.
 */
export const PhantomWalletButton: React.FC = () => {
  const { setVisible } = useWalletModal();
  const { buttonState, onConnect, onDisconnect, publicKey, walletIcon, walletName } = useWalletMultiButton({
    onSelectWallet() {
      setVisible(true);
    },
  });
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLUListElement | null>(null);

  const formattedAddress = useMemo(() => {
    if (!publicKey) return '';
    const address = publicKey.toBase58();
    const visibleChars = 6;
    if (address.length <= visibleChars * 2) return address;
    return `${address.slice(0, visibleChars)}..${address.slice(-visibleChars)}`;
  }, [publicKey]);

  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      const node = dropdownRef.current;
      if (!node || node.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, []);

  const content = useMemo(() => {
    if (publicKey) {
      return formattedAddress;
    }
    if (buttonState === 'connecting' || buttonState === 'has-wallet') {
      return buttonState === 'connecting' ? 'Connecting...' : 'Connect';
    }
    return 'Connect';
  }, [buttonState, formattedAddress, publicKey]);

  return (
    <div className="wallet-adapter-dropdown">
      <button
        className="wallet-adapter-button wallet-adapter-button-trigger !inline-flex !items-center !gap-2 !h-9 !min-h-9 !rounded-xl !bg-white/10 !px-3 !py-0 !text-sm !leading-none !text-white hover:!bg-white/20 !backdrop-blur !border !border-white/15 !shadow-[0_15px_35px_rgba(4,5,15,0.4)] !font-heading !transition-all !duration-300"
        aria-expanded={menuOpen}
        style={{ pointerEvents: menuOpen ? 'none' : 'auto' }}
        onClick={() => {
          switch (buttonState) {
            case 'no-wallet':
              setVisible(true);
              break;
            case 'has-wallet':
              if (onConnect) {
                onConnect();
              }
              break;
            case 'connected':
              setMenuOpen(true);
              break;
          }
        }}
        type="button"
      >
        {walletIcon && walletName && (
          <i className="wallet-adapter-button-start-icon">
            <WalletIcon wallet={{ adapter: { icon: walletIcon, name: walletName } }} />
          </i>
        )}
        {content}
      </button>
      <ul
        ref={dropdownRef}
        aria-label="dropdown-list"
        className={`wallet-adapter-dropdown-list ${menuOpen && 'wallet-adapter-dropdown-list-active'}`}
        role="menu"
      >
        {publicKey ? (
          <li
            className="wallet-adapter-dropdown-list-item"
            role="menuitem"
            onClick={async () => {
              await navigator.clipboard.writeText(publicKey.toBase58());
              setCopied(true);
              setTimeout(() => setCopied(false), 400);
            }}
          >
            {copied ? 'Copied' : 'Copy address'}
          </li>
        ) : null}
        <li
          className="wallet-adapter-dropdown-list-item"
          role="menuitem"
          onClick={() => {
            setVisible(true);
            setMenuOpen(false);
          }}
        >
          Change wallet
        </li>
        {onDisconnect ? (
          <li
            className="wallet-adapter-dropdown-list-item"
            role="menuitem"
            onClick={() => {
              onDisconnect();
              setMenuOpen(false);
            }}
          >
            Disconnect
          </li>
        ) : null}
      </ul>
    </div>
  );
};

export default PhantomWalletButton;