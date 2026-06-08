export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__title">// honest framing</div>
      <ul className="footer__list">
        <li>
          <b>Encryption happens client-side.</b> Whoever runs this browser sees
          the plaintext key first. fhEVM hides it from the contract, the
          chain, and every other party — not from the encrypting client
          itself.
        </li>
        <li>
          <b>Public on-chain metadata.</b> Service names, descriptions,
          endpoints, and the wallet-to-service linkage are public. Only the
          API key contents are encrypted. Use a fresh wallet for stronger
          unlinkability if your subscription itself is sensitive.
        </li>
        <li>
          <b>No rate limit on <code>verify</code>.</b> Brute-forceable for
          low-entropy keys. The registration flow generates 32-byte random
          keys to keep that surface closed; if you bring your own key, make
          it long.
        </li>
        <li>
          <b>Sepolia only.</b> Built on Zama fhEVM testnet. The encryption is
          real (production KMS, threshold MPC); the blockspace is test ETH.
        </li>
      </ul>

      <div className="footer__built">
        <span className="footer__built-label mono">// built by</span>
        <a
          className="footer__built-link mono"
          href="https://x.com/ronnie_thedev"
          target="_blank"
          rel="noopener noreferrer"
        >
          @ronnie_thedev
        </a>
        <span className="footer__built-sep mono">·</span>
        <span className="footer__built-label mono">source</span>
        <a
          className="footer__built-link mono"
          href="https://github.com/ronniethedevv/nullfetch"
          target="_blank"
          rel="noopener noreferrer"
        >
          github ↗
        </a>
      </div>
    </footer>
  );
}
