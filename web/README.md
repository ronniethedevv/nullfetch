# NullFetch — web app

A React + Vite app that drives the
[Marketplace](../contracts/Marketplace.sol) contract on Sepolia and the
bundled demo API. Real TFHE via `@zama-fhe/relayer-sdk@0.4.1` (npm, no
CDN), real MetaMask signatures, real on-chain reads.

---

## Routes

| Route | Wallet | Purpose |
| --- | --- | --- |
| `/` | optional | Landing, role CTAs, category preview |
| `/browse` | optional | Public marketplace browse (paginated, filterable) |
| `/service/:id` | optional | Public service detail page |
| `/provider` | required | Your listed services + stats |
| `/provider/new` | required | List a new service (pays listing fee) |
| `/provider/service/:id` | required | Manage one service: edit endpoint/desc, set inactive, view + revoke subscribers |
| `/developer` | required | Your active subscriptions |
| `/developer/register/:id` | required | Register for a service: generate key, encrypt, pay fee |
| `/developer/service/:id` | required | Use a subscription: verify, attest, call API, rotate key |

Public pages (`/browse`, `/service/:id`) read via a fallback Sepolia
public RPC when no wallet is connected, so visitors don't need MetaMask
just to look around.

---

## Prerequisites

1. **MetaMask** (browser extension). The app reads `window.ethereum`
   directly; it does not work without a wallet that injects one.
2. **Sepolia ETH** in the connected account. Any Sepolia faucet works.
   `listService` and `registerForService` both cost a small fee +
   gas; `verify` / `verifyAndAttest` / `submitAttestation` cost gas
   only.
3. **A deployed `Marketplace`** on Sepolia. From the repo root:
   ```sh
   npm run deploy:sepolia
   ```
   The address is auto-written to `deployments.json` and picked up by
   the web app at build time. Hard-refresh after a fresh deploy.
4. **Node 18+** for the Vite dev server.

---

## Run

```sh
cd web
npm install
npm run dev
```

Vite serves at `http://localhost:5173`. Open in a browser with MetaMask.

`npm run typecheck` and `npm run build` are also available and pass
without type errors.

---

## End-to-end flow

1. Open `http://localhost:5173/browse`. The marketplace browse loads
   over a public Sepolia RPC — no wallet needed. Click any service
   card.

2. On `/service/:id`, click **register for this service** → routes to
   `/developer/register/:id`. Click **register · pay 0.0003 ETH**.
   MetaMask prompts.

   The browser does this *before* the prompt:
   - `crypto.getRandomValues(32)` → random API key
   - `keccak256` → split into hi/lo halves
   - Zama relayer encrypts the halves + builds a ZK proof
   - Calls `registerForService(serviceId, hi, lo, proof)` with the fee

3. After the tx mines, the success page reveals the plaintext key one
   time, behind a "reveal" button. There's a copy affordance, an
   acknowledgement checkbox, and the key is auto-saved to localStorage
   for this device. **This is the only copy of plaintext** unless you
   also save it elsewhere.

4. On `/developer/service/:id`:
   - **Verify** — calls `verify(serviceId, …)`, receives an encrypted
     `ebool`, and asks the Zama relayer for a user-decryption. Only
     the developer sees the answer.
   - **Attest** — runs the two-tx public-decrypt flow
     (`verifyAndAttest` → `publicDecrypt` → `submitAttestation`).
     Result is publicly readable on-chain, gated by `serviceId` + a
     TTL.
   - **Call API** — fetches a SIWE-style challenge from the bundled
     API server, signs it with `personal_sign` (no gas), then GETs
     `/api/service/:id` with the three auth headers. The server reads
     the on-chain attestation and gates the response.
   - **Rotate** — generates a new random key client-side and replaces
     the ciphertext via `rotateKey`. Old key stops validating.

---

## Implementation notes

- The web folder is independent of the Hardhat project. It has its own
  `package.json`, pins `@zama-fhe/relayer-sdk` to exactly `0.4.1`, and
  imports the **web** entrypoint (`@zama-fhe/relayer-sdk/web`) — *not*
  the bundle, *not* the CDN. `vite.config.ts` enables
  `vite-plugin-wasm` + `vite-plugin-top-level-await` because the SDK
  ships native WASM.
- The keccak-split (`hi || lo`) is reimplemented identically to
  `scripts/_keyHelpers.ts`. A mismatch would make every `verify`
  return false. Both versions use `keccak256(toUtf8Bytes(key))` and
  split at hex char 32.
- `verify` is a state-changing tx; the return value isn't readable
  off-chain. We parse the `Verified` event from the receipt instead.
- The EIP-712 signature for `userDecrypt` is submitted to the relayer
  with the `0x` prefix stripped — matching the script in
  `scripts/verify-key.ts`. If a future SDK release wants the prefixed
  form, change one line in `DeveloperService.tsx`.
- The contract address is auto-filled from `deployments.json`
  (imported at build time via Vite's JSON support). The user never
  has to paste an address — hard-refresh after a fresh deploy to pick
  up the new one.
- Wallet state lives in a single `useWallet` context at the App root.
  All pages read from the same source; no duplicate listeners,
  no state forks.

---

## Honest framing — also rendered in the app footer

- **Encryption happens client-side.** Whoever runs this browser sees
  the plaintext key first. fhEVM hides it from the contract, the
  chain, the relayer, the KMS, and every observer — but not from the
  encrypting client itself.

- **Public on-chain metadata.** Service names, descriptions, endpoints,
  and the wallet-to-service linkage are public. Only the API key
  contents are encrypted. Use a fresh wallet for stronger
  unlinkability if your subscription itself is sensitive.

- **No rate limit on `verify`.** Brute-forceable for low-entropy keys.
  The registration flow generates 256-bit random keys to keep that
  surface closed; if you bring your own key, make it long.

- **Sepolia only.** Built on Zama fhEVM testnet. The encryption is
  real (production KMS, threshold MPC); the blockspace is test ETH.
