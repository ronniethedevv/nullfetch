import type { Request, RequestHandler, Response, NextFunction } from 'express';
import { ethers } from 'ethers';
import { createBootstrap, type BootstrapState } from './bootstrap';
import { buildChallengeMessage, checksum, generateNonce } from './challenge';
import { InMemoryChallengeStore } from './store';
import { DEFAULT_CHALLENGE_TTL_MS } from './constants';
import type {
  ChallengeStore,
  CreateGateOptions,
  CreateGateResult,
  NullFetchContext,
} from './types';

/**
 * Build a NullFetch gate + challenge + CORS bundle for one service.
 *
 * The replacement for ~150 lines of hand-written auth code:
 *
 * ```ts
 * import express from 'express';
 * import { createGate } from '@nullfetch/express-gate';
 *
 * const app = express();
 * const nf = createGate({ serviceId: 3 });
 *
 * app.use(nf.cors);
 * app.post('/challenge', nf.challenge);
 * app.get('/api/service/:id', nf.gate, (req, res) => {
 *   res.json({ quote: 'You miss 100% of the shots you don't take.' });
 * });
 *
 * app.listen(3000);
 * ```
 *
 * That's the entire integration. The package handles bootstrap, SIWE
 * verification, on-chain attestation lookup, serviceId matching, and
 * structured error responses.
 */
export function createGate(options: CreateGateOptions): CreateGateResult {
  const serviceId = BigInt(options.serviceId);
  const appName = options.appName ?? 'NullFetch';
  const challengeTtlMs = options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;
  const store: ChallengeStore = options.store ?? new InMemoryChallengeStore();
  const devMode = options.devMode === true;

  // Dev mode warning surfaces at module import time so it can't ship
  // to production undetected. Loud, ugly, intentional.
  if (devMode) {
    // eslint-disable-next-line no-console
    console.warn(
      '\n' +
        '╔═══════════════════════════════════════════════════════════╗\n' +
        '║ @nullfetch/express-gate is running in DEV MODE.           ║\n' +
        '║ Signatures are NOT verified. Attestations are NOT checked.║\n' +
        '║ Any request setting X-Wallet-Address is "authenticated".  ║\n' +
        '║ DO NOT deploy this to production.                         ║\n' +
        '╚═══════════════════════════════════════════════════════════╝\n',
    );
  }

  const state: BootstrapState | null = devMode
    ? null
    : createBootstrap({
        rpcUrl: options.rpcUrl,
        marketplaceAddress: options.marketplaceAddress,
      });

  // ── /challenge handler ─────────────────────────────────────────
  const challenge: RequestHandler = (req: Request, res: Response): void => {
    const raw =
      (req.query.wallet as string | undefined) ?? req.header('X-Wallet-Address');
    if (!raw) {
      res.status(400).json({
        error: 'missing_wallet',
        detail: 'Pass ?wallet=0x... or send X-Wallet-Address.',
      });
      return;
    }
    let wallet: string;
    try {
      wallet = checksum(raw);
    } catch {
      res
        .status(400)
        .json({ error: 'bad_address', detail: `"${raw}" is not a valid address.` });
      return;
    }

    const nonce = generateNonce();
    const expiresAt = Date.now() + challengeTtlMs;
    void store.set(wallet, { nonce, expiresAt });

    const message = buildChallengeMessage({
      appName,
      wallet,
      nonce,
      expiresAt,
      marketplaceAddress: state?.marketAddress ?? options.marketplaceAddress ?? '',
      serviceId,
    });

    res.json({
      wallet,
      nonce,
      expiresAt,
      message,
      instructions:
        'personal_sign(message), then call the gated endpoint with ' +
        'X-Wallet-Address, X-Auth-Nonce, and X-Wallet-Signature headers.',
    });
  };

  // ── auth middleware ────────────────────────────────────────────
  const gate: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // Header parsing is identical in dev and prod so consumers can
    // exercise the full surface locally.
    const rawWallet = req.header('X-Wallet-Address');
    const nonce = req.header('X-Auth-Nonce');
    const sig = req.header('X-Wallet-Signature');

    if (!rawWallet) {
      res.status(400).json({
        error: 'missing_headers',
        detail:
          'Send X-Wallet-Address' +
          (devMode
            ? ' (dev mode — signature/nonce optional).'
            : ', X-Auth-Nonce, and X-Wallet-Signature. POST /challenge first.'),
      });
      return;
    }

    let wallet: string;
    try {
      wallet = checksum(rawWallet);
    } catch {
      res
        .status(400)
        .json({ error: 'bad_address', detail: `"${rawWallet}" is not valid.` });
      return;
    }

    // ── dev mode short-circuit ───────────────────────────────────
    if (devMode) {
      const ctx: NullFetchContext = {
        wallet,
        serviceId,
        attestationVerifiedAt: Math.floor(Date.now() / 1000),
        attestationExpiresInSeconds: 3600,
        dev: true,
      };
      req.nullfetch = ctx;
      next();
      return;
    }

    if (!nonce || !sig) {
      res.status(400).json({
        error: 'missing_headers',
        detail: 'Send X-Auth-Nonce and X-Wallet-Signature too.',
      });
      return;
    }

    // ── bootstrap-ready check ────────────────────────────────────
    // Soft failure: gate returns 502 until RPC is reachable, but
    // /health stays 200 and /challenge keeps issuing nonces.
    if (!state || !state.ready) {
      res.status(502).json({
        error: 'gate_not_ready',
        detail:
          state?.lastError ??
          'Gate is still bootstrapping. The server is up but cannot read attestations yet.',
        retryAfterSeconds: 10,
      });
      return;
    }

    // ── SIWE check ───────────────────────────────────────────────
    const challenge = await store.get(wallet);
    if (!challenge) {
      res.status(401).json({
        error: 'no_challenge',
        detail: 'No active challenge for this wallet. POST /challenge first.',
        wallet,
      });
      return;
    }
    if (challenge.nonce !== nonce) {
      res.status(401).json({
        error: 'nonce_mismatch',
        detail: "X-Auth-Nonce doesn't match this wallet's most recent challenge.",
        wallet,
      });
      return;
    }
    if (Date.now() > challenge.expiresAt) {
      await store.delete(wallet);
      res.status(401).json({
        error: 'challenge_expired',
        detail: `Challenge expired (${challengeTtlMs / 1000}s window). Re-issue a challenge.`,
        wallet,
      });
      return;
    }

    const message = buildChallengeMessage({
      appName,
      wallet,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      marketplaceAddress: state.marketAddress,
      serviceId,
    });
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, sig);
    } catch (err) {
      res.status(401).json({
        error: 'signature_malformed',
        detail: (err as Error).message,
        wallet,
      });
      return;
    }
    if (recovered.toLowerCase() !== wallet.toLowerCase()) {
      res.status(401).json({
        error: 'signature_mismatch',
        detail: `Signature recovers to ${recovered}, not ${wallet}.`,
        wallet,
      });
      return;
    }
    await store.delete(wallet); // single-use

    // ── on-chain attestation check ───────────────────────────────
    let valid: boolean;
    let verifiedAt: bigint;
    let fresh: boolean;
    let attestedServiceId: bigint;
    try {
      [valid, verifiedAt, fresh, attestedServiceId] = (await state.contract.getAttestation(
        wallet,
      )) as [boolean, bigint, boolean, bigint];
    } catch (err) {
      res.status(502).json({
        error: 'contract_read_failed',
        detail: (err as Error).message,
      });
      return;
    }

    if (!fresh) {
      res.status(401).json({
        error: 'no_fresh_attestation',
        detail: `No on-chain attestation within the ${state.attestationTtl}s window. Run verifyAndAttest on NullFetch first.`,
        wallet,
      });
      return;
    }
    if (!valid) {
      res.status(401).json({
        error: 'attestation_invalid',
        detail: 'Your most recent attestation proved key MISMATCH.',
        wallet,
        verifiedAt: Number(verifiedAt),
        attestedServiceId: attestedServiceId.toString(),
      });
      return;
    }
    if (attestedServiceId !== serviceId) {
      res.status(401).json({
        error: 'service_mismatch',
        detail: `Your latest attestation is for service ${attestedServiceId.toString()}, not this one (${serviceId.toString()}). Attest against the correct service first.`,
        wallet,
        attestedServiceId: attestedServiceId.toString(),
        requestedServiceId: serviceId.toString(),
      });
      return;
    }

    const expiresInSeconds = Math.max(
      0,
      state.attestationTtl - (Math.floor(Date.now() / 1000) - Number(verifiedAt)),
    );

    const ctx: NullFetchContext = {
      wallet,
      serviceId,
      attestationVerifiedAt: Number(verifiedAt),
      attestationExpiresInSeconds: expiresInSeconds,
      dev: false,
    };
    req.nullfetch = ctx;
    next();
  };

  // ── permissive CORS preconfigured for the three custom headers ─
  const cors: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Wallet-Address, X-Auth-Nonce, X-Wallet-Signature',
    );
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };

  // ── public introspection helpers ───────────────────────────────
  const ready = async (): Promise<void> => {
    if (devMode || state?.ready) return;
    while (state && !state.ready) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
  };
  const getAttestationTtl = (): number => state?.attestationTtl ?? 0;

  return { gate, challenge, cors, ready, getAttestationTtl };
}
