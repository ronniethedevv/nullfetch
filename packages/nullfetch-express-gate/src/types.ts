import type { RequestHandler } from 'express';

/**
 * Augments the Express Request type so `req.nullfetch` is typed for
 * downstream handlers — no `any`, no casts, just `req.nullfetch.wallet`
 * with proper types.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      nullfetch?: NullFetchContext;
    }
  }
}

export interface NullFetchContext {
  /** EIP-55 wallet address that authenticated (recovered from signature). */
  wallet: string;
  /** The service this server represents. */
  serviceId: bigint;
  /** Block-timestamp at which the on-chain attestation was written. */
  attestationVerifiedAt: number;
  /** Seconds until the attestation goes stale. */
  attestationExpiresInSeconds: number;
  /** True when running in dev mode — no signature or attestation check ran. */
  dev: boolean;
}

/**
 * Stored challenge for a single wallet. Single-use; deleted after first
 * successful verification.
 */
export interface Challenge {
  nonce: string;
  expiresAt: number;
}

/**
 * Pluggable challenge store. Default is `InMemoryChallengeStore` —
 * fine for single-instance deploys. Swap for Redis / KV / database
 * adapter when scaling horizontally.
 */
export interface ChallengeStore {
  get(wallet: string): Promise<Challenge | null>;
  set(wallet: string, challenge: Challenge): Promise<void>;
  delete(wallet: string): Promise<void>;
}

export interface CreateGateOptions {
  /** REQUIRED. The service id this server represents. The gate rejects
   *  attestations for any other service id. */
  serviceId: bigint | number;

  /** Optional. Sepolia JSON-RPC URL. Defaults to
   *  `process.env.SEPOLIA_RPC_URL` then a public fallback. */
  rpcUrl?: string;

  /** Optional. Marketplace contract address. Defaults to the canonical
   *  NullFetch deployment baked into this package. */
  marketplaceAddress?: string;

  /** Optional. When true, bypasses signature and attestation checks for
   *  local development. The gate accepts whichever `X-Wallet-Address`
   *  the caller supplies. Logs a loud warning at startup so it can't
   *  ship to production undetected. */
  devMode?: boolean;

  /** Optional. Override the challenge TTL window in milliseconds. */
  challengeTtlMs?: number;

  /** Optional. Pluggable challenge store. Default is in-memory. */
  store?: ChallengeStore;

  /** Optional. Application name to include in the challenge message.
   *  Defaults to "NullFetch". */
  appName?: string;
}

export interface CreateGateResult {
  /** Express middleware that gates a route. Rejects requests that
   *  fail SIWE verification or whose on-chain attestation is missing,
   *  stale, invalid, or for a different service. */
  gate: RequestHandler;

  /** Express handler that issues a single-use SIWE-style challenge.
   *  Mount it at any path (e.g. `app.post('/challenge', nf.challenge)`). */
  challenge: RequestHandler;

  /** Permissive CORS middleware preconfigured to expose the three
   *  custom headers (X-Wallet-Address, X-Auth-Nonce, X-Wallet-Signature)
   *  and respond to preflight. Use it before the route handlers. */
  cors: RequestHandler;

  /** Resolves when the package has read `attestationTtl` from the
   *  contract at least once. Calling this is optional — the gate works
   *  without it, falling back to a default TTL until the value is read. */
  ready(): Promise<void>;

  /** Current attestation TTL (seconds) the gate is enforcing. Reflects
   *  what was read from the contract, or the default if unreachable. */
  getAttestationTtl(): number;
}
