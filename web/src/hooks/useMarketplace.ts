import { useCallback, useMemo } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider, type Provider } from 'ethers';
import { MARKETPLACE_ABI } from '../abi';
import { SEPOLIA_DEFAULT_ADDR } from '../deployments';

/// Public Sepolia RPC used when no wallet is connected. Browse needs to
/// work for visitors who haven't connected — they shouldn't have to
/// install MetaMask just to read the marketplace.
const PUBLIC_SEPOLIA_RPC = 'https://sepolia.drpc.org';

export interface MarketplaceState {
  /// Contract instance configured for read calls. Null while the
  /// marketplace address is unknown (e.g. before first deploy).
  contract: Contract | null;
  /// The address the contract is pointed at (or empty string).
  address: string;
  /// Whether the connection is via the user's wallet (true) or the
  /// public RPC fallback (false).
  hasWallet: boolean;
  /// Error message when something prevents the hook from giving back a
  /// usable contract — e.g. no deployments.json entry.
  error: string | null;
  /// Returns a Contract bound to the wallet's signer for write
  /// transactions. Call this inside an action handler — it triggers a
  /// MetaMask prompt only when you actually need to send something.
  getSignerContract: () => Promise<Contract>;
}

/**
 * Hook that returns a Marketplace contract instance bound to whichever
 * provider is currently available. Read-only by default; for writes,
 * call `getSignerContract()` inside an action handler so the wallet
 * prompt only fires when the user actually clicks something.
 */
export function useMarketplace(): MarketplaceState {
  const { contract, address, hasWallet, error } = useMemo(() => {
    const addr = SEPOLIA_DEFAULT_ADDR;
    if (!addr) {
      return {
        contract: null as Contract | null,
        address: '',
        hasWallet: false,
        error:
          'No Marketplace address found in deployments.json. ' +
          'Run `npm run deploy:sepolia` once before using the app.',
      };
    }

    let provider: Provider;
    let walletPresent = false;
    if (typeof window !== 'undefined' && window.ethereum) {
      provider = new BrowserProvider(window.ethereum);
      walletPresent = true;
    } else {
      provider = new JsonRpcProvider(PUBLIC_SEPOLIA_RPC);
    }

    return {
      contract: new Contract(addr, MARKETPLACE_ABI, provider),
      address: addr,
      hasWallet: walletPresent,
      error: null,
    };
  }, []);

  const getSignerContract = useCallback(async (): Promise<Contract> => {
    if (!address) {
      throw new Error(
        'No Marketplace address — deploy the contract first.',
      );
    }
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error(
        'MetaMask is required for this action. Install it from metamask.io and reload.',
      );
    }
    const browserProvider = new BrowserProvider(window.ethereum);
    const signer = await browserProvider.getSigner();
    return new Contract(address, MARKETPLACE_ABI, signer);
  }, [address]);

  return { contract, address, hasWallet, error, getSignerContract };
}
