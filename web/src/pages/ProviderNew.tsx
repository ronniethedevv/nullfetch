import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ethers } from 'ethers';
import { CATEGORIES } from '../abi';
import { useWallet } from '../hooks/WalletContext';
import { useMarketplace } from '../hooks/useMarketplace';
import { StatusLog, type LogEntry } from '../components/StatusLog';

interface Outcome {
  serviceId: bigint;
  txHash: string;
  blockNumber: number;
}

export function ProviderNew() {
  const navigate = useNavigate();
  const { account, chainOk, connect, connecting } = useWallet();
  const { contract, getSignerContract, error: marketError } = useMarketplace();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [category, setCategory] = useState(1); // default to AI
  const [busy, setBusy] = useState(false);
  const [fee, setFee] = useState<bigint | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState(false);

  const append = useCallback(
    (level: LogEntry['level'], msg: string) =>
      setLog((l) => [...l, { ts: Date.now(), level, msg }]),
    [],
  );

  // ── read the current listing fee ────────────────────────────────
  useEffect(() => {
    if (!contract) return;
    (async () => {
      try {
        const f = (await contract.listingFee()) as bigint;
        setFee(f);
      } catch (e) {
        append('error', `failed to read listingFee: ${(e as Error).message}`);
      }
    })();
  }, [contract, append]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!account) {
        append('error', 'connect wallet first');
        return;
      }
      if (!chainOk) {
        append('error', 'wrong network — switch to Sepolia first');
        return;
      }
      if (!name.trim()) {
        append('error', 'name is required');
        return;
      }
      if (fee == null) {
        append('error', 'listing fee not yet loaded — wait a moment and try again');
        return;
      }

      setBusy(true);
      try {
        append('info', `building listService("${name}", …, ${CATEGORIES[category]}) …`);
        const signerContract = await getSignerContract();

        append('info', `submitting tx (${ethers.formatEther(fee)} ETH fee) — MetaMask will prompt`);
        const tx = await signerContract.listService(
          name.trim(),
          description.trim(),
          endpoint.trim(),
          category,
          { value: fee },
        );
        append('info', `tx submitted: ${tx.hash} — awaiting receipt…`);

        const rc = await tx.wait();
        if (!rc) throw new Error('no receipt');
        append('ok', `mined in block ${rc.blockNumber}`);

        // Pull serviceId from ServiceListed event.
        let serviceId: bigint | undefined;
        for (const lg of rc.logs) {
          try {
            const parsed = signerContract.interface.parseLog({
              topics: [...lg.topics],
              data: lg.data,
            });
            if (parsed?.name === 'ServiceListed') {
              serviceId = parsed.args.serviceId as bigint;
              break;
            }
          } catch {
            /* not ours */
          }
        }
        if (serviceId === undefined) {
          throw new Error('ServiceListed event not found in receipt');
        }

        append('ok', `serviceId = ${serviceId.toString()}`);
        setOutcome({
          serviceId,
          txHash: tx.hash as string,
          blockNumber: rc.blockNumber,
        });
      } catch (e) {
        append('error', `listService failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [account, chainOk, name, description, endpoint, category, fee, getSignerContract, append],
  );

  const onCopy = useCallback(() => {
    if (!outcome) return;
    void navigator.clipboard.writeText(outcome.serviceId.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [outcome]);

  // ── wallet gate ────────────────────────────────────────────────
  if (!account) {
    return (
      <section className="page page--gate">
        <div className="gate">
          <div className="gate__eyebrow mono">// list a new service</div>
          <h1 className="gate__title">Connect wallet to continue</h1>
          <p className="gate__desc">
            Your wallet signs the listing transaction and pays the listing fee.
          </p>
          <button className="btn btn--primary btn--cta" onClick={connect} disabled={connecting}>
            {connecting ? 'connecting…' : 'connect wallet'}
          </button>
        </div>
      </section>
    );
  }

  // ── success state ──────────────────────────────────────────────
  if (outcome) {
    return (
      <section className="page service-detail">
        <Link to="/provider" className="back-link mono">
          ← provider dashboard
        </Link>

        <header className="page__head">
          <div className="page__eyebrow mono">// service listed · success</div>
          <h1 className="page__title">
            Service #{outcome.serviceId.toString()} is live
          </h1>
          <p className="page__desc">
            On-chain and discoverable. Save the service id — developers
            will need it to register, and the marketplace browse page will
            link to it automatically.
          </p>
        </header>

        <div className="detail-grid">
          <div className="detail-row">
            <div className="detail-row__k mono">service_id</div>
            <div className="detail-row__v mono service-detail__copy">
              {outcome.serviceId.toString()}
              <button className="btn btn--ghost btn--small" onClick={onCopy}>
                {copied ? 'copied ✓' : 'copy'}
              </button>
            </div>
          </div>
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
        </div>

        <div className="service-detail__actions">
          <button
            className="btn btn--primary btn--cta"
            onClick={() => navigate(`/service/${outcome.serviceId.toString()}`)}
          >
            view service detail →
          </button>
          <Link to="/provider" className="btn btn--cta">
            back to dashboard
          </Link>
        </div>
      </section>
    );
  }

  // ── form ───────────────────────────────────────────────────────
  return (
    <section className="page">
      <Link to="/provider" className="back-link mono">
        ← provider dashboard
      </Link>

      <header className="page__head">
        <div className="page__eyebrow mono">// list a new service</div>
        <h1 className="page__title">List a service</h1>
        <p className="page__desc">
          Name and category are immutable after listing. Endpoint and
          description can be edited later. Listing fee:{' '}
          <span className="mono">
            {fee == null ? '…' : `${ethers.formatEther(fee)} ETH`}
          </span>{' '}
          (one-time).
        </p>
      </header>

      {marketError && (
        <div className="alert alert--err mono">
          <span className="alert__k">deployments.json</span> · {marketError}
        </div>
      )}

      <form className="form" onSubmit={onSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="service-name">name</label>
          <input
            id="service-name"
            className="field__input mono"
            type="text"
            placeholder="e.g. FactGen"
            spellCheck={false}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            required
            maxLength={64}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="service-description">description</label>
          <textarea
            id="service-description"
            className="field__input mono form__textarea"
            placeholder="what does this API do?"
            spellCheck={false}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
            maxLength={500}
          />
          <div className="field__hint mono">
            // {description.length}/500 — short, plain, descriptive.
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="service-endpoint">endpoint</label>
          <input
            id="service-endpoint"
            className="field__input mono"
            type="text"
            placeholder="https://your-api.example.dev"
            spellCheck={false}
            autoComplete="off"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            disabled={busy}
          />
          <div className="field__hint mono">
            // editable later via setServiceEndpoint
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="service-category">category</label>
          <select
            id="service-category"
            className="field__input mono form__select"
            value={category}
            onChange={(e) => setCategory(Number(e.target.value))}
            disabled={busy}
          >
            {CATEGORIES.map((c, i) => (
              <option key={c} value={i}>
                {c}
              </option>
            ))}
          </select>
          <div className="field__hint mono">// immutable after listing</div>
        </div>

        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary btn--cta"
            disabled={busy || !chainOk || fee == null}
          >
            {busy
              ? 'working…'
              : `list service · ${fee == null ? '…' : ethers.formatEther(fee)} ETH`}
          </button>
          <Link to="/provider" className="btn btn--cta">
            cancel
          </Link>
        </div>
      </form>

      <div className="form__log">
        <StatusLog entries={log} tone="cool" />
      </div>
    </section>
  );
}
