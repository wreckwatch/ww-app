'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type InputChange = React.ChangeEvent<HTMLInputElement>;
type SelectChange = React.ChangeEvent<HTMLSelectElement>;

const TABLE = 'vehicles_frontend';

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
  { id: 'sold_date',     label: 'Date' },   // FE uses coalesce(sold_date, auction_date)
  { id: 'auction_house', label: 'House' },
  { id: 'buyer_number',  label: 'Buyer' },
  { id: 'state',         label: 'State' },
  // UI-only column
  { id: 'link',          label: 'Link' },
] as const;

// Query the real DB columns PLUS url & auction_date (used for link rules)
const QUERY_COLUMNS = [
  'id',
  'url',
  'auction_date',
  ...DISPLAY.filter(d => d.id !== 'link').map(d => d.id),
];

// Sortable columns: everything except the UI-only "link"
const SORTABLE = new Set<string>([
  ...DISPLAY.filter(d => d.id !== 'link').map(d => d.id),
  'id',
]);

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
    try { localStorage.setItem('theme', next); } catch {}
  }

  return (
    <button className="btn btn-ghost" onClick={toggle} aria-label="Toggle theme">
      {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
    </button>
  );
}

/** Filters shape + single source of truth for “empty filters” */
type Filters = {
  vin: string;
  buyer_no: string;
  make: string;
  model: string;
  yearFrom: string;
  yearTo: string;
  dateFrom: string;
  dateTo: string;
  wovr_status: string;
  sale_status: string;
  incident_types: string[]; // multi select
  priceMin: string;
  priceMax: string;
  auction_house: string;
  state: string;
};

const INITIAL_FILTERS: Filters = {
  vin: '',
  buyer_no: '',
  make: '',
  model: '',
  yearFrom: '',
  yearTo: '',
  dateFrom: '',
  dateTo: '',
  wovr_status: '',
  sale_status: '',
  incident_types: [],
  priceMin: '',
  priceMax: '',
  auction_house: '',
  state: '',
};

type Sort = { column: string; direction: 'asc' | 'desc' };
type Snapshot = { filters: Filters; page: number; sort: Sort; pageSize: number };

export default function SearchPage() {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
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

  // NEW: keep a reverse map of canonical WOVR label -> list of raw DB variants
  const [wovrVariantsMap, setWovrVariantsMap] = useState<Record<string, string[]>>({});

  // map of VIN -> total count in DB
  const [vinCounts, setVinCounts] = useState<Record<string, number>>({});

  // Sorting/paging
  const [sort, setSort] = useState<Sort>({ column: 'sold_date', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  // Lightweight in-app history for VIN-counter drilldowns
  const [history, setHistory] = useState<Snapshot[]>([]);

  // Helpers to normalize and canonicalize WOVR statuses
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

  const canonicalizeWovr = (raw: string): string => {
    const n = norm(raw);
    if (n === 'inspection passed repairable writeoff' || n === 'inspection passed repairable write off' || n === 'inspected write off') {
      return 'Inspected Write-off';
    }
    if (n === 'repairable write off') return 'Repairable Write-off';
    if (n === 'statutory write off') return 'Statutory Write-off';
    if (n === 'wovr na' || n === 'wovr n a') return 'WOVR N/A';
    // default: keep original casing
    return raw;
  };

  // Load dropdown options – uses your RPCs
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

      // Build canonical options for WOVR (case-insensitive + dedup + merge “Inspection Passed …”)
      const wovrMap = new Map<string, Set<string>>(); // canonical -> Set(raw variants)
      for (const r of (wovrRes.data ?? [])) {
        const raw = r.wovr_status as string;
        if (!raw) continue;
        const canon = canonicalizeWovr(raw);
        if (!wovrMap.has(canon)) wovrMap.set(canon, new Set());
        wovrMap.get(canon)!.add(raw);
      }
      // Ensure both "Inspection Passed Repairable Writeoff" variants are included under Inspected Write-off
      const inspectedSet = wovrMap.get('Inspected Write-off') ?? new Set<string>();
      inspectedSet.add('Inspection Passed Repairable Writeoff');
      inspectedSet.add('Inspection Passed Repairable Write-off');
      inspectedSet.add('Inspected Write-off');
      wovrMap.set('Inspected Write-off', inspectedSet);

      // Final dropdown options (sorted, “Inspection Passed …” not shown separately)
      const wovrOptions = Array.from(wovrMap.keys()).sort((a, b) => a.localeCompare(b));

      // Reverse map for filtering
      const reverse: Record<string, string[]> = {};
      wovrMap.forEach((set, canon) => {
        reverse[canon] = Array.from(set);
      });
      setWovrVariantsMap(reverse);

      // ---------- DAMAGE OPTIONS WITH “(ALL) …” QUICK PICKS ----------
      const damageRaw: string[] = (damageRes.data ?? [])
        .map((r: any) => r.incident_type)
        .filter(Boolean);

      // collect unique tags from comma-separated variants
      const tagSet = new Set<string>();
      for (const opt of damageRaw) {
        for (const t of opt.split(',').map((s: string) => s.trim()).filter(Boolean)) {
          tagSet.add(t);
        }
      }
      const allTags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));
      const damageAll = allTags.map(t => `(ALL) ${t}`);

      // final Damage options: "(ALL) …" first, then raw DB variants
      const damageOptions = [...damageAll, ...damageRaw];
      // ---------------------------------------------------------------

      setOpts({
        make: (makeRes.data ?? []).map((r: any) => r.make),
        wovr_status: wovrOptions,
        sale_status: (saleRes.data ?? []).map((r: any) => r.sale_status),
        auction_house: (houseRes.data ?? []).map((r: any) => r.auction_house),
        state: (stateRes.data ?? []).map((r: any) => r.state),
        model: (modelRes.data ?? []).map((r: any) => r.model),
        incident_type: damageOptions,
      });
    } finally {
      setOptsLoading(false);
    }
  }

  useEffect(() => { loadAllOptions(); }, []);

  // When make changes, update models list
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

  // Helpers: date bounds for the date picker values (interpret local, send ISO)
  function toStartOfDayISO(d: string): string {
    const dt = new Date(`${d}T00:00:00`);
    return dt.toISOString();
  }
  function toEndOfDayISO(d: string): string {
    const dt = new Date(`${d}T23:59:59.999`);
    return dt.toISOString();
  }

  // Fetch on changes (debounced)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, [debounced, sort, page, pageSize]);

  function update(k: keyof Filters, v: any) {
    setPage(1);
    setFilters((s) => ({ ...s, [k]: v }));
  }
  const onInput = (k: keyof Filters) => (e: InputChange) => update(k, e.target.value);
  const onSelect = (k: keyof Filters) => (e: SelectChange) => update(k, e.target.value);

  async function fetchVinCounts(forRows: any[]) {
    const vins: string[] = Array.from(new Set(forRows.map(r => r.vin).filter(Boolean)));
    if (vins.length === 0) {
      setVinCounts({});
      return;
    }

    // Up to 25 small HEAD queries; simple and reliable.
    const entries = await Promise.all(
      vins.map(async (v) => {
        const { count, error } = await supabase
          .from(TABLE)
          .select('id', { count: 'exact', head: true })
          .eq('vin', v);
        if (error) console.error('VIN count error', v, error);
        return [v, count || 0] as const;
      })
    );

    const map: Record<string, number> = {};
    for (const [v, c] of entries) map[v] = c;
    setVinCounts(map);
  }

  async function fetchData() {
    setLoading(true);
    setError('');
    try {
      // Normalise ranges
      let { yearFrom, yearTo, priceMin, priceMax, dateFrom, dateTo } = debounced;
      if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) {
        [yearFrom, yearTo] = [yearTo, yearFrom];
      }
      if (priceMin && priceMax && Number(priceMin) > Number(priceMax)) {
        [priceMin, priceMax] = [priceMax, priceMin];
      }
      if (dateFrom && dateTo && dateFrom > dateTo) {
        [dateFrom, dateTo] = [dateTo, dateFrom];
      }

      let q = supabase.from(TABLE).select(QUERY_COLUMNS.join(','), { count: 'exact' });

      const f = { ...debounced, yearFrom, yearTo, priceMin, priceMax, dateFrom, dateTo };

      // VIN exact (case-insensitive)
      if (f.vin.trim()) q = q.ilike('vin', f.vin.trim());
      // Buyer number exact (case-insensitive)
      if (f.buyer_no.trim()) q = q.ilike('buyer_number', f.buyer_no.trim());

      if (f.make) q = q.eq('make', f.make);
      if (f.model) q = q.eq('model', f.model);
      if (f.yearFrom) q = q.gte('year', Number(f.yearFrom));
      if (f.yearTo) q = q.lte('year', Number(f.yearTo));

      // WOVR status: use canonical -> variants map (case-insensitive + merged)
      if (f.wovr_status) {
        const variants = wovrVariantsMap[f.wovr_status] ?? [f.wovr_status];
        q = q.in('wovr_status', variants);
      }

      if (f.sale_status) q = q.eq('sale_status', f.sale_status);

      // ---------- DAMAGE "(ALL) …" EXPANSION ----------
      if (Array.isArray(f.incident_types) && f.incident_types.length > 0) {
        const allOpts = opts.incident_type ?? [];
        const rawOpts = allOpts.filter(o => !o.startsWith('(ALL) ')); // DB values only
        const expanded = new Set<string>();

        for (const sel of f.incident_types) {
          if (sel.startsWith('(ALL) ')) {
            // Expand to ANY option that contains this tag (as a token anywhere)
            const tag = sel.slice(6).trim().toLowerCase();
            for (const opt of rawOpts) {
              const tokens = opt.split(',').map(s => s.trim().toLowerCase());
              if (tokens.includes(tag)) expanded.add(opt);
            }
          } else {
            // Keep existing behavior: exact selection only
            expanded.add(sel);
          }
        }

        q = q.in('incident_type', Array.from(expanded));
      }
      // --------------------------------------------------

      if (f.priceMin) q = q.gte('sold_price', Number(f.priceMin));
      if (f.priceMax) q = q.lte('sold_price', Number(f.priceMax));
      if (f.auction_house) q = q.eq('auction_house', f.auction_house);
      if (f.state) q = q.eq('state', f.state);

      // Date range filter on the view's sold_date (coalesce(sold_date, auction_date))
      if (f.dateFrom) q = q.gte('sold_date', toStartOfDayISO(f.dateFrom));
      if (f.dateTo)   q = q.lte('sold_date', toEndOfDayISO(f.dateTo));

      const sortCol = SORTABLE.has(sort.column) ? sort.column : 'id';
      q = q.order(sortCol, { ascending: sort.direction === 'asc' });

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      q = q.range(from, to);

      const { data, error, count } = await q;
      if (error) throw error;
      setRows(data || []);
      setTotal(count || 0);

      // After rows load, fetch per-VIN counts so we can show the ×N badge
      await fetchVinCounts(data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch');
      setRows([]);
      setTotal(0);
      setVinCounts({});
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
    setFilters(INITIAL_FILTERS);
    setPage(1);
    setHistory([]); // clearing search also clears history
  }

  // Helper: render a WOVR badge for known statuses
  function renderWovrBadge(raw: unknown) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const key = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let src = '';
    let alt = '';

    switch (key) {
      case 'statutory write off':
        src = '/staticon.png';
        alt = 'Statutory Write-off';
        break;
      case 'repairable write off':
        src = '/repairicon.png';
        alt = 'Repairable Write-off';
        break;
      case 'wovr na':
      case 'wovr n a':
        src = '/wovrnaicon.png';
        alt = 'WOVR N/A';
        break;
      case 'inspection passed repairable writeoff':
      case 'inspection passed repairable write off':
        src = '/inspectedicon.png';
        alt = 'Inspection Passed Repairable Write-off';
        break;
      case 'inspected write off': // ← NEW: show same icon for Manheim “Inspected Write-off”
        src = '/inspectedicon.png';
        alt = 'Inspected Write-off';
        break;
      default:
        return null;
    }

    return (
      <img
        src={src}
        alt={alt}
        width={96}
        height={28}
        style={{ display: 'block', margin: '0 auto' }}
      />
    );
  }

  /**
   * Link visibility:
   * - Hide if there is NO date at all (neither auction_date nor sold_date)
   * - If there is a date, show the link up to 7 days after that date
   */
  function renderLinkCell(r: any) {
const href = typeof r.url === 'string' ? r.url : '';
if (!href) return '—';

const auctionTs = r.auction_date ? Date.parse(r.auction_date) : NaN;
const soldTs    = r.sold_date    ? Date.parse(r.sold_date)    : NaN;

if (!Number.isFinite(auctionTs) && !Number.isFinite(soldTs)) return '—';
const refTs = Number.isFinite(auctionTs) ? auctionTs : soldTs;
const cutoff = refTs + 7 * 24 * 60 * 60 * 1000;
if (Date.now() > cutoff) return '—';

return (
  <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
    Link
  </a>
);

  }

  // Click VIN counter: push current state to history, then focus on this VIN
  function focusVinAll(vin: string) {
    if (!vin) return;
    // snapshot BEFORE changing filters
    setHistory(h => [...h, { filters, page, sort, pageSize }]);
    setPage(1);
    setFilters({ ...INITIAL_FILTERS, vin });
  }

  // Back button: restore last snapshot (if any)
  function goBack() {
    setHistory(h => {
      if (h.length === 0) return h;
      const next = h.slice(0, -1);
      const snap = h[h.length - 1];
      setFilters(snap.filters);
      setPage(snap.page);
      setSort(snap.sort);
      setPageSize(snap.pageSize);
      return next;
    });
  }

  return (
    <div className="min-h-screen">
      {/* Full-width brand bar with thin accent */}
      <header className="ww-header">
        <div className="ww-header__inner">
          <div className="ww-logo">WreckWatch</div>
          {/* Back moved out of the header */}
          <ThemeToggleButton />
        </div>
      </header>

      {/* Page container */}
      <div className="mx-auto w-full max-w-[min(100vw-24px,1600px)] p-6">
        {/* Filters */}
        <div className="rounded-lg border p-4 mb-6 bg-[var(--card)]">
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
                placeholder="e.g. 2015"
              />
            </Field>

            <Field label="Year (To)">
              <input
                className="input"
                type="number"
                value={filters.yearTo}
                onChange={onInput('yearTo')}
                placeholder="e.g. 2024"
              />
            </Field>

            {/* Date range calendars */}
            <Field label="Auction Date (From)">
              <input
                className="input"
                type="date"
                value={filters.dateFrom}
                onChange={onInput('dateFrom')}
              />
            </Field>

            <Field label="Auction Date (To)">
              <input
                className="input"
                type="date"
                value={filters.dateTo}
                onChange={onInput('dateTo')}
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

            {/* Damage multi-select */}
            <Field label="Damage">
              <MultiSelect
                options={opts.incident_type}
                value={filters.incident_types}
                onChange={(arr) => update('incident_types', arr)}
                disabled={optsLoading}
              />
            </Field>

            <Field label="Price Min">
              <input
                className="input"
                type="number"
                value={filters.priceMin}
                onChange={onInput('priceMin')}
                placeholder="e.g. 1000"
              />
            </Field>

            <Field label="Price Max">
              <input
                className="input"
                type="number"
                value={filters.priceMax}
                onChange={onInput('priceMax')}
                placeholder="e.g. 50000"
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

            {/* Action row: Search, Clear, Back (Back sits next to Clear) */}
            <div className="flex items-end gap-2">
              <button
                className="btn btn-accent"
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
              <button
                className="btn"
                onClick={goBack}
                disabled={history.length === 0 || loading}
                title={history.length ? 'Back to previous results' : 'No previous view'}
              >
                ⟵ Back
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="rounded-lg border bg-[var(--card)]">
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
                  <option key={n} value={String(n)}>{n} / page</option>
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
              <thead className="sticky-header">
                <tr>
                  {DISPLAY.map(({ id, label }) => (
                    <th
                      key={id}
                      data-col={id}
                      onClick={() => toggleSort(id)}
                      className={`px-3 py-2 text-left ${SORTABLE.has(id) ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <div className="inline-flex items-center gap-2">
                        <span>{label}</span>
                        {sort.column === id && SORTABLE.has(id) && (
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
                    <td colSpan={DISPLAY.length} className="p-8 text-center text-gray-400">
                      No results.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-t row-hover">
                    {DISPLAY.map(({ id }) => (
                      <td key={id} className="px-3 py-2" data-col={id}>
                        {id === 'auction_house' ? (
                          r.auction_house === 'Pickles' ? (
                            <img
                              src="/picon.png"
                              alt="Pickles"
                              width={18}
                              height={18}
                              style={{ display: 'block', margin: '0 auto' }}
                            />
                          ) : r.auction_house === 'Manheim' ? (
                            <img
                              src="/man-logo.png"
                              alt="Manheim"
                              width={22}
                              height={22}
                              style={{ display: 'block', margin: '0 auto' }}
                            />
                          ) : (
                            r.auction_house ?? '—'
                          )
                        ) : id === 'sale_status' ? (
                          typeof r.sale_status === 'string' &&
                          r.sale_status.trim().toUpperCase() === 'SOLD' ? (
                            <img
                              src="/soldicon.webp"
                              alt="Sold"
                              width={64}
                              height={28}
                              style={{ display: 'block', margin: '0 auto' }}
                            />
                          ) : (
                            r.sale_status ?? '—'
                          )
                        ) : id === 'wovr_status' ? (
                          renderWovrBadge(r.wovr_status) ?? (r.wovr_status ?? '—')
                        ) : id === 'sold_date' && r.sold_date ? (
                          new Date(r.sold_date).toLocaleDateString()
                        ) : id === 'sold_price' && r.sold_price != null ? (
                          `$${Number(r.sold_price).toLocaleString()}`
                        ) : id === 'vin' ? (
                          <div className="flex items-center">
                            <span className="vin">{r.vin}</span>
                            {vinCounts[r.vin] > 1 && (
                              <button
                                className="vin-badge"
                                title={`Show ${vinCounts[r.vin]} results for this VIN`}
                                onClick={() => focusVinAll(r.vin)}
                              >
                                ×{vinCounts[r.vin]}
                              </button>
                            )}
                          </div>
                        ) : id === 'link' ? (
                          renderLinkCell(r)
                        ) : (
                          r[id] ?? '—'
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Design tokens & component styles */}
      <style jsx global>{`
        :root {
          --accent: #32cd32;                   /* lime brand */
          --background: 220 20% 97%;           /* soft app canvas */
          --fg: #111111;
          --card: #ffffff;
          --border: rgba(0, 0, 0, 0.12);
          --muted: rgba(0, 0, 0, 0.05);
          --hover: rgba(0, 0, 0, 0.06);
        }
        .dark {
          --accent: #34e684;
          --background: 222 47% 7%;
          --fg: #f3f4f6;
          --card: #111317;
          --border: rgba(255, 255, 255, 0.16);
          --muted: rgba(255, 255, 255, 0.06);
          --hover: rgba(255, 255, 255, 0.08);
        }
        html, body { background: hsl(var(--background)); color: var(--fg); }

        /* Full width header */
        .ww-header {
          background: var(--card);
          border-bottom: 4px solid var(--accent);
          width: 100vw;
          margin-left: 50%;
          transform: translateX(-50%);
          position: sticky;
          top: 0;
          z-index: 50;
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
        }
        .ww-header__inner {
          max-width: min(100vw - 24px, 1600px);
          margin: 0 auto;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .ww-logo {
          font-weight: 800;
          letter-spacing: 0.2px;
          font-size: 28px;
        }

        .input {
          height: 38px;
          border: 1px solid var(--border);
          border-radius: 8px;
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
          transition: background .15s ease, border-color .15s ease;
        }
        .btn:hover { background: var(--hover); }
        .btn-ghost { background: transparent; }
        .btn-accent {
          background: var(--accent);
          border-color: var(--accent);
          color: #0a0a0a;
          font-weight: 600;
        }

        .border { border-color: var(--border) !important; }
        .border-t { border-top-color: var(--border) !important; }

        /* Sticky table header */
        table { border-collapse: separate; border-spacing: 0; }
        thead.sticky-header th {
          position: sticky;
          top: 0;
          z-index: 2;
          background: var(--card);
          border-bottom: 1px solid var(--border);
          box-shadow: 0 1px 0 var(--border), 0 1px 6px rgba(0,0,0,0.04);
        }

        .row-hover:hover { background: var(--hover); }

        /* HOUSE: narrow & centered */
        td[data-col="auction_house"],
        th[data-col="auction_house"] {
          width: 56px;
          min-width: 56px;
          max-width: 56px;
          text-align: center;
        }

        /* OUTCOME & WOVR: center content so badges are tidy */
        td[data-col="sale_status"], th[data-col="sale_status"],
        td[data-col="wovr_status"], th[data-col="wovr_status"] {
          text-align: center;
        }

        /* VIN: fixed width for 17 chars + badge */
        td[data-col="vin"],
        th[data-col="vin"] {
          width: 24ch;
          min-width: 24ch;
          max-width: 24ch;
          white-space: nowrap;
        }
        td[data-col="vin"] .vin {
          font-family: inherit;
          font-size: inherit;
          letter-spacing: .02em;
        }
        /* VIN badge */
        .vin-badge {
          font-size: 11px;
          line-height: 1;
          padding: 3px 6px;
          border-radius: 9999px;
          border: 1px solid #edc001;
          background: #ffed29;
          color: #000000;
          cursor: pointer;
          margin-left: 8px;
        }

        /* LINK: narrow & centered */
        td[data-col="link"], th[data-col="link"] {
          width: 64px;
          min-width: 64px;
          max-width: 64px;
          text-align: center;
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
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

/** Multi-select with "(ALL) …" group visually separated up top */
function MultiSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string[];
  onChange: (vals: string[]) => void;
  options: string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const toggle = (opt: string) => {
    const set = new Set(value);
    set.has(opt) ? set.delete(opt) : set.add(opt);
    onChange(Array.from(set));
  };

  const allOpts = options.filter(o => o.startsWith('(ALL) '));
  const rawOpts = options.filter(o => !o.startsWith('(ALL) '));

  const label =
    value.length === 0 ? 'All' :
    value.length <= 3 ? value.join(', ') :
    `${value.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="input w-full text-left flex items-center justify-between"
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className="truncate">{label}</span>
        <span className="ml-2">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-[var(--card)] shadow max-h-64 overflow-auto p-2">
          <div className="flex items-center justify-between px-1 pb-2">
            <button className="text-xs underline" onClick={() => onChange([])}>
              Clear (All)
            </button>
            <button
              className="text-xs underline"
              onClick={() => onChange(rawOpts.slice(0, 50))}
              title="Select many raw variants quickly"
            >
              Select many
            </button>
          </div>

          {/* QUICK PICKS: "(ALL) …" */}
          {allOpts.length > 0 && (
            <>
              <div className="px-2 pb-1 text-[11px] uppercase tracking-wide opacity-60">
                Quick picks
              </div>
              {allOpts.map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--hover)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={value.includes(opt)}
                    onChange={() => toggle(opt)}
                  />
                  <span className="truncate font-medium">{opt}</span>
                </label>
              ))}
              <div className="my-2 border-t" />
            </>
          )}

          {/* RAW VARIANTS */}
          <div className="px-2 pb-1 text-[11px] uppercase tracking-wide opacity-60">
            Variants
          </div>
          {rawOpts.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--hover)] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={value.includes(opt)}
                onChange={() => toggle(opt)}
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
