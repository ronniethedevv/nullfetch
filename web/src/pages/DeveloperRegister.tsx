import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BrowserProvider, ethers, hexlify } from 'ethers';
import { CATEGORIES } from '../abi';
import { useWallet } from '../hooks/WalletContext';
import { useMarketplace } from '../hooks/useMarketplace';
import { digestHalves } from '../fhe/keyHelpers';
import { getInstance } from '../fhe/sdk';
import { saveKey } from '../fhe/keyStore';
import { StatusLog, type LogEntry } from '../components/StatusLog';
import { normalizeService, type Service, type RawServiceTuple } from '../types';

/// 32 cryptographically-random bytes from the browser's CSPRNG.
function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let out = '0x';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

interface Outcome {
  apiKey: string;
  txHash: string;
  blockNumber: number;
}

export function DeveloperRegister() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { account, chainOk, connect, connecting } = useWallet();
  const { contract, address: marketAddr, getSignerContract, error: marketError } = useMarketplace();

  const [service, setService] = useState<Service | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const append = useCallback(
    (level: LogEntry['level'], msg: string) =>
      setLog((l) => [...l, { ts: Date.now(), level, msg }]),
    [],
  );

  const serviceIdBn = useMemo(() => (id ? BigInt(id) : null), [id]);

  // ── load service + fee ─────────────────────────────────────────
  useEffect(() => {
    if (!contract || !serviceIdBn) return;
    (async () => {
      setLoading(true);
      setReadError(null);
      try {
        const [raw, f] = await Promise.all([
          contract.getService(serviceIdBn) as Promise<RawServiceTuple>,
          contract.registrationFee() as Promise<bigint>,
        ]);
        setService(normalizeService(serviceIdBn, raw));
        setFee(f);
      } catch (e) {
        setReadError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [contract, serviceIdBn]);

  const onRegister = useCallback(async () => {
    if (!account || !serviceIdBn || !service || fee == null) return;
    if (!chainOk) {
      append('error', 'wrong network — switch to Sepolia first');
      return;
    }
    if (!service.active) {
      append('error', 'this service is inactive — registration is disabled');
      return;
    }

    setBusy(true);
    try {
      // 1. Generate the plaintext key locally. This is the only copy
      //    of plaintext that will exist anywhere — until the user backs
      //    it up.
      append('info', 'generating 32 random bytes (crypto.getRandomValues)…');
      const apiKey = generateApiKey();
      append('ok', `plaintext generated (${apiKey.length} chars)`);

      // 2. Hash + split.
      append('info', 'keccak256 → hi/lo 16-byte halves');
      const { hi, lo, digest } = digestHalves(apiKey);
      append('ok', `digest = ${digest}`);

      // 3. Encrypt via the Zama relayer SDK.
      append('info', 'loading Zama relayer SDK (WASM)…');
      const fhevm = await getInstance(window.ethereum!);
      append('info', 'encrypting both halves client-side…');
      const input = fhevm.createEncryptedInput(marketAddr, account);
      input.add128(hi);
      input.add128(lo);
      const enc = await input.encrypt();
      append('ok', `produced ${enc.handles.length} handles + inputProof`);

      // 4. Submit registerForService with fee.
      append(
        'info',
        `submitting registerForService(${serviceIdBn}, …) with ${ethers.formatEther(fee)} ETH — MetaMask will prompt`,
      );
      const signerContract = await getSignerContract();
      const tx = await signerContract.registerForService(
        serviceIdBn,
        hexlify(enc.handles[0]),
        hexlify(enc.handles[1]),
        hexlify(enc.inputProof),
        { value: fee },
      );
      append('info', `tx submitted: ${tx.hash} — awaiting receipt…`);

      const rc = await tx.wait();
      if (!rc) throw new Error('no receipt');
      append('ok', `mined in block ${rc.blockNumber}`);

      // 5. Persist the plaintext locally under envelope encryption.
      //    The wallet will prompt once to derive a session KEK; after
      //    that, every save/load this session is silent.
      try {
        append('info', 'asking wallet to derive the local-store KEK (1 signature, no gas)…');
        const browserProvider = new BrowserProvider(window.ethereum!);
        const signer = await browserProvider.getSigner();
        await saveKey(marketAddr, account, serviceIdBn, apiKey, signer);
        append('ok', 'plaintext encrypted with session KEK + saved to localStorage');
      } catch (e) {
        // If the user declines the signature, we still have the
        // plaintext in `apiKey` and surface it to them on the success
        // screen — they can copy it elsewhere. Local persistence just
        // won't happen this round.
        append('warn', `local save skipped: ${(e as Error).message}`);
      }

      setOutcome({
        apiKey,
        txHash: tx.hash as string,
        blockNumber: rc.blockNumber,
      });
    } catch (e) {
      append('error', `registration failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [account, chainOk, serviceIdBn, service, fee, marketAddr, getSignerContract, append]);

  const onCopy = useCallback(() => {
    if (!outcome) return;
    void navigator.clipboard.writeText(outcome.apiKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [outcome]);

  // ── gates ──────────────────────────────────────────────────────
  if (!account) {
    return (
      <section className="page page--gate">
        <div className="gate">
          <div className="gate__eyebrow mono">// register for service</div>
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
        <div className="browse__empty mono">// loading service #{id}…</div>
      </section>
    );
  }

  if (readError || !service) {
    return (
      <section className="page">
        <Link to="/browse" className="back-link mono">
          ← marketplace
        </Link>
        <div className="alert alert--err mono">
          <span className="alert__k">service #{id}</span> · {readError ?? 'not found'}
        </div>
      </section>
    );
  }

  // ── success state ──────────────────────────────────────────────
  if (outcome) {
    return (
      <section className="page service-detail">
        <header className="page__head">
          <div className="page__eyebrow mono">// registered · success</div>
          <h1 className="page__title">You&rsquo;re subscribed to {service.name}</h1>
          <p className="page__desc">
            Service #{service.id.toString()} · the contract holds an
            encrypted reference to your key. The plaintext below is the
            only copy. <b>Save it now</b> — there is no recovery.
          </p>
        </header>

        <div className={`reveal ${revealed ? 'reveal--on' : ''}`}>
          <div className="reveal__head mono">
            <span className="reveal__label">api_key · plaintext, one-time view</span>
            {!revealed && (
              <button
                className="btn btn--small"
                onClick={() => setRevealed(true)}
              >
                reveal
              </button>
            )}
          </div>
          <div className="reveal__body mono">
            {revealed ? outcome.apiKey : '·'.repeat(66)}
          </div>
          {revealed && (
            <div className="reveal__actions">
              <button className="btn btn--small" onClick={onCopy}>
                {copied ? 'copied ✓' : 'copy'}
              </button>
              <span className="reveal__hint mono">
                // also stored in this browser (encrypted) at nf:key:env:v1:&lt;market&gt;:&lt;wallet&gt;:&lt;service_id&gt;
              </span>
            </div>
          )}
        </div>

        <label className="ack mono">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          I&rsquo;ve saved the key somewhere I trust. I understand the
          marketplace cannot recover it.
        </label>

        <div className="detail-grid">
          <div className="detail-row">
            <div className="detail-row__k mono">tx_hash</div>
            <div className="detail-row__v mono">
              <a
                href={`https://sepolia.etherscan.io/tx/${outcome.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {outcome.txHash.slice(0, 10)}…{outcome.txHash.slice(-8)}
              </a>
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-row__k mono">block</div>
            <div className="detail-row__v mono">{outcome.blockNumber}</div>
          </div>
          <div className="detail-row">
            <div className="detail-row__k mono">service_id</div>
            <div className="detail-row__v mono">{service.id.toString()}</div>
          </div>
        </div>

        <div className="service-detail__actions">
          <button
            className="btn btn--primary btn--cta"
            disabled={!acknowledged}
            onClick={() => navigate(`/developer/service/${service.id.toString()}`)}
          >
            {acknowledged ? 'use this service →' : 'check the box first'}
          </button>
          <Link to="/developer" className="btn btn--cta">
            developer dashboard
          </Link>
        </div>
      </section>
    );
  }

  // ── pre-flight form ────────────────────────────────────────────
  const categoryName = CATEGORIES[service.category] ?? 'Other';

  return (
    <section className="page">
      <Link to={`/service/${service.id.toString()}`} className="back-link mono">
        ← service #{service.id.toString()} · {service.name}
      </Link>

      <header className="page__head">
        <div className="page__eyebrow mono">// register · service #{service.id.toString()}</div>
        <h1 className="page__title">Register for {service.name}</h1>
        <p className="page__desc">
          {service.description || `An API in the ${categoryName} category.`}
        </p>
      </header>

      <div className="alert alert--info mono">
        <span className="alert__k">how this works</span> · click register, MetaMask
        will prompt you to pay {fee == null ? '…' : ethers.formatEther(fee)} ETH.
        Your browser generates a random 32-byte key, encrypts it locally, and
        submits only the ciphertext on-chain. The provider never sees your key.
        Neither do we.
      </div>

      <div className="detail-grid">
        <div className="detail-row">
          <div className="detail-row__k mono">provider</div>
          <div className="detail-row__v mono">{service.provider}</div>
        </div>
        <div className="detail-row">
          <div className="detail-row__k mono">category</div>
          <div className="detail-row__v mono">{categoryName}</div>
        </div>
        <div className="detail-row">
          <div className="detail-row__k mono">registration_fee</div>
          <div className="detail-row__v mono">
            {fee == null ? '…' : `${ethers.formatEther(fee)} ETH`}
          </div>
        </div>
        <div className="detail-row">
          <div className="detail-row__k mono">status</div>
          <div className="detail-row__v mono">
            {service.active ? (
              <span className="detail-row__ok">active</span>
            ) : (
              <span className="detail-row__off">inactive — registration disabled</span>
            )}
          </div>
        </div>
      </div>

      <div className="service-detail__actions">
        <button
          className="btn btn--primary btn--cta"
          onClick={onRegister}
          disabled={busy || !chainOk || fee == null || !service.active}
        >
          {busy
            ? 'registering…'
            : `register · pay ${fee == null ? '…' : ethers.formatEther(fee)} ETH`}
        </button>
        <Link to={`/service/${service.id.toString()}`} className="btn btn--cta">
          cancel
        </Link>
      </div>

      <div className="form__log">
        <StatusLog entries={log} tone="cool" />
      </div>
    </section>
  );
}
