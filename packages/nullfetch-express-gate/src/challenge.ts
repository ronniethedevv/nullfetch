import { randomBytes } from 'crypto';
import { ethers } from 'ethers';

/**
 * Build the canonical challenge message a wallet signs to prove control.
 *
 * The format is intentionally human-readable so a wallet popup shows
 * something a user can audit by eye — "I'm signing into NullFetch, for
 * service N, with this nonce, expiring at this time."
 *
 * Server and client MUST construct this message byte-identically, or
 * `ethers.verifyMessage` will recover a different address. If you ever
 * change this format, every existing consumer breaks. (One of the audit
 * findings — a future version should move to EIP-712 typed data so the
 * format is versioned and machine-checkable.)
 */
export function buildChallengeMessage(opts: {
  appName: string;
  wallet: string;
  nonce: string;
  expiresAt: number;
  marketplaceAddress: string;
  serviceId: bigint;
}): string {
  return [
    `Sign in to ${opts.appName} via NullFetch.`,
    '',
    'This proves you control this wallet so the API can look up your',
    'on-chain attestation. Single use, 2-minute window. No tx, no gas.',
    '',
    `wallet:    ${opts.wallet}`,
    `nonce:     ${opts.nonce}`,
    `expiresAt: ${new Date(opts.expiresAt).toISOString()}`,
    `market:    ${opts.marketplaceAddress.toLowerCase()}`,
    `service:   ${opts.serviceId.toString()}`,
  ].join('\n');
}

/** Fresh 16-byte hex nonce. */
export function generateNonce(): string {
  return '0x' + randomBytes(16).toString('hex');
}

/**
 * Defensive checksum. Throws a typed error if the address is malformed,
 * so the caller can catch and turn it into a 400.
 */
export function checksum(raw: string): string {
  return ethers.getAddress(raw);
}
