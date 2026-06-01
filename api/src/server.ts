import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { ethers } from 'ethers';
import { randomBytes } from 'crypto';

// ─────────────────────────────────────────────────────────────────────
// Marketplace ABI surface this server reads.
// ─────────────────────────────────────────────────────────────────────
const ABI = [
  'function getAttestation(address) view returns (bool valid, uint64 verifiedAt, bool fresh, uint256 serviceId)',
  'function getService(uint256 serviceId) view returns (tuple(address provider, string name, string description, string endpoint, uint8 category, bool active, uint64 createdAt, uint64 subscriberCount))',
  'function attestationTtl() view returns (uint256)',
];

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

const requireEnv = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var: ${k}`);
  return v;
};

// ─────────────────────────────────────────────────────────────────────
// Bootstrap state — populated by `bootstrap()` before the server listens.
// ─────────────────────────────────────────────────────────────────────
let provider: ethers.JsonRpcProvider;
let marketAddr: string;
let contract: ethers.Contract;
let attestationTtl = 3600;

async function bootstrap(): Promise<void> {
  const rpcUrl = `https://sepolia.infura.io/v3/${requireEnv('INFURA_API_KEY')}`;
  marketAddr = ethers.getAddress(requireEnv('MARKETPLACE_ADDRESS'));
  provider = new ethers.JsonRpcProvider(rpcUrl);

  const code = await provider.getCode(marketAddr);
  if (code === '0x') {
    throw new Error(
      `No contract found at MARKETPLACE_ADDRESS=${marketAddr} on Sepolia. ` +
        'Check the address and that deploy:sepolia completed.',
    );
  }

  contract = new ethers.Contract(marketAddr, ABI, provider);
  attestationTtl = Number(await contract.attestationTtl());
  console.log(
    `bootstrap ok  marketplace=${marketAddr}  attestationTtl=${attestationTtl}s`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// SIWE-style sign-in (single-use nonces, 2-minute window).
// ─────────────────────────────────────────────────────────────────────
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
interface Challenge {
  nonce: string;
  expiresAt: number;
}
const challenges = new Map<string, Challenge>();

setInterval(() => {
  const now = Date.now();
  for (const [wallet, c] of challenges) {
    if (now > c.expiresAt) challenges.delete(wallet);
  }
}, 60_000).unref();

function buildChallengeMessage(
  wallet: string,
  nonce: string,
  expiresAt: number,
): string {
  return [
    'Sign in to NullFetch API.',
    '',
    'This proves you control this wallet so the API can look up your',
    'on-chain attestation. Single use, 2-minute window. No tx, no gas.',
    '',
    `wallet:    ${wallet}`,
    `nonce:     ${nonce}`,
    `expiresAt: ${new Date(expiresAt).toISOString()}`,
    `market:    ${marketAddr}`,
  ].join('\n');
}

interface AuthSuccess {
  wallet: string;
  serviceId: bigint;
  attestationVerifiedAt: number;
  attestationExpiresInSeconds: number;
}

type AuthResult =
  | { ok: true; auth: AuthSuccess }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Run the SIWE check + attestation lookup. Returns an AuthSuccess or a
 * ready-to-send error response. The serviceId requested is compared
 * against the attestation's serviceId so each attestation only unlocks
 * one specific service.
 */
async function authenticateRequest(
  req: Request,
  requiredServiceId: bigint | null,
): Promise<AuthResult> {
  const rawWallet = req.header('X-Wallet-Address');
  const nonce = req.header('X-Auth-Nonce');
  const sig = req.header('X-Wallet-Signature');

  if (!rawWallet || !nonce || !sig) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'missing_headers',
        detail:
          'Send X-Wallet-Address, X-Auth-Nonce, and X-Wallet-Signature. ' +
          'Get the nonce and message from POST /challenge first.',
      },
    };
  }

  let wallet: string;
  try {
    wallet = ethers.getAddress(rawWallet);
  } catch {
    return {
      ok: false,
      status: 400,
      body: { error: 'bad_address', detail: `"${rawWallet}" is not valid.` },
    };
  }

  // ── SIWE-style nonce + signature check ──────────────────────────
  const challenge = challenges.get(wallet);
  if (!challenge) {
    return {
      ok: false,
      status: 401,
      body: {
        error: 'no_challenge',
        detail: 'No active challenge. POST /challenge first.',
        wallet,
      },
    };
  }
  if (challenge.nonce !== nonce) {
    return {
      ok: false,
      status: 401,
      body: {
        error: 'nonce_mismatch',
        detail: 'The nonce header does not match the most recent challenge.',
        wallet,
      },
    };
  }
  if (Date.now() > challenge.expiresAt) {
    challenges.delete(wallet);
    return {
      ok: false,
      status: 401,
      body: {
        error: 'challenge_expired',
        detail: 'Challenge expired. Re-issue a challenge.',
        wallet,
      },
    };
  }

  const message = buildChallengeMessage(wallet, challenge.nonce, challenge.expiresAt);
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(message, sig);
  } catch (e) {
    return {
      ok: false,
      status: 401,
      body: {
        error: 'signature_malformed',
        detail: (e as Error).message,
        wallet,
      },
    };
  }
  if (recovered.toLowerCase() !== wallet.toLowerCase()) {
    return {
      ok: false,
      status: 401,
      body: {
        error: 'signature_mismatch',
        detail: `Signature recovers to ${recovered}, not ${wallet}.`,
        wallet,
      },
    };
  }

  // Single-use: drop after successful recovery.
  challenges.delete(wallet);

  // ── on-chain attestation lookup ─────────────────────────────────
  let valid: boolean;
  let verifiedAt: bigint;
  let fresh: boolean;
  let serviceId: bigint;
  try {
    [valid, verifiedAt, fresh, serviceId] = (await contract.getAttestation(
      wallet,
    )) as [boolean, bigint, boolean, bigint];
  } catch (e) {
    return {
      ok: false,
      status: 502,
      body: {
        error: 'contract_read_failed',
        detail: (e as Error).message,
      },
    };
  }

  if (!fresh) {
    return {
      ok: false,
      status: 401,
      body: {
        error: 'no_fresh_attestation',
        detail: `No on-chain attestation within the ${attestationTtl}-second window. Run verifyAndAttest first.`,
        wallet,
      },
    };
  }
  if (!valid) {
    return {
      ok: false,
      status: 401,
      body: {
        error: 'attestation_invalid',
        detail: 'Your most recent attestation proved key MISMATCH.',
        wallet,
        serviceId: serviceId.toString(),
        verifiedAt: Number(verifiedAt),
      },
    };
  }
  if (requiredServiceId !== null && serviceId !== requiredServiceId) {
    return {
      ok: false,
      status: 401,
      body: {
        error: 'service_mismatch',
        detail: `Your latest attestation is for service ${serviceId.toString()}, not ${requiredServiceId.toString()}. Run an attestation against the correct service first.`,
        wallet,
        attestedServiceId: serviceId.toString(),
        requestedServiceId: requiredServiceId.toString(),
      },
    };
  }

  const remaining =
    attestationTtl - (Math.floor(Date.now() / 1000) - Number(verifiedAt));
  return {
    ok: true,
    auth: {
      wallet,
      serviceId,
      attestationVerifiedAt: Number(verifiedAt),
      attestationExpiresInSeconds: Math.max(0, remaining),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Category-aware stub responses. In a real deployment each provider's
// API would do something useful here; for the demo we return a small
// shape per category so callers can see the auth gate actually works.
// ─────────────────────────────────────────────────────────────────────
const QUOTES = [
  'Octopuses have three hearts.',
  'Honey never spoils.',
  'Bananas are berries; strawberries are not.',
  'The shortest war in history lasted 38 minutes.',
  'A group of flamingos is called a flamboyance.',
];

function stubResponse(category: number, _serviceId: bigint): Record<string, unknown> {
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

// ─────────────────────────────────────────────────────────────────────
// Express app.
// ─────────────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');

app.use((req: Request, res: Response, next: () => void) => {
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
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'nullfetch-demo-api',
    marketplace: marketAddr,
    attestationTtlSeconds: attestationTtl,
    challengeTtlSeconds: CHALLENGE_TTL_MS / 1000,
    categories: CATEGORIES,
  });
});

// ── /challenge ─────────────────────────────────────────────────────
app.post('/challenge', (req: Request, res: Response) => issueChallenge(req, res));
app.get('/challenge', (req: Request, res: Response) => issueChallenge(req, res));

function issueChallenge(req: Request, res: Response): void {
  const raw =
    (req.query.wallet as string | undefined) ?? req.header('X-Wallet-Address');
  if (!raw) {
    res.status(400).json({
      error: 'missing_wallet',
      detail: 'Pass ?wallet=0x... (or send X-Wallet-Address).',
    });
    return;
  }
  let wallet: string;
  try {
    wallet = ethers.getAddress(raw);
  } catch {
    res.status(400).json({
      error: 'bad_address',
      detail: `"${raw}" is not a valid Ethereum address.`,
    });
    return;
  }

  const nonce = '0x' + randomBytes(16).toString('hex');
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  challenges.set(wallet, { nonce, expiresAt });

  res.json({
    wallet,
    nonce,
    expiresAt,
    message: buildChallengeMessage(wallet, nonce, expiresAt),
    instructions:
      'personal_sign(message), then call GET /api/service/<id> with ' +
      'X-Wallet-Address, X-Auth-Nonce, and X-Wallet-Signature headers.',
  });
}

// ── /whoami — auth probe, returns the attestation as-is ────────────
app.get('/whoami', async (req: Request, res: Response) => {
  const result = await authenticateRequest(req, null);
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.json({
    authenticated: true,
    wallet: result.auth.wallet,
    serviceId: result.auth.serviceId.toString(),
    attestationVerifiedAt: result.auth.attestationVerifiedAt,
    expiresInSeconds: result.auth.attestationExpiresInSeconds,
    message:
      'You proved possession of a valid key without revealing it, and ' +
      'you proved control of this wallet without sending us a credential. ' +
      "We never saw either. We can't leak what we don't have.",
  });
});

// ── /api/service/:id — the actual gated demo endpoint ─────────────
app.get('/api/service/:id', async (req: Request, res: Response) => {
  let requested: bigint;
  try {
    requested = BigInt(req.params.id);
  } catch {
    res.status(400).json({ error: 'bad_service_id', detail: req.params.id });
    return;
  }

  const result = await authenticateRequest(req, requested);
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }

  // Look up the service to get its category for the stub response.
  let category: number;
  let name: string;
  try {
    const s = (await contract.getService(requested)) as {
      category: bigint;
      name: string;
    };
    category = Number(s.category);
    name = s.name;
  } catch (e) {
    res.status(404).json({
      error: 'service_not_found',
      detail: (e as Error).message,
      serviceId: requested.toString(),
    });
    return;
  }

  const stub = stubResponse(category, requested);
  res.json({
    authenticated: true,
    wallet: result.auth.wallet,
    service: {
      id: requested.toString(),
      name,
      category: CATEGORIES[category] ?? 'Other',
    },
    response: stub,
    attestationExpiresInSeconds: result.auth.attestationExpiresInSeconds,
  });
});

// ─────────────────────────────────────────────────────────────────────
// Boot.
// ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3000);

bootstrap()
  .then(() => {
    app.listen(port, () =>
      console.log(
        `api listening on :${port}  market=${marketAddr}  attestationTtl=${attestationTtl}s`,
      ),
    );
  })
  .catch((err) => {
    console.error('bootstrap failed:', (err as Error).message);
    process.exit(1);
  });
