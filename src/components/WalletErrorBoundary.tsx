import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches wallet connection errors (e.g. WalletConnectionError with "Unexpected error")
 * and shows a friendly message so the app doesn't crash or show a raw adapter message.
 */
export class WalletErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> | null {
    const isWalletError = error?.name === 'WalletConnectionError' || /wallet|connection|unexpected error/i.test(error?.message ?? '');
    return isWalletError ? { error } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (error?.name === 'WalletConnectionError' || /wallet|connection/i.test(error?.message ?? '')) {
      console.warn('[WalletErrorBoundary]', error?.message || 'Connection failed', info.componentStack);
    } else {
      console.error('[WalletErrorBoundary]', error, info.componentStack);
    }
  }

  clearError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="wallet-error-fallback" style={{
          padding: '1.5rem',
          textAlign: 'center',
          color: '#fff',
          background: 'rgba(0,0,0,0.4)',
          borderRadius: '12px',
          margin: '1rem',
          maxWidth: '420px',
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          <p style={{ margin: '0 0 1rem' }}>
            Phantom couldn’t connect. Unlock Phantom, approve the connection in the popup, then click Connect again. If you closed the popup without approving, try connecting once more.
          </p>
          <button
            type="button"
            onClick={this.clearError}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.3)',
              background: 'rgba(255,255,255,0.1)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
    );
  }
}
