import { useCallback, useEffect, useState } from 'react';
import { BrowserProvider } from 'ethers';
import { SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID_HEX } from '../abi';
import { resetInstance } from '../fhe/sdk';
import { resetCache as resetKeyStoreCache } from '../fhe/keyStore';

export interface WalletState {
  account: string | null;
  chainId: number | null;
  connecting: boolean;
  chainOk: boolean;
  connect: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
}

/**
 * Single source of truth for wallet/network state across the app.
 *
 * Auto-reconnects on mount if the user previously authorised the page.
 * Subscribes to `accountsChanged` / `chainChanged` so role-aware pages
 * react immediately when the user swaps wallets or networks. Also
 * resets the Zama relayer SDK instance on either change so cached
 * keypairs from a stale wallet don't carry over.
 */
export function useWallet(): WalletState {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);

  const readChain = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      setChainId(Number(net.chainId));
    } catch {
      setChainId(null);
    }
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert(
        'MetaMask is required and was not detected. Install it from metamask.io and reload this page.',
      );
      return;
    }
    setConnecting(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      const accs = await provider.send('eth_requestAccounts', []);
      if (accs && accs.length > 0) setAccount(accs[0] as string);
      await readChain();
    } catch (e) {
      console.error(e);
    } finally {
      setConnecting(false);
    }
  }, [readChain]);

  const switchToSepolia = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      });
    } catch (err) {
      // 4902 = chain not added; offer to add it.
      const code = (err as { code?: number }).code;
      if (code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: SEPOLIA_CHAIN_ID_HEX,
                chainName: 'Sepolia',
                nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://sepolia.drpc.org'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              },
            ],
          });
        } catch (e) {
          console.error(e);
        }
      } else {
        console.error(err);
      }
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accs = args[0] as string[];
      setAccount(accs && accs.length > 0 ? accs[0] : null);
      resetInstance();
      // Drop the cached KEK so a wallet swap can't ride the previous
      // wallet's signature-derived key for decrypting localStorage.
      resetKeyStoreCache();
    };
    const onChainChanged = (...args: unknown[]) => {
      const hex = args[0] as string;
      try {
        setChainId(parseInt(hex, 16));
      } catch {
        setChainId(null);
      }
      resetInstance();
      resetKeyStoreCache();
    };

    window.ethereum.on?.('accountsChanged', onAccountsChanged);
    window.ethereum.on?.('chainChanged', onChainChanged);

    // Read initial state if already authorised.
    (async () => {
      try {
        const provider = new BrowserProvider(window.ethereum!);
        const accs = (await provider.send('eth_accounts', [])) as string[];
        if (accs && accs.length > 0) setAccount(accs[0]);
        const net = await provider.getNetwork();
        setChainId(Number(net.chainId));
      } catch {
        /* not connected yet */
      }
    })();

    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccountsChanged);
      window.ethereum?.removeListener?.('chainChanged', onChainChanged);
    };
  }, []);

  return {
    account,
    chainId,
    connecting,
    chainOk: chainId === SEPOLIA_CHAIN_ID,
    connect,
    switchToSepolia,
  };
}
