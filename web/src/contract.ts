import { getAddress } from 'ethers';

/**
 * Normalize a user-typed contract address to its canonical EIP-55
 * checksum form. Accepts all-lowercase, all-uppercase, or correctly
 * mixed-case input; only throws if the address is structurally invalid
 * (wrong length, non-hex characters, or wrong-checksum mixed case).
 *
 * Call this once at the boundary, then use the returned string for
 * every downstream call (`new Contract`, `createEncryptedInput`,
 * `handleContractPairs`, the EIP-712 contract list, etc.). Do not
 * normalize at the input field itself — the user should still see
 * exactly what they typed.
 */
export function normalizeAddress(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Contract address is empty.');
  try {
    return getAddress(trimmed);
  } catch {
    throw new Error(
      `"${trimmed}" is not a valid Ethereum address. Check for typos ` +
        `or paste the address from your deploy output.`,
    );
  }
}
