# Migration prompt — Quote API → @nullfetch/express-gate

Paste the block below into the Quote API session to migrate from the
hand-written 156-line auth layer to the SDK.

---

> NullFetch just shipped `@nullfetch/express-gate` — an Express
> middleware package that replaces the entire hand-written auth layer
> with two lines of config. I want to migrate this server to use it.
> The integration spec, audit verdict, and friction inventory you
> wrote informed the package design directly.
>
> ### What to do
>
> 1. **Install the package.** Until it's published to the public npm
>    registry, install from the path / git ref:
>
>    ```sh
>    npm install github:ronniethedevv/nullfetch#path:/packages/nullfetch-express-gate
>    ```
>
>    If that doesn't resolve cleanly, fall back to:
>
>    ```sh
>    npm install file:/absolute/path/to/packages/nullfetch-express-gate
>    ```
>
> 2. **Strip the hand-written auth code** from `server.js`. Specifically remove:
>    - The `MARKETPLACE_ABI` constant
>    - The `provider`, `contract`, `marketAddr`, `myServiceId`, `attestationTtl` globals
>    - The `bootstrap()` function and its `bootstrap().then(() => app.listen(port))` invocation
>    - The `challenges` Map and the `setInterval` sweep
>    - `buildChallengeMessage()`
>    - The `/challenge` route handler
>    - The `nullfetchGate` middleware function
>    - The CORS scaffold (the SDK provides its own)
>
> 3. **Replace with the SDK.** The wiring becomes:
>
>    ```js
>    import express from 'express';
>    import { createGate } from '@nullfetch/express-gate';
>    import { quotes } from './quotes.js';
>
>    const nf = createGate({
>      serviceId: Number(process.env.SERVICE_ID),
>      rpcUrl: process.env.SEPOLIA_RPC_URL,  // SDK now prefers this name
>      appName: 'Quote of the moment',
>      devMode: process.env.NULLFETCH_DEV_MODE === 'true',
>    });
>
>    const app = express();
>    app.use(nf.cors);
>
>    app.get('/health', (_req, res) => {
>      res.json({ ok: true, service: 'quote-api', ttl: nf.getAttestationTtl() });
>    });
>
>    app.post('/challenge', nf.challenge);
>
>    app.get('/api/service/:id', nf.gate, (req, res) => {
>      const q = quotes[Math.floor(Math.random() * quotes.length)];
>      res.json({
>        authenticated: true,
>        wallet: req.nullfetch.wallet,
>        service: { id: req.params.id, name: 'Quote of the moment' },
>        response: { type: 'quote', body: q.text, author: q.author },
>      });
>    });
>
>    app.listen(Number(process.env.PORT) || 3000);
>    ```
>
> 4. **Update `.env.example`.** Rename `INFURA_API_KEY=...` to
>    `SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/...` (or whichever
>    provider). The SDK is vendor-neutral — no more `/v3/undefined`
>    surprise from forgetting to set it.
>
> 5. **Update Render env vars.** Same rename — add `SEPOLIA_RPC_URL`
>    with the full URL, keep `MARKETPLACE_ADDRESS` and `SERVICE_ID`.
>    The `INFURA_API_KEY` var can be deleted; the SDK doesn't read it.
>
> 6. **Verify behavior is identical** by curling the deployed server:
>
>    ```sh
>    # /challenge still works
>    curl -X POST 'https://quote-api-d9wc.onrender.com/challenge?wallet=0xYourWallet'
>
>    # /api/service/3 still returns the quote after attestation + signing
>    curl 'https://quote-api-d9wc.onrender.com/api/service/3' \
>      -H 'X-Wallet-Address: 0x...' \
>      -H 'X-Auth-Nonce: 0x...' \
>      -H 'X-Wallet-Signature: 0x...'
>    ```
>
>    The error codes are identical (`no_challenge`, `signature_mismatch`,
>    `no_fresh_attestation`, `service_mismatch`, etc.) so any existing
>    client integration keeps working unchanged.
>
> ### Expected diff
>
> - `server.js` should go from ~210 lines to ~30
> - `package.json` adds `@nullfetch/express-gate`, removes nothing
> - `.env.example` rename only
>
> Report back with the new line count and the diff size so I can quote
> it in the demo video.
>
> ### Things the SDK fixes that you flagged in the audit
>
> Address each one in the migration so I can confirm them:
>
> 1. **Friction #3 (bootstrap-or-die):** Confirm the new server comes up
>    even if Sepolia is unreachable at boot. `/health` should return 200,
>    `/api/service/:id` should return `502 gate_not_ready` until the
>    bootstrap retries succeed.
> 2. **Friction #4 (`INFURA_API_KEY` baked in):** Confirm `SEPOLIA_RPC_URL`
>    is the env var the package reads. Confirm the old `INFURA_API_KEY`
>    is no longer in your `.env.example`.
> 3. **Friction #9 (no local dev story):** Confirm `NULLFETCH_DEV_MODE=true
>    npm start` brings the server up with the loud banner and that
>    `curl -H 'X-Wallet-Address: 0xdead...' http://localhost:3000/api/service/3`
>    returns 200 without any on-chain interaction.
> 4. **Friction #10 (phishing address surface):** Confirm
>    `MARKETPLACE_ADDRESS` is optional now — removing it from the env
>    should still work because the SDK has the canonical address baked in.
>
> If any of those four don't work as advertised, that's a package bug —
> tell me and I'll fix the SDK.

---

## Once the migration is done

After the Quote API session reports back successfully:

1. Get the new line count of `server.js` (should be ~30 lines).
2. Get a copy of the diff (or at least the size).
3. Use both in the demo video — "the integration was 156 lines, the SDK shipped, the new code is 30 lines. Same behavior, same gates, same errors."
