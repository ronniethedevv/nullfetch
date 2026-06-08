import { Link } from 'react-router-dom';

/**
 * Provider integration docs. Long-form scannable single-page reference
 * that teaches an API author how to add NullFetch auth to an existing
 * Express server in under an hour.
 *
 * Order is intentional: prerequisites → quick start → deeper API surface
 * → production checklist → FAQ. A reader scanning for the 8-line code
 * sample finds it near the top; a reader debugging in production finds
 * the error table and the troubleshooting list near the bottom.
 */
export function Docs() {
  return (
    <section className="page docs">
      <header className="page__head">
        <div className="page__eyebrow mono">// provider docs</div>
        <h1 className="page__title">Integrate NullFetch in your API</h1>
        <p className="page__desc">
          Add wallet-gated authentication to an existing Node/Express API
          server in about an hour. No API key database, no plaintext keys
          on disk, no custom signing logic — the server reads on-chain
          attestations from the marketplace contract and gates responses
          on a single boolean flag.
        </p>
      </header>

      {/* ── table of contents ──────────────────────────────────── */}
      <nav className="docs__toc mono" aria-label="On this page">
        <div className="docs__toc-label">// on this page</div>
        <ul>
          <li><a href="#overview">01 · overview</a></li>
          <li><a href="#prerequisites">02 · prerequisites</a></li>
          <li><a href="#quickstart">03 · quick start</a></li>
          <li><a href="#walkthrough">04 · step-by-step</a></li>
          <li><a href="#api">05 · api reference</a></li>
          <li><a href="#dev">06 · local development</a></li>
          <li><a href="#production">07 · production checklist</a></li>
          <li><a href="#errors">08 · error codes</a></li>
          <li><a href="#faq">09 · faq</a></li>
          <li><a href="#help">10 · need help</a></li>
        </ul>
      </nav>

      {/* ── 01 overview ────────────────────────────────────────── */}
      <section id="overview" className="docs__section">
        <h2 className="docs__h2 mono">01 · overview</h2>
        <p>
          Your API server doesn&rsquo;t store, generate, or compare API
          keys. It calls one read-only function on the NullFetch
          marketplace contract — <code>getAttestation(wallet)</code> —
          and treats the response as the auth decision.
        </p>
        <p>
          Three things happen on every request to a gated endpoint:
        </p>
        <ol className="docs__list">
          <li>
            <b>SIWE check.</b> The caller signs a short-lived challenge
            you issued. You verify the signature recovers to the wallet
            they claim.
          </li>
          <li>
            <b>On-chain attestation read.</b> You call{' '}
            <code>getAttestation(wallet)</code>. The contract returns{' '}
            <code>(valid, verifiedAt, fresh, serviceId)</code>.
          </li>
          <li>
            <b>Decision.</b> Allow if <code>fresh && valid && serviceId == YOUR_SERVICE_ID</code>.
            Otherwise return 401.
          </li>
        </ol>
        <p>
          That&rsquo;s the entire protocol. No key storage. No key
          comparison. No KMS calls. Just one RPC read per request, which
          is free on most Sepolia providers.
        </p>
      </section>

      {/* ── 02 prerequisites ───────────────────────────────────── */}
      <section id="prerequisites" className="docs__section">
        <h2 className="docs__h2 mono">02 · prerequisites</h2>
        <div className="docs__table-wrap">
          <table className="docs__table mono">
            <thead>
              <tr>
                <th>Need</th>
                <th>For</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Node 18+ &amp; npm</td>
                <td>Runtime</td>
                <td>0</td>
              </tr>
              <tr>
                <td>Express (or fastify/koa/hono)</td>
                <td>HTTP server</td>
                <td>0</td>
              </tr>
              <tr>
                <td><code>ethers@^6</code></td>
                <td>Signature verify + contract read</td>
                <td>0</td>
              </tr>
              <tr>
                <td>A Sepolia RPC URL</td>
                <td>Reading the attestation</td>
                <td>$0 (public default), recommended: your own Infura/Alchemy free tier</td>
              </tr>
              <tr>
                <td>A long-lived host</td>
                <td>Express + in-memory nonce store</td>
                <td>$0 (Render free tier works)</td>
              </tr>
              <tr>
                <td>A listed service on NullFetch</td>
                <td>Knowing your <code>serviceId</code></td>
                <td>0.0003 Sepolia ETH listing fee</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="docs__note mono">
          // No wallet, no private key, no signing. The server only reads
          the chain — it never writes.
        </p>
      </section>

      {/* ── 03 quick start ─────────────────────────────────────── */}
      <section id="quickstart" className="docs__section">
        <h2 className="docs__h2 mono">03 · quick start</h2>
        <p>
          Eight lines of integration code. Replace <code>YOUR_SERVICE_ID</code>{' '}
          with the id you get after listing.
        </p>
        <pre className="docs__code mono">
{`npm install @nullfetch/express-gate ethers express`}
        </pre>
        <pre className="docs__code mono">
{`import express from 'express';
import { createGate } from '@nullfetch/express-gate';

const nf = createGate({ serviceId: YOUR_SERVICE_ID });
const app = express();

app.use(nf.cors);                              // permissive CORS
app.post('/challenge', nf.challenge);          // SIWE challenge issuer
app.get('/api/service/:id', nf.gate, (req, res) => {
  // req.nullfetch.wallet is the authenticated caller
  res.json({ data: 'your protected payload here' });
});

app.listen(process.env.PORT || 3000);`}
        </pre>
        <p>
          That&rsquo;s the entire integration. The package handles
          challenge nonces, signature recovery, attestation reads,
          freshness checks, service id matching, and error responses.
        </p>
      </section>

      {/* ── 04 step-by-step ────────────────────────────────────── */}
      <section id="walkthrough" className="docs__section">
        <h2 className="docs__h2 mono">04 · step-by-step</h2>

        <h3 className="docs__h3">1. List your service</h3>
        <p>
          Open <Link to="/provider/new">/provider/new</Link>, connect
          your wallet, fill in name + description + endpoint URL +
          category. Pay the listing fee (0.0003 Sepolia ETH).
        </p>
        <p>
          The success page shows your <code>serviceId</code> — a small
          integer like <code>3</code>. Save it. You&rsquo;ll bake it into
          your server config.
        </p>

        <h3 className="docs__h3">2. Install the SDK</h3>
        <pre className="docs__code mono">
{`cd your-api/
npm install @nullfetch/express-gate ethers`}
        </pre>

        <h3 className="docs__h3">3. Add the gate to your server</h3>
        <p>
          Mount the challenge endpoint and wrap your existing routes:
        </p>
        <pre className="docs__code mono">
{`import { createGate } from '@nullfetch/express-gate';

const nf = createGate({ serviceId: 3 });

app.use(nf.cors);
app.post('/challenge', nf.challenge);

// before:
app.get('/quote', (req, res) => res.json({ quote: '...' }));

// after:
app.get('/quote', nf.gate, (req, res) => {
  res.json({ quote: '...', requestedBy: req.nullfetch.wallet });
});`}
        </pre>

        <h3 className="docs__h3">4. Configure environment</h3>
        <p>
          The defaults work for development. For production, set at
          least one env var so you&rsquo;re not relying on the public
          RPC fallback:
        </p>
        <pre className="docs__code mono">
{`# .env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
# Optional:
PORT=3000`}
        </pre>
        <p>
          The marketplace address is baked in as a default — no env var
          needed for it, but you can override with{' '}
          <code>MARKETPLACE_ADDRESS</code> if you point at a different
          deployment.
        </p>

        <h3 className="docs__h3">5. Deploy</h3>
        <p>
          Any Node 18+ host with HTTPS works: Render, Fly.io, Railway,
          Heroku, a VPS, your own server. The integration imposes no
          host requirements.
        </p>
        <p>
          The free tier of Render is enough for most use cases. Heads
          up: free-tier servers sleep after 15 minutes of inactivity;
          first request after sleep takes ~30s to warm up.
        </p>

        <h3 className="docs__h3">6. Test the round-trip</h3>
        <p>
          Once deployed, run through the developer flow from{' '}
          <Link to="/browse">/browse</Link> — find your service, register
          for it, run an attestation, then hit your endpoint. You should
          get an authenticated response. Tamper with anything in the
          chain and you should get a clean 401.
        </p>
      </section>

      {/* ── 05 api reference ───────────────────────────────────── */}
      <section id="api" className="docs__section">
        <h2 className="docs__h2 mono">05 · api reference</h2>

        <h3 className="docs__h3">createGate(options)</h3>
        <pre className="docs__code mono">
{`interface CreateGateOptions {
  /** Required. The serviceId you got after listing. */
  serviceId: number | bigint;

  /** Optional. Sepolia RPC URL. Defaults to env SEPOLIA_RPC_URL,
   *  falls back to a public RPC if neither is set. */
  rpcUrl?: string;

  /** Optional. Marketplace contract address. Baked-in default points
   *  at the canonical NullFetch deployment. */
  marketplaceAddress?: string;

  /** Optional. Skips signature + attestation checks for local dev.
   *  Logs a loud warning at startup. Never enable in production. */
  devMode?: boolean;

  /** Optional. Plug in a Redis-backed store for horizontal scaling.
   *  Defaults to a single-instance in-memory Map. */
  store?: ChallengeStore;

  /** Optional. Override the challenge TTL (default: 2 minutes). */
  challengeTtlMs?: number;
}

interface CreatedGate {
  challenge: RequestHandler;  // mount at POST /challenge
  gate: RequestHandler;       // wrap any route you want gated
  cors: RequestHandler;       // permissive CORS middleware
  ready: () => Promise<void>; // resolves once bootstrap completes
}`}
        </pre>

        <h3 className="docs__h3">req.nullfetch (on authenticated requests)</h3>
        <pre className="docs__code mono">
{`interface NullFetchAuth {
  wallet: string;                     // EIP-55 checksummed
  serviceId: number;                  // your service id
  verifiedAt: number;                 // unix seconds
  expiresInSeconds: number;           // until attestation goes stale
}

// In your handler:
app.get('/quote', nf.gate, (req, res) => {
  console.log('authenticated as', req.nullfetch.wallet);
  res.json({ quote: pickRandomQuote() });
});`}
        </pre>

        <h3 className="docs__h3">ChallengeStore (advanced)</h3>
        <pre className="docs__code mono">
{`interface ChallengeStore {
  get(wallet: string): Promise<Challenge | null>;
  set(wallet: string, challenge: Challenge): Promise<void>;
  delete(wallet: string): Promise<void>;
}

interface Challenge {
  nonce: string;
  expiresAt: number;
  message: string;
}`}
        </pre>
        <p>
          Implement this interface against Redis, DynamoDB, or any other
          shared store if you run multiple server instances behind a
          load balancer. The default in-memory map only works for
          single-instance deployments.
        </p>
      </section>

      {/* ── 06 local dev ───────────────────────────────────────── */}
      <section id="dev" className="docs__section">
        <h2 className="docs__h2 mono">06 · local development</h2>
        <p>
          The gate&rsquo;s default behavior requires a real on-chain
          attestation — which means to test locally, you&rsquo;d need to
          register on the marketplace, pay fees, and run a real
          attestation flow. For iteration, that&rsquo;s painful.
        </p>
        <p>
          Use <code>devMode: true</code> to bypass signature + attestation
          checks. The gate accepts any <code>X-Wallet-Address</code> header
          and pretends every caller is authenticated:
        </p>
        <pre className="docs__code mono">
{`const nf = createGate({
  serviceId: 3,
  devMode: process.env.NODE_ENV !== 'production',
});`}
        </pre>
        <p>
          A loud warning logs at startup so you can&rsquo;t accidentally
          ship to production with dev mode on. Recommended: tie it
          strictly to <code>NODE_ENV</code> and double-check the env var
          on your hosting platform before promoting.
        </p>
        <p>
          For curl-driven testing:
        </p>
        <pre className="docs__code mono">
{`# in dev mode, any wallet address works
curl http://localhost:3000/quote \\
  -H "X-Wallet-Address: 0x000000000000000000000000000000000000dEaD" \\
  -H "X-Auth-Nonce: anything" \\
  -H "X-Wallet-Signature: anything"`}
        </pre>
      </section>

      {/* ── 07 production ──────────────────────────────────────── */}
      <section id="production" className="docs__section">
        <h2 className="docs__h2 mono">07 · production checklist</h2>
        <ul className="docs__check">
          <li>
            <b>Set <code>SEPOLIA_RPC_URL</code></b> to your own Infura,
            Alchemy, or QuickNode endpoint. The public RPC fallback
            works for hackathons but rate-limits at scale.
          </li>
          <li>
            <b><code>devMode</code> is <code>false</code></b> and gated
            on <code>NODE_ENV</code>, not a manual flag.
          </li>
          <li>
            <b>HTTPS only.</b> The web app calling you is HTTPS;
            browsers block mixed content. Most hosts give you HTTPS by
            default.
          </li>
          <li>
            <b>CORS configured.</b> The default <code>nf.cors</code>{' '}
            middleware is permissive — fine for public APIs, tighten if
            you have an allowlist of origins.
          </li>
          <li>
            <b>Pluggable challenge store</b> if you horizontally scale.
            The in-memory default sends 50% of requests to{' '}
            <code>no_challenge</code> on a two-instance deploy.
          </li>
          <li>
            <b>Monitor <code>/health</code></b> — the SDK&rsquo;s soft
            bootstrap keeps health up even when the RPC is degraded, so
            alerts on the gated routes are the right signal.
          </li>
          <li>
            <b>Update your endpoint URL on-chain</b> if you redeploy to
            a different host. Open{' '}
            <Link to="/provider">/provider</Link> → your service → edit
            endpoint.
          </li>
          <li>
            <b>Test the revocation path.</b> Run a self-revoke on a test
            subscription and verify your gate starts returning 401 (the
            current attestation stays valid until TTL expires, then
            re-attest attempts revert).
          </li>
        </ul>
      </section>

      {/* ── 08 error codes ─────────────────────────────────────── */}
      <section id="errors" className="docs__section">
        <h2 className="docs__h2 mono">08 · error codes</h2>
        <p>
          Every gated response that isn&rsquo;t a 2xx returns JSON with
          an <code>error</code> code and a <code>detail</code> string.
          Surface both to your callers — they map to specific
          remediation paths.
        </p>
        <div className="docs__table-wrap">
          <table className="docs__table mono">
            <thead>
              <tr>
                <th>Status</th>
                <th>Error</th>
                <th>Cause / fix</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>400</td>
                <td>missing_headers</td>
                <td>Caller didn&rsquo;t send all three auth headers. Tell them which to add.</td>
              </tr>
              <tr>
                <td>400</td>
                <td>bad_address</td>
                <td>Wallet header isn&rsquo;t a valid Ethereum address. Pass <code>ethers.getAddress()</code>.</td>
              </tr>
              <tr>
                <td>401</td>
                <td>no_challenge</td>
                <td>Caller skipped <code>POST /challenge</code>. They need to fetch one first.</td>
              </tr>
              <tr>
                <td>401</td>
                <td>nonce_mismatch</td>
                <td>Caller&rsquo;s nonce doesn&rsquo;t match the latest issued for this wallet. Re-issue.</td>
              </tr>
              <tr>
                <td>401</td>
                <td>challenge_expired</td>
                <td>2-minute TTL elapsed. Re-issue a challenge.</td>
              </tr>
              <tr>
                <td>401</td>
                <td>signature_malformed</td>
                <td>Signature isn&rsquo;t valid ECDSA. Probably mangled in transit.</td>
              </tr>
              <tr>
                <td>401</td>
                <td>signature_mismatch</td>
                <td>Signature recovers to a different wallet. Caller is signing on a different account.</td>
              </tr>
              <tr>
                <td>401</td>
                <td>no_fresh_attestation</td>
                <td>Caller has no on-chain attestation, or it&rsquo;s stale. They need to run <code>verifyAndAttest</code>.</td>
              </tr>
              <tr>
                <td>401</td>
                <td>attestation_invalid</td>
                <td>Caller attested but their key didn&rsquo;t match the ciphertext on file. Wrong key.</td>
              </tr>
              <tr>
                <td>401</td>
                <td>service_mismatch</td>
                <td>Caller&rsquo;s most recent attestation is for a different service. They need to attest against yours.</td>
              </tr>
              <tr>
                <td>502</td>
                <td>gate_not_ready</td>
                <td>Bootstrap hasn&rsquo;t completed (RPC unreachable). Auto-recovers once RPC comes back.</td>
              </tr>
              <tr>
                <td>502</td>
                <td>contract_read_failed</td>
                <td>Transient RPC error reading <code>getAttestation</code>. Retry with backoff.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 09 faq ─────────────────────────────────────────────── */}
      <section id="faq" className="docs__section">
        <h2 className="docs__h2 mono">09 · faq</h2>

        <h3 className="docs__h3">How long does an attestation last?</h3>
        <p>
          Default: 1 hour. Range: 1 minute to 24 hours, owner-settable on
          the marketplace contract. Inside the window, the developer can
          call your API as many times as they want with a free wallet
          signature per call (no gas). Once expired, they refresh with
          two transactions.
        </p>

        <h3 className="docs__h3">Do I pay gas per API call?</h3>
        <p>
          No. The provider only does free RPC reads. The developer pays
          gas for registration (once) and attestation refresh (once per
          TTL). API calls themselves are free signatures.
        </p>

        <h3 className="docs__h3">What if my server scales horizontally?</h3>
        <p>
          The default in-memory challenge store is per-instance. With
          multiple instances, 50% of requests will 401 with{' '}
          <code>no_challenge</code> because the nonce was issued on a
          different instance. Implement a <code>ChallengeStore</code>{' '}
          backed by Redis or any shared KV.
        </p>

        <h3 className="docs__h3">Can I check arbitrary conditions in the gate?</h3>
        <p>
          Yes — after <code>nf.gate</code> succeeds, you have{' '}
          <code>req.nullfetch.wallet</code> and you can do anything else
          you want before responding: rate-limit per wallet, check a
          subscription tier in your own DB, look up plan flags, etc. The
          gate proves identity; the rest of your logic is yours.
        </p>

        <h3 className="docs__h3">Can a different service&rsquo;s attestation pass my gate?</h3>
        <p>
          No. The gate matches <code>attestation.serviceId == YOUR_SERVICE_ID</code>{' '}
          before passing. A developer attested for service #5 cannot
          access service #3.
        </p>

        <h3 className="docs__h3">Is this fhEVM mainnet-ready?</h3>
        <p>
          Sepolia only today. Zama&rsquo;s mainnet rollout determines
          when this scales. The cost model changes meaningfully on
          mainnet — attestation refresh costs real ETH — so for
          high-frequency consumer APIs you&rsquo;ll want to bump the TTL
          to 24h to amortize.
        </p>

        <h3 className="docs__h3">Does NullFetch see my responses?</h3>
        <p>
          No. The marketplace contract is involved only in the auth
          decision (one read per request). Your actual API payload
          flows directly from your server to the developer&rsquo;s
          machine. Nothing about your content touches the chain or any
          NullFetch infrastructure.
        </p>

        <h3 className="docs__h3">What kinds of APIs fit this auth model?</h3>
        <p>
          Stateless REST APIs where one HTTP call equals one unit of
          access — quotes, weather, AI inference, prices, lookups,
          image generation. For streaming / WebSocket / webhook
          inbound, you&rsquo;ll need to adapt the pattern (auth once,
          issue a session token, gate the long-lived thing on the
          token). Anonymous APIs don&rsquo;t fit — wallet identity is
          mandatory.
        </p>
      </section>

      {/* ── 10 help ────────────────────────────────────────────── */}
      <section id="help" className="docs__section">
        <h2 className="docs__h2 mono">10 · need help</h2>
        <ul className="docs__list">
          <li>
            <b>Source &amp; issues:</b>{' '}
            <a
              href="https://github.com/ronniethedevv/nullfetch"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/ronniethedevv/nullfetch
            </a>
          </li>
          <li>
            <b>Reference integrations</b> (read these for working examples):
            <ul>
              <li>
                <a
                  href="https://github.com/ronniethedevv/quote-api"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  quote-api
                </a>{' '}
                — third-party provider
              </li>
              <li>
                <a
                  href="https://github.com/ronniethedevv/quote-fetcher"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  quote-fetcher
                </a>{' '}
                — consumer CLI + frontend
              </li>
            </ul>
          </li>
          <li>
            <b>Maintainer:</b>{' '}
            <a
              href="https://x.com/ronnie_thedev"
              target="_blank"
              rel="noopener noreferrer"
            >
              @ronnie_thedev
            </a>
          </li>
        </ul>
      </section>
    </section>
  );
}
