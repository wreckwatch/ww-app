'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type InputChange = React.ChangeEvent<HTMLInputElement>;
type SelectChange = React.ChangeEvent<HTMLSelectElement>;

const TABLE = 'vehicles';

/** Locked result columns (order + labels) */
const DISPLAY = [
  { id: 'year',          label: 'Year' },
  { id: 'make',          label: 'Make' },
  { id: 'model',         label: 'Model' },
  { id: 'sub_model',     label: 'Variant' },
  { id: 'vin',           label: 'VIN' },
  { id: 'odometer',      label: 'ODO' },
  { id: 'wovr_status',   label: 'WOVR' },
  { id: 'incident_type', label: 'Damage' },
  { id: 'sale_status',   label: 'Outcome' },
  { id: 'sold_price',    label: 'Amount' },
  { id: 'sold_date',     label: 'Date' }, // date-only
  { id: 'auction_house', label: 'House' },
  { id: 'buyer_number',  label: 'Buyer' },
  { id: 'state',         label: 'State' },
] as const;

// Minimal list of columns fetched from DB (include id for stable keys)
const QUERY_COLUMNS = ['id', ...DISPLAY.map(d => d.id)];

// Columns allowed for sorting (fallback to id if not sortable)
const SORTABLE = new Set<string>([...DISPLAY.map(d => d.id), 'id']);

/** debounce hook */
function useDebounce<T>(val: T, ms = 400) {
  const [v, setV] = useState(val);
  useEffect(() => {
    const id = setTimeout(() => setV(val), ms);
    return () => clearTimeout(id);
  }, [val, ms]);
  return v;
}

/** Theme toggle */
function ThemeToggleButton() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme') as 'light' | 'dark' | null;
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const initial = stored ?? (prefersDark ? 'dark' : 'light');
      setTheme(initial);
      document.documentElement.classList.toggle('dark', initial === 'dark');
    } catch {}
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('theme', next);
    } catch {}
  }

  return (
    <button className="btn btn-ghost" onClick={toggle} aria-label="Toggle theme">
      {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
    </button>
  );
}

/** Header bar (lime) */
function HeaderBar() {
  return (
    <header className="header">
      <div className="header__inner">
        <div className="brand">
          <span className="brand__dot" /> WreckWatch
        </div>
        <div className="spacer" />
        <ThemeToggleButton />
      </div>
    </header>
  );
}

export default function SearchPage() {
  const [filters, setFilters] = useState({
    vin: '',
    buyer_no: '',
    make: '',
    model: '',
    yearFrom: '',
    yearTo: '',
    wovr_status: '',
    sale_status: '',
    incident_type: '',
    priceMin: '',
    priceMax: '',
    auction_house: '',
    state: '',
  });
  const debounced = useDebounce(filters, 400);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [opts, setOpts] = useState<Record<string, string[]>>({
    make: [],
    model: [],
    wovr_status: [],
    sale_status: [],
    incident_type: [],
    auction_house: [],
    state: [],
  });
  const [optsLoading, setOptsLoading] = useState(false);

  // Sorting/paging
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({
    column: 'sold_date',
    direction: 'desc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  // Load dropdown options – uses your RPCs (including distinct_incident_type)
  async function loadAllOptions(makeFilter?: string) {
    setOptsLoading(true);
    try {
      const [
        makeRes,
        wovrRes,
        saleRes,
        houseRes,
        stateRes,
        modelRes,
        damageRes,
      ] = await Promise.all([
        supabase.rpc('distinct_make'),
        supabase.rpc('distinct_wovr_status'),
        supabase.rpc('distinct_sale_status'),
        supabase.rpc('distinct_auction_house'),
        supabase.rpc('distinct_state'),
        makeFilter
          ? supabase.rpc('distinct_model', { make_filter: makeFilter })
          : supabase.rpc('distinct_model'),
        supabase.rpc('distinct_incident_type'),
      ]);

      setOpts({
        make: (makeRes.data ?? []).map((r: any) => r.make),
        wovr_status: (wovrRes.data ?? []).map((r: any) => r.wovr_status),
        sale_status: (saleRes.data ?? []).map((r: any) => r.sale_status),
        auction_house: (houseRes.data ?? []).map((r: any) => r.auction_house),
        state: (stateRes.data ?? []).map((r: any) => r.state),
        model: (modelRes.data ?? []).map((r: any) => r.model),
        incident_type: (damageRes.data ?? []).map((r: any) => r.incident_type),
      });
    } finally {
      setOptsLoading(false);
    }
  }

  useEffect(() => {
    loadAllOptions();
  }, []);

  // When make changes, update models list (and reset model if it becomes invalid)
  useEffect(() => {
    (async () => {
      if (!filters.make) {
        loadAllOptions(undefined);
        return;
      }
      const { data } = await supabase.rpc('distinct_model', {
        make_filter: filters.make,
      });
      const models = (data ?? []).map((r: any) => r.model);
      setOpts((o) => ({ ...o, model: models }));
      if (filters.model && !models.includes(filters.model)) {
        setFilters((f) => ({ ...f, model: '' }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.make]);

  // Fetch on changes (debounced)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchData();
  }, [debounced, sort, page, pageSize]);

  function update(k: keyof typeof filters, v: string) {
    setPage(1);
    setFilters((s) => ({ ...s, [k]: v }));
  }
  const onInput = (k: keyof typeof filters) => (e: InputChange) =>
    update(k, e.target.value);
  const onSelect = (k: keyof typeof filters) => (e: SelectChange) =>
    update(k, e.target.value);

  async function fetchData() {
    setLoading(true);
    setError('');
    try {
      // Normalise ranges
      let { yearFrom, yearTo, priceMin, priceMax } = debounced;
      if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) {
        [yearFrom, yearTo] = [yearTo, yearFrom];
      }
      if (priceMin && priceMax && Number(priceMin) > Number(priceMax)) {
        [priceMin, priceMax] = [priceMax, priceMin];
      }

      let q = supabase.from(TABLE).select(QUERY_COLUMNS.join(','), {
        count: 'exact',
      });

      const f = { ...debounced, yearFrom, yearTo, priceMin, priceMax };

      // VIN exact (case-insensitive)
      if (f.vin.trim()) q = q.ilike('vin', f.vin.trim());
      // Buyer number exact (case-insensitive)
      if (f.buyer_no.trim()) q = q.ilike('buyer_number', f.buyer_no.trim());

      if (f.make) q = q.eq('make', f.make);
      if (f.model) q = q.eq('model', f.model);
      if (f.yearFrom) q = q.gte('year', Number(f.yearFrom));
      if (f.yearTo) q = q.lte('year', Number(f.yearTo));
      if (f.wovr_status) q = q.eq('wovr_status', f.wovr_status);
      if (f.sale_status) q = q.eq('sale_status', f.sale_status);
      if (f.incident_type) q = q.eq('incident_type', f.incident_type);
      if (f.priceMin) q = q.gte('sold_price', Number(f.priceMin));
      if (f.priceMax) q = q.lte('sold_price', Number(f.priceMax));
      if (f.auction_house) q = q.eq('auction_house', f.auction_house);
      if (f.state) q = q.eq('state', f.state);

      const sortCol = SORTABLE.has(sort.column) ? sort.column : 'id';
      q = q.order(sortCol, { ascending: sort.direction === 'asc' });

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      q = q.range(from, to);

      const { data, error, count } = await q;
      if (error) throw error;
      setRows(data || []);
      setTotal(count || 0);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  function toggleSort(col: string) {
    if (!SORTABLE.has(col)) return;
    setSort((s) => ({
      column: col,
      direction: s.column === col && s.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  function clearFilters() {
    setFilters({
      vin: '',
      buyer_no: '',
      make: '',
      model: '',
      yearFrom: '',
      yearTo: '',
      wovr_status: '',
      sale_status: '',
      incident_type: '',
      priceMin: '',
      priceMax: '',
      auction_house: '',
      state: '',
    });
    setPage(1);
  }

  return (
    <>
      <HeaderBar />

      <main className="container">
        {/* Filters */}
        <section className="card mb-6">
          <div className="grid grid-4 gap-4">
            <Field label="VIN (exact)">
              <input
                className="input"
                value={filters.vin}
                onChange={onInput('vin')}
                placeholder="e.g. MR0FZ22G401062065"
              />
            </Field>

            <Field label="Buyer number (exact)">
              <input
                className="input"
                value={filters.buyer_no}
                onChange={onInput('buyer_no')}
                placeholder="e.g. B12345"
              />
            </Field>

            <Field label="Make">
              <Select
                value={filters.make}
                onChange={onSelect('make')}
                options={opts.make}
                loading={optsLoading}
              />
            </Field>

            <Field label="Model">
              <Select
                value={filters.model}
                onChange={onSelect('model')}
                options={opts.model}
                loading={optsLoading}
              />
            </Field>

            <Field label="Year (From)">
              <input
                className="input"
                type="number"
                value={filters.yearFrom}
                onChange={onInput('yearFrom')}
              />
            </Field>

            <Field label="Year (To)">
              <input
                className="input"
                type="number"
                value={filters.yearTo}
                onChange={onInput('yearTo')}
              />
            </Field>

            <Field label="WOVR Status">
              <Select
                value={filters.wovr_status}
                onChange={onSelect('wovr_status')}
                options={opts.wovr_status}
                loading={optsLoading}
              />
            </Field>

            <Field label="Sale Status">
              <Select
                value={filters.sale_status}
                onChange={onSelect('sale_status')}
                options={opts.sale_status}
                loading={optsLoading}
              />
            </Field>

            <Field label="Damage">
              <Select
                value={filters.incident_type}
                onChange={onSelect('incident_type')}
                options={opts.incident_type}
                loading={optsLoading}
              />
            </Field>

            <Field label="Price Min">
              <input
                className="input"
                type="number"
                value={filters.priceMin}
                onChange={onInput('priceMin')}
              />
            </Field>

            <Field label="Price Max">
              <input
                className="input"
                type="number"
                value={filters.priceMax}
                onChange={onInput('priceMax')}
              />
            </Field>

            <Field label="Auction House">
              <Select
                value={filters.auction_house}
                onChange={onSelect('auction_house')}
                options={opts.auction_house}
                loading={optsLoading}
              />
            </Field>

            <Field label="State">
              <Select
                value={filters.state}
                onChange={onSelect('state')}
                options={opts.state}
                loading={optsLoading}
              />
            </Field>

            <div className="actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setPage(1);
                  fetchData();
                }}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Search'}
              </button>
              <button className="btn btn-ghost" onClick={clearFilters} disabled={loading}>
                Clear
              </button>
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="card">
          <div className="card__bar">
            <div className="text-sm">
              Results{' '}
              <span className="pill">
                {total.toLocaleString()} items
              </span>
            </div>
            <div className="controls">
              <select
                className="input w-28"
                value={String(pageSize)}
                onChange={(e: SelectChange) => setPageSize(Number(e.target.value))}
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={String(n)}>
                    {n} / page
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Prev
              </button>
              <div className="text-sm tabular-nums min-w-[64px] text-center">
                {page} / {totalPages}
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          </div>

          {error && <div className="p-4 text-red-500 text-sm">{error}</div>}

          <div className="table-wrap">
            <table className="w-full text-sm table-auto">
              <thead className="table-head">
                <tr>
                  {DISPLAY.map(({ id, label }) => {
                    const active = sort.column === id;
                    const dir = active ? (sort.direction === 'asc' ? '▲' : '▼') : '';
                    return (
                      <th
                        key={id}
                        onClick={() => toggleSort(id)}
                        className="px-3 py-2 text-left cursor-pointer select-none"
                        title="Click to sort"
                      >
                        <span className="inline-flex items-center gap-1">
                          {label} {dir && <span className="sort">{dir}</span>}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={DISPLAY.length}
                      className="p-8 text-center text-gray-400"
                    >
                      No results.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="row">
                    {DISPLAY.map(({ id }) => (
                      <td key={id} className="px-3 py-2" data-col={id}>
                        {id === 'sold_date' && r.sold_date
                          ? new Date(r.sold_date).toLocaleDateString()
                          : id === 'sold_price' && r.sold_price != null
                          ? `$${Number(r.sold_price).toLocaleString()}`
                          : id === 'vin'
                          ? <span className="vin">{r[id]}</span>
                          : (r[id] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <style jsx global>{`
        /* ===== Theme tokens ===== */
        :root {
          --lime: #32cd32;
          --header-h: 56px;

          --bg: #f8faf9;
          --fg: #0f1720;

          --card: #ffffff;
          --border: rgba(0,0,0,0.12);
          --muted: rgba(16,24,40,0.04);
          --hover: rgba(16,24,40,0.05);

          --primary: var(--lime);
          --primary-ink: #08340a;
        }
        .dark {
          --bg: #0b0d11;
          --fg: #eef2f6;

          --card: #121418;
          --border: rgba(255,255,255,0.14);
          --muted: rgba(255,255,255,0.06);
          --hover: rgba(255,255,255,0.07);

          --primary: var(--lime);
          --primary-ink: #051f06;
        }
        html, body { background: var(--bg); color: var(--fg); }

        /* ===== Header Bar ===== */
        .header {
          position: sticky;
          top: 0;
          z-index: 50;
          height: var(--header-h);
          background: var(--primary);
          color: #002400;
          box-shadow: 0 1px 0 rgba(0,0,0,0.08);
        }
        .header__inner {
          margin: 0 auto;
          max-width: min(1600px, calc(100vw - 24px));
          height: 100%;
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 0 16px;
        }
        .brand {
          font-weight: 800;
          letter-spacing: .2px;
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .brand__dot {
          width: 14px; height: 14px;
          border-radius: 3px;
          background: #fff;
          outline: 2px solid rgba(0,0,0,.1);
        }
        .spacer { flex: 1; }

        /* ===== Layout ===== */
        .container {
          margin: 16px auto;
          padding: 0 12px 24px 12px;
          max-width: min(1600px, calc(100vw - 24px));
        }
        .card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          padding: 16px;
        }
        .card__bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 16px; border-bottom: 1px solid var(--border);
        }
        .pill {
          margin-left: 8px; padding: 2px 8px;
          border-radius: 999px; background: var(--muted);
        }
        .controls { display:flex; align-items:center; gap:8px; }

        /* Simple grid helpers */
        .grid { display: grid; }
        .gap-4 { gap: 16px; }
        .grid-4 {
          grid-template-columns: repeat(1, minmax(0,1fr));
        }
        @media (min-width: 900px) {
          .grid-4 { grid-template-columns: repeat(3, minmax(0,1fr)); }
        }
        @media (min-width: 1200px) {
          .grid-4 { grid-template-columns: repeat(4, minmax(0,1fr)); }
        }

        /* ===== Controls ===== */
        .input {
          height: 40px;
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0 10px;
          width: 100%;
          background: var(--card);
          color: var(--fg);
        }
        .btn {
          height: 38px;
          padding: 0 14px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--fg);
        }
        .btn-ghost { background: transparent; }
        .btn-primary {
          background: var(--primary);
          border-color: rgba(0,0,0,0.1);
          color: var(--primary-ink);
          font-weight: 600;
        }
        .actions { display:flex; align-items:end; gap:8px; }

        /* ===== Table ===== */
        .table-wrap { overflow-x: auto; }
        .table-head {
          position: sticky;
          top: var(--header-h); /* stays below header */
          z-index: 5;
          background: var(--muted);
        }
        .row:hover { background: var(--hover); }

        /* Keep important columns single-line and fluid */
        td[data-col="vin"] .vin {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
          font-size: 12px;
          white-space: nowrap;
        }
        td[data-col="vin"] { white-space: nowrap; min-width: clamp(180px, 24vw, 400px); }
        td[data-col="sub_model"] { white-space: nowrap; min-width: clamp(180px, 20vw, 360px); }
        td[data-col="sold_price"] { white-space: nowrap; }
        td[data-col="sold_date"] { white-space: nowrap; }
        td[data-col="auction_house"] { white-space: nowrap; }
        th .sort { font-size: 10px; opacity: .7; }

        /* Utilities used in markup */
        .w-28 { width: 7rem; }
        .mb-6 { margin-bottom: 24px; }
        .min-w-\[64px\] { min-width: 64px; }
        .text-center { text-align: center; }
        .tabular-nums { font-variant-numeric: tabular-nums; }
      `}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
  loading,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: string[];
  loading?: boolean;
}) {
  return (
    <select className="input" value={value} onChange={onChange} disabled={loading}>
      <option value="">{loading ? 'Loading…' : 'All'}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
