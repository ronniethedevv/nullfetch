import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventLog } from 'ethers';
import { useWallet } from '../hooks/WalletContext';
import { useMarketplace } from '../hooks/useMarketplace';
import { ServiceCard } from '../components/ServiceCard';
import { normalizeService, type Service, type RawServiceTuple } from '../types';

export function Provider() {
  const { account, connect, connecting } = useWallet();
  const { contract, error: marketError } = useMarketplace();

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!contract || !account) return;
    setLoading(true);
    setLoadError(null);
    try {
      // ServiceListed event is indexed by (serviceId, provider, category).
      // Filter by provider so we only get logs for services owned by the
      // connected wallet — no client-side filtering needed.
      const filter = contract.filters.ServiceListed(null, account);
      const events = (await contract.queryFilter(filter, 0, 'latest')) as EventLog[];
      const ids = events.map((e) => e.args.serviceId as bigint);

      // For each event, re-read current state — description / endpoint
      // / active flag / subscriberCount may have changed since listing.
      const fetched = await Promise.all(
        ids.map(async (id) => {
          const raw = (await contract.getService(id)) as RawServiceTuple;
          return normalizeService(id, raw);
        }),
      );

      // Sort newest first by id (events were chronological).
      fetched.sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
      setServices(fetched);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [contract, account]);

  useEffect(() => {
    load();
  }, [load]);

  // ── wallet gate ────────────────────────────────────────────────────
  if (!account) {
    return (
      <section className="page page--gate">
        <div className="gate">
          <div className="gate__eyebrow mono">// provider dashboard</div>
          <h1 className="gate__title">Connect wallet to continue</h1>
          <p className="gate__desc">
            The provider dashboard reads your wallet to look up services
            you own and accept signatures for new listings.
          </p>
          <button
            className="btn btn--primary btn--cta"
            onClick={connect}
            disabled={connecting}
          >
            {connecting ? 'connecting…' : 'connect wallet'}
          </button>
        </div>
      </section>
    );
  }

  const totalSubs = services.reduce(
    (acc, s) => acc + Number(s.subscriberCount),
    0,
  );
  const activeCount = services.filter((s) => s.active).length;

  return (
    <section className="page">
      <header className="page__head">
        <div className="page__eyebrow mono">// provider · your services</div>
        <h1 className="page__title">Provider dashboard</h1>
        <p className="page__desc">
          Services owned by <span className="mono">{account.slice(0, 6)}…{account.slice(-4)}</span>.
          Click any card to manage subscribers, edit endpoint, or set
          inactive.
        </p>
      </header>

      <div className="stats-bar">
        <div className="stat">
          <div className="stat__k mono">services</div>
          <div className="stat__v mono">{services.length}</div>
        </div>
        <div className="stat">
          <div className="stat__k mono">active</div>
          <div className="stat__v mono">{activeCount}</div>
        </div>
        <div className="stat">
          <div className="stat__k mono">total_subs</div>
          <div className="stat__v mono">{totalSubs}</div>
        </div>
        <div className="stats-bar__spacer" />
        <Link to="/provider/new" className="btn btn--primary btn--cta">
          + list new service
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

      {loading && services.length === 0 && (
        <div className="browse__empty mono">// loading your services…</div>
      )}

      {!loading && services.length === 0 && !loadError && (
        <div className="browse__empty mono">
          // you haven&apos;t listed any services yet
        </div>
      )}

      {services.length > 0 && (
        <div className="service-grid">
          {services.map((s) => (
            <Link
              key={s.id.toString()}
              to={`/provider/service/${s.id.toString()}`}
              className="service-card-wrap"
            >
              <ServiceCard service={s} />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
