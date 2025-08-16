'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type InputChange = React.ChangeEvent<HTMLInputElement>;
type SelectChange = React.ChangeEvent<HTMLSelectElement>;

const TABLE = 'vehicles';

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
  { id: 'sold_date',     label: 'Date' },
  { id: 'auction_house', label: 'House' },
  { id: 'buyer_number',  label: 'Buyer' },
  { id: 'state',         label: 'State' },
] as const;

const QUERY_COLUMNS = ['id', ...DISPLAY.map((d) => d.id)];
const SORTABLE = new Set<string>([...DISPLAY.map(d => d.id), 'id']);

function useDebounce<T>(val: T, ms = 350) {
  const [v, setV] = useState(val);
  useEffect(() => { const id = setTimeout(() => setV(val), ms); return () => clearTimeout(id); }, [val, ms]);
  return v;
}

/** Simple dark/light toggle that adds/removes the `dark` class on <html> */
function ThemeToggle() {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const stored = (localStorage.getItem('theme') as 'light' | 'dark' | null);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = stored ?? (prefersDark ? 'dark' : 'light');
    setMode(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, []);
  const toggle = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('theme', next);
  };
  return (
    <button
      onClick={toggle}
      className="rounded-full border border-black/10 bg-white/70 px-3 py-1 text-sm font-medium text-black shadow-sm hover:bg-white"
    >
      {mode === 'dark' ? '🌙 Dark' : '☀️ Light'}
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
  const debounced = useDebounce(filters, 350);

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

  // paging/sorting
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({ column: 'sold_date', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  // Load distinct dropdown values (RPCs you already created)
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
        makeFilter ? supabase.rpc('distinct_model', { make_filter: makeFilter }) : supabase.rpc('distinct_model'),
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

  useEffect(() => { loadAllOptions(); }, []);

  useEffect(() => {
    (async () => {
      if (!filters.make) { loadAllOptions(undefined); return; }
      const { data } = await supabase.rpc('distinct_model', { make_filter: filters.make });
      const models = (data ?? []).map((r: any) => r.model);
      setOpts(o => ({ ...o, model: models }));
      if (filters.model && !models.includes(filters.model)) {
        setFilters(f => ({ ...f, model: '' }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.make]);

  // fetch on changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, [debounced, sort, page, pageSize]);

  function update(k: keyof typeof filters, v: string) { setPage(1); setFilters(s => ({ ...s, [k]: v })); }
  const onInput = (k: keyof typeof filters) => (e: InputChange) => update(k, e.target.value);
  const onSelect = (k: keyof typeof filters) => (e: SelectChange) => update(k, e.target.value);

  async function fetchData() {
    setLoading(true);
    setError('');
    try {
      let { yearFrom, yearTo, priceMin, priceMax } = debounced;
      if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) [yearFrom, yearTo] = [yearTo, yearFrom];
      if (priceMin && priceMax && Number(priceMin) > Number(priceMax)) [priceMin, priceMax] = [priceMax, priceMin];

      let q = supabase.from(TABLE).select(QUERY_COLUMNS.join(','), { count: 'exact' });

      // exact VIN & buyer (case-insensitive)
      if (debounced.vin.trim()) q = q.ilike('vin', debounced.vin.trim());
      if (debounced.buyer_no.trim()) q = q.ilike('buyer_number', debounced.buyer_no.trim());

      if (debounced.make) q = q.eq('make', debounced.make);
      if (debounced.model) q = q.eq('model', debounced.model);
      if (yearFrom) q = q.gte('year', Number(yearFrom));
      if (yearTo) q = q.lte('year', Number(yearTo));
      if (debounced.wovr_status) q = q.eq('wovr_status', debounced.wovr_status);
      if (debounced.sale_status) q = q.eq('sale_status', debounced.sale_status);
      if (debounced.incident_type) q = q.eq('incident_type', debounced.incident_type);
      if (priceMin) q = q.gte('sold_price', Number(priceMin));
      if (priceMax) q = q.lte('sold_price', Number(priceMax));
      if (debounced.auction_house) q = q.eq('auction_house', debounced.auction_house);
      if (debounced.state) q = q.eq('state', debounced.state);

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
      {/* Brand Bar */}
      <header className="w-full bg-[#32CD32]">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
          <div className="flex items-center gap-2 font-extrabold tracking-tight text-black">
            WreckWatch
            <span className="rounded-md bg-black/10 px-2 py-0.5 text-xs font-semibold">Search</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6">
        {/* Filter card */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 md:p-6">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-200">Filters</h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
            <Field label="VIN (exact)">
              <input className="input" value={filters.vin} onChange={onInput('vin')} placeholder="e.g. MR0FZ22G401062065" />
            </Field>
            <Field label="Buyer number (exact)">
              <input className="input" value={filters.buyer_no} onChange={onInput('buyer_no')} placeholder="e.g. B12345" />
            </Field>
            <Field label="Make">
              <Select value={filters.make} onChange={onSelect('make')} options={opts.make} loading={optsLoading} />
            </Field>
            <Field label="Model">
              <Select value={filters.model} onChange={onSelect('model')} options={opts.model} loading={optsLoading} />
            </Field>
            <Field label="Year (From)">
              <input type="number" className="input" value={filters.yearFrom} onChange={onInput('yearFrom')} />
            </Field>
            <Field label="Year (To)">
              <input type="number" className="input" value={filters.yearTo} onChange={onInput('yearTo')} />
            </Field>
            <Field label="WOVR Status">
              <Select value={filters.wovr_status} onChange={onSelect('wovr_status')} options={opts.wovr_status} loading={optsLoading} />
            </Field>
            <Field label="Sale Status">
              <Select value={filters.sale_status} onChange={onSelect('sale_status')} options={opts.sale_status} loading={optsLoading} />
            </Field>
            <Field label="Damage">
              <Select value={filters.incident_type} onChange={onSelect('incident_type')} options={opts.incident_type} loading={optsLoading} />
            </Field>
            <Field label="Price Min">
              <input type="number" className="input" value={filters.priceMin} onChange={onInput('priceMin')} />
            </Field>
            <Field label="Price Max">
              <input type="number" className="input" value={filters.priceMax} onChange={onInput('priceMax')} />
            </Field>
            <Field label="Auction House">
              <Select value={filters.auction_house} onChange={onSelect('auction_house')} options={opts.auction_house} loading={optsLoading} />
            </Field>
            <Field label="State">
              <Select value={filters.state} onChange={onSelect('state')} options={opts.state} loading={optsLoading} />
            </Field>

            <div className="flex items-end gap-2">
              <button
                className="h-10 rounded-lg bg-[#32CD32] px-4 font-semibold text-black shadow-sm ring-offset-0 hover:bg-[#28ad28]"
                onClick={() => { setPage(1); fetchData(); }}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Search'}
              </button>
              <button
                className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                onClick={clearFilters}
                disabled={loading}
              >
                Clear
              </button>
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 text-sm dark:border-neutral-800">
            <div>
              Results{' '}
              <span className="ml-2 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800">
                {total.toLocaleString()} items
              </span>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="input w-28"
                value={String(pageSize)}
                onChange={(e: SelectChange) => setPageSize(Number(e.target.value))}
              >
                {[10, 25, 50, 100].map((n) => <option key={n} value={String(n)}>{n} / page</option>)}
              </select>
              <button className="btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
              <div className="tabular-nums text-sm">{page} / {Math.max(1, totalPages)}</div>
              <button className="btn-ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
            </div>
          </div>

          {error && <div className="px-4 py-3 text-sm text-red-500">{error}</div>}

          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full table-auto text-sm">
              <thead className="sticky top-0 z-10 bg-white shadow-sm dark:bg-neutral-900">
                <tr className="text-left">
                  {DISPLAY.map(({ id, label }) => (
                    <th
                      key={id}
                      onClick={() => toggleSort(id)}
                      className="cursor-pointer px-3 py-2"
                    >
                      <div className="inline-flex items-center gap-2">
                        <span className="font-medium">{label}</span>
                        {sort.column === id && (
                          <span className="text-xs uppercase text-gray-500">{sort.direction}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={DISPLAY.length} className="px-3 py-8 text-center text-gray-400">No results.</td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={r.id} className="odd:bg-gray-50 hover:bg-gray-100 dark:odd:bg-neutral-900/50 dark:hover:bg-neutral-800/70">
                    {DISPLAY.map(({ id }) => (
                      <td
                        key={id}
                        className={[
                          'px-3 py-2 align-top',
                          id === 'vin' ? 'whitespace-nowrap min-w-[180px] md:min-w-[240px] lg:min-w-[320px] font-mono text-xs' : '',
                          id === 'sub_model' ? 'whitespace-nowrap min-w-[160px] lg:min-w-[280px]' : '',
                          id === 'sold_price' ? 'whitespace-nowrap min-w-[110px]' : '',
                          id === 'sold_date' ? 'whitespace-nowrap min-w-[110px]' : '',
                        ].join(' ')}
                      >
                        {id === 'sold_date' && r.sold_date
                          ? new Date(r.sold_date).toLocaleDateString()
                          : id === 'sold_price' && r.sold_price != null
                          ? `$${Number(r.sold_price).toLocaleString()}`
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

      {/* tiny utility styles */}
      <style jsx>{`
        .input {
          @apply h-10 rounded-lg border border-gray-300 bg-white px-3 text-[0.95rem] outline-none transition
                 focus:border-[#32CD32] focus:ring-2 focus:ring-[#32CD32]/30
                 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100;
        }
        .btn-ghost {
          @apply h-10 rounded-lg border border-gray-300 bg-white px-3 text-gray-700 hover:bg-gray-50
                 disabled:opacity-50 disabled:cursor-not-allowed
                 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800;
        }
      `}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-neutral-600 dark:text-neutral-300">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value, onChange, options, loading,
}: { value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: string[]; loading?: boolean }) {
  return (
    <select className="input" value={value} onChange={onChange} disabled={loading}>
      <option value="">{loading ? 'Loading…' : 'All'}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
