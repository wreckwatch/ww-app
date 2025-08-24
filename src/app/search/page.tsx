'use client';

import { useEffect, useMemo, useState } from 'react';
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
  { id: 'date_display',  label: 'Date' },   // we render from sold_date || auction_date
  { id: 'auction_house', label: 'House' },
  { id: 'buyer_number',  label: 'Buyer' },
  { id: 'state',         label: 'State' },
  { id: 'link',          label: 'Link' },   // NEW column
] as const;

// Minimal list of columns fetched from DB (include id for stable keys)
// NOTE: include url, auction_date, sold_date to power link/date behaviors
const QUERY_COLUMNS = [
  'id',
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
  'sold_date',
  'auction_date',
  'auction_house',
  'buyer_number',
  'state',
  'url',
];

/** Columns allowed for sorting */
const SORTABLE = new Set<string>([
  'year','make','model','sub_model','vin','odometer','wovr_status','incident_type',
  'sale_status','sold_price','sold_date','auction_date','auction_house','buyer_number',
  'state','id'
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
    // Damage is multi-select:
    incident_type_multi: [] as string[],
    priceMin: '',
    priceMax: '',
    auction_house: '',
    state: '',
    // Date range that matches sold_date OR auction_date
    dateFrom: '',
    dateTo: '',
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

  /** Load dropdown options */
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

  useEffect(() => { loadAllOptions(); }, []);

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
  useEffect(() => { fetchData(); }, [debounced, sort, page, pageSize]);

  function update(k: keyof typeof filters, v: any) {
    setPage(1);
    setFilters((s) => ({ ...s, [k]: v }));
  }
  const onInput = (k: keyof typeof filters) => (e: InputChange) => update(k, e.target.value);
  const onSelect = (k: keyof typeof filters) => (e: SelectChange) => update(k, e.target.value);

  async function fetchData() {
    setLoading(true);
    setError('');
    try {
      // Normalize numeric ranges
      let { yearFrom, yearTo, priceMin, priceMax } = debounced;
      if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) {
        [yearFrom, yearTo] = [yearTo, yearFrom];
      }
      if (priceMin && priceMax && Number(priceMin) > Number(priceMax)) {
        [priceMin, priceMax] = [priceMax, priceMin];
      }

      let q = supabase.from(TABLE).select(QUERY_COLUMNS.join(','), { count: 'exact' });

      // VIN exact (case-insensitive)
      if (debounced.vin.trim()) q = q.ilike('vin', debounced.vin.trim());
      // Buyer number exact (case-insensitive)
      if (debounced.buyer_no.trim()) q = q.ilike('buyer_number', debounced.buyer_no.trim());

      if (debounced.make) q = q.eq('make', debounced.make);
      if (debounced.model) q = q.eq('model', debounced.model);
      if (yearFrom) q = q.gte('year', Number(yearFrom));
      if (yearTo) q = q.lte('year', Number(yearTo));
      if (debounced.wovr_status) q = q.eq('wovr_status', debounced.wovr_status);
      if (debounced.sale_status) q = q.eq('sale_status', debounced.sale_status);

      // Damage multi-select: OR each choice
      if (debounced.incident_type_multi.length > 0) {
        const ors = debounced.incident_type_multi
          .map((opt) => `incident_type.eq.${encodeURIComponent(opt)}`)
          .join(',');
        q = q.or(ors);
      }

      if (priceMin) q = q.gte('sold_price', Number(priceMin));
      if (priceMax) q = q.lte('sold_price', Number(priceMax));
      if (debounced.auction_house) q = q.eq('auction_house', debounced.auction_house);
      if (debounced.state) q = q.eq('state', debounced.state);

      // Date range (OR across sold_date and auction_date)
      const { dateFrom, dateTo } = debounced;
      const df = dateFrom ? new Date(dateFrom) : null;
      const dt = dateTo ? new Date(dateTo) : null;
      if (df || dt) {
        // Build range strings in ISO (date only)
        const lower = df ? df.toISOString() : null;
        const upper = dt ? new Date(dt.getTime() + 24 * 60 * 60 * 1000).toISOString() : null; // inclusive end

        // Compose OR: and(sold_date >= lower, sold_date < upper) , and(auction_date >= lower, auction_date < upper)
        const parts: string[] = [];
        if (lower && upper) {
          parts.push(`and(sold_date.gte.${lower},sold_date.lt.${upper})`);
          parts.push(`and(auction_date.gte.${lower},auction_date.lt.${upper})`);
        } else if (lower) {
          parts.push(`sold_date.gte.${lower}`);
          parts.push(`auction_date.gte.${lower}`);
        } else if (upper) {
          parts.push(`sold_date.lt.${upper}`);
          parts.push(`auction_date.lt.${upper}`);
        }
        q = q.or(parts.join(','));
      }

      // Sort
      const sortCol = SORTABLE.has(sort.column) ? sort.column : 'id';
      q = q.order(sortCol, { ascending: sort.direction === 'asc' });

      // Paging
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
      incident_type_multi: [],
      priceMin: '',
      priceMax: '',
      auction_house: '',
      state: '',
      dateFrom: '',
      dateTo: '',
    });
    setPage(1);
  }

  /** ----- cell renderers ----- */

  function renderWovrCell(v: string) {
    if (!v) return '—';
    const map: Record<string, string> = {
      'Statutory Write-Off': '/staticon.png',
      'Repairable Write-Off': '/repairicon.png',
      'WOVR N/A': '/wovrnaicon.png',
      'Inspection Passed Repairable Writeoff': '/inspectedicon.png',
    };
    const src = map[v];
    if (!src) return v;
    return <img src={src} alt={v} width={88} height={28} style={{ display: 'inline-block' }} />;
  }

  function renderOutcomeCell(v: string) {
    if (!v) return '—';
    if (v.toUpperCase() === 'SOLD') {
      return <img src="/soldicon.webp" alt="SOLD" width={68} height={24} style={{ display: 'inline-block' }} />;
    }
    return v;
  }

  function renderHouseCell(v: string) {
    if (!v) return '—';
    if (v.toLowerCase() === 'pickles') {
      return <img src="/picon.png" alt="Pickles" width={16} height={16} style={{ display: 'inline-block' }} />;
    }
    return v;
  }

  // NEW: link renderer per your rule (hide if no date; show before cutoff; hide after +7 days)
  function renderLinkCell(r: any) {
    const href = typeof r.url === 'string' ? r.url.trim() : '';
    if (!href) return '—';

    const ts = (d: any) => {
      if (!d) return NaN;
      const n = Date.parse(String(d));
      return Number.isFinite(n) ? n : NaN;
    };

    const AUCTION = ts(r.auction_date);
    const SOLD = ts(r.sold_date);

    // If neither date exists, DO NOT show the link
    if (!Number.isFinite(AUCTION) && !Number.isFinite(SOLD)) return '—';

    if (Number.isFinite(AUCTION)) {
      const cutoff = AUCTION + 7 * 24 * 60 * 60 * 1000;
      if (Date.now() > cutoff) return '—';
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          Link
        </a>
      );
    }
    if (Number.isFinite(SOLD)) {
      const cutoff = SOLD + 7 * 24 * 60 * 60 * 1000;
      if (Date.now() > cutoff) return '—';
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          Link
        </a>
      );
    }
    return '—';
  }

  function displayDate(r: any) {
    const d = r.sold_date || r.auction_date;
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString();
  }

  // Damage multi-select menu state
  const [showDamageMenu, setShowDamageMenu] = useState(false);

  const damageLabel = useMemo(() => {
    const n = filters.incident_type_multi.length;
    if (n === 0) return 'All';
    if (n === 1) return filters.incident_type_multi[0];
    return `${n} selected`;
  }, [filters.incident_type_multi]);

  return (
    <div className="min-h-screen">
      {/* Full-width brand bar with thin accent */}
      <header className="ww-header">
        <div className="ww-header__inner">
          <div className="ww-logo text-2xl md:text-3xl font-black tracking-wide">WreckWatch</div>
          <ThemeToggleButton />
        </div>
      </header>

      {/* Page container */}
      <div className="mx-auto w-full max-w-[min(100vw-24px,1600px)] p-6">
        {/* Filters */}
        <div className="rounded-lg border p-4 mb-6 bg-[var(--card)]">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
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
              <input className="input" type="number" value={filters.yearFrom} onChange={onInput('yearFrom')} placeholder="e.g. 2015" />
            </Field>

            <Field label="Year (To)">
              <input className="input" type="number" value={filters.yearTo} onChange={onInput('yearTo')} placeholder="e.g. 2024" />
            </Field>

            <Field label="WOVR Status">
              <Select value={filters.wovr_status} onChange={onSelect('wovr_status')} options={opts.wovr_status} loading={optsLoading} />
            </Field>

            <Field label="Sale Status">
              <Select value={filters.sale_status} onChange={onSelect('sale_status')} options={opts.sale_status} loading={optsLoading} />
            </Field>

            {/* Damage multi-select */}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600 dark:text-gray-300">Damage</span>
              <button
                type="button"
                className="input flex items-center justify-between"
                onClick={() => setShowDamageMenu((o) => !o)}
              >
                <span>{damageLabel}</span>
                <span className="opacity-60">▾</span>
              </button>
              {showDamageMenu && (
                <div className="mt-2 rounded-md border bg-[var(--card)] p-2 max-h-64 overflow-auto">
                  <div className="flex items-center gap-2 p-2">
                    <button
                      className="btn"
                      onClick={() => update('incident_type_multi', [])}
                      disabled={optsLoading}
                    >
                      Clear All
                    </button>
                    <button
                      className="btn"
                      onClick={() => update('incident_type_multi', [...opts.incident_type])}
                      disabled={optsLoading}
                    >
                      Select All
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {opts.incident_type.map((opt) => {
                      const checked = filters.incident_type_multi.includes(opt);
                      return (
                        <li key={opt} className="px-2 py-1">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set(filters.incident_type_multi);
                                if (e.target.checked) next.add(opt);
                                else next.delete(opt);
                                update('incident_type_multi', Array.from(next));
                              }}
                            />
                            <span>{opt}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </label>

            <Field label="Price Min">
              <input className="input" type="number" value={filters.priceMin} onChange={onInput('priceMin')} placeholder="e.g. 1000" />
            </Field>

            <Field label="Price Max">
              <input className="input" type="number" value={filters.priceMax} onChange={onInput('priceMax')} placeholder="e.g. 50000" />
            </Field>

            <Field label="Auction House">
              <Select value={filters.auction_house} onChange={onSelect('auction_house')} options={opts.auction_house} loading={optsLoading} />
            </Field>

            <Field label="State">
              <Select value={filters.state} onChange={onSelect('state')} options={opts.state} loading={optsLoading} />
            </Field>

            {/* Date range: matches SOLD or AUCTION dates */}
            <Field label="Date (From)">
              <input className="input" type="date" value={filters.dateFrom} onChange={onInput('dateFrom')} />
            </Field>
            <Field label="Date (To)">
              <input className="input" type="date" value={filters.dateTo} onChange={onInput('dateTo')} />
            </Field>

            <div className="flex items-end gap-2">
              <button
                className="btn btn-accent"
                onClick={() => { setPage(1); fetchData(); }}
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
              Results <span className="ml-2 rounded-full bg-black/10 dark:bg-white/10 px-2 py-0.5">{total.toLocaleString()} items</span>
            </div>
            <div className="flex items-center gap-2">
              <select className="input w-28" value={String(pageSize)} onChange={(e: SelectChange) => setPageSize(Number(e.target.value))}>
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={String(n)}>{n} / page</option>
                ))}
              </select>
              <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
              <div className="text-sm tabular-nums">{page} / {totalPages}</div>
              <button className="btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
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
                      onClick={() => toggleSort(id === 'date_display' ? 'sold_date' : id)} // sort by sold_date when clicking "Date"
                      className="px-3 py-2 text-left cursor-pointer"
                      style={id === 'auction_house' ? { width: 64 } : id === 'link' ? { width: 80 } : undefined}
                    >
                      <div className="inline-flex items-center gap-2">
                        <span>{label}</span>
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
                    <td colSpan={DISPLAY.length} className="p-8 text-center text-gray-400">No results.</td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-t row-hover">
                    {DISPLAY.map(({ id }) => {
                      let content: any = r[id as keyof typeof r];

                      if (id === 'sold_price' && r.sold_price != null) {
                        content = `$${Number(r.sold_price).toLocaleString()}`;
                      } else if (id === 'vin') {
                        content = <span className="vin">{r.vin}</span>;
                      } else if (id === 'wovr_status') {
                        content = renderWovrCell(r.wovr_status);
                      } else if (id === 'sale_status') {
                        content = renderOutcomeCell(r.sale_status);
                      } else if (id === 'auction_house') {
                        content = renderHouseCell(r.auction_house);
                      } else if (id === 'date_display') {
                        content = displayDate(r);
                      } else if (id === 'link') {
                        content = renderLinkCell(r);
                      } else if (content == null || content === '') {
                        content = '—';
                      }

                      return (
                        <td
                          key={id}
                          className="px-3 py-2"
                          data-col={id}
                          style={id === 'auction_house' ? { width: 64 } : id === 'link' ? { width: 80 } : undefined}
                        >
                          {content}
                        </td>
                      );
                    })}
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
          --accent: #32cd32;
          --background: 220 20% 97%;
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
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .ww-logo { font-weight: 900; letter-spacing: 0.2px; }

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

        /* VIN: same font as body, fixed to 17ch, no wrapping */
        td[data-col="vin"] .vin { white-space: nowrap; }
        td[data-col="vin"] { min-width: 17ch; max-width: 17ch; white-space: nowrap; }

        /* House column narrow; Link column narrow */
        td[data-col="auction_house"] { width: 64px; }
        td[data-col="link"] { width: 80px; text-align: left; }
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
