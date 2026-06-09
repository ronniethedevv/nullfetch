# Integrate NullFetch in your API

> Provider docs · integration guide
>
> Source: https://nullfetch.vercel.app/docs/providers

Add wallet-gated authentication to an existing Node/Express API server
in about an hour. No API key database, no plaintext keys on disk, no
custom signing logic — the server reads on-chain attestations from the
marketplace contract and gates responses on a single boolean flag.

---

## 01 · Overview

Your API server doesn't store, generate, or compare API keys. It calls
one read-only function on the NullFetch marketplace contract —
`getAttestation(wallet)` — and treats the response as the auth decision.

Three things happen on every request to a gated endpoint:

1. **SIWE check.** The caller signs a short-lived challenge you issued.
   You verify the signature recovers to the wallet they claim.
2. **On-chain attestation read.** You call `getAttestation(wallet)`. The
   contract returns `(valid, verifiedAt, fresh, serviceId)`.
3. **Decision.** Allow if
   `fresh && valid && serviceId == YOUR_SERVICE_ID`. Otherwise return
   401.

That's the entire protocol. No key storage. No key comparison. No KMS
calls. Just one RPC read per request, which is free on most Sepolia
providers.

---

## 02 · Prerequisites

| Need | For | Cost |
|---|---|---|
| Node 18+ & npm | Runtime | 0 |
| Express (or fastify/koa/hono) | HTTP server | 0 |
| `ethers@^6` | Signature verify + contract read | 0 |
| A Sepolia RPC URL | Reading the attestation | $0 (public default), recommended: your own Infura/Alchemy free tier |
| A long-lived host | Express + in-memory nonce store | $0 (Render free tier works) |
| A listed service on NullFetch | Knowing your `serviceId` | 0.0003 Sepolia ETH listing fee |

> No wallet, no private key, no signing. The server only reads the
> chain — it never writes.

---

## 03 · Quick start

Eight lines of integration code. Replace `YOUR_SERVICE_ID` with the id
you get after listing.

```bash
npm install @nullfetch/express-gate ethers express
```

```ts
import express from 'express';
import { createGate } from '@nullfetch/express-gate';

const nf = createGate({ serviceId: YOUR_SERVICE_ID });
const app = express();

app.use(nf.cors);                              // permissive CORS
app.post('/challenge', nf.challenge);          // SIWE challenge issuer
app.get('/api/service/:id', nf.gate, (req, res) => {
  // req.nullfetch.wallet is the authenticated caller
  res.json({ data: 'your protected payload here' });
});

app.listen(process.env.PORT || 3000);
```

That's the entire integration. The package handles challenge nonces,
signature recovery, attestation reads, freshness checks, service id
matching, and error responses.

---

## 04 · Step-by-step

### 1. List your service

Open `/provider/new` on NullFetch, connect your wallet, fill in name +
description + endpoint URL + category. Pay the listing fee (0.0003
Sepolia ETH).

The success page shows your `serviceId` — a small integer like `3`.
Save it.

### 2. Install the SDK

```bash
cd your-api/
npm install @nullfetch/express-gate ethers
```

### 3. Add the gate to your server

```ts
import { createGate } from '@nullfetch/express-gate';

const nf = createGate({ serviceId: 3 });

app.use(nf.cors);
app.post('/challenge', nf.challenge);

// before:
app.get('/quote', (req, res) => res.json({ quote: '...' }));

// after:
app.get('/quote', nf.gate, (req, res) => {
  res.json({ quote: '...', requestedBy: req.nullfetch.wallet });
});
```

### 4. Configure environment

```dotenv
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
PORT=3000
```

### 5. Deploy

Any Node 18+ host with HTTPS works: Render, Fly.io, Railway, Heroku, a
VPS, your own server. The integration imposes no host requirements.

### 6. Test the round-trip

Once deployed, run through the developer flow from `/browse` on
NullFetch — find your service, register for it, run an attestation,
then hit your endpoint.

---

## 05 · API reference

### `createGate(options)`

```ts
interface CreateGateOptions {
  serviceId: number | bigint;             // required
  rpcUrl?: string;                        // defaults to SEPOLIA_RPC_URL env
  marketplaceAddress?: string;            // baked-in default works
  devMode?: boolean;                      // local-dev bypass
  store?: ChallengeStore;                 // pluggable nonce store
  challengeTtlMs?: number;                // default: 2 minutes
}

interface CreatedGate {
  challenge: RequestHandler;              // mount at POST /challenge
  gate: RequestHandler;                   // wrap routes to gate
  cors: RequestHandler;                   // permissive CORS middleware
  ready: () => Promise<void>;             // resolves once bootstrapped
}
```

### `req.nullfetch` (on authenticated requests)

```ts
interface NullFetchAuth {
  wallet: string;                         // EIP-55 checksummed
  serviceId: number;
  verifiedAt: number;                     // unix seconds
  expiresInSeconds: number;
}

app.get('/quote', nf.gate, (req, res) => {
  console.log('authenticated as', req.nullfetch.wallet);
  res.json({ quote: pickRandomQuote() });
});
```

### `ChallengeStore` (advanced)

```ts
interface ChallengeStore {
  get(wallet: string): Promise<Challenge | null>;
  set(wallet: string, challenge: Challenge): Promise<void>;
  delete(wallet: string): Promise<void>;
}
```

Implement against Redis or any shared KV if you run multiple server
instances. The default in-memory map is per-instance.

---

## 06 · Local development

Use `devMode: true` to bypass signature + attestation checks. The gate
accepts any wallet header and pretends every caller is authenticated:

```ts
const nf = createGate({
  serviceId: 3,
  devMode: process.env.NODE_ENV !== 'production',
});
```

A loud warning logs at startup. Tie it strictly to `NODE_ENV`; never
enable in production.

```bash
# in dev mode, any wallet address works
curl http://localhost:3000/quote \
  -H "X-Wallet-Address: 0x000000000000000000000000000000000000dEaD" \
  -H "X-Auth-Nonce: anything" \
  -H "X-Wallet-Signature: anything"
```

---

## 07 · Production checklist

- [ ] Set `SEPOLIA_RPC_URL` to your own Infura / Alchemy / QuickNode
      endpoint.
- [ ] `devMode` is `false` and gated on `NODE_ENV`.
- [ ] HTTPS only. Browsers block mixed content from the marketplace UI.
- [ ] CORS configured. The default is permissive — tighten if you
      allowlist origins.
- [ ] Pluggable challenge store if you horizontally scale (Redis
      adapter).
- [ ] Monitor `/health` — the SDK's soft bootstrap keeps health up
      under degraded RPC.
- [ ] Update your endpoint URL on-chain via `/provider` if you redeploy.
- [ ] Test the revocation path end-to-end on a test subscription.

---

## 08 · Error codes

Every gated response that isn't a 2xx returns JSON with `error` and
`detail`. Surface both to your callers.

| Status | Error | Cause / fix |
|---|---|---|
| 400 | `missing_headers` | Caller didn't send all three auth headers. |
| 400 | `bad_address` | Wallet header isn't valid. Pass `ethers.getAddress()`. |
| 401 | `no_challenge` | Caller skipped `POST /challenge`. |
| 401 | `nonce_mismatch` | Caller's nonce doesn't match the latest. |
| 401 | `challenge_expired` | 2-minute TTL elapsed. Re-issue. |
| 401 | `signature_malformed` | Signature isn't valid ECDSA. |
| 401 | `signature_mismatch` | Signature recovers to a different wallet. |
| 401 | `no_fresh_attestation` | Caller has no attestation or it's stale. |
| 401 | `attestation_invalid` | Caller's key didn't match the stored ciphertext. |
| 401 | `service_mismatch` | Caller's attestation is for a different service. |
| 502 | `gate_not_ready` | Bootstrap hasn't completed (RPC unreachable). |
| 502 | `contract_read_failed` | Transient RPC error. Retry with backoff. |

---

## 09 · FAQ

**How long does an attestation last?**
Default: 1 hour. Range: 1 min to 24h, owner-settable on the contract.

**Do I pay gas per API call?**
No. The provider only does free RPC reads.

**What if my server scales horizontally?**
The default in-memory store is per-instance. Implement a `ChallengeStore`
backed by Redis or similar.

**Can I check arbitrary conditions in the gate?**
Yes — after `nf.gate` succeeds you have `req.nullfetch.wallet` and can
add rate-limiting, tier checks, billing logic, etc.

**Can a different service's attestation pass my gate?**
No. The gate enforces `serviceId` match before passing.

**Is this fhEVM mainnet-ready?**
Sepolia only today. Mainnet rollout depends on Zama. Cost model
changes — bump the TTL to 24h on mainnet to amortize refresh gas across
more calls.

**Does NullFetch see my responses?**
No. The contract is involved only in the auth decision. Your payload
flows directly from your server to the caller.

**What kinds of APIs fit this auth model?**
Stateless REST APIs. For streaming / WebSocket / inbound webhooks,
adapt the pattern (auth once, issue a session token). Anonymous APIs
don't fit — wallet identity is mandatory.

---

## 10 · Need help

- **Source & issues:** https://github.com/ronniethedevv/nullfetch
- **Marketplace contract on Sepolia:**
  [0x77CD…3875](https://sepolia.etherscan.io/address/0x77CD4B9b78946A20407fa1C1C8B3298401D93875#code)
- **Reference integrations:**
  - [quote-api](https://github.com/ronniethedevv/quote-api) — third-party provider
  - [quote-fetcher](https://github.com/ronniethedevv/quote-fetcher) — consumer CLI + frontend
- **Maintainer:** [@ronnie_thedev](https://x.com/ronnie_thedev)
