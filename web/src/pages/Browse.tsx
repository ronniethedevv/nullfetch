import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CATEGORIES, type CategoryName } from '../abi';
import { useMarketplace } from '../hooks/useMarketplace';
import { ServiceCard } from '../components/ServiceCard';
import { CategoryFilter } from '../components/CategoryFilter';
import { normalizeService, type Service, type RawServiceTuple } from '../types';

const PAGE_SIZE = 12;

/** Parse the ?category= query param into a CategoryName or 'all'. */
function readCategoryParam(p: URLSearchParams): CategoryName | 'all' {
  const raw = p.get('category');
  if (!raw) return 'all';
  const match = CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  return match ?? 'all';
}

export function Browse() {
  const { contract, error } = useMarketplace();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = readCategoryParam(searchParams);

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');

  // ── load services for the active category, starting from offset 0 ──
  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (!contract) return;
      setLoading(true);
      setLoadError(null);
      try {
        let ids: bigint[];
        let raws: RawServiceTuple[];
        if (activeCategory === 'all') {
          const res = (await contract.getServicesPage(offset, PAGE_SIZE)) as [
            bigint[],
            RawServiceTuple[],
          ];
          ids = res[0];
          raws = res[1];
        } else {
          const catIdx = CATEGORIES.indexOf(activeCategory);
          const res = (await contract.getServicesByCategory(
            catIdx,
            offset,
            PAGE_SIZE,
          )) as [bigint[], RawServiceTuple[]];
          ids = res[0];
          raws = res[1];
        }
        const page = ids.map((id, i) => normalizeService(id, raws[i]));
        setServices((prev) => (append ? [...prev, ...page] : page));
        setHasMore(page.length === PAGE_SIZE);
      } catch (e) {
        setLoadError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [contract, activeCategory],
  );

  useEffect(() => {
    setServices([]);
    setHasMore(false);
    loadPage(0, false);
  }, [loadPage]);

  // ── client-side name filter applied on top of the loaded set ───────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => s.name.toLowerCase().includes(q));
  }, [services, search]);

  const onChangeCategory = useCallback(
    (cat: CategoryName | 'all') => {
      const next = new URLSearchParams(searchParams);
      if (cat === 'all') next.delete('category');
      else next.set('category', cat);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  // ── empty states ────────────────────────────────────────────────────
  const emptyMessage = (() => {
    if (loading || services.length > 0 || loadError) return null;
    if (activeCategory !== 'all') {
      return `No services listed under ${activeCategory} yet.`;
    }
    return 'No services listed yet. Be the first to list one.';
  })();

  return (
    <section className="page browse">
      <header className="page__head">
        <div className="page__eyebrow mono">// marketplace · browse</div>
        <h1 className="page__title">Services</h1>
        <p className="page__desc">
          Every service listed on-chain. Reads come from the Marketplace
          contract directly — no wallet required, no backend in between.
        </p>
      </header>

      <CategoryFilter active={activeCategory} onChange={onChangeCategory} />

      <div className="browse__search">
        <input
          className="field__input mono"
          type="text"
          placeholder="search by name…"
          spellCheck={false}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="browse__count mono">
          {filtered.length} {filtered.length === 1 ? 'service' : 'services'}
          {search && services.length !== filtered.length
            ? ` (filtered from ${services.length})`
            : ''}
        </div>
      </div>

      {error && (
        <div className="alert alert--err mono">
          <span className="alert__k">deployments.json</span> · {error}
        </div>
      )}
      {loadError && (
        <div className="alert alert--err mono">
          <span className="alert__k">read failed</span> · {loadError}
        </div>
      )}

      <div className="service-grid">
        {filtered.map((s) => (
          <ServiceCard key={s.id.toString()} service={s} />
        ))}
      </div>

      {emptyMessage && (
        <div className="browse__empty mono">// {emptyMessage}</div>
      )}

      {search && filtered.length === 0 && services.length > 0 && (
        <div className="browse__empty mono">
          // no services match "{search}" in the loaded page
        </div>
      )}

      {loading && services.length === 0 && (
        <div className="browse__empty mono">// loading…</div>
      )}

      {hasMore && !loading && (
        <div className="browse__more">
          <button
            className="btn"
            onClick={() => loadPage(services.length, true)}
            disabled={loading}
          >
            load more
          </button>
        </div>
      )}
    </section>
  );
}
