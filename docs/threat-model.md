# Threat model

What this marketplace protects against, what it does not, and where the
trust boundaries actually live.

---

## Assets

The asset is the **plaintext API key** the developer holds. Everything
else (service metadata, subscription records, attestations) is public by
design.

A secondary asset is **the linkage between a real-world identity and a
subscription** — but this is treated as out-of-scope (see "Limitations"
in the root README); wallet pseudonymity is the user's responsibility.

---

## Boundary diagram

```
┌─ developer's device ─────────────────────────────────────┐
│                                                          │
│   plaintext API key                                      │
│        │                                                 │
│        ▼                                                 │
│   browser memory ──(envelope)──> localStorage (cipher)   │
│        │                                                 │
│        │ keccak + TFHE encrypt + ZKPoK                   │
│        ▼                                                 │
└────────│─────────────────────────────────────────────────┘
         │
         ▼  ciphertext + proof only past this line
┌────────────────────────────────────────────────────────────┐
│   Sepolia chain · Marketplace contract                     │
│   FHE.eq on stored ciphertext · FHE.allow / allowThis      │
└────────────────────────────────────────────────────────────┘
         │
         ▼  threshold-MPC decryption requests / responses
┌────────────────────────────────────────────────────────────┐
│   Zama coprocessor + KMS (9-of-13 nodes, Nitro Enclaves)   │
│   Etherscan · Fireblocks · Ledger · OpenZeppelin · others  │
└────────────────────────────────────────────────────────────┘
```

The dashed envelope around localStorage in the developer's device is
the part this project adds beyond the typical fhEVM client flow — see
`web/src/fhe/keyStore.ts`.

---

## Adversaries and what each can see

| Adversary | Can see plaintext key? | How it's prevented |
| --- | --- | --- |
| **Marketplace operator (us)** | No | Operator never holds the key; nothing in the contract or off-chain infrastructure receives plaintext. |
| **Service provider** | No | Provider stores ciphertext via fhEVM; the auth gate reads only an on-chain attestation flag. |
| **Chain observer** | No | On-chain data is handles + ciphertext. The on-chain `Attested` event reveals a boolean and a serviceId, never key contents. |
| **Zama coprocessor or KMS node (single)** | No | TFHE master key is 9-of-13 threshold MPC; no single party can decrypt. |
| **Database breach of the marketplace** | No | There is no database. The contract's storage is ciphertext only. |
| **Database breach of the provider's API server** | No | The API server has no key DB. It reads `getAttestation(wallet)`. |
| **Passive disk dump of the developer's machine** | **Mitigated** (cipher only) | localStorage holds the envelope record; recovering plaintext requires the wallet's signature, which is not on disk. |
| **Extension reading the page's localStorage** | **Mitigated** (cipher only) | Same — extension reads the envelope record, can't unwrap without the wallet. |
| **Malware in the same browser process as the page** | **Yes (live process)** | Out of scope. See below. |
| **XSS / supply-chain compromise of the web app** | **Yes (live process)** | Out of scope. See below. |
| **OS-level keylogger / screen recorder / clipboard scraper** | **Yes (during use)** | Out of scope — endpoint security is the user's responsibility. |

---

## What the envelope encryption layer adds

The localStorage record format is an AES-GCM envelope:

```ts
interface EnvelopeRecord {
  v: 1;
  scope: { market, account, chainId, origin, purpose };
  iv:   base64;  // payload IV
  wIv:  base64;  // KEK→DEK wrap IV
  wDek: base64;  // wrapped DEK
  ct:   base64;  // AES-GCM ciphertext of the plaintext API key
}
```

- **KEK** is `SHA-256(wallet.signMessage(scopeMessage))`. The scope
  binds the signature to the marketplace address, the wallet, the
  chain id, the origin, and a purpose tag — so a signature collected
  for one app/wallet can't unwrap records of another.
- **DEK** is a fresh 256-bit random per record, wrapped under the KEK.
- **IVs** are 96-bit fresh per operation. Never derived.
- **Session cache.** The imported KEK CryptoKey is cached in memory
  for the lifetime of the tab; cleared on `accountsChanged` /
  `chainChanged`. One signature prompt per session per wallet, not
  per key.
- **Memory hygiene.** The raw signature and KEK bytes are zeroed
  immediately after the CryptoKey is imported. The CryptoKey itself
  is non-extractable.

This pattern is borrowed from
[ZamaDrop's `draft-crypto.ts`](https://github.com/huaruic/zamadrop)
(MIT-licensed reference, no code reuse).

What this does **not** protect against:

- Code running in the page (XSS, malicious extension, supply-chain
  compromise of any dep) can ask the user to sign the unlock message
  and intercept the resulting KEK. The envelope only helps against
  *passive* observation of disk and storage.
- Malware running as the same OS user can attach to the browser
  process and read the plaintext while it's in memory during
  encrypt/decrypt operations. The OS-level boundary is outside this
  app's reach.
- Live process introspection (DevTools, frida, gdb) sees plaintext.
  The browser cannot defend against a user with full local access.

---

## Out-of-scope by design

Three categories of attack are explicitly out-of-scope:

1. **Endpoint compromise.** If the developer's machine is infected
   with malware, every credential they hold on that machine is
   compromised — the marketplace's API key, plus Stripe keys, plus
   AWS keys, plus everything else. The marketplace cannot harden
   the OS.

2. **Wallet compromise.** If the wallet's private key leaks, the
   attacker can sign the unlock message, derive the KEK, and decrypt
   the envelope. They can also impersonate the developer to the
   marketplace contract directly. Wallet security is the user's
   responsibility (hardware wallet, FIDO2, etc.).

3. **Identity / linkability.** Anyone watching the chain sees which
   wallet is subscribed to which service. The *key* is private; the
   *fact of subscription* is not. Pseudonymous wallets are an option
   the user can choose; the marketplace neither forces nor prevents
   linkability.

---

## What an attacker realistically has to do

To go from "I dumped this developer's localStorage" to "I have their
plaintext API key":

1. Acquire the developer's wallet's private key — by phishing them
   into signing the unlock message under a malicious origin, or by
   compromising their wallet's keystore, or by extracting it from a
   running browser process.

Step 1 is the entire attack. There is no "step 2" — once the wallet
is compromised, the attacker can decrypt the envelope, sign new
`registerForService` / `verifyAndAttest` transactions, and act as the
developer in every other way too. The envelope doesn't make the wallet
attack harder; it makes the *passive* paths (cold disk scrape,
extension snooping localStorage) ineffective.

This is the same threat model as any wallet-gated dApp. The
marketplace inherits whatever security the wallet provides and
contributes:

- **Strictly less plaintext on disk and in transit** than any
  conventional API marketplace.
- **Strictly less plaintext at any provider, the marketplace
  operator, the chain, the relayer, or the KMS** than any
  conventional API marketplace.
- **Equivalent exposure to wallet-level compromise** as any other
  Ethereum dApp.

---

## What would move the boundary further

Documented for completeness; not implemented:

- **Hardware-rooted custody (WebAuthn / passkey / TPM).** Use a
  platform authenticator as the KEK source instead of a wallet
  signature. Plaintext would only appear after a biometric or hardware
  unlock; an extension or malicious origin couldn't impersonate it.
  Requires the cryptographic scheme to fit what the authenticator can
  do — current TFHE doesn't, but a ZK proof of preimage knowledge
  does.

- **Threshold custody of the developer's key.** Split the API key
  across multiple devices/services via MPC; no single device ever
  reconstructs plaintext. Production-grade but complex (recovery,
  multi-device flows).

- **`FHE.randEuint256()` for key generation.** The contract generates
  random ciphertext via threshold-MPC randomness; the developer
  user-decrypts it at first use. Eliminates "browser sees plaintext at
  generation"; plaintext appears only at first reveal, which can be
  inside a TEE if needed.

- **Drop the long-lived secret entirely.** Use the wallet's signature
  as the authentication credential (SIWE-only, no API key). No
  plaintext anywhere at any point. Loses the "API key as portable
  string" affordance.

Each of these would change the marketplace's architecture
substantially. The current design is a deliberate trade-off: keep the
familiar "API key as a string" model that developers already understand
from Stripe/AWS/OpenAI, while moving every off-device part of the
trust boundary into ciphertext.
