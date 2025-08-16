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
    <button className="btn" onClick={toggle} aria-label="Toggle theme">
      {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
    </button>
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
        supabase.rpc('distinct_incident_type'), // <-- your new RPC
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
    <div className="mx-auto w-full max-w-[min(100vw-24px,1600px)] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">WreckWatch Search</h1>
        <ThemeToggleButton />
      </div>

      {/* Filters */}
      <div className="rounded-lg border p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
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

          <div className="flex items-end gap-2">
            <button
              className="btn"
              onClick={() => {
                setPage(1);
                fetchData();
              }}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Search'}
            </button>
            <button className="btn" onClick={clearFilters} disabled={loading}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="text-sm">
            Results{' '}
            <span className="ml-2 rounded-full bg-black/10 dark:bg-white/10 px-2 py-0.5">
              {total.toLocaleString()} items
            </span>
          </div>
          <div className="flex items-center gap-2">
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
              className="btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Prev
            </button>
            <div className="text-sm tabular-nums">
              {page} / {totalPages}
            </div>
            <button
              className="btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </button>
          </div>
        </div>

        {error && <div className="p-4 text-red-500 text-sm">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm table-auto">
            <thead className="themable">
              <tr>
                {DISPLAY.map(({ id, label }) => (
                  <th
                    key={id}
                    onClick={() => toggleSort(id)}
                    className="px-3 py-2 text-left cursor-pointer"
                  >
                    <div className="inline-flex items-center gap-2">
                      <span>{label}</span>
                      {sort.column === id && (
                        <span className="text-xs uppercase text-gray-500">
                          {sort.direction}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
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
                <tr key={r.id} className="border-t themable">
                  {DISPLAY.map(({ id }) => (
                    <td key={id} className="px-3 py-2" data-col={id}>
                      {id === 'sold_date' && r.sold_date
                        ? new Date(r.sold_date).toLocaleDateString() // date only
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
      </div>

      <style jsx global>{`
        :root {
          --bg: #ffffff;
          --fg: #111111;
          --card: #ffffff;
          --border: rgba(0, 0, 0, 0.12);
          --muted: rgba(0, 0, 0, 0.05);
          --hover: rgba(0, 0, 0, 0.05);
        }
        .dark {
          --bg: #0c0d10;
          --fg: #f3f4f6;
          --card: #111317;
          --border: rgba(255, 255, 255, 0.16);
          --muted: rgba(255, 255, 255, 0.06);
          --hover: rgba(255, 255, 255, 0.06);
        }
        html,
        body {
          background: var(--bg);
          color: var(--fg);
        }

        .input {
          height: 38px;
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0 10px;
          background: var(--card);
          color: var(--fg);
        }
        .btn {
          height: 36px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--fg);
        }
        .border {
          border-color: var(--border) !important;
        }
        .border-t {
          border-top-color: var(--border) !important;
        }

        thead.themable {
          background: var(--muted);
        }
        tr.themable:hover {
          background: var(--hover);
        }

        /* Responsive, single-line key columns */
        td[data-col="vin"] .vin {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
          font-size: 12px;
          white-space: nowrap;
        }
        /* clamp(min, fluid, max) so widths adapt to user resolution */
        td[data-col="vin"] { white-space: nowrap; min-width: clamp(180px, 22vw, 360px); }
        td[data-col="sub_model"] { white-space: nowrap; min-width: clamp(140px, 16vw, 280px); }
        td[data-col="auction_house"] { white-space: nowrap; min-width: clamp(100px, 12vw, 220px); }

        td[data-col="odometer"] { white-space: nowrap; min-width: clamp(90px, 10vw, 140px); }
        td[data-col="sold_price"] { white-space: nowrap; min-width: clamp(100px, 10vw, 160px); }
        td[data-col="sold_date"] { white-space: nowrap; min-width: clamp(110px, 11vw, 180px); }
        td[data-col="buyer_number"],
        td[data-col="state"] { white-space: nowrap; }
      `}</style>
    </div>
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
