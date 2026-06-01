import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EventLog } from 'ethers';
import { CATEGORIES } from '../abi';
import { useWallet } from '../hooks/WalletContext';
import { useMarketplace } from '../hooks/useMarketplace';
import { StatusLog, type LogEntry } from '../components/StatusLog';
import { normalizeService, type Service, type RawServiceTuple } from '../types';

interface SubscriberRow {
  address: string;
  exists: boolean;
  revoked: boolean;
  registeredAt: bigint;
  callCount: bigint;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function ProviderService() {
  const { id } = useParams<{ id: string }>();
  const { account, chainOk, connect, connecting } = useWallet();
  const { contract, getSignerContract, error: marketError } = useMarketplace();

  const [service, setService] = useState<Service | null>(null);
  const [subscribers, setSubscribers] = useState<SubscriberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);

  const [endpointDraft, setEndpointDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const append = useCallback(
    (level: LogEntry['level'], msg: string) =>
      setLog((l) => [...l, { ts: Date.now(), level, msg }]),
    [],
  );

  // ── load service + subscribers ─────────────────────────────────
  const load = useCallback(async () => {
    if (!contract || !id) return;
    setLoading(true);
    setReadError(null);
    try {
      const serviceId = BigInt(id);
      const raw = (await contract.getService(serviceId)) as RawServiceTuple;
      const s = normalizeService(serviceId, raw);
      setService(s);
      setEndpointDraft(s.endpoint);
      setDescDraft(s.description);

      // Subscribed events for this service id.
      const filter = contract.filters.Subscribed(serviceId, null);
      const events = (await contract.queryFilter(filter, 0, 'latest')) as EventLog[];
      const seen = new Set<string>();
      const addrs: string[] = [];
      for (const ev of events) {
        const a = (ev.args.developer as string).toLowerCase();
        if (!seen.has(a)) {
          seen.add(a);
          addrs.push(ev.args.developer as string);
        }
      }

      const subs: SubscriberRow[] = await Promise.all(
        addrs.map(async (addr) => {
          const r = (await contract.getSubscription(serviceId, addr)) as [
            boolean,
            boolean,
            bigint,
            bigint,
          ];
          return {
            address: addr,
            exists: r[0],
            revoked: r[1],
            registeredAt: r[2],
            callCount: r[3],
          };
        }),
      );
      // Filter out subs that don't exist (shouldn't happen, but defensive).
      setSubscribers(subs.filter((s) => s.exists));
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [contract, id]);

  useEffect(() => {
    load();
  }, [load]);

  // ── action helpers ─────────────────────────────────────────────
  async function runAction<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    if (!chainOk) {
      append('error', 'wrong network — switch to Sepolia first');
      return null;
    }
    setBusyAction(label);
    append('info', `${label}: submitting…`);
    try {
      const result = await fn();
      append('ok', `${label}: done`);
      await load();
      return result;
    } catch (e) {
      append('error', `${label}: ${(e as Error).message}`);
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  const onSaveEndpoint = useCallback(async () => {
    if (!service) return;
    if (endpointDraft.trim() === service.endpoint) {
      append('info', 'endpoint unchanged — nothing to save');
      return;
    }
    await runAction('setServiceEndpoint', async () => {
      const c = await getSignerContract();
      const tx = await c.setServiceEndpoint(service.id, endpointDraft.trim());
      await tx.wait();
    });
  }, [service, endpointDraft, getSignerContract, append]);

  const onSaveDescription = useCallback(async () => {
    if (!service) return;
    if (descDraft.trim() === service.description) {
      append('info', 'description unchanged — nothing to save');
      return;
    }
    await runAction('setServiceDescription', async () => {
      const c = await getSignerContract();
      const tx = await c.setServiceDescription(service.id, descDraft.trim());
      await tx.wait();
    });
  }, [service, descDraft, getSignerContract, append]);

  const onToggleActive = useCallback(async () => {
    if (!service) return;
    const next = !service.active;
    await runAction(`setServiceActive(${next})`, async () => {
      const c = await getSignerContract();
      const tx = await c.setServiceActive(service.id, next);
      await tx.wait();
    });
  }, [service, getSignerContract]);

  const onRevoke = useCallback(
    async (devAddr: string) => {
      if (!service) return;
      if (
        !confirm(
          `Revoke ${shortAddr(devAddr)}? They will be unable to verify or attest against service #${service.id.toString()}. Irreversible — they have to re-register if you want them back in.`,
        )
      )
        return;
      await runAction(`revokeSubscription(${shortAddr(devAddr)})`, async () => {
        const c = await getSignerContract();
        const tx = await c.revokeSubscription(service.id, devAddr);
        await tx.wait();
      });
    },
    [service, getSignerContract],
  );

  // ── gates ──────────────────────────────────────────────────────
  if (!account) {
    return (
      <section className="page page--gate">
        <div className="gate">
          <div className="gate__eyebrow mono">// service management</div>
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
        <Link to="/provider" className="back-link mono">
          ← provider dashboard
        </Link>
        <div className="alert alert--err mono">
          <span className="alert__k">service #{id}</span> · {readError ?? 'not found'}
        </div>
      </section>
    );
  }

  const isProvider = account.toLowerCase() === service.provider.toLowerCase();
  if (!isProvider) {
    return (
      <section className="page">
        <Link to="/provider" className="back-link mono">
          ← provider dashboard
        </Link>
        <div className="alert alert--err mono">
          <span className="alert__k">access denied</span> · this wallet is not the provider of service #{service.id.toString()}.
        </div>
      </section>
    );
  }

  const categoryName = CATEGORIES[service.category] ?? 'Other';
  const activeSubs = subscribers.filter((s) => !s.revoked);
  const revokedSubs = subscribers.filter((s) => s.revoked);

  return (
    <section className="page service-detail">
      <Link to="/provider" className="back-link mono">
        ← provider dashboard
      </Link>

      <header className="page__head">
        <div className="page__eyebrow mono">
          // manage · service #{service.id.toString()} · {categoryName}
          {!service.active && (
            <span className="service-detail__head-off"> · inactive</span>
          )}
        </div>
        <h1 className="page__title">{service.name}</h1>
      </header>

      {/* ── editable fields ───────────────────────────────────────── */}
      <div className="form">
        <div className="field">
          <label className="field__label" htmlFor="edit-desc">description</label>
          <textarea
            id="edit-desc"
            className="field__input mono form__textarea"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            disabled={busyAction !== null}
            rows={3}
            maxLength={500}
          />
          <div className="form__inline-actions">
            <button
              className="btn"
              onClick={onSaveDescription}
              disabled={
                busyAction !== null ||
                descDraft.trim() === service.description
              }
            >
              {busyAction === 'setServiceDescription' ? 'saving…' : 'save description'}
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="edit-endpoint">endpoint</label>
          <input
            id="edit-endpoint"
            className="field__input mono"
            type="text"
            value={endpointDraft}
            onChange={(e) => setEndpointDraft(e.target.value)}
            disabled={busyAction !== null}
          />
          <div className="form__inline-actions">
            <button
              className="btn"
              onClick={onSaveEndpoint}
              disabled={
                busyAction !== null ||
                endpointDraft.trim() === service.endpoint
              }
            >
              {busyAction === 'setServiceEndpoint' ? 'saving…' : 'save endpoint'}
            </button>
          </div>
        </div>

        <div className="field">
          <div className="field__label">service status</div>
          <div className="form__inline-actions form__inline-actions--gap">
            <span className={`status-tag mono ${service.active ? 'status-tag--ok' : 'status-tag--off'}`}>
              {service.active ? 'active' : 'inactive'}
            </span>
            <button
              className="btn"
              onClick={onToggleActive}
              disabled={busyAction !== null}
            >
              {busyAction?.startsWith('setServiceActive')
                ? 'updating…'
                : service.active
                  ? 'set inactive'
                  : 'set active'}
            </button>
            <span className="field__hint mono">
              // inactive services reject new registrations but existing subs still verify
            </span>
          </div>
        </div>
      </div>

      {/* ── subscribers ───────────────────────────────────────────── */}
      <header className="page__head" style={{ marginTop: 32 }}>
        <div className="page__eyebrow mono">
          // subscribers · {activeSubs.length} active
          {revokedSubs.length > 0 ? ` · ${revokedSubs.length} revoked` : ''}
        </div>
        <h2 className="page__title" style={{ fontSize: 20 }}>
          Subscriber list
        </h2>
      </header>

      {subscribers.length === 0 && (
        <div className="browse__empty mono">
          // no subscribers yet — share the service id with developers
        </div>
      )}

      {subscribers.length > 0 && (
        <div className="sub-table">
          <div className="sub-table__head mono">
            <div>address</div>
            <div>registered</div>
            <div>calls</div>
            <div>status</div>
            <div></div>
          </div>
          {subscribers.map((s) => (
            <div key={s.address} className="sub-table__row">
              <div className="mono">
                <a
                  href={`https://sepolia.etherscan.io/address/${s.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {shortAddr(s.address)}
                </a>
              </div>
              <div className="mono">
                {new Date(Number(s.registeredAt) * 1000).toISOString().slice(0, 10)}
              </div>
              <div className="mono">{s.callCount.toString()}</div>
              <div className="mono">
                {s.revoked ? (
                  <span className="status-tag status-tag--off">revoked</span>
                ) : (
                  <span className="status-tag status-tag--ok">active</span>
                )}
              </div>
              <div>
                {!s.revoked && (
                  <button
                    className="btn btn--small"
                    onClick={() => onRevoke(s.address)}
                    disabled={busyAction !== null}
                  >
                    revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="form__log">
        <StatusLog entries={log} tone="cool" />
      </div>
    </section>
  );
}
