import { createContext, useContext, type ReactNode } from 'react';
import { useWallet as useWalletImpl, type WalletState } from './useWallet';

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  // One useWallet() call at the top of the tree. Pages consume via
  // useWallet() below, which now reads from context instead of running
  // its own useState/useEffect (which would double-subscribe to
  // window.ethereum events and forget connections across pages).
  const wallet = useWalletImpl();
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
