/**
 * Canonical NullFetch marketplace contract address on Sepolia.
 *
 * Baked in as a default so providers can't accidentally point at a
 * phishing contract from a misleading email or doc. Override via the
 * `marketplaceAddress` option to `createGate()` if you genuinely need
 * to target a different deployment (test contracts, forks, etc.).
 */
export const DEFAULT_MARKETPLACE_ADDRESS =
  '0x77CD4B9b78946A20407fa1C1C8B3298401D93875';

/**
 * Fallback Sepolia RPC if the provider doesn't supply one. The Zama
 * relayer SDK uses its own infrastructure for ciphertext ops — this URL
 * is only used by this package for the read-only attestation lookup,
 * so a public RPC is acceptable in development.
 */
export const FALLBACK_SEPOLIA_RPC = 'https://sepolia.drpc.org';

/**
 * Default challenge window — short enough to make replay impractical,
 * long enough for the user to actually click "sign" in their wallet.
 */
export const DEFAULT_CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * Hard upper bound on attestation freshness when the on-chain TTL
 * can't be read. The contract's own `attestationTtl` value is preferred
 * and read at bootstrap; this is only a safety floor.
 */
export const DEFAULT_ATTESTATION_TTL_S = 60 * 60;
