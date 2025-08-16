'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@/lib/supabaseClient';

/** ---------- Types (adjust if your columns differ) ---------- */
type VehicleRow = {
  id: string | number;
  year: number | null;
  make: string | null;
  model: string | null;
  sub_model: string | null;       // Variant
  vin: string | null;
  odometer: string | number | null;
  wovr_status: string | null;
  incident_type: string | null;   // Damage
  sale_status: string | null;     // Outcome
  sold_price: number | null;      // Amount
  sold_date: string | null;       // Date
  auction_house: string | null;   // House
  buyer_number: string | null;    // Buyer
  state: string | null;
};

/** Small helpers */
const formatMoney = (n: number | null | undefined) =>
  typeof n === 'number' ? `$${n.toLocaleString()}` : '—';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';

/** ---------- The Page ---------- */
export default function SearchPage() {
  const supabase = useMemo(createBrowserClient, []);

  /** Filters */
  const [vin, setVin] = useState('');
  const [buyer, setBuyer] = useState('');
  const [make, setMake] = useState('All');
  const [model, setModel] = useState('All');
  const [yearFrom, setYearFrom] = useState<string>('');
  const [yearTo, setYearTo] = useState<string>('');
  const [wovr, setWovr] = useState('All');
  const [saleStatus, setSaleStatus] = useState('All');
  const [damage, setDamage] = useState('All');
  const [priceMin, setPriceMin] = useState<string>('');
  const [auctionHouse, setAuctionHouse] = useState('All');
  const [state, setState] = useState('All');

  /** Options for the dropdowns */
  const [optMake, setOptMake] = useState<string[]>([]);
  const [optModel, setOptModel] = useState<string[]>([]);
  const [optWovr, setOptWovr] = useState<string[]>([]);
  const [optSale, setOptSale] = useState<string[]>([]);
  const [optDamage, setOptDamage] = useState<string[]>([]);
  const [optAuction, setOptAuction] = useState<string[]>([]);
  const [optState, setOptState] = useState<string[]>([]);

  /** Results & pagination */
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** ----------- Options loading (unique values) ----------- */
  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      // Helper: load unique values for a column
      const uniq = async (column: string) => {
        const { data, error } = await supabase
          .from('vehicles')
          .select(column)
          .not(column, 'is', null)
          .neq(column, '')
          .order(column, { ascending: true });

        if (error) throw error;
        const s = new Set<string>();
        (data as any[]).forEach((r) => r[column] && s.add(String(r[column])));
        return Array.from(s);
      };

      try {
        const [mks, mdls, wv, ss, dmg, auc, st] = await Promise.all([
          uniq('make'),
          uniq('model'),
          uniq('wovr_status'),
          uniq('sale_status'),
          uniq('incident_type'),
          uniq('auction_house'),
          uniq('state'),
        ]);
        if (cancelled) return;
        setOptMake(mks);
        setOptModel(mdls);
        setOptWovr(wv);
        setOptSale(ss);
        setOptDamage(dmg);
        setOptAuction(auc);
        setOptState(st);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Failed loading options.');
      }
    }

    loadOptions();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ----------- Query data ----------- */
  const fetchData = async (resetPage = false) => {
    try {
      setLoading(true);
      setError(null);
      if (resetPage) setPage(1);

      const from = (resetPage ? 0 : (page - 1) * pageSize);
      const to = from + pageSize - 1;

      let q = supabase
        .from('vehicles')
        .select(
          [
            'id', 'year', 'make', 'model', 'sub_model',
            'vin', 'odometer', 'wovr_status', 'incident_type',
            'sale_status', 'sold_price', 'sold_date',
            'auction_house', 'buyer_number', 'state',
          ].join(','),
          { count: 'exact' }
        )
        .order('sold_date', { ascending: false, nullsFirst: false })
        .range(from, to);

      // Apply filters
      if (vin.trim()) {
        // case-insensitive exact match (ilike without % wildcards)
        q = q.filter('vin', 'ilike', vin.trim());
      }
      if (buyer.trim()) q = q.eq('buyer_number', buyer.trim());
      if (make !== 'All') q = q.eq('make', make);
      if (model !== 'All') q = q.eq('model', model);
      if (wovr !== 'All') q = q.eq('wovr_status', wovr);
      if (saleStatus !== 'All') q = q.eq('sale_status', saleStatus);
      if (damage !== 'All') q = q.eq('incident_type', damage);
      if (auctionHouse !== 'All') q = q.eq('auction_house', auctionHouse);
      if (state !== 'All') q = q.eq('state', state);
      if (yearFrom) q = q.gte('year', Number(yearFrom));
      if (yearTo) q = q.lte('year', Number(yearTo));
      if (priceMin) q = q.gte('sold_price', Number(priceMin));

      const { data, error, count } = await q;
      if (error) throw error;

      setRows((data || []) as VehicleRow[]);
      setTotal(count || 0);
    } catch (e: any) {
      setError(e.message ?? 'Search failed.');
    } finally {
      setLoading(false);
    }
  };

  // Initial search once options load
  useEffect(() => {
    if (optMake.length || optModel.length) fetchData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optMake.length, optModel.length]);

  // Re-run when page/pageSize changes
  useEffect(() => {
    fetchData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  /** UI handlers */
  const onSearch = () => fetchData(true);
  const onClear = () => {
    setVin('');
    setBuyer('');
    setMake('All');
    setModel('All');
    setYearFrom('');
    setYearTo('');
    setWovr('All');
    setSaleStatus('All');
    setDamage('All');
    setPriceMin('');
    setAuctionHouse('All');
    setState('All');
    setPage(1);
    fetchData(true);
  };
  const nextPage = () =>
    setPage((p) => (p < Math.max(1, Math.ceil(total / pageSize)) ? p + 1 : p));
  const prevPage = () =>
    setPage((p) => (p > 1 ? p - 1 : p));

  /** --------------- RENDER --------------- */
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      {/* PAGE HEADER */}
      <header className="pt-6 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">WreckWatch Search</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Search Australian auction results by VIN, buyer number, make, model and more.
            </p>
          </div>
          <div className="flex items-center gap-2">{/* space for future quick actions */}</div>
        </div>
      </header>

      {/* FILTERS CARD */}
      <section className="rounded-xl border border-border bg-card/60 shadow-sm backdrop-blur-sm supports-[backdrop-filter]:bg-card/70">
        <div className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">Filters</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* VIN */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">VIN (exact)</label>
              <input
                value={vin}
                onChange={(e) => setVin(e.target.value)}
                placeholder="e.g. MR0FZ22G401062065"
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              />
            </div>

            {/* Buyer number */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Buyer number (exact)</label>
              <input
                value={buyer}
                onChange={(e) => setBuyer(e.target.value)}
                placeholder="e.g. B12345"
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              />
            </div>

            {/* Make */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Make</label>
              <select
                value={make}
                onChange={(e) => setMake(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              >
                <option>All</option>
                {optMake.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            {/* Model */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              >
                <option>All</option>
                {optModel.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            {/* Year From */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Year (From)</label>
              <input
                type="number"
                value={yearFrom}
                onChange={(e) => setYearFrom(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              />
            </div>

            {/* Year To */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Year (To)</label>
              <input
                type="number"
                value={yearTo}
                onChange={(e) => setYearTo(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              />
            </div>

            {/* WOVR */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">WOVR Status</label>
              <select
                value={wovr}
                onChange={(e) => setWovr(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              >
                <option>All</option>
                {optWovr.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            {/* Sale Status */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Sale Status</label>
              <select
                value={saleStatus}
                onChange={(e) => setSaleStatus(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              >
                <option>All</option>
                {optSale.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            {/* Damage */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Damage</label>
              <select
                value={damage}
                onChange={(e) => setDamage(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              >
                <option>All</option>
                {optDamage.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            {/* Price Min */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Price Min</label>
              <input
                type="number"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              />
            </div>

            {/* Auction House */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Auction House</label>
              <select
                value={auctionHouse}
                onChange={(e) => setAuctionHouse(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              >
                <option>All</option>
                {optAuction.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            {/* State */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">State</label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
              >
                <option>All</option>
                {optState.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Sticky action row */}
        <div className="sticky bottom-0 z-[1] border-t border-border bg-card/80 px-4 py-3 sm:px-5">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClear}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onSearch}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Search
            </button>
          </div>
        </div>
      </section>

      {/* RESULTS TOOLBAR */}
      <section className="mt-6 mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Results</span>
          <span className="inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 text-xs">
            {total.toLocaleString()} items
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="pageSize">page size</label>
          <select
            id="pageSize"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm"
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>

          <button
            onClick={prevPage}
            disabled={page === 1 || loading}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>

          <span className="text-xs text-muted-foreground">
            {page} / {Math.max(1, Math.ceil(total / pageSize))}
          </span>

          <button
            onClick={nextPage}
            disabled={page >= Math.ceil(total / pageSize) || loading}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </section>

      {/* Loading / Error */}
      {loading && (
        <div className="mt-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          Searching…
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* TABLE */}
      <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-[var(--appbar-h)] z-10 bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="w-[72px] px-3 py-2">Year</th>
              <th className="w-[120px] px-3 py-2">Make</th>
              <th className="w-[140px] px-3 py-2">Model</th>
              <th className="w-[280px] px-3 py-2">Variant</th>
              <th className="w-[190px] px-3 py-2">VIN</th>
              <th className="w-[120px] px-3 py-2 text-right">ODO</th>
              <th className="w-[120px] px-3 py-2">WOVR</th>
              <th className="w-[110px] px-3 py-2">Damage</th>
              <th className="w-[120px] px-3 py-2">Outcome</th>
              <th className="w-[110px] px-3 py-2 text-right">Amount</th>
              <th className="w-[120px] px-3 py-2">Date</th>
              <th className="w-[120px] px-3 py-2">House</th>
              <th className="w-[100px] px-3 py-2">Buyer</th>
              <th className="w-[80px] px-3 py-2">State</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No results. Adjust your filters and try again.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">{r.year ?? '—'}</td>
                  <td className="px-3 py-2">{r.make ?? '—'}</td>
                  <td className="px-3 py-2">{r.model ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="line-clamp-1">{r.sub_model ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs tracking-tight whitespace-nowrap">
                      {r.vin ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.odometer ?? '—'}
                  </td>
                  <td className="px-3 py-2">{r.wovr_status ?? '—'}</td>
                  <td className="px-3 py-2">{r.incident_type ?? '—'}</td>
                  <td className="px-3 py-2">{r.sale_status ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {formatMoney(r.sold_price)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDate(r.sold_date)}
                  </td>
                  <td className="px-3 py-2">{r.auction_house ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.buyer_number ?? '—'}</td>
                  <td className="px-3 py-2">{r.state ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="h-6" />
    </div>
  );
}
