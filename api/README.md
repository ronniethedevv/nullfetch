# NullFetch — demo API server

A minimal Express service that proves what a real-world API provider
looks like when it has *no* API-key database to leak.

The provider's "auth check" is a read of an on-chain attestation:
`getAttestation(wallet)` on the deployed Marketplace contract. The
attestation says (in cleartext, on Sepolia) whether that wallet recently
proved possession of a valid key — **without ever revealing the key**
to the provider, the chain, the relayer, or the KMS.

The server:

- Holds **no private key**, signs **no transaction**, needs **no
  funding**. It only does read calls via Infura.
- Receives **only the wallet address + SIWE proof of wallet control**.
  The underlying API key is never sent to it, ever.
- Trusts the on-chain attestation because it was signed by the Zama KMS
  threshold and verified inside `submitAttestation` via
  `FHE.checkSignatures`.
- Matches the attestation's `serviceId` against the requested service.
  An attestation for service #1 does not grant access to service #2.

If this server is breached tomorrow, the attacker gets a list of wallet
addresses and a copy of this code. They get no keys — there are none
to get.

---

## Run

Prerequisites: a deployed `Marketplace` on Sepolia and an Infura API
key. Both come from running `npm run deploy:sepolia` in the repo root.

```sh
cd api
cp .env.example .env
# fill MARKETPLACE_ADDRESS and INFURA_API_KEY

npm install
npm run dev
# → bootstrap ok  marketplace=0x…  attestationTtl=3600s
# → api listening on :3000
```

The bootstrap step verifies a contract exists at `MARKETPLACE_ADDRESS`
and reads the live `attestationTtl` once. If either fails the server
refuses to listen — clearer than a runtime crash mid-request.

---

## Endpoints

```sh
# Public — sanity check
curl http://localhost:3000/health
# → { ok: true, marketplace: '0x…', attestationTtlSeconds: 3600, … }
```

```sh
# ── auth flow ──────────────────────────────────────────────────
# 1. Get a SIWE-style challenge (single-use, 2-minute window)
curl -X POST 'http://localhost:3000/challenge?wallet=0xYourWallet'
# → { wallet, nonce, expiresAt, message, instructions }

# 2. Sign `message` with personal_sign in your wallet.
# 3. Call the protected endpoint with three headers:
curl http://localhost:3000/api/service/1 \
  -H 'X-Wallet-Address: 0xYourWallet' \
  -H 'X-Auth-Nonce: 0x…the nonce from step 1' \
  -H 'X-Wallet-Signature: 0x…the signature'

# After a fresh verifyAndAttest for service #1:
# → 200, authenticated:true, service:{ id:'1', name:'FactGen', category:'AI' }, response:{ … }

# Without one:
# → 401, no_fresh_attestation
```

```sh
# /whoami — auth probe (returns the attestation as-is, no service check)
curl http://localhost:3000/whoami -H '...same three headers...'
# → 200, wallet, serviceId, attestationVerifiedAt, expiresInSeconds
```

---

## What gates the response

Six checks, in order:

1. `X-Wallet-Address`, `X-Auth-Nonce`, `X-Wallet-Signature` present? → 400 if not.
2. Nonce known + not expired? → 401 if not.
3. Signature recovers to the claimed wallet? → 401 if not.
4. Attestation exists and is fresh (within `attestationTtl`)? → 401 if not.
5. Attestation says `valid == true`? → 401 if not.
6. Attestation's `serviceId` matches the URL param? → 401 if not.

All six pass → category-aware stub response.

---

## Category-stub responses

For the demo, each category returns a small shape so callers can see
the auth gate actually works. In a real deployment the provider
replaces the body of the relevant `case` in `stubResponse()` with their
actual API logic.

| Category | Stub |
| --- | --- |
| AI | random fact from a hardcoded list |
| Finance | fake ETH price |
| Data | tiny fake dataset |
| Weather | fake forecast |
| Utility | echo timestamp |
| Storage | no-op storage stub |
| Communications | no-op message stub |
| Other | `{ ok: true }` |

The auth-gate code (`authenticateRequest`) is **provider-agnostic** —
every provider's server runs the exact same lines. Only the post-auth
response body changes.

---

## Honest framing

- **Provider-side primitive.** Doesn't sit in front of an existing
  centralised integration. Real fit is greenfield APIs where the
  on-chain `verify` *is* the authentication step.

- **Encryption is client-side.** The browser that generates the key
  sees plaintext first. Everything past that point — chain, relayer,
  KMS, provider, marketplace operator — only sees ciphertext.

- **No rate limit on `verify` / `verifyAndAttest`.** The registration
  flow generates 256-bit random keys to keep brute force closed; a
  provider who lets users bring their own key reopens it.

- **Attestation TTL drives gas cost.** 1 attestation refresh per TTL
  window covers unlimited API calls in between. Bump TTL up for
  high-frequency, down for tighter security. Bounded [1m, 24h].
