'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type InputChange = React.ChangeEvent<HTMLInputElement>;
type SelectChange = React.ChangeEvent<HTMLSelectElement>;

/** Hard exclusions: permanently removed for all users */
const EXCLUDED = ['title', 'stock_no', 'auction_number'] as const;

/** Table or view to read from */
const TABLE = 'vehicles';

/** All selectable columns in your schema (keep in sync with DB) */
const ALL_COLUMNS = [
  'id',
  'title',
  'make',
  'model',
  'sub_model',
  'year',
  'vin',
  'odometer',
  'wovr_status',
  'incident_type',
  'sale_status',
  'sold_price',
  'sold_date',
  'auction_house',
  'stock_no',
  'auction_number',
  'state',
  'color',
  'buyer_number',
] as const;
type ColName = typeof ALL_COLUMNS[number];

/** Effective columns after exclusions */
const COLUMNS = ALL_COLUMNS.filter(
  (c) => !(EXCLUDED as readonly string[]).includes(c)
) as ColName[];

/** Labels (your requested names) */
const LABELS: Record<ColName, string> = {
  id: 'ID',
  title: 'Title',
  make: 'Make',
  model: 'Model',
  sub_model: 'Variant',
  year: 'Year',
  vin: 'VIN',
  odometer: 'ODO',
  wovr_status: 'WOVR',
  incident_type: 'Damage',
  sale_status: 'Outcome',
  sold_price: 'Amount',
  sold_date: 'Sold',
  auction_house: 'House',
  stock_no: 'Stock #',
  auction_number: 'Auction #',
  state: 'State',
  color: 'Color',
  buyer_number: 'Buyer',
};

/** Default visible order (your requested order) */
const DEFAULT_VISIBLE: ColName[] = [
  'year',
  'make',
  'model',
  'sub_model',
  'vin',
  'odometer',
  'wovr_status',
  'incident_type',
  'sale_status',
  'sold_price',
  'auction_house',
  'buyer_number',
  'state',
].filter((c) => COLUMNS.includes(c)) as ColName[];

/** Persisted layout key (bumped so your new defaults apply immediately) */
const LAYOUT_STORAGE_KEY = 'ww_visible_columns_v2';

const SORTABLE = new Set<ColName>(ALL_COLUMNS);

function useDebounce<T>(val: T, ms = 400) {
  const [v, setV] = useState(val);
  useEffect(() => {
    const id = setTimeout(() => setV(val), ms);
    return () => clearTimeout(id);
  }, [val, ms]);
  return v;
}

// Inline theme toggle
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

// Column picker (only shows allowed columns)
function ColumnPicker({
  all,
  visible,
  onChange,
  onClose,
}: {
  all: ColName[];
  visible: ColName[];
  onChange: (cols: ColName[]) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<ColName[]>(visible);
  useEffect(() => {
    setLocal(visible);
  }, [visible]);

  function toggle(id: ColName) {
    setLocal((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function move(id: ColName, dir: -1 | 1) {
    setLocal((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const to = idx + dir;
      if (to < 0 || to >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(to, 0, item);
      return copy;
    });
  }
  function selectAll() {
    setLocal(all);
  }
  function selectDefault() {
    setLocal(DEFAULT_VISIBLE);
  }
  function clearAll() {
    setLocal([]);
  }
  function save() {
    onChange(local);
    onClose();
  }

  const order = [...new Set<ColName>([...DEFAULT_VISIBLE, ...all.filter((c) => !DEFAULT_VISIBLE.includes(c))])];

  return (
    <div className="picker">
      <div className="picker-head">
        <div className="font-medium">Customize columns</div>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="picker-actions">
        <button className="btn" onClick={selectDefault}>
          Default
        </button>
        <button className="btn" onClick={selectAll}>
          All
        </button>
        <button className="btn" onClick={clearAll}>
          None
        </button>
      </div>
      <div className="picker-list">
        {order.map((id) => (
          <div key={id} className="item">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={local.includes(id)} onChange={() => toggle(id)} />
              <span>{LABELS[id]}</span>
            </label>
            <div className="ml-auto flex gap-1">
              <button className="btn" onClick={() => move(id, -1)} title="Move up">
                ↑
              </button>
              <button className="btn" onClick={() => move(id, 1)} title="Move down">
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="picker-foot">
        <button className="btn" onClick={save}>
          Save
        </button>
      </div>

      <style jsx>{`
        .picker {
          position: absolute;
          top: 52px;
          right: 0;
          width: 360px;
          max-height: 70vh;
          background: var(--card);
          color: var(--fg);
          border: 1px solid var(--border);
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
          display: flex;
          flex-direction: column;
        }
        .picker-head,
        .picker-foot,
        .picker-actions {
          padding: 10px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .picker-foot {
          border-top: 1px solid var(--border);
          border-bottom: 0;
          justify-content: flex-end;
        }
        .picker-list {
          padding: 8px;
          overflow: auto;
          display: grid;
          gap: 6px;
        }
        .item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 8px;
        }
        .item:hover {
          background: var(--hover);
        }
      `}</style>
    </div>
  );
}

export default function SearchPage() {
  const BUYER_ENABLED = COLUMNS.includes('buyer_number' as ColName);

  const [filters, setFilters] = useState({
    vin: '',
    buyer_no: '',
    make: '',
    model: '',
    yearFrom: '',
    yearTo: '',
    wovr_status: '',
    sale_status: '',
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
    auction_house: [],
    state: [],
  });
  const [optsLoading, setOptsLoading] = useState(false);

  // Visible columns (persisted) — filtered to allowed only
  const [visibleCols, setVisibleCols] = useState<ColName[]>(DEFAULT_VISIBLE);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ColName[];
        setVisibleCols(parsed.filter((c) => COLUMNS.includes(c)));
      }
    } catch {}
  }, []);
  function updateVisible(cols: ColName[]) {
    const uniqueCols = Array.from(new Set(cols)).filter((c): c is ColName => COLUMNS.includes(c));
    setVisibleCols(uniqueCols);
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(uniqueCols));
    } catch {}
  }

  // Default sort (kept on sold_date; column isn’t visible by default but you can change via header)
  const [sort, setSort] = useState<{ column: ColName | string; direction: 'asc' | 'desc' }>({
    column: 'sold_date',
    direction: 'desc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  // Dropdown options (RPCs you already have)
  async function loadAllOptions(make?: string) {
    setOptsLoading(true);
    const [{ data: makeData }, { data: wovrData }, { data: saleData }, { data: houseData }, { data: stateData }, modelRes] =
      await Promise.all([
        supabase.rpc('distinct_make'),
        supabase.rpc('distinct_wovr_status'),
        supabase.rpc('distinct_sale_status'),
        supabase.rpc('distinct_auction_house'),
        supabase.rpc('distinct_state'),
        make ? supabase.rpc('distinct_model', { make_filter: make }) : supabase.rpc('distinct_model'),
      ]);
    setOpts({
      make: (makeData ?? []).map((r: any) => r.make),
      wovr_status: (wovrData ?? []).map((r: any) => r.wovr_status),
      sale_status: (saleData ?? []).map((r: any) => r.sale_status),
      auction_house: (houseData ?? []).map((r: any) => r.auction_house),
      state: (stateData ?? []).map((r: any) => r.state),
      model: (modelRes.data ?? []).map((r: any) => r.model),
    });
    setOptsLoading(false);
  }
  useEffect(() => {
    loadAllOptions();
  }, []);

  useEffect(() => {
    (async () => {
      if (!filters.make) {
        loadAllOptions(undefined);
        return;
      }
      const { data } = await supabase.rpc('distinct_model', { make_filter: filters.make });
      const models = (data ?? []).map((r: any) => r.model);
      setOpts((o) => ({ ...o, model: models }));
      if (filters.model && !models.includes(filters.model)) {
        setFilters((f) => ({ ...f, model: '' }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.make]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchData();
  }, [debounced, sort, page, pageSize]);

  function update<K extends keyof typeof filters>(k: K, v: string) {
    setPage(1);
    setFilters((s) => ({ ...s, [k]: v }));
  }
  const onInput = (k: keyof typeof filters) => (e: InputChange) => update(k, e.target.value);
  const onSelect = (k: keyof typeof filters) => (e: SelectChange) => update(k, e.target.value);

  async function fetchData() {
    setLoading(true);
    setError('');
    try {
      // guard ranges
      let { yearFrom, yearTo, priceMin, priceMax } = debounced;
      if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) [yearFrom, yearTo] = [yearTo, yearFrom];
      if (priceMin && priceMax && Number(priceMin) > Number(priceMax)) [priceMin, priceMax] = [priceMax, priceMin];

      let q = supabase.from(TABLE).select(COLUMNS.join(','), { count: 'exact' });

      const f = { ...debounced, yearFrom, yearTo, priceMin, priceMax };

      // VIN exact (case-insensitive)
      if (f.vin.trim()) q = q.ilike('vin', f.vin.trim());

      // Buyer number exact (only if not excluded)
      if (BUYER_ENABLED && f.buyer_no.trim()) q = q.ilike('buyer_number', f.buyer_no.trim());

      if (f.make) q = q.eq('make', f.make);
      if (f.model) q = q.eq('model', f.model);
      if (f.yearFrom) q = q.gte('year', Number(f.yearFrom));
      if (f.yearTo) q = q.lte('year', Number(f.yearTo));
      if (f.wovr_status) q = q.eq('wovr_status', f.wovr_status);
      if (f.sale_status) q = q.eq('sale_status', f.sale_status);
      if (f.priceMin) q = q.gte('sold_price', Number(f.priceMin));
      if (f.priceMax) q = q.lte('sold_price', Number(f.priceMax));
      if (f.auction_house) q = q.eq('auction_house', f.auction_house);
      if (f.state) q = q.eq('state', f.state);

      const sortCol =
        SORTABLE.has(sort.column as ColName) && COLUMNS.includes(sort.column as ColName)
          ? (sort.column as ColName)
          : 'id';
      q = q.order(sortCol, { ascending: sort.direction === 'asc' });

      const from = (page - 1) * pageSize,
        to = from + pageSize - 1;
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
    if (!COLUMNS.includes(col as ColName)) return;
    setSort((s) => ({ column: col, direction: s.column === col && s.direction === 'asc' ? 'desc' : 'asc' }));
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
      priceMin: '',
      priceMax: '',
      auction_house: '',
      state: '',
    });
    setPage(1);
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-center justify-between relative">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">WreckWatch Search</h1>
          <button className="btn" onClick={() => setShowPicker((s) => !s)}>
            Customize columns
          </button>
          {showPicker && (
            <ColumnPicker
              all={COLUMNS}
              visible={visibleCols.filter((c) => COLUMNS.includes(c))}
              onChange={updateVisible}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
        <ThemeToggleButton />
      </div>

      {/* Filters */}
      <div className="rounded-lg border p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Field label="VIN (exact)">
            <input className="input" value={filters.vin} onChange={onInput('vin')} placeholder="e.g. MR0FZ22G401062065" />
          </Field>

          {BUYER_ENABLED && (
            <Field label="Buyer number (exact)">
              <input className="input" value={filters.buyer_no} onChange={onInput('buyer_no')} placeholder="e.g. B12345" />
            </Field>
          )}

          <Field label="Make">
            <Select value={filters.make} onChange={onSelect('make')} options={opts.make} loading={optsLoading} />
          </Field>

          <Field label="Model">
            <Select value={filters.model} onChange={onSelect('model')} options={opts.model} loading={optsLoading} />
          </Field>

          <Field label="Year (From)">
            <input className="input" type="number" value={filters.yearFrom} onChange={onInput('yearFrom')} />
          </Field>

          <Field label="Year (To)">
            <input className="input" type="number" value={filters.yearTo} onChange={onInput('yearTo')} />
          </Field>

          <Field label="WOVR Status">
            <Select value={filters.wovr_status} onChange={onSelect('wovr_status')} options={opts.wovr_status} loading={optsLoading} />
          </Field>

          <Field label="Sale Status">
            <Select value={filters.sale_status} onChange={onSelect('sale_status')} options={opts.sale_status} loading={optsLoading} />
          </Field>

          <Field label="Price Min">
            <input className="input" type="number" value={filters.priceMin} onChange={onInput('priceMin')} />
          </Field>

          <Field label="Price Max">
            <input className="input" type="number" value={filters.priceMax} onChange={onInput('priceMax')} />
          </Field>

          <Field label="Auction House">
            <Select value={filters.auction_house} onChange={onSelect('auction_house')} options={opts.auction_house} loading={optsLoading} />
          </Field>

          <Field label="State">
            <Select value={filters.state} onChange={onSelect('state')} options={opts.state} loading={optsLoading} />
          </Field>

          <div className="flex items-end gap-2">
            <button className="btn" onClick={() => { setPage(1); fetchData(); }} disabled={loading}>
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
            <select className="input w-28" value={String(pageSize)} onChange={(e: SelectChange) => setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={String(n)}>
                  {n} / page
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Prev
            </button>
            <div className="text-sm tabular-nums">
              {page} / {totalPages}
            </div>
            <button className="btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next
            </button>
          </div>
        </div>

        {error && <div className="p-4 text-red-500 text-sm">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="themable">
              <tr>
                {visibleCols.filter((c) => COLUMNS.includes(c)).map((id) => (
                  <th key={id} onClick={() => toggleSort(id)} className="px-3 py-2 text-left cursor-pointer">
                    <div className="inline-flex items-center gap-2">
                      <span>{LABELS[id]}</span>
                      {sort.column === id && <span className="text-xs uppercase text-gray-500">{(sort as any).direction}</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={visibleCols.length} className="p-8 text-center text-gray-400">
                    No results.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t themable">
                  {visibleCols.filter((c) => COLUMNS.includes(c)).map((id) => (
                    <td key={id} className="px-3 py-2">
                      {id === 'sold_date' && r.sold_date
                        ? new Date(r.sold_date).toLocaleString()
                        : id === 'sold_price' && r.sold_price != null
                        ? `$${Number(r.sold_price).toLocaleString()}`
                        : id === 'vin'
                        ? <span className="font-mono text-xs break-all">{r[id]}</span>
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

