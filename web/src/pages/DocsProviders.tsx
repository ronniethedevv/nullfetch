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
export function DocsProviders() {
  return (
    <section className="page docs">
      <Link to="/docs" className="back-link mono">
        ← all docs
      </Link>

      <header className="page__head">
        <div className="page__eyebrow mono">// provider docs · integration guide</div>
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

      <section id="overview" className="docs__section">
        <h2 className="docs__h2 mono">01 · overview</h2>
        <p>
          Your API server doesn&rsquo;t store, generate, or compare API
          keys. It calls one read-only function on the NullFetch
          marketplace contract — <code>getAttestation(wallet)</code> —
          and treats the response as the auth decision.
        </p>
        <p>Three things happen on every request to a gated endpoint:</p>
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

      <section id="prerequisites" className="docs__section">
        <h2 className="docs__h2 mono">02 · prerequisites</h2>
        <div className="docs__table-wrap">
          <table className="docs__table mono">
            <thead>
              <tr><th>Need</th><th>For</th><th>Cost</th></tr>
            </thead>
            <tbody>
              <tr><td>Node 18+ &amp; npm</td><td>Runtime</td><td>0</td></tr>
              <tr><td>Express (or fastify/koa/hono)</td><td>HTTP server</td><td>0</td></tr>
              <tr><td><code>ethers@^6</code></td><td>Signature verify + contract read</td><td>0</td></tr>
              <tr><td>A Sepolia RPC URL</td><td>Reading the attestation</td><td>$0 (public default), recommended: your own Infura/Alchemy free tier</td></tr>
              <tr><td>A long-lived host</td><td>Express + in-memory nonce store</td><td>$0 (Render free tier works)</td></tr>
              <tr><td>A listed service on NullFetch</td><td>Knowing your <code>serviceId</code></td><td>0.0003 Sepolia ETH listing fee</td></tr>
            </tbody>
          </table>
        </div>
        <p className="docs__note mono">
          // No wallet, no private key, no signing. The server only reads
          the chain — it never writes.
        </p>
      </section>

      <section id="quickstart" className="docs__section">
        <h2 className="docs__h2 mono">03 · quick start</h2>
        <p>
          Eight lines of integration code. Replace <code>YOUR_SERVICE_ID</code>{' '}
          with the id you get after listing.
        </p>
        <pre className="docs__code mono">{`npm install @nullfetch/express-gate ethers express`}</pre>
        <pre className="docs__code mono">{`import express from 'express';
import { createGate } from '@nullfetch/express-gate';

const nf = createGate({ serviceId: YOUR_SERVICE_ID });
const app = express();

app.use(nf.cors);                              // permissive CORS
app.post('/challenge', nf.challenge);          // SIWE challenge issuer
app.get('/api/service/:id', nf.gate, (req, res) => {
  // req.nullfetch.wallet is the authenticated caller
  res.json({ data: 'your protected payload here' });
});

app.listen(process.env.PORT || 3000);`}</pre>
        <p>
          That&rsquo;s the entire integration. The package handles
          challenge nonces, signature recovery, attestation reads,
          freshness checks, service id matching, and error responses.
        </p>
      </section>

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
          integer like <code>3</code>. Save it.
        </p>

        <h3 className="docs__h3">2. Install the SDK</h3>
        <pre className="docs__code mono">{`cd your-api/
npm install @nullfetch/express-gate ethers`}</pre>

        <h3 className="docs__h3">3. Add the gate to your server</h3>
        <pre className="docs__code mono">{`import { createGate } from '@nullfetch/express-gate';

const nf = createGate({ serviceId: 3 });

app.use(nf.cors);
app.post('/challenge', nf.challenge);

// before:
app.get('/quote', (req, res) => res.json({ quote: '...' }));

// after:
app.get('/quote', nf.gate, (req, res) => {
  res.json({ quote: '...', requestedBy: req.nullfetch.wallet });
});`}</pre>

        <h3 className="docs__h3">4. Configure environment</h3>
        <pre className="docs__code mono">{`# .env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
PORT=3000`}</pre>

        <h3 className="docs__h3">5. Deploy</h3>
        <p>
          Any Node 18+ host with HTTPS works: Render, Fly.io, Railway,
          Heroku, a VPS, your own server. The integration imposes no
          host requirements.
        </p>

        <h3 className="docs__h3">6. Test the round-trip</h3>
        <p>
          Once deployed, run through the developer flow from{' '}
          <Link to="/browse">/browse</Link> — find your service, register
          for it, run an attestation, then hit your endpoint.
        </p>
      </section>

      <section id="api" className="docs__section">
        <h2 className="docs__h2 mono">05 · api reference</h2>

        <h3 className="docs__h3">createGate(options)</h3>
        <pre className="docs__code mono">{`interface CreateGateOptions {
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
}`}</pre>

        <h3 className="docs__h3">req.nullfetch (on authenticated requests)</h3>
        <pre className="docs__code mono">{`interface NullFetchAuth {
  wallet: string;                         // EIP-55 checksummed
  serviceId: number;
  verifiedAt: number;                     // unix seconds
  expiresInSeconds: number;
}

app.get('/quote', nf.gate, (req, res) => {
  console.log('authenticated as', req.nullfetch.wallet);
  res.json({ quote: pickRandomQuote() });
});`}</pre>

        <h3 className="docs__h3">ChallengeStore (advanced)</h3>
        <pre className="docs__code mono">{`interface ChallengeStore {
  get(wallet: string): Promise<Challenge | null>;
  set(wallet: string, challenge: Challenge): Promise<void>;
  delete(wallet: string): Promise<void>;
}`}</pre>
        <p>
          Implement against Redis or any shared KV if you run multiple
          server instances. The default in-memory map is per-instance.
        </p>
      </section>

      <section id="dev" className="docs__section">
        <h2 className="docs__h2 mono">06 · local development</h2>
        <p>
          Use <code>devMode: true</code> to bypass signature + attestation
          checks. The gate accepts any wallet header and pretends every
          caller is authenticated:
        </p>
        <pre className="docs__code mono">{`const nf = createGate({
  serviceId: 3,
  devMode: process.env.NODE_ENV !== 'production',
});`}</pre>
        <p>
          A loud warning logs at startup. Tie it strictly to{' '}
          <code>NODE_ENV</code>; never enable in production.
        </p>
        <pre className="docs__code mono">{`# in dev mode, any wallet address works
curl http://localhost:3000/quote \\
  -H "X-Wallet-Address: 0x000000000000000000000000000000000000dEaD" \\
  -H "X-Auth-Nonce: anything" \\
  -H "X-Wallet-Signature: anything"`}</pre>
      </section>

      <section id="production" className="docs__section">
        <h2 className="docs__h2 mono">07 · production checklist</h2>
        <ul className="docs__check">
          <li><b>Set <code>SEPOLIA_RPC_URL</code></b> to your own Infura/Alchemy/QuickNode endpoint.</li>
          <li><b><code>devMode</code> is <code>false</code></b> and gated on <code>NODE_ENV</code>.</li>
          <li><b>HTTPS only.</b> Browsers block mixed content from the marketplace UI.</li>
          <li><b>CORS configured.</b> The default is permissive — tighten if you allowlist origins.</li>
          <li><b>Pluggable challenge store</b> if you horizontally scale (Redis adapter).</li>
          <li><b>Monitor <code>/health</code></b> — the SDK&rsquo;s soft bootstrap keeps health up under degraded RPC.</li>
          <li><b>Update your endpoint URL on-chain</b> via <Link to="/provider">/provider</Link> if you redeploy.</li>
          <li><b>Test the revocation path</b> end-to-end on a test subscription.</li>
        </ul>
      </section>

      <section id="errors" className="docs__section">
        <h2 className="docs__h2 mono">08 · error codes</h2>
        <p>
          Every gated response that isn&rsquo;t a 2xx returns JSON with{' '}
          <code>error</code> and <code>detail</code>. Surface both to
          your callers.
        </p>
        <div className="docs__table-wrap">
          <table className="docs__table mono">
            <thead><tr><th>Status</th><th>Error</th><th>Cause / fix</th></tr></thead>
            <tbody>
              <tr><td>400</td><td>missing_headers</td><td>Caller didn&rsquo;t send all three auth headers.</td></tr>
              <tr><td>400</td><td>bad_address</td><td>Wallet header isn&rsquo;t valid. Pass <code>ethers.getAddress()</code>.</td></tr>
              <tr><td>401</td><td>no_challenge</td><td>Caller skipped <code>POST /challenge</code>.</td></tr>
              <tr><td>401</td><td>nonce_mismatch</td><td>Caller&rsquo;s nonce doesn&rsquo;t match the latest.</td></tr>
              <tr><td>401</td><td>challenge_expired</td><td>2-minute TTL elapsed. Re-issue.</td></tr>
              <tr><td>401</td><td>signature_malformed</td><td>Signature isn&rsquo;t valid ECDSA.</td></tr>
              <tr><td>401</td><td>signature_mismatch</td><td>Signature recovers to a different wallet.</td></tr>
              <tr><td>401</td><td>no_fresh_attestation</td><td>Caller has no attestation or it&rsquo;s stale.</td></tr>
              <tr><td>401</td><td>attestation_invalid</td><td>Caller&rsquo;s key didn&rsquo;t match the stored ciphertext.</td></tr>
              <tr><td>401</td><td>service_mismatch</td><td>Caller&rsquo;s attestation is for a different service.</td></tr>
              <tr><td>502</td><td>gate_not_ready</td><td>Bootstrap hasn&rsquo;t completed (RPC unreachable).</td></tr>
              <tr><td>502</td><td>contract_read_failed</td><td>Transient RPC error. Retry with backoff.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="faq" className="docs__section">
        <h2 className="docs__h2 mono">09 · faq</h2>

        <h3 className="docs__h3">How long does an attestation last?</h3>
        <p>Default: 1 hour. Range: 1 min to 24h, owner-settable on the contract.</p>

        <h3 className="docs__h3">Do I pay gas per API call?</h3>
        <p>No. The provider only does free RPC reads.</p>

        <h3 className="docs__h3">What if my server scales horizontally?</h3>
        <p>
          The default in-memory store is per-instance. Implement a{' '}
          <code>ChallengeStore</code> backed by Redis or similar.
        </p>

        <h3 className="docs__h3">Can I check arbitrary conditions in the gate?</h3>
        <p>
          Yes — after <code>nf.gate</code> succeeds you have{' '}
          <code>req.nullfetch.wallet</code> and can add rate-limiting,
          tier checks, billing logic, etc.
        </p>

        <h3 className="docs__h3">Can a different service&rsquo;s attestation pass my gate?</h3>
        <p>No. The gate enforces <code>serviceId</code> match before passing.</p>

        <h3 className="docs__h3">Is this fhEVM mainnet-ready?</h3>
        <p>
          Sepolia only today. Mainnet rollout depends on Zama. Cost model
          changes — bump the TTL to 24h on mainnet to amortize refresh
          gas across more calls.
        </p>

        <h3 className="docs__h3">Does NullFetch see my responses?</h3>
        <p>
          No. The contract is involved only in the auth decision. Your
          payload flows directly from your server to the caller.
        </p>

        <h3 className="docs__h3">What kinds of APIs fit this auth model?</h3>
        <p>
          Stateless REST APIs. For streaming / WebSocket / inbound
          webhooks, adapt the pattern (auth once, issue a session
          token). Anonymous APIs don&rsquo;t fit — wallet identity is
          mandatory.
        </p>
      </section>

      <section id="help" className="docs__section">
        <h2 className="docs__h2 mono">10 · need help</h2>
        <ul className="docs__list">
          <li>
            <b>Source &amp; issues:</b>{' '}
            <a href="https://github.com/ronniethedevv/nullfetch" target="_blank" rel="noopener noreferrer">
              github.com/ronniethedevv/nullfetch
            </a>
          </li>
          <li>
            <b>Marketplace contract on Sepolia:</b>{' '}
            <a
              href="https://sepolia.etherscan.io/address/0x77CD4B9b78946A20407fa1C1C8B3298401D93875#code"
              target="_blank" rel="noopener noreferrer"
            >
              0x77CD…3875 ↗
            </a>
          </li>
          <li>
            <b>Reference integrations:</b>
            <ul>
              <li>
                <a href="https://github.com/ronniethedevv/quote-api" target="_blank" rel="noopener noreferrer">
                  quote-api
                </a>{' '}
                — third-party provider
              </li>
              <li>
                <a href="https://github.com/ronniethedevv/quote-fetcher" target="_blank" rel="noopener noreferrer">
                  quote-fetcher
                </a>{' '}
                — consumer CLI + frontend
              </li>
            </ul>
          </li>
          <li>
            <b>Maintainer:</b>{' '}
            <a href="https://x.com/ronnie_thedev" target="_blank" rel="noopener noreferrer">
              @ronnie_thedev
            </a>
          </li>
        </ul>
      </section>
    </section>
  );
}
