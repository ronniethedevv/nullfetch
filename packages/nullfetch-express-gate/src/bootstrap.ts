import { ethers } from 'ethers';
import { MARKETPLACE_READ_ABI } from './abi';
import {
  DEFAULT_MARKETPLACE_ADDRESS,
  DEFAULT_ATTESTATION_TTL_S,
  FALLBACK_SEPOLIA_RPC,
} from './constants';

export interface BootstrapState {
  provider: ethers.JsonRpcProvider;
  contract: ethers.Contract;
  marketAddress: string;
  /** Latest TTL read from the contract. Defaults to
   *  `DEFAULT_ATTESTATION_TTL_S` until the first successful read. */
  attestationTtl: number;
  /** Whether the package has confirmed a contract is deployed at
   *  `marketAddress` and read `attestationTtl()` at least once. */
  ready: boolean;
  /** Last bootstrap error, if any. Surfaced in the 502 response so
   *  operators can debug RPC issues without log-diving. */
  lastError: string | null;
}

/**
 * Resolves the Sepolia RPC URL to use. Honours an explicit option,
 * then `SEPOLIA_RPC_URL`, then falls back to the public RPC.
 *
 * Notably does NOT default to `INFURA_API_KEY`-derived URLs — the
 * vendor-neutral name is what providers should write into their env
 * files going forward. (If you're migrating from a previous setup,
 * just set `SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY`.)
 */
export function resolveRpcUrl(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.SEPOLIA_RPC_URL) return process.env.SEPOLIA_RPC_URL;
  // eslint-disable-next-line no-console
  console.warn(
    '[@nullfetch/express-gate] No rpcUrl supplied and SEPOLIA_RPC_URL not set; falling back to public RPC. Set SEPOLIA_RPC_URL for production use.',
  );
  return FALLBACK_SEPOLIA_RPC;
}

/**
 * Soft bootstrap. Returns a state object immediately; spawns a
 * background task to confirm the contract is deployed and to read the
 * current `attestationTtl`. The gate consults `state.ready` per request
 * and returns 502 until the bootstrap succeeds — but `/health` and
 * `/challenge` keep working in the meantime.
 *
 * The auditor's #3 friction point: "bootstrap-or-die" patterns mean a
 * Sepolia hiccup at cold-start brings the whole API down. This pattern
 * lets you come up degraded and recover automatically when RPC is
 * reachable again.
 */
export function createBootstrap(options: {
  rpcUrl?: string;
  marketplaceAddress?: string;
}): BootstrapState {
  const rpcUrl = resolveRpcUrl(options.rpcUrl);
  const marketAddress = ethers.getAddress(
    options.marketplaceAddress ?? DEFAULT_MARKETPLACE_ADDRESS,
  );
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(marketAddress, MARKETPLACE_READ_ABI, provider);

  const state: BootstrapState = {
    provider,
    contract,
    marketAddress,
    attestationTtl: DEFAULT_ATTESTATION_TTL_S,
    ready: false,
    lastError: null,
  };

  // Kick off the actual checks in the background. The gate will return
  // 502 with state.lastError until these resolve successfully.
  void runBootstrap(state);

  return state;
}

async function runBootstrap(state: BootstrapState): Promise<void> {
  try {
    const code = await state.provider.getCode(state.marketAddress);
    if (code === '0x') {
      throw new Error(
        `No contract found at ${state.marketAddress}. Wrong address or wrong network?`,
      );
    }
    const ttl = (await state.contract.attestationTtl()) as bigint;
    state.attestationTtl = Number(ttl);
    state.ready = true;
    state.lastError = null;
    // eslint-disable-next-line no-console
    console.log(
      `[@nullfetch/express-gate] bootstrap ok  marketplace=${state.marketAddress}  attestationTtl=${state.attestationTtl}s`,
    );
  } catch (err) {
    state.ready = false;
    state.lastError = (err as Error).message;
    // eslint-disable-next-line no-console
    console.warn(
      `[@nullfetch/express-gate] bootstrap failed (will retry): ${state.lastError}`,
    );
    // Retry with exponential-ish backoff up to 30s.
    const delay = Math.min(30_000, 2_000 + Math.random() * 3_000);
    setTimeout(() => void runBootstrap(state), delay);
  }
}
