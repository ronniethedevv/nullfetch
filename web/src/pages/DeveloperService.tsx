import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BrowserProvider, getAddress, hexlify } from 'ethers';
import { CATEGORIES } from '../abi';
import { useWallet } from '../hooks/WalletContext';
import { useMarketplace } from '../hooks/useMarketplace';
import { digestHalves } from '../fhe/keyHelpers';
import { getInstance } from '../fhe/sdk';
import { saveKey, loadKey, clearKey, hasStoredKey } from '../fhe/keyStore';
import { StatusLog, type LogEntry } from '../components/StatusLog';
import { ResultTile } from '../components/ResultTile';
import { normalizeService, type Service, type RawServiceTuple } from '../types';

type VerifyState = 'idle' | 'pending' | 'true' | 'false';

interface SubInfo {
  exists: boolean;
  revoked: boolean;
  registeredAt: bigint;
  callCount: bigint;
}

interface ApiResponse {
  status: number;
  body: string;
}

interface ChallengeResponse {
  wallet: string;
  nonce: string;
  expiresAt: number;
  message: string;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function pickResult(
  res: Record<string, bigint | boolean | string>,
  handle: string,
): bigint | boolean | string | undefined {
  if (handle in res) return res[handle];
  const lower = handle.toLowerCase();
  for (const k of Object.keys(res)) {
    if (k.toLowerCase() === lower) return res[k];
  }
  return undefined;
}

function asBool(v: bigint | boolean | string | undefined): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return v !== 0n;
  if (typeof v === 'string') {
    if (v === '0x' || v === '0x0' || v === '0') return false;
    return Boolean(v);
  }
  return null;
}

export function DeveloperService() {
  const { id } = useParams<{ id: string }>();
  const { account, chainOk, connect, connecting } = useWallet();
  const { contract, address: marketAddr, getSignerContract, error: marketError } = useMarketplace();

  const [service, setService] = useState<Service | null>(null);
  const [sub, setSub] = useState<SubInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);

  const [keyInput, setKeyInput] = useState('');
  const [hasLocalKey, setHasLocalKey] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [attestState, setAttestState] = useState<VerifyState>('idle');
  // Defaults to the deployed Render API for the live site. Editable in
  // the UI for local development (point at http://localhost:3000) or
  // for testing other deployments.
  const [apiBase, setApiBase] = useState('https://nullfetch-api.onrender.com');
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const append = useCallback(
    (level: LogEntry['level'], msg: string) =>
      setLog((l) => [...l, { ts: Date.now(), level, msg }]),
    [],
  );

  const serviceIdBn = useMemo(() => (id ? BigInt(id) : null), [id]);

  // ── load service + sub state + saved key ───────────────────────
  const load = useCallback(async () => {
    if (!contract || !serviceIdBn || !account) return;
    setLoading(true);
    setReadError(null);
    try {
      const [rawService, rawSub] = await Promise.all([
        contract.getService(serviceIdBn) as Promise<RawServiceTuple>,
        contract.getSubscription(serviceIdBn, account) as Promise<[boolean, boolean, bigint, bigint]>,
      ]);
      setService(normalizeService(serviceIdBn, rawService));
      setSub({
        exists: rawSub[0],
        revoked: rawSub[1],
        registeredAt: rawSub[2],
        callCount: rawSub[3],
      });
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [contract, serviceIdBn, account]);

  useEffect(() => {
    load();
  }, [load]);

  // Zero the plaintext from React state when the user navigates away
  // from this page. The window during which plaintext lives in JS heap
  // shrinks from "tab open" to "this page mounted". Re-mount triggers
  // an unlock prompt again — same flow, just narrower.
  useEffect(() => {
    return () => {
      setKeyInput('');
    };
  }, []);

  // Check whether a ciphertext record exists for this slot. Read-only
  // — does NOT prompt for a signature. The "unlock" button does that
  // on demand so a casual page reload doesn't trigger a wallet popup.
  useEffect(() => {
    if (!account || !serviceIdBn || !marketAddr) return;
    setHasLocalKey(hasStoredKey(marketAddr, account, serviceIdBn));
  }, [account, serviceIdBn, marketAddr]);

  const onUnlock = useCallback(async () => {
    if (!account || !serviceIdBn) return;
    setUnlocking(true);
    try {
      append('info', '[unlock] asking wallet to derive the local-store KEK (1 signature, no gas)…');
      const browserProvider = new BrowserProvider(window.ethereum!);
      const signer = await browserProvider.getSigner();
      const plaintext = await loadKey(marketAddr, account, serviceIdBn, signer);
      if (plaintext) {
        setKeyInput(plaintext);
        append('ok', '[unlock] decrypted local plaintext into key field');
      } else {
        append('warn', '[unlock] no record found after unlock');
      }
    } catch (e) {
      append('error', `[unlock] ${(e as Error).message}`);
    } finally {
      setUnlocking(false);
    }
  }, [account, serviceIdBn, marketAddr, append]);

  // ── actions ────────────────────────────────────────────────────
  const onVerify = useCallback(async () => {
    if (!service || !serviceIdBn || !account) return;
    if (!chainOk) {
      append('error', 'switch to Sepolia first');
      return;
    }
    if (!keyInput.trim()) {
      append('error', 'paste your API key first');
      return;
    }
    setBusyAction('verify');
    setVerifyState('pending');
    try {
      // EIP-55 checksum every address that the Zama relayer SDK
      // touches. MetaMask returns lowercase; the SDK rejects with
      // "User address is not a valid address" / "Bad address checksum"
      // on uncasumed input. Compute once, reuse below.
      const checksumMarket = getAddress(marketAddr);
      const checksumUser = getAddress(account);

      append('info', `[verify] hashing key (${keyInput.length} chars)`);
      const { hi, lo, digest } = digestHalves(keyInput.trim());
      append('ok', `[verify] digest = ${digest}`);

      append('info', '[verify] loading Zama relayer SDK…');
      const fhevm = await getInstance(window.ethereum!);

      const input = fhevm.createEncryptedInput(checksumMarket, checksumUser);
      input.add128(hi);
      input.add128(lo);
      const enc = await input.encrypt();
      append('ok', '[verify] encrypted both halves');

      const signerContract = await getSignerContract();
      append('info', '[verify] submitting verify(serviceId, …) — MetaMask prompt');
      const tx = await signerContract.verify(
        serviceIdBn,
        hexlify(enc.handles[0]),
        hexlify(enc.handles[1]),
        hexlify(enc.inputProof),
      );
      append('info', `[verify] tx ${tx.hash} — awaiting receipt`);
      const rc = await tx.wait();
      if (!rc) throw new Error('no receipt');
      append('ok', `[verify] mined in block ${rc.blockNumber}`);

      // Extract result handle from the Verified event.
      let resultHandle: string | undefined;
      for (const lg of rc.logs) {
        try {
          const parsed = signerContract.interface.parseLog({
            topics: [...lg.topics],
            data: lg.data,
          });
          if (parsed?.name === 'Verified') {
            resultHandle = parsed.args.resultHandle as string;
            break;
          }
        } catch {
          /* not ours */
        }
      }
      if (!resultHandle) throw new Error('Verified event missing in receipt');

      // User-decrypt the ebool via the relayer SDK. Both the contract
      // list and the user address must be EIP-55 — see the comment at
      // the top of this handler.
      append('info', '[verify] building EIP-712 user-decrypt permission');
      const kp = fhevm.generateKeypair();
      const start = Math.floor(Date.now() / 1000);
      const days = 7;
      const eip712 = fhevm.createEIP712(kp.publicKey, [checksumMarket], start, days);

      const browserProvider = new BrowserProvider(window.ethereum!);
      const signer = await browserProvider.getSigner();
      const sigBytes = await signer.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification: [
            ...eip712.types.UserDecryptRequestVerification,
          ],
        },
        eip712.message,
      );
      append('ok', '[verify] permission signed');

      append('info', '[verify] posting handle + permission to relayer…');
      const res = await fhevm.userDecrypt(
        [{ handle: resultHandle, contractAddress: checksumMarket }],
        kp.privateKey,
        kp.publicKey,
        sigBytes.replace(/^0x/, ''),
        [checksumMarket],
        checksumUser,
        start,
        days,
      );

      const raw = pickResult(res, resultHandle);
      const bool = asBool(raw);
      if (bool == null) throw new Error('relayer returned no decrypted value');
      append('ok', `[verify] decrypted ebool = ${bool}`);
      setVerifyState(bool ? 'true' : 'false');
    } catch (e) {
      append('error', `[verify] ${(e as Error).message}`);
      setVerifyState('idle');
    } finally {
      setBusyAction(null);
    }
  }, [service, serviceIdBn, account, chainOk, keyInput, marketAddr, getSignerContract, append]);

  const onAttest = useCallback(async () => {
    if (!service || !serviceIdBn || !account) return;
    if (!chainOk) {
      append('error', 'switch to Sepolia first');
      return;
    }
    if (!keyInput.trim()) {
      append('error', 'paste your API key first');
      return;
    }
    setBusyAction('attest');
    setAttestState('pending');
    try {
      append('info', '[attest] hashing + encrypting');
      const { hi, lo } = digestHalves(keyInput.trim());
      const fhevm = await getInstance(window.ethereum!);
      // EIP-55 checksum both addresses — the Zama relayer SDK rejects
      // lowercase input with "User address is not a valid address."
      const input = fhevm.createEncryptedInput(getAddress(marketAddr), getAddress(account));
      input.add128(hi);
      input.add128(lo);
      const enc = await input.encrypt();
      append('ok', '[attest] encrypted halves');

      const signerContract = await getSignerContract();

      // tx 1: verifyAndAttest
      append('info', '[attest 1/2] verifyAndAttest — MetaMask prompt');
      const tx1 = await signerContract.verifyAndAttest(
        serviceIdBn,
        hexlify(enc.handles[0]),
        hexlify(enc.handles[1]),
        hexlify(enc.inputProof),
      );
      append('info', `[attest 1/2] tx ${tx1.hash}`);
      const rc1 = await tx1.wait();
      if (!rc1) throw new Error('no receipt for verifyAndAttest');
      append('ok', `[attest 1/2] mined in block ${rc1.blockNumber}`);

      let handle: string | undefined;
      for (const lg of rc1.logs) {
        try {
          const parsed = signerContract.interface.parseLog({
            topics: [...lg.topics],
            data: lg.data,
          });
          if (parsed?.name === 'AttestationRequested') {
            handle = parsed.args.handle as string;
            break;
          }
        } catch {
          /* not ours */
        }
      }
      if (!handle) throw new Error('AttestationRequested event missing');

      // Off-chain public-decrypt
      append('info', '[attest] asking relayer to public-decrypt…');
      const pd = await fhevm.publicDecrypt([handle]);
      append('ok', `[attest] relayer returned KMS-signed cleartext`);

      // tx 2: submitAttestation
      append('info', '[attest 2/2] submitAttestation — MetaMask prompt');
      const tx2 = await signerContract.submitAttestation(
        [handle],
        pd.abiEncodedClearValues,
        pd.decryptionProof,
      );
      append('info', `[attest 2/2] tx ${tx2.hash}`);
      const rc2 = await tx2.wait();
      if (!rc2) throw new Error('no receipt for submitAttestation');
      append('ok', `[attest 2/2] mined in block ${rc2.blockNumber}`);

      // Read the resulting attestation so we know if it matched.
      const [valid] = (await contract!.getAttestation(account)) as [
        boolean,
        bigint,
        boolean,
        bigint,
      ];
      setAttestState(valid ? 'true' : 'false');
      append(
        valid ? 'ok' : 'warn',
        `[attest] on-chain result: valid = ${valid}`,
      );
    } catch (e) {
      append('error', `[attest] ${(e as Error).message}`);
      setAttestState('idle');
    } finally {
      setBusyAction(null);
    }
  }, [service, serviceIdBn, account, chainOk, keyInput, marketAddr, contract, getSignerContract, append]);

  const onCallApi = useCallback(async () => {
    if (!account || !serviceIdBn) return;
    setBusyAction('api');
    setApiResponse(null);
    try {
      const base = apiBase.replace(/\/$/, '');

      // 1. fetch challenge
      append('info', `[api] POST ${base}/challenge?wallet=${account}`);
      const cr = await fetch(
        `${base}/challenge?wallet=${encodeURIComponent(account)}`,
        { method: 'POST' },
      );
      if (!cr.ok) {
        const txt = await cr.text();
        setApiResponse({ status: cr.status, body: txt });
        append('error', `[api] challenge HTTP ${cr.status}`);
        return;
      }
      const challenge = (await cr.json()) as ChallengeResponse;
      append('ok', `[api] challenge nonce ${challenge.nonce.slice(0, 10)}…`);

      // 2. sign
      append('info', '[api] personal_sign challenge (no tx)…');
      const browserProvider = new BrowserProvider(window.ethereum!);
      const signer = await browserProvider.getSigner();
      const signature = await signer.signMessage(challenge.message);
      append('ok', `[api] signed: ${signature.slice(0, 18)}…`);

      // 3. call the protected endpoint
      const url = `${base}/api/service/${serviceIdBn.toString()}`;
      append('info', `[api] GET ${url}`);
      const r = await fetch(url, {
        headers: {
          'X-Wallet-Address': account,
          'X-Auth-Nonce': challenge.nonce,
          'X-Wallet-Signature': signature,
        },
      });
      const text = await r.text();
      let body: string;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        body = text;
      }
      setApiResponse({ status: r.status, body });
      append(r.ok ? 'ok' : 'warn', `[api] ← HTTP ${r.status}`);
    } catch (e) {
      append('error', `[api] ${(e as Error).message}`);
    } finally {
      setBusyAction(null);
    }
  }, [account, serviceIdBn, apiBase, append]);

  const onRotateKey = useCallback(async () => {
    if (!service || !serviceIdBn || !account) return;
    if (!confirm(
      'Rotate the key for this subscription? The current key will stop working. A new random key will be generated and saved locally.',
    )) return;

    setBusyAction('rotate');
    try {
      append('info', '[rotate] generating new 32-byte random key');
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      let newKey = '0x';
      for (let i = 0; i < bytes.length; i++) {
        newKey += bytes[i].toString(16).padStart(2, '0');
      }
      const { hi, lo, digest } = digestHalves(newKey);
      append('ok', `[rotate] new digest = ${digest}`);

      const fhevm = await getInstance(window.ethereum!);
      // EIP-55 checksum both addresses — the Zama relayer SDK rejects
      // lowercase input with "User address is not a valid address."
      const input = fhevm.createEncryptedInput(getAddress(marketAddr), getAddress(account));
      input.add128(hi);
      input.add128(lo);
      const enc = await input.encrypt();

      const signerContract = await getSignerContract();
      append('info', '[rotate] submitting rotateKey — MetaMask prompt');
      const tx = await signerContract.rotateKey(
        serviceIdBn,
        hexlify(enc.handles[0]),
        hexlify(enc.handles[1]),
        hexlify(enc.inputProof),
      );
      append('info', `[rotate] tx ${tx.hash}`);
      const rc = await tx.wait();
      append('ok', `[rotate] mined in block ${rc?.blockNumber}`);

      try {
        const browserProvider = new BrowserProvider(window.ethereum!);
        const signer = await browserProvider.getSigner();
        await saveKey(marketAddr, account, serviceIdBn, newKey, signer);
        setHasLocalKey(true);
        append('ok', '[rotate] new plaintext encrypted + saved locally');
      } catch (e) {
        append('warn', `[rotate] local save skipped: ${(e as Error).message}`);
      }
      setKeyInput(newKey);
    } catch (e) {
      append('error', `[rotate] ${(e as Error).message}`);
    } finally {
      setBusyAction(null);
    }
  }, [service, serviceIdBn, account, marketAddr, getSignerContract, append]);

  const onForgetLocalKey = useCallback(() => {
    if (!account || !serviceIdBn) return;
    if (!confirm('Forget the locally-stored key for this subscription? You can paste it back in manually.')) return;
    clearKey(marketAddr, account, serviceIdBn);
    setKeyInput('');
    setHasLocalKey(false);
    append('info', 'cleared local key record');
  }, [account, serviceIdBn, marketAddr, append]);

  // ── gates ──────────────────────────────────────────────────────
  if (!account) {
    return (
      <section className="page page--gate">
        <div className="gate">
          <div className="gate__eyebrow mono">// use a service</div>
          <h1 className="gate__title">Connect wallet to continue</h1>
          <button className="btn btn--primary btn--cta" onClick={connect} disabled={connecting}>
            {connecting ? 'connecting…' : 'connect wallet'}
          </button>
        </div>
      </section>
    );
  }

  if (marketError) {
    return (
      <section className="page">
        <div className="alert alert--err mono">
          <span className="alert__k">deployments.json</span> · {marketError}
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="page">
        <div className="browse__empty mono">// loading subscription…</div>
      </section>
    );
  }

  if (readError || !service || !sub) {
    return (
      <section className="page">
        <Link to="/developer" className="back-link mono">
          ← developer dashboard
        </Link>
        <div className="alert alert--err mono">
          <span className="alert__k">subscription</span> · {readError ?? 'not found'}
        </div>
      </section>
    );
  }

  if (!sub.exists) {
    return (
      <section className="page">
        <Link to="/developer" className="back-link mono">
          ← developer dashboard
        </Link>
        <div className="alert alert--err mono">
          <span className="alert__k">subscription</span> · this wallet is not subscribed to service #{service.id.toString()}
        </div>
        <Link to={`/developer/register/${service.id.toString()}`} className="btn btn--primary btn--cta">
          register for this service
        </Link>
      </section>
    );
  }

  const cat = CATEGORIES[service.category] ?? 'Other';
  const apiTone: 'ok' | 'err' | 'idle' =
    apiResponse == null
      ? 'idle'
      : apiResponse.status >= 200 && apiResponse.status < 300
        ? 'ok'
        : 'err';

  return (
    <section className="page service-detail">
      <Link to="/developer" className="back-link mono">
        ← developer dashboard
      </Link>

      <header className="page__head">
        <div className="page__eyebrow mono">
          // subscription · #{service.id.toString()} · {cat}
          {sub.revoked && <span className="service-detail__head-off"> · revoked</span>}
          {!service.active && <span className="service-detail__head-off"> · service inactive</span>}
        </div>
        <h1 className="page__title">{service.name}</h1>
        <p className="page__desc">
          {service.description || `An API in the ${cat} category.`}
        </p>
      </header>

      {sub.revoked && (
        <div className="alert alert--err mono">
          <span className="alert__k">revoked</span> · provider has revoked this subscription. verify and attest will revert; you can&rsquo;t use this service anymore.
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-row">
          <div className="detail-row__k mono">provider</div>
          <div className="detail-row__v mono">{shortAddr(service.provider)}</div>
        </div>
        <div className="detail-row">
          <div className="detail-row__k mono">endpoint</div>
          <div className="detail-row__v mono">{service.endpoint || '— not set'}</div>
        </div>
        <div className="detail-row">
          <div className="detail-row__k mono">registered</div>
          <div className="detail-row__v mono">
            {new Date(Number(sub.registeredAt) * 1000).toISOString().slice(0, 10)}
          </div>
        </div>
        <div className="detail-row">
          <div className="detail-row__k mono">on_chain_calls</div>
          <div className="detail-row__v mono">{sub.callCount.toString()}</div>
        </div>
      </div>

      {/* ── key ──────────────────────────────────────────────── */}
      <header className="page__head" style={{ marginTop: 28 }}>
        <div className="page__eyebrow mono">// your api key (local only)</div>
        <h2 className="page__title" style={{ fontSize: 18 }}>Key</h2>
      </header>

      <div className="field">
        <input
          className="field__input mono"
          type="text"
          placeholder="paste your key, or click unlock if you stored it here before"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          disabled={busyAction !== null || unlocking}
        />
        <div className="field__hint mono">
          // localStorage holds only ciphertext — unlocking derives a
          KEK from a wallet signature, AES-GCM unwraps the record. No
          tx, no gas.
        </div>
        <div className="form__inline-actions">
          {hasLocalKey && !keyInput && (
            <button
              className="btn btn--small"
              onClick={onUnlock}
              disabled={unlocking || busyAction !== null}
            >
              {unlocking ? 'unlocking…' : 'unlock saved key'}
            </button>
          )}
          <button
            className="btn btn--small"
            onClick={async () => {
              if (!account || !serviceIdBn || !keyInput.trim()) return;
              try {
                const browserProvider = new BrowserProvider(window.ethereum!);
                const signer = await browserProvider.getSigner();
                await saveKey(marketAddr, account, serviceIdBn, keyInput.trim(), signer);
                setHasLocalKey(true);
                append('ok', 'encrypted + saved current input to local storage');
              } catch (e) {
                append('error', `save failed: ${(e as Error).message}`);
              }
            }}
            disabled={!keyInput.trim() || busyAction !== null || unlocking}
          >
            save
          </button>
          <button
            className="btn btn--small"
            onClick={onForgetLocalKey}
            disabled={busyAction !== null || unlocking || !hasLocalKey}
          >
            forget local copy
          </button>
        </div>
      </div>

      {/* ── verify ───────────────────────────────────────────── */}
      <header className="page__head" style={{ marginTop: 28 }}>
        <div className="page__eyebrow mono">// 1 · verify (private, caller-only)</div>
        <h2 className="page__title" style={{ fontSize: 18 }}>Verify possession privately</h2>
        <p className="page__desc">
          The contract compares your encrypted key to the stored ciphertext
          and gives you back an encrypted boolean only you can decrypt.
          Nothing public.
        </p>
      </header>
      <button
        className="btn btn--primary btn--cta"
        onClick={onVerify}
        disabled={busyAction !== null || sub.revoked || !service.active}
      >
        {busyAction === 'verify' ? 'verifying…' : 'encrypt & verify'}
      </button>
      <ResultTile state={verifyState} />

      {/* ── attest ───────────────────────────────────────────── */}
      <header className="page__head" style={{ marginTop: 28 }}>
        <div className="page__eyebrow mono">// 2 · attest (public, for API gating)</div>
        <h2 className="page__title" style={{ fontSize: 18 }}>Attest on-chain</h2>
        <p className="page__desc">
          Two-tx flow: verifyAndAttest, then submitAttestation. The result
          becomes a publicly-readable attestation that any API server can
          gate on for the next hour.
        </p>
      </header>
      <button
        className="btn btn--primary btn--cta"
        onClick={onAttest}
        disabled={busyAction !== null || sub.revoked || !service.active}
      >
        {busyAction === 'attest' ? 'attesting…' : 'run on-chain attestation (2 sigs)'}
      </button>
      <ResultTile state={attestState} />

      {/* ── call api ─────────────────────────────────────────── */}
      <header className="page__head" style={{ marginTop: 28 }}>
        <div className="page__eyebrow mono">// 3 · call the API</div>
        <h2 className="page__title" style={{ fontSize: 18 }}>Call the protected endpoint</h2>
        <p className="page__desc">
          The demo API reads your on-chain attestation (with a SIWE proof
          of wallet control) and returns a category-appropriate stub
          response. Run an attestation first if you haven&rsquo;t.
        </p>
      </header>
      <div className="form__inline-actions">
        <input
          className="field__input mono"
          type="text"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value.trim())}
          disabled={busyAction !== null}
          style={{ maxWidth: 320 }}
        />
        <button
          className="btn btn--primary btn--cta"
          onClick={onCallApi}
          disabled={busyAction !== null}
        >
          {busyAction === 'api' ? 'calling…' : `sign + GET /api/service/${id}`}
        </button>
      </div>

      {apiResponse && (
        <div className={`api-response api-response--${apiTone}`}>
          <div className="api-response__head mono">HTTP {apiResponse.status}</div>
          <pre className="api-response__body mono">{apiResponse.body}</pre>
        </div>
      )}

      {/* ── rotate ───────────────────────────────────────────── */}
      <header className="page__head" style={{ marginTop: 28 }}>
        <div className="page__eyebrow mono">// rotate key</div>
        <h2 className="page__title" style={{ fontSize: 18 }}>Rotate</h2>
        <p className="page__desc">
          Generates a new random key, encrypts it, and replaces the
          ciphertext stored against your subscription. The old key stops
          validating. No fee.
        </p>
      </header>
      <button
        className="btn"
        onClick={onRotateKey}
        disabled={busyAction !== null || sub.revoked || !service.active}
      >
        {busyAction === 'rotate' ? 'rotating…' : 'rotate to a new random key'}
      </button>

      <div className="form__log" style={{ marginTop: 28 }}>
        <StatusLog entries={log} tone="cool" />
      </div>
    </section>
  );
}
