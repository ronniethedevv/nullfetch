/**
 * Envelope-encrypted local key store.
 *
 * The plaintext API key is never persisted in localStorage as-is. Each
 * record is wrapped with an AES-GCM envelope:
 *
 *   - DEK (data-encryption key): fresh 256-bit random per record,
 *     never written to disk in raw form.
 *   - KEK (key-encryption key): derived from the wallet's signature over
 *     a scope-bound message via SHA-256. Same wallet + same marketplace
 *     + same chain re-derives the same KEK. Different wallet = different
 *     KEK = can't decrypt your records.
 *   - Storage record: { wrapped DEK (under KEK), ciphertext (under DEK),
 *     two fresh IVs, the scope used to derive the KEK }. All base64.
 *
 * On a passive disk dump or an extension reading localStorage, all an
 * attacker gets is ciphertext + a scope hint. They cannot decrypt
 * without first forging a wallet signature, which requires the wallet's
 * private key.
 *
 * The imported KEK CryptoKey is cached in memory for the session so the
 * developer signs once per session, not once per key. `resetCache()` is
 * called from useWallet on accountsChanged / chainChanged so a wallet
 * swap can't ride the previous wallet's KEK.
 */

import { ethers, type Signer } from 'ethers';

// ── record format ─────────────────────────────────────────────────
const RECORD_PREFIX = 'nf:key:env:v1:'; // versioned for future migrations
const LEGACY_PREFIX = 'pkm:key:';       // pre-Phase-7 plaintext format
const SCOPE_PURPOSE = 'nf-keyStore-v1';

interface EnvelopeRecord {
  v: 1;
  scope: {
    market: string;
    account: string;
    chainId: number;
    origin: string;
    purpose: typeof SCOPE_PURPOSE;
  };
  iv: string;     // base64 — IV for the payload AES-GCM
  wIv: string;    // base64 — IV used to wrap the DEK
  wDek: string;   // base64 — DEK wrapped under the KEK
  ct: string;     // base64 — ciphertext of the plaintext key
}

// ── storage keys ──────────────────────────────────────────────────
function recordKey(market: string, account: string, serviceId: bigint): string {
  return RECORD_PREFIX + [market.toLowerCase(), account.toLowerCase(), serviceId.toString()].join(':');
}

function legacyKey(market: string, account: string, serviceId: bigint): string {
  return LEGACY_PREFIX + [market.toLowerCase(), account.toLowerCase(), serviceId.toString()].join(':');
}

// ── helpers ───────────────────────────────────────────────────────
function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  // Allocate on an explicit ArrayBuffer (not ArrayBufferLike) so the
  // result satisfies Web Crypto's BufferSource constraint under TS 5's
  // stricter typed-array variance.
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/// Copy any Uint8Array into a fresh ArrayBuffer-backed view. Same
/// reason as fromB64 — ethers.getBytes returns Uint8Array<ArrayBufferLike>
/// which Web Crypto rejects under TS 5 strictness.
function asArrayBufferView(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(src.length);
  const out = new Uint8Array(buf);
  out.set(src);
  return out;
}

function zero(buf: Uint8Array): void {
  buf.fill(0);
}

// ── scope message ─────────────────────────────────────────────────
// Bound to: marketplace, wallet, chain, origin, purpose. Same wallet
// across multiple service ids on the same marketplace shares a KEK,
// which is the right trade-off — one signature per session per
// wallet is a tolerable UX cost, one per service id is not.
function buildScopeMessage(market: string, account: string, chainId: number): string {
  return [
    'NullFetch — unlock local key storage',
    '',
    'This signature derives a key that encrypts your API key in this',
    'browser. No transaction, no gas, no chain interaction. You will be',
    'asked once per session per wallet.',
    '',
    `market:    ${market.toLowerCase()}`,
    `account:   ${account.toLowerCase()}`,
    `chain_id:  ${chainId}`,
    `origin:    ${typeof window !== 'undefined' ? window.location.origin : '<no-origin>'}`,
    `purpose:   ${SCOPE_PURPOSE}`,
  ].join('\n');
}

// ── in-memory KEK cache ───────────────────────────────────────────
// Keyed by (market, account). Cleared on wallet/chain change.
const kekCache = new Map<string, CryptoKey>();

function cacheKey(market: string, account: string): string {
  return market.toLowerCase() + ':' + account.toLowerCase();
}

/** Clears the session KEK cache. Called by useWallet on wallet/chain change. */
export function resetCache(): void {
  kekCache.clear();
}

async function getKek(market: string, account: string, signer: Signer): Promise<CryptoKey> {
  const ck = cacheKey(market, account);
  const cached = kekCache.get(ck);
  if (cached) return cached;

  const network = await signer.provider!.getNetwork();
  const chainId = Number(network.chainId);
  const message = buildScopeMessage(market, account, chainId);

  // personal_sign — no tx, no gas.
  const sigHex = await signer.signMessage(message);
  const sigBytes = asArrayBufferView(ethers.getBytes(sigHex));

  // KEK = SHA-256(signature bytes). Same scope → same signature →
  // same KEK, deterministically.
  const kekRaw = new Uint8Array(await crypto.subtle.digest('SHA-256', sigBytes));
  zero(sigBytes); // best-effort scrub of the signature bytes

  const kek = await crypto.subtle.importKey(
    'raw',
    kekRaw,
    { name: 'AES-GCM' },
    false,                 // not extractable
    ['encrypt', 'decrypt'],
  );
  zero(kekRaw); // scrub the raw bytes; the CryptoKey is the only handle now

  kekCache.set(ck, kek);
  return kek;
}

// ── public API ────────────────────────────────────────────────────

/**
 * Returns true iff a ciphertext record exists for this slot. Read-only;
 * does not prompt for a signature or attempt decryption. Use this on
 * page mount to decide whether to show an "unlock saved key" button.
 */
export function hasStoredKey(
  market: string,
  account: string,
  serviceId: bigint,
): boolean {
  try {
    const newFmt = localStorage.getItem(recordKey(market, account, serviceId));
    if (newFmt != null) return true;
    const legacy = localStorage.getItem(legacyKey(market, account, serviceId));
    return legacy != null;
  } catch {
    return false;
  }
}

/**
 * Encrypt the plaintext key and persist it. Prompts for a wallet
 * signature on first call per session (cached after); silent for the
 * rest of the session.
 */
export async function saveKey(
  market: string,
  account: string,
  serviceId: bigint,
  plaintext: string,
  signer: Signer,
): Promise<void> {
  const kek = await getKek(market, account, signer);

  // Fresh DEK + IVs per record. IV reuse is catastrophic for AES-GCM,
  // so we never derive these.
  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const wIv = crypto.getRandomValues(new Uint8Array(12));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Wrap the DEK under the KEK.
  const wDek = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wIv }, kek, dekRaw),
  );

  // Encrypt the plaintext key under the DEK.
  const dek = await crypto.subtle.importKey(
    'raw',
    dekRaw,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  zero(dekRaw); // CryptoKey holds the material now; scrub the buffer

  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      dek,
      new TextEncoder().encode(plaintext),
    ),
  );

  const network = await signer.provider!.getNetwork();
  const chainId = Number(network.chainId);

  const record: EnvelopeRecord = {
    v: 1,
    scope: {
      market: market.toLowerCase(),
      account: account.toLowerCase(),
      chainId,
      origin: typeof window !== 'undefined' ? window.location.origin : '<no-origin>',
      purpose: SCOPE_PURPOSE,
    },
    iv: b64(iv),
    wIv: b64(wIv),
    wDek: b64(wDek),
    ct: b64(ct),
  };

  try {
    localStorage.setItem(recordKey(market, account, serviceId), JSON.stringify(record));
  } catch (e) {
    console.warn('keyStore: localStorage write failed', e);
  }

  // If there's a legacy plaintext record for this slot, drop it now —
  // we've successfully replaced it with the envelope form.
  try {
    localStorage.removeItem(legacyKey(market, account, serviceId));
  } catch {
    /* ignore */
  }
}

/**
 * Load and decrypt the plaintext key for this slot. Prompts for a
 * signature on first call per session. Returns null if no record
 * exists, throws on decryption failure (wrong wallet, corrupted record,
 * tampered ciphertext).
 *
 * Also handles one-time migration: if a legacy plaintext record exists,
 * read it, re-save under the envelope format, delete the legacy entry,
 * and return the plaintext.
 */
export async function loadKey(
  market: string,
  account: string,
  serviceId: bigint,
  signer: Signer,
): Promise<string | null> {
  // ── new envelope format ──
  let raw: string | null;
  try {
    raw = localStorage.getItem(recordKey(market, account, serviceId));
  } catch {
    raw = null;
  }

  if (raw) {
    let record: EnvelopeRecord;
    try {
      record = JSON.parse(raw) as EnvelopeRecord;
    } catch {
      throw new Error('keyStore: stored record is malformed JSON');
    }
    if (record.v !== 1) {
      throw new Error(`keyStore: unsupported record version ${record.v}`);
    }

    const kek = await getKek(market, account, signer);

    // Unwrap DEK.
    const dekRawBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(record.wIv) },
      kek,
      fromB64(record.wDek),
    );
    const dekRaw = new Uint8Array(dekRawBuf);
    const dek = await crypto.subtle.importKey(
      'raw',
      dekRaw,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    zero(dekRaw);

    // Decrypt payload.
    const ptBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(record.iv) },
      dek,
      fromB64(record.ct),
    );
    return new TextDecoder().decode(ptBuf);
  }

  // ── legacy plaintext format — migrate on read ──
  let legacy: string | null;
  try {
    legacy = localStorage.getItem(legacyKey(market, account, serviceId));
  } catch {
    legacy = null;
  }
  if (legacy) {
    // Re-save under the envelope format (prompts for signature) and
    // drop the plaintext entry. After this point, the plaintext is gone
    // from disk.
    await saveKey(market, account, serviceId, legacy, signer);
    try {
      localStorage.removeItem(legacyKey(market, account, serviceId));
    } catch {
      /* ignore */
    }
    return legacy;
  }

  return null;
}

/** Delete both the envelope record and any legacy plaintext entry. */
export function clearKey(
  market: string,
  account: string,
  serviceId: bigint,
): void {
  try {
    localStorage.removeItem(recordKey(market, account, serviceId));
    localStorage.removeItem(legacyKey(market, account, serviceId));
  } catch {
    /* ignore */
  }
}
