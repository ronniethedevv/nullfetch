// Bundled at build time from the repo-root deployments.json that
// scripts/deploy.ts writes after each `npm run deploy:sepolia`. This is
// why the contract-address input is pre-filled rather than asking the
// user to paste the address by hand on every page load.
//
// If you point this checkout at a contract you didn't deploy here, you
// can still override the address via the input — the bundled value is
// just the default.
import raw from '../../deployments.json';

type Deployments = {
  [network: string]: { Marketplace?: string; PrivateKeyVerifier?: string };
};

const deployments = raw as Deployments;

// Read `Marketplace` first; fall back to the legacy `PrivateKeyVerifier`
// key in case the deploy step hasn't been re-run since Phase 1's
// contract rename.
export const SEPOLIA_DEFAULT_ADDR: string =
  deployments.sepolia?.Marketplace ??
  deployments.sepolia?.PrivateKeyVerifier ??
  '';
