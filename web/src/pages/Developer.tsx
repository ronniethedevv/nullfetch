import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventLog } from 'ethers';
import { CATEGORIES } from '../abi';
import { useWallet } from '../hooks/WalletContext';
import { useMarketplace } from '../hooks/useMarketplace';
import { normalizeService, type Service, type RawServiceTuple } from '../types';

interface Subscription {
  service: Service;
  exists: boolean;
  revoked: boolean;
  registeredAt: bigint;
  callCount: bigint;
}

export function Developer() {
  const { account, connect, connecting } = useWallet();
  const { contract, error: marketError } = useMarketplace();

  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!contract || !account) return;
    setLoading(true);
    setLoadError(null);
    try {
      // Subscribed events for this developer across every service.
      const filter = contract.filters.Subscribed(null, account);
      const events = (await contract.queryFilter(filter, 0, 'latest')) as EventLog[];
      const ids = events.map((e) => e.args.serviceId as bigint);
      const seen = new Set<string>();
      const unique = ids.filter((id) => {
        const k = id.toString();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const loaded = await Promise.all(
        unique.map(async (id) => {
          const [rawService, rawSub] = await Promise.all([
            contract.getService(id) as Promise<RawServiceTuple>,
            contract.getSubscription(id, account) as Promise<[boolean, boolean, bigint, bigint]>,
          ]);
          return {
            service: normalizeService(id, rawService),
            exists: rawSub[0],
            revoked: rawSub[1],
            registeredAt: rawSub[2],
            callCount: rawSub[3],
          } as Subscription;
        }),
      );

      // Filter out subs that don't exist (defensive — shouldn't happen).
      const real = loaded.filter((s) => s.exists);
      // Sort: active first, then revoked. Within each, newest registered first.
      real.sort((a, b) => {
        if (a.revoked !== b.revoked) return a.revoked ? 1 : -1;
        if (a.registeredAt > b.registeredAt) return -1;
        if (a.registeredAt < b.registeredAt) return 1;
        return 0;
      });
      setSubs(real);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [contract, account]);

  useEffect(() => {
    load();
  }, [load]);

  if (!account) {
    return (
      <section className="page page--gate">
        <div className="gate">
          <div className="gate__eyebrow mono">// developer dashboard</div>
          <h1 className="gate__title">Connect wallet to continue</h1>
          <p className="gate__desc">
            The developer dashboard shows the services you&rsquo;ve registered
            for and lets you authenticate against their APIs.
          </p>
          <button className="btn btn--primary btn--cta" onClick={connect} disabled={connecting}>
            {connecting ? 'connecting…' : 'connect wallet'}
          </button>
        </div>
      </section>
    );
  }

  const activeCount = subs.filter((s) => !s.revoked).length;
  const revokedCount = subs.length - activeCount;

  return (
    <section className="page">
      <header className="page__head">
        <div className="page__eyebrow mono">// developer · your subscriptions</div>
        <h1 className="page__title">Developer dashboard</h1>
        <p className="page__desc">
          API subscriptions held by{' '}
          <span className="mono">{account.slice(0, 6)}…{account.slice(-4)}</span>.
          Click any card to verify possession, attest on-chain, or call the
          provider&rsquo;s API.
        </p>
      </header>

      <div className="stats-bar">
        <div className="stat">
          <div className="stat__k mono">total</div>
          <div className="stat__v mono">{subs.length}</div>
        </div>
        <div className="stat">
          <div className="stat__k mono">active</div>
          <div className="stat__v mono">{activeCount}</div>
        </div>
        <div className="stat">
          <div className="stat__k mono">revoked</div>
          <div className="stat__v mono">{revokedCount}</div>
        </div>
        <div className="stats-bar__spacer" />
        <Link to="/browse" className="btn btn--primary btn--cta">
          browse marketplace
        </Link>
      </div>

      {marketError && (
        <div className="alert alert--err mono">
          <span className="alert__k">deployments.json</span> · {marketError}
        </div>
      )}
      {loadError && (
        <div className="alert alert--err mono">
          <span className="alert__k">read failed</span> · {loadError}
        </div>
      )}

      {loading && subs.length === 0 && (
        <div className="browse__empty mono">// loading your subscriptions…</div>
      )}

      {!loading && subs.length === 0 && !loadError && (
        <div className="browse__empty mono">
          // no subscriptions yet · <Link to="/browse">browse the marketplace</Link> to register for one
        </div>
      )}

      {subs.length > 0 && (
        <div className="sub-cards">
          {subs.map((sub) => {
            const cat = CATEGORIES[sub.service.category] ?? 'Other';
            return (
              <Link
                key={sub.service.id.toString()}
                to={`/developer/service/${sub.service.id.toString()}`}
                className={`sub-card ${sub.revoked ? 'sub-card--revoked' : ''}`}
              >
                <div className="sub-card__head mono">
                  <span className="sub-card__id">#{sub.service.id.toString()}</span>
                  <span className="sub-card__sep">·</span>
                  <span className="sub-card__cat">{cat}</span>
                  {sub.revoked ? (
                    <span className="status-tag status-tag--off sub-card__tag">revoked</span>
                  ) : sub.service.active ? (
                    <span className="status-tag status-tag--ok sub-card__tag">active</span>
                  ) : (
                    <span className="status-tag status-tag--off sub-card__tag">service off</span>
                  )}
                </div>
                <div className="sub-card__name">{sub.service.name}</div>
                <div className="sub-card__meta mono">
                  <span>
                    <span className="sub-card__k">registered</span>{' '}
                    {new Date(Number(sub.registeredAt) * 1000).toISOString().slice(0, 10)}
                  </span>
                  <span>
                    <span className="sub-card__k">calls</span> {sub.callCount.toString()}
                  </span>
                </div>
                <div className="sub-card__cta mono">
                  use this service →
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
