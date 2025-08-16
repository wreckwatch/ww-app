'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient, PostgrestSingleResponse } from '@supabase/supabase-js';

/** ---------- Supabase client (browser) ---------- */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/** ---------- Types (adjust if your columns differ) ---------- */
type VehicleRow = {
  id: number;
  year: number | null;
  make: string | null;
  model: string | null;
  sub_model: string | null;        // Variant
  vin: string | null;
  odometer: number | null;         // ODO in km
  wovr_status: string | null;      // WOVR
  incident_type: string | null;    // Damage
  sale_status: string | null;      // Outcome
  sold_price: number | null;       // Amount
  sold_date: string | null;        // Date (ISO string)
  auction_house: string | null;    // House
  state: string | null;
  buyer_number: string | null;
};

/** Distinct option utility */
async function fetchDistinct<K extends keyof VehicleRow>(
  column: K,
  order: K
): Promise<string[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select(column as string)
    .not(column as string, 'is', null)
    .neq(column as string, '')
    .order(order as string, { ascending: true })
    .limit(1000);

  if (error || !data) return [];
  const vals = (data as any[]).map((r) => r[column]).filter(Boolean) as string[];
  return Array.from(new Set(vals));
}

/** ---------- Page component ---------- */
export default function SearchPage() {
  /** Filters */
  const [vin, setVin] = useState('');
  const [buyer, setBuyer] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');

  const [make, setMake] = useState('All');
  const [model, setModel] = useState('All');
  const [wovr, setWovr] = useState('All');
  const [saleStatus, setSaleStatus] = useState('All');
  const [auctionHouse, setAuctionHouse] = useState('All');
  const [damage, setDamage] = useState('All');
  const [state, setState] = useState('All');

  /** Dropdown options */
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [wovrs, setWovrs] = useState<string[]>([]);
  const [houses, setHouses] = useState<string[]>([]);
  const [damages, setDamages] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const saleStatuses = useMemo(() => ['All', 'SOLD', 'REFERRED', 'PASSED IN', 'WITHDRAWN'], []);

  /** Results + paging */
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** Load dropdowns once */
  useEffect(() => {
    (async () => {
      const [mk, md, wo, ho, da, st] = await Promise.all([
        fetchDistinct('make', 'make'),
        fetchDistinct('model', 'model'),
        fetchDistinct('wovr_status', 'wovr_status'),
        fetchDistinct('auction_house', 'auction_house'),
        fetchDistinct('incident_type', 'incident_type'),
        fetchDistinct('state', 'state'),
      ]);
      setMakes(['All', ...mk]);
      setModels(['All', ...md]);
      setWovrs(['All', ...wo]);
      setHouses(['All', ...ho]);
      setDamages(['All', ...da]);
      setStates(['All', ...st]);
    })();
  }, []);

  /** Build and run the search */
  async function runSearch(resetPage = false) {
    try {
      setLoading(true);
      setErr(null);

      const currentPage = resetPage ? 1 : page;
      const from = (currentPage - 1) * perPage;
      const to = from + perPage - 1;

      let q = supabase
        .from('vehicles')
        .select('*', { count: 'exact' })
        .order('sold_date', { ascending: false })
        .range(from, to);

      // VIN exact (case-insensitive)
      if (vin.trim()) q = q.ilike('vin', vin.trim().toUpperCase());

      // Buyer number exact
      if (buyer.trim()) q = q.eq('buyer_number', buyer.trim());

      if (make !== 'All') q = q.eq('make', make);
      if (model !== 'All') q = q.eq('model', model);
      if (wovr !== 'All') q = q.eq('wovr_status', wovr);
      if (saleStatus !== 'All') q = q.eq('sale_status', saleStatus);
      if (auctionHouse !== 'All') q = q.eq('auction_house', auctionHouse);
      if (damage !== 'All') q = q.eq('incident_type', damage);
      if (state !== 'All') q = q.eq('state', state);

      if (yearFrom) q = q.gte('year', Number(yearFrom));
      if (yearTo) q = q.lte('year', Number(yearTo));
      if (priceMin) q = q.gte('sold_price', Number(priceMin));
      if (priceMax) q = q.lte('sold_price', Number(priceMax));

      const { data, error, count } = (await q) as PostgrestSingleResponse<VehicleRow[]>;
      if (error) throw error;

      setRows(data || []);
      setTotal(count || 0);
      if (resetPage) setPage(1);
    } catch (e: any) {
      setErr(e.message || 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch(true); // initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Helpers */
  function clearAll() {
    setVin('');
    setBuyer('');
    setYearFrom('');
    setYearTo('');
    setPriceMin('');
    setPriceMax('');
    setMake('All');
    setModel('All');
    setWovr('All');
    setSaleStatus('All');
    setAuctionHouse('All');
    setDamage('All');
    setState('All');
    setPage(1);
    runSearch(true);
  }

  function nextPage() {
    if (page * perPage >= total) return;
    setPage((p) => p + 1);
  }
  function prevPage() {
    if (page === 1) return;
    setPage((p) => p - 1);
  }
  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage]);

  /** Mode toggle (light/dark) – optional */
  function toggleMode() {
    document.documentElement.classList.toggle('dark');
  }

  /** Formatters */
  const fmtMoney = (n: number | null) =>
    typeof n === 'number' ? n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }) : '—';
  const fmtKm = (n: number | null) => (typeof n === 'number' ? `${n.toLocaleString()} km` : '—');
  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-AU') : '—');

  return (
    <>
      {/* FULL-WIDTH WHITE HEADER WITH THIN BRAND ACCENT */}
      <header className="site-header">
        <div className="site-header__inner">
          <div className="brand">WreckWatch</div>
          <div className="header-actions">
            <button className="mode-pill" onClick={toggleMode} aria-label="Toggle theme">
              <span className="dot" /> Light / Dark
            </button>
          </div>
        </div>
      </header>

      {/* PAGE CONTENT SHELL */}
      <main className="page-shell">
        {/* Filters Card */}
        <section className="filters-card">
          <div className="filters-grid">
            {/* Row 1 */}
            <div className="form-group">
              <label>VIN (exact)</label>
              <input value={vin} onChange={(e) => setVin(e.target.value)} placeholder="e.g. MR0FZ22G401062065" />
            </div>
            <div className="form-group">
              <label>Buyer number (exact)</label>
              <input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="e.g. B12345" />
            </div>
            <div className="form-group">
              <label>Make</label>
              <select value={make} onChange={(e) => setMake(e.target.value)}>
                {makes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Model</label>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Row 2 */}
            <div className="form-group">
              <label>Year (From)</label>
              <input value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} placeholder="e.g. 2010" inputMode="numeric" />
            </div>
            <div className="form-group">
              <label>Year (To)</label>
              <input value={yearTo} onChange={(e) => setYearTo(e.target.value)} placeholder="e.g. 2025" inputMode="numeric" />
            </div>
            <div className="form-group">
              <label>WOVR Status</label>
              <select value={wovr} onChange={(e) => setWovr(e.target.value)}>
                {wovrs.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Sale Status</label>
              <select value={saleStatus} onChange={(e) => setSaleStatus(e.target.value)}>
                {saleStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Row 3 */}
            <div className="form-group">
              <label>Damage</label>
              <select value={damage} onChange={(e) => setDamage(e.target.value)}>
                {damages.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Price Min</label>
              <input value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="e.g. 5000" inputMode="numeric" />
            </div>
            <div className="form-group">
              <label>Price Max</label>
              <input value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="e.g. 50000" inputMode="numeric" />
            </div>
            <div className="form-group">
              <label>Auction House</label>
              <select value={auctionHouse} onChange={(e) => setAuctionHouse(e.target.value)}>
                {houses.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            {/* Row 4 */}
            <div className="form-group">
              <label>State</label>
              <select value={state} onChange={(e) => setState(e.target.value)}>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-actions">
              <button className="btn btn-primary" onClick={() => runSearch(true)} disabled={loading}>
                {loading ? 'Searching…' : 'Search'}
              </button>
              <button className="btn" onClick={clearAll} disabled={loading}>
                Clear
              </button>
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="results-card">
          <div className="results-top">
            <div className="muted">
              Results <span className="chip">{total.toLocaleString()} items</span>
            </div>
            <div className="pager">
              <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
              <button className="btn" onClick={prevPage} disabled={page === 1}>
                Prev
              </button>
              <div className="muted">
                {page} / {Math.max(1, Math.ceil(total / perPage))}
              </div>
              <button className="btn" onClick={nextPage} disabled={page * perPage >= total}>
                Next
              </button>
            </div>
          </div>

          {err ? (
            <div className="error">{err}</div>
          ) : (
            <div className="table-wrap">
              <table className="results">
                <thead className="table-head">
                  <tr>
                    <th>Year</th>
                    <th>Make</th>
                    <th>Model</th>
                    <th>Variant</th>
                    <th>VIN</th>
                    <th>ODO</th>
                    <th>WOVR</th>
                    <th>Damage</th>
                    <th>Outcome</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>House</th>
                    <th>State</th>
                    <th>Buyer</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.year ?? '—'}</td>
                      <td>{r.make ?? '—'}</td>
                      <td>{r.model ?? '—'}</td>
                      <td>{r.sub_model ?? '—'}</td>
                      <td className="mono">{r.vin ?? '—'}</td>
                      <td>{fmtKm(r.odometer)}</td>
                      <td>{r.wovr_status ?? '—'}</td>
                      <td>{r.incident_type ?? '—'}</td>
                      <td>{r.sale_status ?? '—'}</td>
                      <td>{fmtMoney(r.sold_price)}</td>
                      <td>{fmtDate(r.sold_date)}</td>
                      <td>{r.auction_house ?? '—'}</td>
                      <td>{r.state ?? '—'}</td>
                      <td className="mono">{r.buyer_number ?? '—'}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={14} className="muted center">
                        No results.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* ---------- Styles (Option 1: white header with thin brand accent + sticky thead fix) ---------- */}
      <style jsx global>{`
        :root {
          --brand: #22c55e;            /* modern emerald; swap to #32cd32 if you prefer original lime */
          --brand-600: #16a34a;
          --brand-700: #15803d;

          --background: #fafafa;
          --card: #ffffff;
          --text: #111827;
          --muted-text: #6b7280;
          --border: #e5e7eb;

          --header-h: 64px;
          --radius: 10px;
        }
        .dark:root {
          --background: #0b1020;
          --card: #0f1526;
          --text: #e5e7eb;
          --muted-text: #9aa3b2;
          --border: #1f2a44;
        }

        html, body {
          background: var(--background);
          color: var(--text);
        }

        /* Full-bleed white header with thin brand underline */
        .site-header {
          position: sticky;
          top: 0;
          left: 0;
          right: 0;
          z-index: 50;
          background: var(--card);
          box-shadow: 0 1px 0 var(--border);
        }
        .site-header::after {
          content: "";
          display: block;
          height: 4px;
          background: linear-gradient(90deg, var(--brand), var(--brand-600));
        }
        .site-header__inner {
          max-width: 1200px;
          margin: 0 auto;
          height: var(--header-h);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
        }
        .brand {
          font-weight: 800;
          letter-spacing: .2px;
        }
        .mode-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          background: #f4f4f5;
          border: 1px solid #e4e4e7;
          color: #111827;
        }
        .mode-pill .dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--brand);
        }

        .page-shell {
          max-width: 1200px;
          margin: 24px auto 80px;
          padding: 0 16px;
        }

        .filters-card, .results-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius);
        }
        .filters-card {
          padding: 20px;
          margin-bottom: 16px;
        }
        .filters-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px 16px;
        }
        @media (max-width: 1100px) {
          .filters-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 820px) {
          .filters-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
          .filters-grid { grid-template-columns: 1fr; }
        }

        .form-group label {
          display: block;
          font-size: 12px;
          color: var(--muted-text);
          margin-bottom: 6px;
        }
        .form-group input, .form-group select {
          width: 100%;
          height: 38px;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--text);
          border-radius: 8px;
          padding: 0 10px;
        }
        .form-actions {
          grid-column: 1 / -1;
          display: flex;
          gap: 10px;
          margin-top: 6px;
        }
        .btn {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--text);
        }
        .btn-primary {
          background: var(--brand);
          color: white;
          border-color: var(--brand-600);
        }
        .btn-primary:hover { background: var(--brand-600); border-color: var(--brand-700); }

        .results-card {
          padding: 12px 12px 6px;
        }
        .results-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 4px 10px;
        }
        .muted { color: var(--muted-text); }
        .chip {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--card);
          margin-left: 6px;
        }
        .pager {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pager select {
          height: 32px; border: 1px solid var(--border);
          border-radius: 8px; background: var(--card); color: var(--text);
        }

        .table-wrap { overflow: auto; }
        table.results {
          width: 100%;
          border-collapse: collapse;
        }
        table.results th, table.results td {
          padding: 10px 8px;
          white-space: nowrap;
          border-bottom: 1px solid var(--border);
          font-size: 14px;
        }
        table.results td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }

        /* Sticky head fix: solid background + under shadow */
        .table-head {
          position: sticky;
          top: var(--header-h);
          z-index: 9;
          background: var(--card);
          box-shadow: 0 1px 0 var(--border);
        }
        .table-head th { background: inherit; }

        .center { text-align: center; }
        .error {
          color: #b91c1c;
          background: #fef2f2;
          border: 1px solid #fecaca;
          padding: 10px 12px;
          border-radius: 8px;
          margin: 8px;
        }
      `}</style>
    </>
  );
}
