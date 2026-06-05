/**
 * Minimal ABI fragment — only the read methods this package actually
 * calls. Keeping the surface small means downstream upgrades to the
 * marketplace contract are less likely to break this package's typing.
 */
export const MARKETPLACE_READ_ABI = [
  'function getAttestation(address) view returns (bool valid, uint64 verifiedAt, bool fresh, uint256 serviceId)',
  'function attestationTtl() view returns (uint256)',
] as const;
