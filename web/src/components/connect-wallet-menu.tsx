import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { StandardConnect, StandardDisconnect } from '@wallet-standard/core';
import {
  type UiWallet,
  type UiWalletAccount,
  uiWalletAccountBelongsToUiWallet,
  useConnect,
  useDisconnect,
  useWallets,
} from '@wallet-standard/react';

import { SelectedWalletAccountContext } from '@/context/selected-wallet-account-context';

/* ─── Per-wallet connect button (hooks must be top-level) ─── */
function WalletOption({
  wallet,
  onSelect,
}: {
  wallet: UiWallet;
  onSelect: (account: UiWalletAccount) => void;
}) {
  const [isConnecting, connect] = useConnect(wallet);

  const handleClick = useCallback(async () => {
    try {
      const accounts = await connect();
      if (accounts[0]) onSelect(accounts[0]);
    } catch (err) {
      console.error('Wallet connect error:', err);
    }
  }, [connect, onSelect]);

  return (
    <button
      onClick={handleClick}
      disabled={isConnecting}
      className="text-arcade-text hover:bg-arcade-cyan/10 hover:text-arcade-cyan flex w-full items-center gap-3 px-4 py-3 text-left font-mono text-sm tracking-wider uppercase transition-colors duration-100 disabled:opacity-40"
    >
      {wallet.icon && (
        <img src={wallet.icon} alt="" className="size-5 shrink-0" aria-hidden />
      )}
      <span className="truncate">{isConnecting ? 'CONNECTING...' : wallet.name}</span>
    </button>
  );
}

/* ─── Per-wallet disconnect button ─── */
function DisconnectButton({
  wallet,
  onDisconnect,
}: {
  wallet: UiWallet;
  onDisconnect: () => void;
}) {
  const [isDisconnecting, disconnect] = useDisconnect(wallet);

  return (
    <button
      onClick={async () => {
        try {
          await disconnect();
          onDisconnect();
        } catch (err) {
          console.error('Wallet disconnect error:', err);
        }
      }}
      disabled={isDisconnecting}
      className="text-arcade-red hover:bg-arcade-red/10 w-full px-4 py-3 text-left font-mono text-sm tracking-wider uppercase transition-colors duration-100 disabled:opacity-40"
    >
      {isDisconnecting ? 'DISCONNECTING...' : 'DISCONNECT'}
    </button>
  );
}

/* ─── Main menu ─── */
export function ConnectWalletMenu() {
  const wallets = useWallets();
  const [selectedAccount, setSelectedAccount] = useContext(SelectedWalletAccountContext);
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const connectableWallets = wallets.filter(
    w =>
      w.features.includes(StandardConnect) &&
      w.features.includes(StandardDisconnect) &&
      w.chains.includes('solana:devnet')
  );

  // Find the wallet that owns the selected account (for disconnect)
  const ownerWallet = selectedAccount
    ? wallets.find(w => uiWalletAccountBelongsToUiWallet(selectedAccount, w))
    : undefined;

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(o => !o)}
        className="border-arcade-cyan text-arcade-cyan hover:bg-arcade-cyan hover:text-arcade-bg border-2 px-4 py-2 font-mono text-sm tracking-widest uppercase shadow-[0_0_8px_rgba(0,255,204,0.25)] transition-all duration-100 active:scale-95"
      >
        {selectedAccount
          ? `${selectedAccount.address.slice(0, 4)}..${selectedAccount.address.slice(-4)}`
          : 'INSERT COIN'}
      </button>

      {isOpen && (
        <div className="border-arcade-border bg-arcade-panel absolute right-0 z-50 mt-2 min-w-60 border-2 shadow-[0_0_20px_rgba(0,255,204,0.1)]">
          {selectedAccount && ownerWallet ? (
            <>
              <div className="border-arcade-border border-b px-4 py-3">
                <p className="text-arcade-muted font-mono text-xs tracking-wider uppercase">
                  CONNECTED
                </p>
                <p className="text-arcade-cyan mt-1 font-mono text-sm">
                  {selectedAccount.address.slice(0, 8)}...
                  {selectedAccount.address.slice(-8)}
                </p>
              </div>
              <DisconnectButton
                wallet={ownerWallet}
                onDisconnect={() => {
                  setSelectedAccount(undefined);
                  setIsOpen(false);
                }}
              />
            </>
          ) : connectableWallets.length === 0 ? (
            <div className="text-arcade-muted px-4 py-3 font-mono text-sm">
              NO WALLETS DETECTED
            </div>
          ) : (
            <>
              <div className="border-arcade-border border-b px-4 py-2">
                <p className="text-arcade-muted font-mono text-xs tracking-wider uppercase">
                  SELECT WALLET
                </p>
              </div>
              {connectableWallets.map(wallet => (
                <WalletOption
                  key={wallet.name}
                  wallet={wallet}
                  onSelect={account => {
                    setSelectedAccount(account);
                    setIsOpen(false);
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
