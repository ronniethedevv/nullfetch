# Deploy guide

How to take this from "runs locally" to "submission-grade" with three
optional wins:

1. **Etherscan source verification** — judges click the contract
   address and read your code in the browser.
2. **Vercel for the web app** — a live URL anyone can poke at.
3. **Render or Railway for the API** — same, for the auth gate.

All three are optional. The local setup is enough for the hackathon
demo if you have the screen recording.

---

## 1 · Etherscan source verification (~5 minutes)

`scripts/deploy.ts` already calls `verify:verify` after each Sepolia
deploy, *if* you have an Etherscan API key set.

```sh
# 1. Get a free Etherscan API key: https://etherscan.io/myapikey
#    Create an account, generate a v2 key.

# 2. Add it to your root .env:
ETHERSCAN_API_KEY=YOUR_KEY_HERE

# 3. Re-deploy:
npm run deploy:sepolia
# → waits 5 confirmations, then publishes source
# → "verified on Etherscan: https://sepolia.etherscan.io/address/0x…/#code"
```

If your existing Marketplace was already deployed, you can verify it
without re-deploying:

```sh
npx hardhat verify --network sepolia <MARKETPLACE_ADDRESS>
```

After verification, the `Code` tab on the Etherscan page shows the
human-readable Solidity instead of bytecode. Anyone can click a method
in `Read Contract` and call it directly — useful for judges who want
to confirm the contract you deployed matches the source in the repo.

---

## 2 · Web app on Vercel (~10 minutes)

The web app is a static Vite build. Vercel deploys static sites for
free.

```sh
# 1. Install Vercel CLI if you don't have it:
npm i -g vercel

# 2. From the repo root, deploy the web folder:
cd web
vercel
# → answer prompts:
#   - link to your Vercel account (signs in via browser)
#   - "set up and deploy ./web?" → y
#   - "scope" → your account
#   - "link to existing project?" → n
#   - "project name" → nullfetch (or whatever)
#   - "directory" → ./ (current, since you're in web/)
#   - "override settings?" → n
# → ~1 minute, then a preview URL
```

The build picks up `deployments.json` automatically because Vite
imports it at build time. Make sure you ran `npm run deploy:sepolia`
*before* the Vercel build so the contract address is committed.

Promote to production with:

```sh
vercel --prod
```

Alternatively, push the repo to GitHub and import via the Vercel web
UI — it auto-detects Vite and builds on every push.

### Heads-up: WASM headers

The Zama relayer SDK ships native WASM. Vercel serves these correctly
out of the box, but if you see `Refused to compile WebAssembly` errors
in the browser console, add a `vercel.json` at the web/ root:

```json
{
  "headers": [
    {
      "source": "/(.*)\\.wasm",
      "headers": [
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

This isn't usually needed but is the canonical fix when it is.

---

## 3 · API on Render (~10 minutes)

Render's free tier handles the Express API fine.

```sh
# 1. Sign up at https://render.com — connect your GitHub.

# 2. New → Web Service → pick this repo.

# 3. Configure:
#    - Name:           nullfetch-api
#    - Root Directory: api
#    - Environment:    Node
#    - Build Command:  npm install && npm run build
#    - Start Command:  npm start
#    - Instance Type:  Free

# 4. Environment variables:
#    MARKETPLACE_ADDRESS = 0x… (from deployments.json)
#    INFURA_API_KEY      = your_infura_id
#    PORT                = 10000 (Render injects this, but the code defaults to 3000)

# 5. Deploy. Wait ~3 minutes. Note the public URL (e.g.
#    https://nullfetch-api.onrender.com).
```

The web app currently hardcodes the API base to `http://localhost:3000`
in the developer use page. To point at the live API:

- **Quick way:** the API base is editable in the UI (the input next
  to "sign + call" on `/developer/service/:id`). Paste the Render URL
  in directly during the demo.
- **Permanent way:** edit
  [`web/src/pages/DeveloperService.tsx`](../web/src/pages/DeveloperService.tsx)
  and change the default `useState('http://localhost:3000')` to your
  Render URL. Redeploy the web app.

### Heads-up: free-tier cold starts

Render's free tier puts the service to sleep after 15 minutes of
inactivity. The first request after a cold start takes ~30 seconds to
spin back up. For a recorded demo this is fine — make sure the API is
warm by hitting `/health` once before you start recording.

For a live demo with judges, either:

- Pay $7/month to keep the instance warm, or
- Have someone curl `/health` every 10 minutes during the judging
  window, or
- Bundle a "warm-up" link in your submission that fires `/health`.

---

## 4 · Optional: pretty URL for the contract

After the contract is verified on Etherscan, you can label your
deployment with a friendly name via Etherscan's "Add Name Tag" feature
(visible to you only, but a screen-recording with a clearly-labelled
address looks more polished).

---

## Submission checklist

Before you ship to the judges:

- [ ] Contract deployed and verified on Sepolia Etherscan
- [ ] At least 2 services listed (so the browse page isn't empty)
- [ ] At least 1 active subscription (so the developer dashboard shows
      a real card)
- [ ] Web app deployed somewhere with a public URL (Vercel)
- [ ] API server deployed somewhere with a public URL (Render)
- [ ] Web app's default API base points at the live API URL
- [ ] 90-second demo video recorded against the live deployment
- [ ] README links updated to your live URLs
- [ ] `.env.example` complete, `.env` not committed
- [ ] All tests pass: `npm test` in the repo root
- [ ] CI green: `.github/workflows/ci.yml` passing
