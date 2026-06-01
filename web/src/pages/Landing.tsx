import { Link } from 'react-router-dom';
import { useWallet } from '../hooks/WalletContext';
import { CATEGORIES } from '../abi';

const STEPS = [
  {
    n: '01',
    title: 'Provider lists a service',
    body: 'Name, description, endpoint, category. Pays a one-time listing fee. No keys yet — the marketplace is empty of secrets by default.',
  },
  {
    n: '02',
    title: 'Developer registers',
    body: 'Frontend generates a random API key locally. Hashes it. Encrypts the digest halves client-side. Submits only ciphertext to the contract. The plaintext key never leaves the developer.',
  },
  {
    n: '03',
    title: 'Verification under FHE',
    body: 'To authenticate, the developer re-encrypts the same key and proves equality against the stored ciphertext. The contract compares without decrypting. Result is a single encrypted boolean.',
  },
  {
    n: '04',
    title: "Provider's API gates access",
    body: 'The API reads an on-chain attestation derived from the FHE comparison. No key database. Nothing to leak. Nothing to subpoena.',
  },
];

export function Landing() {
  const { account } = useWallet();

  return (
    <div className="landing">
      {/* ── hero ───────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero__eyebrow mono">// API marketplace · powered by Zama fhEVM</div>
        <h1 className="hero__headline">
          API keys you can&rsquo;t leak,
          <br />
          because no one has them.
        </h1>
        <p className="hero__lede">
          A marketplace of APIs where the provider verifies your key without
          ever seeing it. The marketplace operator never sees it. We never see
          it. Only you do — and you generated it. <span className="hero__lede-faint">If the database leaks, the only thing on the disk is ciphertext.</span>
        </p>

        <div className="hero__ctas">
          <Link to="/provider" className="btn btn--primary btn--cta">
            {account ? 'go to provider dashboard' : 'sign up as provider'}
          </Link>
          <Link to="/developer" className="btn btn--cta">
            {account ? 'go to developer dashboard' : 'sign up as developer'}
          </Link>
          <Link to="/browse" className="hero__browse-link">
            or — browse the marketplace →
          </Link>
        </div>
      </section>

      {/* ── how it works ────────────────────────────────────── */}
      <section className="steps">
        <div className="steps__title mono">// how it works</div>
        <div className="steps__grid">
          {STEPS.map((s) => (
            <div key={s.n} className="step">
              <div className="step__n mono">{s.n}</div>
              <div className="step__title">{s.title}</div>
              <div className="step__body">{s.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── categories ──────────────────────────────────────── */}
      <section className="cats">
        <div className="cats__title mono">// categories</div>
        <div className="cats__chips">
          {CATEGORIES.map((c) => (
            <Link key={c} to={`/browse?category=${c}`} className="cat-chip">
              {c}
            </Link>
          ))}
        </div>
      </section>

      {/* ── trust strip ─────────────────────────────────────── */}
      <section className="trust">
        <div className="trust__title mono">// the privacy claim, restated</div>
        <ul className="trust__list">
          <li>
            <span className="trust__k mono">marketplace_operator</span>
            <span className="trust__sep">·</span>
            <span className="trust__v">cannot read keys — never has them</span>
          </li>
          <li>
            <span className="trust__k mono">service_provider</span>
            <span className="trust__sep">·</span>
            <span className="trust__v">cannot read keys — only verifies possession</span>
          </li>
          <li>
            <span className="trust__k mono">chain_observer</span>
            <span className="trust__sep">·</span>
            <span className="trust__v">cannot read keys — sees only ciphertext handles</span>
          </li>
          <li>
            <span className="trust__k mono">database_hacker</span>
            <span className="trust__sep">·</span>
            <span className="trust__v">cannot exfiltrate keys — there is no key database</span>
          </li>
          <li>
            <span className="trust__k mono">developer</span>
            <span className="trust__sep">·</span>
            <span className="trust__v acc">holds plaintext, locally, only</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
