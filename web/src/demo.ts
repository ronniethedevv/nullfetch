/**
 * Helpers for the UI-only "Generate Demo Key" affordance.
 *
 * Everything here runs synchronously in the browser. No network, no
 * worker, no external dependency, no storage. The generated key never
 * leaves the page in plaintext — it enters the same client-side
 * encryption path as any typed key.
 */

/**
 * 32 cryptographically-random bytes from the browser's CSPRNG
 * (Web Crypto), encoded as a 0x-prefixed lowercase hex string of
 * length 66.
 */
export function generateDemoKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let out = '0x';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Flip one random character of a key string to a *different* random hex
 * char, leaving any leading `0x` prefix intact. Used by the developer
 * panel's mismatch demo so the user doesn't have to retype.
 */
export function tweakOneChar(key: string): string {
  if (!key) return key;
  const prefixLen = key.startsWith('0x') ? 2 : 0;
  const bodyLen = key.length - prefixLen;
  if (bodyLen <= 0) return key;
  const idx = prefixLen + Math.floor(Math.random() * bodyLen);
  const cur = key[idx].toLowerCase();
  const hex = '0123456789abcdef';
  let next: string;
  do {
    next = hex[Math.floor(Math.random() * 16)];
  } while (next === cur);
  return key.slice(0, idx) + next + key.slice(idx + 1);
}
