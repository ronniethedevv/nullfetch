import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createGate } from '@nullfetch/express-gate';
import { ethers } from 'ethers';

/**
 * NullFetch reference API.
 *
 * Demonstrates the @nullfetch/express-gate integration: ~50 lines of
 * actual code, of which only one block (`createGate(...)`) is
 * NullFetch-specific. Everything else is normal Express.
 *
 * For the demo it handles every service id by reading the service's
 * category from the chain and returning a category-appropriate stub.
 * Real providers replace `stubResponse()` with their actual API logic
 * and lock the gate to their own `SERVICE_ID`.
 */

const requireEnv = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var: ${k}`);
  return v;
};

// ─────────────────────────────────────────────────────────────────────
// One block of NullFetch wiring. That's it.
// ─────────────────────────────────────────────────────────────────────
const rpcUrl =
  process.env.SEPOLIA_RPC_URL ??
  (process.env.INFURA_API_KEY
    ? `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`
    : undefined);

const nf = createGate({
  // The reference API handles all services for the demo; for a real
  // single-service provider this would be a concrete number.
  serviceId: Number(process.env.SERVICE_ID ?? '0') || 1,
  rpcUrl,
  marketplaceAddress: process.env.MARKETPLACE_ADDRESS,
  appName: 'NullFetch (reference)',
  devMode: process.env.NULLFETCH_DEV_MODE === 'true',
});

// ─────────────────────────────────────────────────────────────────────
// Category-aware stub responses.
// ─────────────────────────────────────────────────────────────────────
const CATEGORIES = [
  'Other',
  'AI',
  'Finance',
  'Data',
  'Weather',
  'Utility',
  'Storage',
  'Communications',
] as const;

const QUOTES = [
  'Octopuses have three hearts.',
  'Honey never spoils.',
  'Bananas are berries; strawberries are not.',
  'The shortest war in history lasted 38 minutes.',
  'A group of flamingos is called a flamboyance.',
];

function stubResponse(category: number): Record<string, unknown> {
  const name = CATEGORIES[category] ?? 'Other';
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
  switch (name) {
    case 'AI':
      return { type: 'fact', body: pick(QUOTES) };
    case 'Finance':
      return {
        type: 'quote',
        symbol: 'ETH',
        priceUsd: 3500 + Math.random() * 100,
        ts: new Date().toISOString(),
      };
    case 'Data':
      return {
        type: 'dataset',
        rows: [
          { id: 1, label: 'alpha', value: 42 },
          { id: 2, label: 'beta', value: 17 },
        ],
      };
    case 'Weather':
      return {
        type: 'forecast',
        city: 'Lagos',
        tempC: 28 + Math.random() * 4,
        condition: 'partly cloudy',
      };
    case 'Utility':
      return { type: 'echo', ok: true, now: Date.now() };
    case 'Storage':
      return { type: 'storage', wouldStoreBytes: 0, note: 'demo no-op' };
    case 'Communications':
      return { type: 'message', queued: true, recipient: '— (demo no-op)' };
    default:
      return { type: 'ok', ok: true };
  }
}

// Reuse the gate's already-bootstrapped provider for the category
// lookup. The lookup ABI is intentionally tiny.
const SERVICE_LOOKUP_ABI = [
  'function getService(uint256 serviceId) view returns (tuple(address provider, string name, string description, string endpoint, uint8 category, bool active, uint64 createdAt, uint64 subscriberCount))',
];
const lookupProvider = rpcUrl
  ? new ethers.JsonRpcProvider(rpcUrl)
  : null;
const lookupContract =
  lookupProvider && process.env.MARKETPLACE_ADDRESS
    ? new ethers.Contract(
        ethers.getAddress(requireEnv('MARKETPLACE_ADDRESS')),
        SERVICE_LOOKUP_ABI,
        lookupProvider,
      )
    : null;

// ─────────────────────────────────────────────────────────────────────
// Express app.
// ─────────────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');

app.use(nf.cors);

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'nullfetch-reference-api',
    marketplace: process.env.MARKETPLACE_ADDRESS,
    attestationTtlSeconds: nf.getAttestationTtl(),
    categories: CATEGORIES,
  });
});

// SIWE challenge issuance — provided by the SDK.
app.post('/challenge', nf.challenge);
app.get('/challenge', nf.challenge);

// Raw auth probe — useful for "is my SIWE flow working" debugging.
app.get('/whoami', nf.gate, (req: Request, res: Response) => {
  const ctx = req.nullfetch!;
  res.json({
    authenticated: true,
    wallet: ctx.wallet,
    serviceId: ctx.serviceId.toString(),
    attestationVerifiedAt: ctx.attestationVerifiedAt,
    expiresInSeconds: ctx.attestationExpiresInSeconds,
    devMode: ctx.dev,
  });
});

// The actual gated endpoint. The middleware does all the auth work;
// this handler just looks up the category and returns a stub.
app.get('/api/service/:id', nf.gate, async (req: Request, res: Response) => {
  const ctx = req.nullfetch!;
  let requested: bigint;
  try {
    requested = BigInt(req.params.id);
  } catch {
    res.status(400).json({ error: 'bad_service_id', detail: req.params.id });
    return;
  }

  let category = 0;
  let name = `Service #${requested.toString()}`;
  if (lookupContract) {
    try {
      const s = (await lookupContract.getService(requested)) as {
        category: bigint;
        name: string;
      };
      category = Number(s.category);
      name = s.name;
    } catch (err) {
      res.status(404).json({
        error: 'service_not_found',
        detail: (err as Error).message,
        serviceId: requested.toString(),
      });
      return;
    }
  }

  res.json({
    authenticated: true,
    wallet: ctx.wallet,
    service: {
      id: requested.toString(),
      name,
      category: CATEGORIES[category] ?? 'Other',
    },
    response: stubResponse(category),
    attestationExpiresInSeconds: ctx.attestationExpiresInSeconds,
  });
});

// ─────────────────────────────────────────────────────────────────────
// Boot.
// ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`api listening on :${port}`);
});
