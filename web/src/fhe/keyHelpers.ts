import { keccak256, toUtf8Bytes } from 'ethers';

/**
 * Split keccak256(utf8(key)) into hi/lo 16-byte BigInts.
 *
 * Mirrors scripts/_keyHelpers.ts in the parent project exactly. Any
 * divergence here would cause every `verify` to come back false even
 * for the correct key.
 */
export function digestHalves(key: string): {
  digest: string;
  hiHex: string;
  loHex: string;
  hi: bigint;
  lo: bigint;
} {
  const digest = keccak256(toUtf8Bytes(key));
  const hex = digest.slice(2); // 64 hex chars
  const hiHex = '0x' + hex.slice(0, 32);
  const loHex = '0x' + hex.slice(32, 64);
  return {
    digest,
    hiHex,
    loHex,
    hi: BigInt(hiHex),
    lo: BigInt(loHex),
  };
}

/**
 * Normalize a human-readable customer label into the `bytes32` slot id
 * the contract uses. Mirrors `toCustomerId` in scripts/_keyHelpers.ts:
 * a 0x-prefixed 32-byte hex string is used as-is; anything else is
 * hashed with keccak256.
 */
export function toCustomerId(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('customer id is empty');
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
  return keccak256(toUtf8Bytes(trimmed));
}
