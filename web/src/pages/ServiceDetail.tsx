import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CATEGORIES } from '../abi';
import { useMarketplace } from '../hooks/useMarketplace';
import { useWallet } from '../hooks/WalletContext';
import { normalizeService, type Service, type RawServiceTuple } from '../types';

const SEPOLIA_ETHERSCAN = 'https://sepolia.etherscan.io';

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function relativeTime(unix: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(unix);
  const delta = now - ts;
  if (delta < 60) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 30 * 86400) return `${Math.floor(delta / 86400)}d ago`;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { contract, error: marketError } = useMarketplace();
  const { account } = useWallet();

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!contract || !id) return;
    setLoading(true);
    setError(null);
    try {
      const raw = (await contract.getService(BigInt(id))) as RawServiceTuple;
      setService(normalizeService(BigInt(id), raw));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [contract, id]);

  useEffect(() => {
    load();
  }, [load]);

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

  if (error || !service) {
    return (
      <section className="page">
        <div className="alert alert--err mono">
          <span className="alert__k">service #{id}</span> ·{' '}
          {error ?? 'not found'}
        </div>
        <Link to="/browse" className="back-link mono">
          ← back to marketplace
        </Link>
      </section>
    );
  }

  const categoryName = CATEGORIES[service.category] ?? 'Other';
  const isProvider = account?.toLowerCase() === service.provider.toLowerCase();

  return (
    <section className="page service-detail">
      <Link to="/browse" className="back-link mono">
        ← marketplace
      </Link>

      <header className="page__head">
        <div className="page__eyebrow mono">
          // service · #{service.id.toString()}
          <span className="service-detail__head-cat">
            <span className="service-detail__sep">·</span>
            {categoryName}
          </span>
          {!service.active && (
            <span className="service-detail__head-off">· inactive</span>
          )}
        </div>
        <h1 className="page__title">{service.name}</h1>
        {service.description && (
          <p className="page__desc service-detail__desc">{service.description}</p>
        )}
      </header>

      <div className="detail-grid">
        <div className="detail-row">
          <div className="detail-row__k mono">provider</div>
          <div className="detail-row__v">
            <a
              href={`${SEPOLIA_ETHERSCAN}/address/${service.provider}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mono"
            >
              {shortAddr(service.provider)}
            </a>
            {isProvider && (
              <span className="detail-row__tag mono">you own this</span>
            )}
          </div>
        </div>

        <div className="detail-row">
          <div className="detail-row__k mono">endpoint</div>
          <div className="detail-row__v mono">
            {service.endpoint || (
              <span className="detail-row__faint">— not set</span>
            )}
          </div>
        </div>

        <div className="detail-row">
          <div className="detail-row__k mono">category</div>
          <div className="detail-row__v mono">{categoryName}</div>
        </div>

        <div className="detail-row">
          <div className="detail-row__k mono">subscribers</div>
          <div className="detail-row__v mono">
            {service.subscriberCount.toString()}
          </div>
        </div>

        <div className="detail-row">
          <div className="detail-row__k mono">created</div>
          <div className="detail-row__v mono">
            {relativeTime(service.createdAt)}
          </div>
        </div>

        <div className="detail-row">
          <div className="detail-row__k mono">status</div>
          <div className="detail-row__v mono">
            {service.active ? (
              <span className="detail-row__ok">active</span>
            ) : (
              <span className="detail-row__off">inactive</span>
            )}
          </div>
        </div>
      </div>

      <div className="service-detail__actions">
        {isProvider ? (
          <Link to="/provider" className="btn btn--primary btn--cta">
            manage in provider dashboard
          </Link>
        ) : service.active ? (
          <Link
            to={`/developer/register/${service.id.toString()}`}
            className="btn btn--primary btn--cta"
          >
            register for this service
          </Link>
        ) : (
          <Link to="/developer" className="btn btn--cta">
            service inactive — visit dashboard
          </Link>
        )}
        <Link to="/browse" className="btn btn--cta">
          back to browse
        </Link>
      </div>
    </section>
  );
}
