# 90-second demo script

A beat-by-beat narration for screen-recording the privacy claim
end-to-end. Each beat lists the exact click + what to say + what the
viewer should see. Target run-time: 90 seconds.

> **Setup before you hit record.** API + web both running locally,
> MetaMask connected to Sepolia, deployed Marketplace with at least one
> service listed. The provider wallet has Sepolia ETH; the developer
> wallet (which can be the same wallet for the demo) has Sepolia ETH.
> Open two browser tabs:
>
> - Tab 1: `http://localhost:5173/browse`
> - Tab 2: `http://localhost:3000/health` — leave open to prove the API
>   is real
>
> Have your editor open to `api/src/server.ts` line 200ish (the
> `authenticateRequest` function) for the "auth code is provider-
> agnostic" point near the end.

---

## Beat 1 — the claim · 10 seconds

**Show:** the landing page (`/`).

**Say:**
> "Every API service today has an API-key database. When that database
> leaks, every customer's key leaks. This is the same marketplace —
> but the keys are never in the database to leak. Built on Zama fhEVM."

**Click:** "browse the marketplace" → `/browse`.

---

## Beat 2 — browse · 8 seconds

**Show:** the browse grid with at least one service (FactGen).

**Say:**
> "Anyone can browse services. No wallet needed for read."

**Click:** the FactGen card → `/service/1`.

---

## Beat 3 — service detail · 7 seconds

**Show:** the service detail page.

**Say:**
> "Provider, endpoint, category, subscriber count — all public
> metadata. The thing that's *not* public is the key any developer
> uses to authenticate."

**Click:** "register for this service" → `/developer/register/1`.

---

## Beat 4 — registration · 18 seconds

**Show:** the registration page.

**Say:**
> "Watch what happens. I click register, and *before* MetaMask prompts,
> my browser generates a 32-byte random key, hashes it, encrypts the
> halves client-side, and builds a zero-knowledge proof. The
> transaction submits only ciphertext."

**Click:** "register · pay 0.0003 ETH".
**MetaMask prompts. Confirm.**

**Wait:** ~10 seconds for the tx to mine. The status log streams the
phases — encryption, submission, receipt.

**Show:** the success page. Click **reveal**.

**Say:**
> "This is the only place plaintext ever existed. The provider didn't
> see it. The marketplace contract didn't see it. We didn't see it.
> Only my browser, right now."

**Tick:** the acknowledgement box. Click **use this service**.

---

## Beat 5 — verify under FHE · 15 seconds

**Show:** the use page with the key auto-filled from localStorage.

**Say:**
> "Now I prove possession. The contract has ciphertext, I'm submitting
> ciphertext, and it does the equality check homomorphically. Only I
> can decrypt the result."

**Click:** "encrypt & verify".

**MetaMask prompts. Confirm.**

**Wait:** ~5 seconds.

**Show:** the result tile flipping to `result · true · ebool decrypted = 1`.

**Say:**
> "True. Nobody else saw any plaintext."

---

## Beat 6 — attest + call the API · 22 seconds

**Show:** the same page.

**Say:**
> "To gate an API server, the boolean has to become public. Two
> transactions plus an off-chain decrypt round-trip — the standard
> fhEVM public-decrypt pattern."

**Click:** "run on-chain attestation". **Two MetaMask prompts. Confirm
both.**

**Wait:** ~15 seconds. Result tile flips to `true`.

**Click:** "sign + GET /api/service/1". **MetaMask shows a
personal_sign popup (no tx, no gas). Confirm.**

**Show:** the response panel shows `HTTP 200` with the response body —
including the wallet, service id, category, and a fact from the AI
stub.

**Say:**
> "The API server gates on the on-chain attestation. It has no key
> database. If it gets breached, there's nothing to leak. And the same
> auth code works for every provider — they all read the same on-chain
> state."

---

## Beat 7 — the proof, by breakage · 10 seconds

**Show:** edit the key field. Delete one character.

**Click:** "encrypt & verify" again.

**MetaMask prompts. Confirm.**

**Show:** result tile flips to `false`.

**Say:**
> "Wrong key — false. No tampering possible."

---

## Beat 8 — revocation · the close · 8 seconds

**Show:** in a separate tab, `/provider/service/1`. Click **revoke** on
the developer's row. Confirm in MetaMask + browser confirm.

**Switch back** to the developer tab. Click "sign + GET /api/service/1"
once more.

**Show:** `HTTP 401 · service_mismatch` (or whichever failure mode lands).

**Say:**
> "Revocation propagates immediately. No key DB, no plaintext anywhere,
> instant kill switch. That's the marketplace."

---

## Total: ~98 seconds

Trim Beat 4 to 14 seconds (skip narrating the encryption phases — the
status log shows them) to hit 90.

---

## What to highlight in voice-over

If your video has narration, emphasise these three sentences at any
point — they're the load-bearing claims:

1. **"The provider never sees the key."**
2. **"The marketplace never sees the key."**
3. **"If the database leaks, there's nothing to leak."**

Everything else is implementation detail.
