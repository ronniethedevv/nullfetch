import {
  initSDK,
  createInstance,
  SepoliaConfig,
} from '@zama-fhe/relayer-sdk/web';

type Instance = Awaited<ReturnType<typeof createInstance>>;

let initPromise: Promise<unknown> | null = null;
let instance: Instance | null = null;

/**
 * Load the WASM modules. Idempotent — safe to call from multiple panels.
 * `initSDK` returns a boolean in 0.4.1; we only care that it resolved.
 */
export async function ensureSDK(): Promise<void> {
  if (!initPromise) {
    initPromise = initSDK();
  }
  await initPromise;
}

/**
 * Build (or return) a relayer-SDK instance bound to the connected wallet.
 * `SepoliaConfig` is `Omit<FhevmInstanceConfig, 'network'>`, so we spread
 * it and inject the EIP-1193 provider from MetaMask.
 */
export async function getInstance(
  network: NonNullable<Window['ethereum']>,
): Promise<Instance> {
  if (instance) return instance;
  await ensureSDK();
  instance = await createInstance({ ...SepoliaConfig, network });
  return instance;
}

/** Force a rebuild on chain/account change. */
export function resetInstance(): void {
  instance = null;
}
