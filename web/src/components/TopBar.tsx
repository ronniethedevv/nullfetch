import { NavLink, Link } from 'react-router-dom';
import { useWallet } from '../hooks/WalletContext';

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function TopBar() {
  const { account, chainId, chainOk, connecting, connect, switchToSepolia } = useWallet();

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Link to="/" className="topbar__brand-link">
          <span className="topbar__title">NullFetch</span>
        </Link>
        <span className="topbar__subtitle">// fhEVM · Sepolia</span>
      </div>

      <nav className="topbar__nav" aria-label="Primary">
        <NavLink to="/browse" className="navlink">
          browse
        </NavLink>
        <NavLink to="/docs" className="navlink">
          docs
        </NavLink>
        <NavLink to="/provider" className="navlink">
          provider
        </NavLink>
        <NavLink to="/developer" className="navlink">
          developer
        </NavLink>
      </nav>

      <div className="topbar__right">
        <div
          className={`netbadge ${chainOk ? 'netbadge--ok' : 'netbadge--warn'}`}
          title={chainId == null ? 'not connected' : `chainId ${chainId}`}
        >
          <span className="netbadge__dot" />
          {chainId == null
            ? 'no chain'
            : chainOk
              ? 'Sepolia'
              : `chain ${chainId} — switch`}
        </div>

        {!chainOk && chainId != null && (
          <button className="btn btn--ghost" onClick={switchToSepolia}>
            switch to Sepolia
          </button>
        )}

        {account ? (
          <div className="topbar__account mono" title={account}>
            {shortAddr(account)}
          </div>
        ) : (
          <button className="btn btn--primary" onClick={connect} disabled={connecting}>
            {connecting ? 'connecting…' : 'connect wallet'}
          </button>
        )}
      </div>
    </header>
  );
}
