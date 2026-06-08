# @nullfetch/express-gate

Express middleware that gates API routes on
[NullFetch](https://github.com/ronniethedevv/nullfetch) on-chain
attestations.

Replaces ~150 lines of hand-written SIWE + fhEVM auth code with two
lines of config.

---

## Install

```sh
npm install @nullfetch/express-gate
```

Or, while the package isn't on the public npm registry yet, install
from a path or git ref:

```sh
npm install file:../path/to/packages/nullfetch-express-gate
# or
npm install github:ronniethedevv/nullfetch#path:/packages/nullfetch-express-gate
```

---

## The whole integration

```ts
import express from 'express';
import { createGate } from '@nullfetch/express-gate';

const app = express();
const nf = createGate({ serviceId: 3 });

app.use(nf.cors);
app.post('/challenge', nf.challenge);

app.get('/api/service/:id', nf.gate, (req, res) => {
  // Auth passed. The recovered wallet and serviceId are on req.nullfetch.
  res.json({ quote: 'You miss 100% of the shots you don\'t take.' });
});

app.listen(3000);
```

That's the entire NullFetch integration. The middleware handles:

- SIWE-style challenge issuance + single-use nonce store
- Personal-sign signature verification via ethers
- On-chain `getAttestation()` lookup
- `serviceId` match against this server's service
- Structured error responses with named error codes
- Permissive CORS for the three custom headers
- Soft bootstrap (server stays up even when Sepolia is degraded)

---

## API

### `createGate(options)`

Returns `{ gate, challenge, cors, ready, getAttestationTtl }`.

#### Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `serviceId` | `bigint \| number` | **required** | The service id this server represents. The gate rejects attestations for any other service id. |
| `rpcUrl` | `string` | `SEPOLIA_RPC_URL` env, then a public RPC | Sepolia JSON-RPC endpoint for the attestation lookup. |
| `marketplaceAddress` | `string` | NullFetch canonical address (baked in) | Override for testing against forks. |
| `devMode` | `boolean` | `false` | When `true`, bypasses signature + attestation checks. Logs a loud warning at startup. **Never set in production.** |
| `challengeTtlMs` | `number` | `120000` (2 min) | Single-use challenge window. |
| `store` | `ChallengeStore` | `InMemoryChallengeStore` | Pluggable; swap for Redis/KV/database when scaling horizontally. |
| `appName` | `string` | `"NullFetch"` | Shown in the wallet popup. Set to your product name. |

#### Returned handlers

- **`gate`** — Express middleware. Authenticates the request and sets `req.nullfetch` to a `NullFetchContext`. Calls `next()` on success, sends 4xx/5xx with a structured body on failure.
- **`challenge`** — Express request handler. Issues a single-use nonce and returns the canonical challenge message. Mount at any path (`app.post('/challenge', nf.challenge)`).
- **`cors`** — Permissive CORS middleware preconfigured to expose the three custom headers (`X-Wallet-Address`, `X-Auth-Nonce`, `X-Wallet-Signature`) and respond to preflight.
- **`ready(): Promise<void>`** — Resolves once the package has successfully read `attestationTtl` from the chain at least once. Optional — the gate works without awaiting.
- **`getAttestationTtl(): number`** — Current TTL the gate is enforcing.

---

## Request shape

After a successful `gate` call, `req.nullfetch` is:

```ts
{
  wallet: string;                       // EIP-55 checksummed
  serviceId: bigint;                    // matches the option you passed
  attestationVerifiedAt: number;        // unix seconds
  attestationExpiresInSeconds: number;  // seconds until stale
  dev: boolean;                         // true only if devMode was set
}
```

---

## Error responses

The gate returns HTTP 4xx/5xx with JSON in this shape:

```json
{ "error": "no_challenge", "detail": "...", "wallet": "0x..." }
```

Possible `error` values:

| Code | Status | When |
| --- | --- | --- |
| `missing_headers` | 400 | One of the three auth headers was missing |
| `bad_address` | 400 | `X-Wallet-Address` isn't a valid Ethereum address |
| `gate_not_ready` | 502 | RPC bootstrap hasn't completed yet — auto-retries; try again in a few seconds |
| `no_challenge` | 401 | No active challenge for this wallet (POST `/challenge` first) |
| `nonce_mismatch` | 401 | `X-Auth-Nonce` doesn't match the most recent challenge |
| `challenge_expired` | 401 | Challenge expired (2-min window by default) |
| `signature_malformed` | 401 | `verifyMessage` threw — usually a malformed hex string |
| `signature_mismatch` | 401 | Signature recovers to a different wallet |
| `contract_read_failed` | 502 | `getAttestation()` RPC call failed |
| `no_fresh_attestation` | 401 | Wallet has no attestation within the TTL window — run `verifyAndAttest` on NullFetch first |
| `attestation_invalid` | 401 | Attestation says the wallet's key didn't match |
| `service_mismatch` | 401 | Wallet's attestation is for a different service id |

---

## Local development

Set `devMode: true` (or `NULLFETCH_DEV_MODE=true` in env, then pass it
through) to bypass the on-chain check during local development:

```ts
const nf = createGate({
  serviceId: 3,
  devMode: process.env.NULLFETCH_DEV_MODE === 'true',
});
```

In dev mode:

- A loud banner is logged at startup. Hard to miss in a build pipeline.
- The gate accepts any `X-Wallet-Address` header without verifying a
  signature.
- The gate skips the attestation lookup.
- `req.nullfetch.dev` is `true`, so handlers can branch if they want.

Curl-friendly:

```sh
curl -i http://localhost:3000/api/service/3 \
  -H 'X-Wallet-Address: 0x000000000000000000000000000000000000dEaD'
# → 200 — passes in dev mode, would fail in prod
```

---

## Horizontal scaling

The default `InMemoryChallengeStore` keeps challenges in the process's
memory. Two consequences:

1. Challenges issued by one dyno aren't visible to the others. With two
   dynos behind a load balancer, half the challenges fail with
   `no_challenge`.
2. Restarts drop all in-flight challenges.

For multi-instance deploys, pass a `store` that talks to Redis or a
database:

```ts
import { createClient } from 'redis';
import type { ChallengeStore } from '@nullfetch/express-gate';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const store: ChallengeStore = {
  async get(wallet) {
    const raw = await redis.get(`nf:challenge:${wallet.toLowerCase()}`);
    return raw ? JSON.parse(raw) : null;
  },
  async set(wallet, challenge) {
    await redis.setEx(
      `nf:challenge:${wallet.toLowerCase()}`,
      120,
      JSON.stringify(challenge),
    );
  },
  async delete(wallet) {
    await redis.del(`nf:challenge:${wallet.toLowerCase()}`);
  },
};

const nf = createGate({ serviceId: 3, store });
```

---

## What this replaces

Before:

```ts
// 156 lines of hand-written code: ABI fragment, ethers provider, contract,
// in-memory challenge map with manual sweep, buildChallengeMessage, the
// SIWE verify dance, the attestation lookup, the serviceId match check,
// structured error responses for each failure mode, the bootstrap
// fail-or-die, the CORS headers...
```

After:

```ts
const nf = createGate({ serviceId: 3 });
app.use(nf.cors);
app.post('/challenge', nf.challenge);
app.get('/api/service/:id', nf.gate, yourHandler);
```

---

## License

MIT.
