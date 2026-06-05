# NullFetch — confidential API marketplace on Zama fhEVM

> API keys you can't leak, because no one has them.

A marketplace where providers list APIs and developers register for
them. The API keys themselves are **never held in plaintext** by the
marketplace, by the provider, by any database, or by anyone but the
developer that generated them.

Built on Zama fhEVM. Real TFHE on Sepolia, not demo encryption.

---

## The claim

|  Actor | Sees the plaintext key? |
| --- | --- |
| The developer (key holder) | **Yes — only on their own device, only at generation time** |
| The service provider | No — only ciphertext is stored |
| The marketplace contract | No — only ciphertext is stored |
| The marketplace operator | No — there is no off-chain key database |
| The Zama coprocessor / KMS | No — threshold-secret-shared across 13 nodes (9-of-13 to decrypt) |
| Any chain observer | No — only handles, never values |
| Anyone who breaches the marketplace | **No — there is no plaintext to steal** |

If the marketplace's database leaks, the only thing on disk is
ciphertext. If a provider's auth server is compromised, there's no key
material on it to extract. If the chain is forked, replayed, or
re-indexed, no plaintext appears.

---

## How it works

```
┌─ provider ──────────────────┐         ┌─ developer ─────────────────┐
│ listService(name, …)        │         │ crypto.getRandomValues(32)  │
│ pays 0.0003 ETH (one-time)  │         │ keccak256 → hi/lo halves    │
│                             │         │ Zama relayer encrypts halves│
│   ─→ Service #N created     │         │ ZKPoK proof generated       │
│                             │         │                             │
│                             │  ─────→ │ registerForService(N, …)    │
│                             │         │ pays 0.0003 ETH (one-time)  │
│                             │         │                             │
│                             │         │   ─→ ciphertext stored,     │
│                             │         │      provider never sees    │
│                             │         │      plaintext              │
└─────────────────────────────┘         └─────────────────────────────┘

Then, whenever the developer wants to use the service:

      developer (off-chain)                marketplace contract
      ─────────────────────                ──────────────────────
      re-encrypt key halves   ──verify──>  FHE.eq on ciphertext
                              <──ebool──   returns encrypted boolean
      user-decrypt locally
        — only the dev sees the answer

  Or, for API gating:

      verifyAndAttest         ──FHE.eq──>  marks ebool publicly decryptable
      relayer.publicDecrypt   ──KMS sig──> returns signed cleartext
      submitAttestation       ──verify──>  writes plaintext result on-chain
                                           with serviceId + TTL

  The provider's API server then reads getAttestation(wallet) — a free
  view call — and gates response on (fresh && valid && serviceId == N).
```

Each provider runs an API server. The server reads on-chain attestations
and has no key database. Auth is **two lines of code** when integrated
via the `@nullfetch/express-gate` SDK shipped in this repo (see
[`packages/nullfetch-express-gate/`](packages/nullfetch-express-gate/)):

```ts
const nf = createGate({ serviceId: 3 });
app.get('/api/service/:id', nf.gate, (req, res) => {
  res.json({ /* your business logic */ });
});
```

The SDK handles SIWE challenge issuance, signature verification, the
on-chain attestation lookup, service-id matching, structured error
responses, soft bootstrap (server stays up even when Sepolia is
degraded), pluggable challenge stores for horizontal scaling, and dev
mode. See the [package README](packages/nullfetch-express-gate/README.md)
for the full surface.

---

## Demo in 90 seconds

After cloning + `npm install` in the root, `api/`, and `web/`:

```sh
# 1. Deploy (or reuse the bundled deployments.json)
npm run deploy:sepolia

# 2. Provider lists a service (set SERVICE_* in .env first)
npm run list-service:sepolia
# → SERVICE_ID = 1

# 3. Run the API server + web app in two terminals
npm run api:dev
npm run web:dev
# → web at http://localhost:5173

# 4. In the browser:
#    /browse           — see the service you just listed
#    /service/1        — click "register for this service"
#    /developer/register/1
#                      — click "register · pay 0.0003 ETH"
#                      — MetaMask prompts, you pay, see the
#                        one-time generated key reveal
#    /developer/service/1
#                      — click "encrypt & verify"          → true
#                      — click "run on-chain attestation"  → true
#                      — click "sign + GET /api/service/1" → HTTP 200
```

A beat-by-beat script for a recorded demo lives at
[`docs/demo-script.md`](docs/demo-script.md).

---

## Setup

```sh
git clone <this-repo>
cd <this-repo>
cp .env.example .env       # fill MNEMONIC + INFURA_API_KEY
npm install
npm run compile
npm test                   # 39 passing — mock fhEVM, no Sepolia, no relayer
```

See [`.env.example`](.env.example) for every variable the scripts and
API server read. The web app reads the deployed contract address from
[`deployments.json`](deployments.json) at build time, so the contract
input auto-fills after a `deploy:sepolia` run.

---

## App routes

The web app is a real router (react-router-dom v6), not a single page:

| Route | Wallet | Purpose |
| --- | --- | --- |
| `/` | optional | Landing, role CTAs, category preview |
| `/browse` | optional | Public marketplace browse (paginated, filterable) |
| `/service/:id` | optional | Public service detail page |
| `/provider` | required | Listed services + stats |
| `/provider/new` | required | List a new service (pays listing fee) |
| `/provider/service/:id` | required | Manage one service: edit endpoint/desc, set inactive, view + revoke subscribers |
| `/developer` | required | Active subscriptions |
| `/developer/register/:id` | required | Register for a service: generate key, encrypt, pay fee |
| `/developer/service/:id` | required | Use a subscription: verify, attest, call API, rotate key |

---

## CLI scripts

For testing without the web app — same flow, different surface:

| Script | What it does |
| --- | --- |
| `npm run deploy:sepolia` | Deploys Marketplace, writes `deployments.json`, optionally verifies on Etherscan |
| `npm run list-service:sepolia` | Provider lists a service. Reads `SERVICE_NAME`, `SERVICE_DESCRIPTION`, `SERVICE_ENDPOINT`, `SERVICE_CATEGORY` from `.env`. Pays listing fee. |
| `npm run register:sepolia` | Developer registers for `SERVICE_ID`. Generates a random key, encrypts, pays registration fee, writes plaintext to `.key-service-<id>` (mode 0600, gitignored). |
| `npm run verify-key:sepolia` | Developer verifies possession of the key for `SERVICE_ID`. Reads plaintext from `.key-service-<id>` (or `CANDIDATE_KEY` env override). Prints `YES` or `NO`. |

---

## Contract surface

[`contracts/Marketplace.sol`](contracts/Marketplace.sol) — single
deployable contract, audited against all 20 patterns in Zama's fhEVM
anti-pattern catalog. Audit summary below.

```solidity
// provider-facing
function listService(string name, string description, string endpoint, Category category)
    external payable returns (uint256 serviceId);
function setServiceActive(uint256 serviceId, bool active) external;
function setServiceEndpoint(uint256 serviceId, string endpoint) external;
function setServiceDescription(uint256 serviceId, string description) external;
function revokeSubscription(uint256 serviceId, address developer) external;
function recordUse(uint256 serviceId, address developer) external;  // optional usage counter

// developer-facing
function registerForService(uint256 serviceId, externalEuint128 hi, externalEuint128 lo, bytes proof)
    external payable;
function rotateKey(uint256 serviceId, externalEuint128 hi, externalEuint128 lo, bytes proof) external;
function verify(uint256 serviceId, externalEuint128 hi, externalEuint128 lo, bytes proof)
    external returns (ebool);
function verifyAndAttest(uint256 serviceId, externalEuint128 hi, externalEuint128 lo, bytes proof)
    external;
function submitAttestation(bytes32[] handles, bytes cleartexts, bytes proof) external;

// API-server-facing (read-only)
function getAttestation(address user)
    external view returns (bool valid, uint64 verifiedAt, bool fresh, uint256 serviceId);

// discovery + admin
function getServicesPage(uint256 offset, uint256 limit) external view returns (...);
function getServicesByCategory(Category cat, uint256 offset, uint256 limit) external view returns (...);
function getService(uint256 serviceId) external view returns (Service memory);
function setListingFee(uint256) external;          // owner
function setRegistrationFee(uint256) external;     // owner
function setAttestationTtl(uint256) external;      // owner, bounded [1m, 24h]
function setTreasury(address) external;            // owner
function withdraw() external;                      // anyone, sends to treasury
function transferOwnership(address) external;      // owner (two-step)
function acceptOwnership() external;               // pending owner
```

39 contract tests in `test/Marketplace.test.ts` cover listing fees,
single-subscription-per-dev rule, revocation cutting off in-flight
attestations, verify + attestation flows, multi-service isolation,
cross-caller ACL isolation, key rotation, treasury withdraw,
two-step ownership, TTL bounds.

---

## Stack (verified compatible — keep pinned)

| Package | Version |
| --- | --- |
| solidity | 0.8.27 |
| hardhat | ^2.26.0 |
| @fhevm/hardhat-plugin | ^0.4.2 |
| @fhevm/solidity | ^0.11.1 |
| @fhevm/mock-utils | 0.4.2 |
| @nomicfoundation/hardhat-toolbox | ^5 |
| ethers | ^6.16.0 |
| @zama-fhe/relayer-sdk | 0.4.1 |
| react / react-dom | ^18.3.1 |
| react-router-dom | ^6.28.0 |
| vite | ^5.4.10 |
| express | ^4.19.2 |

`@fhevm/hardhat-plugin@0.4.2` runtime-checks `@zama-fhe/relayer-sdk` to
exactly `0.4.1`. Pin both. A `.npmrc` sets `legacy-peer-deps=true` for
the Hardhat-toolbox transitive conflict.

---

## Anti-pattern audit

Walked against all 20 patterns in Zama's fhEVM anti-pattern catalog.
No violations.

- **Layer 1 (logic correctness)** — No `if`/`require` on `ebool`. All
  conditional logic via `FHE.select` and silent failure.
  `FHE.allowThis` on every stored ciphertext, `FHE.allow(handle,
  msg.sender)` on every user-decryptable result. `FHE.isSenderAllowed`
  as defense in depth on every external handle.
- **Layer 2 (operational)** — `submitAttestation` follows strict CEI:
  handle records invalidated before the attestation write. KMS
  signatures verified via `FHE.checkSignatures` as the first line of
  the callback. ~600K HCU per `verify` call; well under the 20M
  per-tx budget.
- **Layer 3 (privacy)** — Events emit handles, never values. The
  `Attested` event carries the boolean by design (the public-decrypt
  flow exists to publish that boolean). No trivial encryption from
  user inputs. No `allowTransient`, so no AA-bundle bleed.

---

## Cost model

The developer does **not** pay gas per API call. Once attested, calls
to the API within the attestation TTL window are free signatures only:

| Action | Cost | Frequency |
| --- | --- | --- |
| `listService` | 0.0003 ETH + ~200K gas | Once per service |
| `registerForService` | 0.0003 ETH + ~200K gas | Once per (service, developer) |
| `verifyAndAttest` + `submitAttestation` | ~600K gas total, no fee | Once per TTL (default 1h) |
| SIWE `personal_sign` | **No gas, no fee** | Per API call |
| `GET /api/service/:id` | **No gas, no fee** | Per API call |

For high-frequency APIs, bump `attestationTtl` up to 24h via
`setAttestationTtl` so the refresh cost amortises over a full day.

---

## Limitations

The marketplace claim is real, but bounded:

- **Encryption happens client-side.** The browser that generates the
  key sees the plaintext first. fhEVM hides it from everyone past
  that point; it does not hide the user's own machine from itself.
  The browser is the trust boundary. The localStorage record itself
  is wrapped in an AES-GCM envelope under a wallet-signature-derived
  KEK (see [`docs/threat-model.md`](docs/threat-model.md)) so a
  passive disk dump or a casual extension peek returns ciphertext
  only — but malware in the same process or a hostile script
  triggering the unlock can still see plaintext.

- **Not a drop-in for existing API providers.** Twilio, Stripe, and
  OpenAI use the API key as a bearer credential — the centralised
  service receives plaintext on every request and acts on it. Nothing
  here changes that. The fit is greenfield flows where the on-chain
  `verify` is the authentication step, or providers willing to
  redesign their auth around it.

- **Linkability is on-chain.** The subscriber's wallet is public in
  the `Subscribed` event and in the storage layout. The *key* stays
  private; *who subscribes to which service* does not. For stronger
  unlinkability, subscribers can use a fresh wallet for marketplace
  activity. The marketplace doesn't force a linkage and can't remove
  one either.

- **Brute-forceability for low-entropy keys.** `verify` has no rate
  limit, no fee escalation, no lockout. The registration flow
  generates 256-bit random keys to keep that surface closed by
  default. Users who supply their own key bypass that default.

- **Sepolia only.** Built on Zama fhEVM testnet. The encryption is
  real (production KMS, real threshold MPC); the blockspace is test
  ETH.

- **`recordUse` is one tx per call.** It is optional by design. A
  provider who wants on-chain usage analytics calls it after each
  API hit; one tx per call is fine on Sepolia, expensive on mainnet.
  Most providers will skip it and track usage off-chain.

---

## License

MIT.
