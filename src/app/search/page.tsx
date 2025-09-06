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

/* -------------------- INSIGHTS helpers & UI -------------------- */

type InsightsJson = {
  ok: boolean;
  stats?: { count: number; min: number | null; max: number | null; avg: number | null; median: number | null };
  trend?: { month: string; avg_price: number | null; n: number }[];
  tags?: { tag: string; count: number }[];
};

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}

/* ---------- Responsive MONTHLY chart with dots + tooltip ---------- */
function useSize(ref: React.RefObject<HTMLElement>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function niceTickStep(min: number, max: number, target = 6) {
  const span = Math.max(1, max - min);
  const raw = span / target;
  const pow10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = [1, 2, 2.5, 5, 10].map(k => k * pow10);
  let best = steps[0];
  for (const s of steps) if (Math.abs(raw - s) < Math.abs(raw - best)) best = s;
  return best;
}

function monthTicks(startMs: number, endMs: number) {
  const out: number[] = [];
  const start = new Date(startMs);
  const end = new Date(endMs);
  const d = new Date(start.getFullYear(), start.getMonth(), 1, 0, 0, 0, 0);
  // move to next month boundary if start isn't the 1st
  if (start.getDate() !== 1) d.setMonth(d.getMonth() + 1);
  while (d <= end) {
    out.push(d.getTime());
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function dollars(n: number) { return `$${Math.round(n).toLocaleString()}`; }

function PriceDotsChart({
  points, height = 210,
}: {
  points: { t: number; p: number }[];
  height?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useSize(wrap);

  // Tooltip state
  const [tip, setTip] = useState<{ x: number; y: number; label: string } | null>(null);

  if (!points.length) return (
    <div ref={wrap} className="rounded border p-3">
      <div className="text-xs opacity-70 mb-1">Price timeline (monthly)</div>
      <div className="text-sm opacity-60">No price points</div>
    </div>
  );

  // sort & domain
  const pts = [...points].sort((a, b) => a.t - b.t);
  const xMin = pts[0].t;
  const xMax = pts[pts.length - 1].t;
  const yMin = Math.min(...pts.map(d => d.p));
  const yMax = Math.max(...pts.map(d => d.p));
  const yPad = Math.max(1, Math.round((yMax - yMin) * 0.08));
  // never go below $0
  const ymin = Math.max(0, yMin - yPad);
  const ymax = Math.max(yMin + 1, yMax + yPad);

  // margins for axes
  const ml = 64, mr = 12, mt = 12, mb = 40;
  const W = Math.max(320, width || 720);
  const H = height;

  // scales
  const x = (t: number) => ml + ( (t - xMin) / Math.max(1, xMax - xMin) ) * (W - ml - mr);
  const y = (v: number) => H - mb - ( (v - ymin) / Math.max(1, ymax - ymin) ) * (H - mt - mb);

  // ticks
  const yStep = niceTickStep(ymin, ymax, 5);
  const yTicks: number[] = [];
  const yStart = Math.floor(ymin / yStep) * yStep;
  for (let v = yStart; v <= ymax + 0.001; v += yStep) yTicks.push(v);

  const xTicks = monthTicks(xMin, xMax);

  // line path (dotted like your screenshot)
  const path = pts.map((d, i) => `${i ? 'L' : 'M'}${x(d.t)},${y(d.p)}`).join(' ');

  // x labels (rotate)
  const fmtX = (t: number) => {
    const d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  };

  // Tooltip helpers (find nearest point)
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // invert x: find t from mx
    const tGuess = xMin + ((mx - ml) / Math.max(1, W - ml - mr)) * (xMax - xMin);

    // nearest by x (binary search would be fine; linear is OK for <= 2k)
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(pts[i].t - tGuess);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const p = pts[bestIdx];
    setTip({ x: x(p.t), y: y(p.p), label: dollars(p.p) });
  }
  function onLeave() { setTip(null); }

  return (
    <div ref={wrap} className="rounded border p-3 relative">
      <div className="text-xs opacity-70 mb-1">Price timeline (monthly ticks)</div>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ display: 'block' }}
      >
        {/* grid (y) */}
        {yTicks.map((v, i) => (
          <g key={`gy${i}`}>
            <line x1={ml} x2={W - mr} y1={y(v)} y2={y(v)} stroke="currentColor" opacity="0.08" />
            <text x={ml - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" opacity="0.7">
              {dollars(v)}
            </text>
          </g>
        ))}

        {/* grid (x) */}
        {xTicks.map((t, i) => (
          <g key={`gx${i}`}>
            <line x1={x(t)} x2={x(t)} y1={mt} y2={H - mb} stroke="currentColor" opacity="0.06" />
            <text
              x={x(t)} y={H - mb + 18}
              transform={`rotate(35 ${x(t)} ${H - mb + 18})`}
              textAnchor="start" fontSize="10" opacity="0.7"
            >
              {fmtX(t)}
            </text>
          </g>
        ))}

        {/* dotted line */}
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" strokeDasharray="3 4" />

        {/* dots */}
        {pts.map((d, i) => (
          <g key={`pt${i}`}>
            <circle cx={x(d.t)} cy={y(d.p)} r={3} stroke="currentColor" fill="currentColor" />
          </g>
        ))}

        {/* hover marker */}
        {tip && (
          <>
            <line x1={tip.x} x2={tip.x} y1={mt} y2={H - mb} stroke="currentColor" opacity="0.15" />
            <circle cx={tip.x} cy={tip.y} r={5} fill="currentColor" opacity="0.9" />
          </>
        )}
      </svg>

      {/* tooltip */}
      {tip && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(tip.x + 8, 8), (wrap.current?.clientWidth ?? W) - 120),
            top: Math.max(tip.y - 28, 8),
            pointerEvents: 'none',
          }}
          className="px-2 py-1 rounded border bg-[var(--card)] text-xs shadow"
        >
          {tip.label}
        </div>
      )}
    </div>
  );
}

/* ---------- KPIs & tags ---------- */
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function InsightsPanel({
  insights, loading, requiredReady, pricePoints,
}: {
  insights: InsightsJson | null;
  loading: boolean;
  requiredReady: boolean; // make+model+year range present?
  pricePoints: { t: number; p: number }[];
}) {
  const [open, setOpen] = useState(true);

  const top = (insights?.tags ?? []).slice(0, 10);
  const topMax = top.length ? top[0].count : 1;

  return (
    <div className="rounded-lg border mb-6 bg-[var(--card)]">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="font-semibold">Insights</div>
        <div className="text-sm opacity-70">
          {loading ? 'computing…' : (insights?.stats ? `${insights.stats.count.toLocaleString()} matches` : '')}
          <span className="ml-2">{open ? '▴' : '▾'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {!requiredReady && (
            <div className="text-sm opacity-70 p-3 rounded border">
              Set <strong>Make</strong>, <strong>Model</strong>, and a <strong>Year range</strong> to view insights.
            </div>
          )}

          {requiredReady && !insights && !loading && (
            <div className="text-sm opacity-70 p-3 rounded border">
              No data found for the selected filters.
            </div>
          )}

          {requiredReady && insights?.stats && (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <Kpi label="Count" value={String(insights.stats.count)} />
                <Kpi label="Avg price" value={fmtMoney(insights.stats.avg)} />
                <Kpi label="Median" value={fmtMoney(insights.stats.median)} />
                <Kpi label="Min" value={fmtMoney(insights.stats.min)} />
                <Kpi label="Max" value={fmtMoney(insights.stats.max)} />
              </div>

              {/* Monthly chart with dots + tooltip */}
              <PriceDotsChart points={pricePoints} />

              {/* Top tags */}
              <div className="rounded border p-3 mt-4">
                <div className="text-xs opacity-70 mb-2">Top damage tags</div>
                <div className="flex flex-col gap-2">
                  {top.length === 0 && <div className="text-sm opacity-60">No damage data</div>}
                  {top.map(({ tag, count }) => (
                    <div key={tag} className="flex items-center gap-2">
                      <div className="w-40 truncate text-sm">{tag}</div>
                      <div className="flex-1 h-2 rounded bg-[var(--muted)] overflow-hidden">
                        <div
                          className="h-2 bg-[var(--accent)]"
                          style={{ width: `${Math.round((count / topMax) * 100)}%` }}
                          title={`${tag}: ${count}`}
                        />
                      </div>
                      <div className="w-8 text-right text-xs">{count}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-xs opacity-60 mt-3">
                KPIs are server-side aggregates. Chart points are individual sales (max 2,000) for the selected filters.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------- /INSIGHTS helpers & UI -------------------- */

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

      // Build WOVR canonical options
      const wovrMap = new Map<string, Set<string>>();
      for (const r of (wovrRes.data ?? [])) {
        const raw = r.wovr_status as string;
        if (!raw) continue;
        const canon = canonicalizeWovr(raw);
        if (!wovrMap.has(canon)) wovrMap.set(canon, new Set());
        wovrMap.get(canon)!.add(raw);
      }
      const inspectedSet = wovrMap.get('Inspected Write-off') ?? new Set<string>();
      inspectedSet.add('Inspection Passed Repairable Writeoff');
      inspectedSet.add('Inspection Passed Repairable Write-off');
      inspectedSet.add('Inspected Write-off');
      wovrMap.set('Inspected Write-off', inspectedSet);

      const wovrOptions = Array.from(wovrMap.keys()).sort((a, b) => a.localeCompare(b));
      const reverse: Record<string, string[]> = {};
      wovrMap.forEach((set, canon) => { reverse[canon] = Array.from(set); });
      setWovrVariantsMap(reverse);

      // DAMAGE OPTIONS with "(ALL) …"
      const damageRaw: string[] = (damageRes.data ?? []).map((r: any) => r.incident_type).filter(Boolean);
      const tagSet = new Set<string>();
      for (const opt of damageRaw) {
        for (const t of opt.split(',').map((s: string) => s.trim()).filter(Boolean)) tagSet.add(t);
      }
      const allTags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));
      const damageAll = allTags.map(t => `(ALL) ${t}`);
      const damageOptions = [...damageAll, ...damageRaw];

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
      const { data } = await supabase.rpc('distinct_model', { make_filter: filters.make });
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
      if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) [yearFrom, yearTo] = [yearTo, yearFrom];
      if (priceMin && priceMax && Number(priceMin) > Number(priceMax)) [priceMin, priceMax] = [priceMax, priceMin];
      if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];

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

      // WOVR status via canonical -> variants map
      if (f.wovr_status) {
        const variants = wovrVariantsMap[f.wovr_status] ?? [f.wovr_status];
        q = q.in('wovr_status', variants);
      }

      if (f.sale_status) q = q.eq('sale_status', f.sale_status);

      // DAMAGE "(ALL) …" expansion
      if (Array.isArray(f.incident_types) && f.incident_types.length > 0) {
        const allOpts = opts.incident_type ?? [];
        const rawOpts = allOpts.filter(o => !o.startsWith('(ALL) ')); // DB values only
        const expanded = new Set<string>();
        for (const sel of f.incident_types) {
          if (sel.startsWith('(ALL) ')) {
            const tag = sel.slice(6).trim().toLowerCase();
            for (const opt of rawOpts) {
              const tokens = opt.split(',').map(s => s.trim().toLowerCase());
              if (tokens.includes(tag)) expanded.add(opt);
            }
          } else {
            expanded.add(sel);
          }
        }
        q = q.in('incident_type', Array.from(expanded));
      }

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
      case 'inspected write off':
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

  /* -------------------- INSIGHTS: fetch when ready -------------------- */

  const [insights, setInsights] = useState<InsightsJson | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // points for the dot chart
  const [pricePoints, setPricePoints] = useState<{ t: number; p: number }[]>([]);

  // derive damage filters from current selections
  function deriveDamageFilters() {
    const allOpts = opts.incident_type ?? [];
    const rawOpts = allOpts.filter(o => !o.startsWith('(ALL) '));
    const tags = new Set<string>();
    const variants = new Set<string>();
    for (const sel of filters.incident_types) {
      if (sel.startsWith('(ALL) ')) tags.add(sel.slice(6).trim());
      else {
        if (rawOpts.includes(sel)) variants.add(sel);
        else variants.add(sel);
      }
    }
    return { tags: Array.from(tags), variants: Array.from(variants) };
  }

  const requiredReady =
    !!filters.make && !!filters.model && !!filters.yearFrom && !!filters.yearTo;

  // Fetch server-side aggregates
  useEffect(() => {
    if (!requiredReady) { setInsights(null); return; }

    const { tags, variants } = deriveDamageFilters();
    const wovrVariants =
      filters.wovr_status
        ? (wovrVariantsMap[filters.wovr_status] ?? [filters.wovr_status])
        : null;

    setInsightsLoading(true);
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.rpc('ww_insights', {
        p_make: filters.make,
        p_model: filters.model,
        p_year_from: Number(filters.yearFrom),
        p_year_to: Number(filters.yearTo),
        p_date_from: filters.dateFrom ? new Date(filters.dateFrom).toISOString() : null,
        p_date_to:   filters.dateTo   ? new Date(filters.dateTo).toISOString()   : null,
        p_auction_house: filters.auction_house || null,
        p_state: filters.state || null,
        p_damage_tags: tags.length ? tags : null,
        p_damage_variants: variants.length ? variants : null,
        p_vin: filters.vin ? filters.vin : null,
        p_buyer_no: filters.buyer_no ? filters.buyer_no : null,
        p_wovr_variants: wovrVariants,
        p_sale_status: filters.sale_status || null,
        p_price_min: filters.priceMin ? Number(filters.priceMin) : null,
        p_price_max: filters.priceMax ? Number(filters.priceMax) : null,
      });

      if (cancelled) return;
      if (error) {
        console.error('ww_insights error', error);
        setInsights(null);
      } else if (data?.ok) {
        setInsights(data as InsightsJson);
      } else {
        setInsights(null);
      }
      setInsightsLoading(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    requiredReady,
    filters.make, filters.model, filters.yearFrom, filters.yearTo,
    filters.dateFrom, filters.dateTo, filters.auction_house, filters.state,
    filters.vin, filters.buyer_no, filters.wovr_status,
    filters.sale_status, filters.priceMin, filters.priceMax,
    filters.incident_types, opts.incident_type,
  ]);

  // Fetch individual sale points (client-side), capped
  useEffect(() => {
    if (!requiredReady) { setPricePoints([]); return; }

    const fetchPoints = async () => {
      // reuse same filter logic; only select the columns we need
      let q = supabase.from(TABLE).select('sold_price,sold_date,auction_date', { count: 'exact' });

      const f = filters;

      if (f.vin.trim()) q = q.ilike('vin', f.vin.trim());
      if (f.buyer_no.trim()) q = q.ilike('buyer_number', f.buyer_no.trim());

      if (f.make) q = q.eq('make', f.make);
      if (f.model) q = q.eq('model', f.model);
      if (f.yearFrom) q = q.gte('year', Number(f.yearFrom));
      if (f.yearTo) q = q.lte('year', Number(f.yearTo));

      if (f.wovr_status) {
        const variants = wovrVariantsMap[f.wovr_status] ?? [f.wovr_status];
        q = q.in('wovr_status', variants);
      }
      if (f.sale_status) q = q.eq('sale_status', f.sale_status);

      if (Array.isArray(f.incident_types) && f.incident_types.length > 0) {
        const allOpts = opts.incident_type ?? [];
        const rawOpts = allOpts.filter(o => !o.startsWith('(ALL) '));
        const expanded = new Set<string>();
        for (const sel of f.incident_types) {
          if (sel.startsWith('(ALL) ')) {
            const tag = sel.slice(6).trim().toLowerCase();
            for (const opt of rawOpts) {
              const tokens = opt.split(',').map(s => s.trim().toLowerCase());
              if (tokens.includes(tag)) expanded.add(opt);
            }
          } else expanded.add(sel);
        }
        q = q.in('incident_type', Array.from(expanded));
      }

      if (f.priceMin) q = q.gte('sold_price', Number(f.priceMin));
      if (f.priceMax) q = q.lte('sold_price', Number(f.priceMax));
      if (f.auction_house) q = q.eq('auction_house', f.auction_house);
      if (f.state) q = q.eq('state', f.state);

      if (f.dateFrom) q = q.gte('sold_date', toStartOfDayISO(f.dateFrom));
      if (f.dateTo)   q = q.lte('sold_date', toEndOfDayISO(f.dateTo));

      // reasonable cap to keep the SVG snappy
      q = q.order('sold_date', { ascending: true }).limit(2000);

      const { data, error } = await q;
      if (error) {
        console.error('price points error', error);
        setPricePoints([]);
        return;
      }

      const pts = (data ?? [])
        .map((r: any) => {
          const t = Date.parse(r.sold_date ?? r.auction_date);
          const p = typeof r.sold_price === 'number' ? r.sold_price : Number(r.sold_price);
          return Number.isFinite(t) && Number.isFinite(p) ? { t, p } : null;
        })
        .filter(Boolean) as { t: number; p: number }[];

      setPricePoints(pts);
    };

    fetchPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    requiredReady,
    filters.make, filters.model, filters.yearFrom, filters.yearTo,
    filters.dateFrom, filters.dateTo, filters.auction_house, filters.state,
    filters.vin, filters.buyer_no, filters.wovr_status,
    filters.sale_status, filters.priceMin, filters.priceMax,
    filters.incident_types, opts.incident_type, wovrVariantsMap,
  ]);

  /* -------------------- /INSIGHTS -------------------- */

  return (
    <div className="min-h-screen">
      {/* Full-width brand bar with thin accent */}
      <header className="ww-header">
        <div className="ww-header__inner">
          <div className="ww-logo">WreckWatch</div>
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

            <Field label="Auction Date (From)">
              <input className="input" type="date" value={filters.dateFrom} onChange={onInput('dateFrom')} />
            </Field>

            <Field label="Auction Date (To)">
              <input className="input" type="date" value={filters.dateTo} onChange={onInput('dateTo')} />
            </Field>

            <Field label="WOVR Status">
              <Select value={filters.wovr_status} onChange={onSelect('wovr_status')} options={opts.wovr_status} loading={optsLoading} />
            </Field>

            <Field label="Sale Status">
              <Select value={filters.sale_status} onChange={onSelect('sale_status')} options={opts.sale_status} loading={optsLoading} />
            </Field>

            <Field label="Damage">
              <MultiSelect
                options={opts.incident_type}
                value={filters.incident_types}
                onChange={(arr) => update('incident_types', arr)}
                disabled={optsLoading}
              />
            </Field>

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

            <div className="flex items-end gap-2">
              <button className="btn btn-accent" onClick={() => { setPage(1); fetchData(); }} disabled={loading}>
                {loading ? 'Loading…' : 'Search'}
              </button>
              <button className="btn" onClick={clearFilters} disabled={loading}>Clear</button>
              <button className="btn" onClick={goBack} disabled={history.length === 0 || loading} title={history.length ? 'Back to previous results' : 'No previous view'}>⟵ Back</button>
            </div>
          </div>
        </div>

        {/* Insights (collapsible) */}
        <InsightsPanel
          insights={insights}
          loading={insightsLoading}
          requiredReady={requiredReady}
          pricePoints={pricePoints}
        />

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
              <select className="input w-28" value={String(pageSize)} onChange={(e: SelectChange) => setPageSize(Number(e.target.value))}>
                {[10, 25, 50, 100].map((n) => (<option key={n} value={String(n)}>{n} / page</option>))}
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
                  <tr><td colSpan={DISPLAY.length} className="p-8 text-center text-gray-400">No results.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-t row-hover">
                    {DISPLAY.map(({ id }) => (
                      <td key={id} className="px-3 py-2" data-col={id}>
                        {id === 'auction_house' ? (
                          r.auction_house === 'Pickles' ? (
                            <img src="/picon.png" alt="Pickles" width={18} height={18} style={{ display: 'block', margin: '0 auto' }} />
                          ) : r.auction_house === 'Manheim' ? (
                            <img src="/man-logo.png" alt="Manheim" width={22} height={22} style={{ display: 'block', margin: '0 auto' }} />
                          ) : (r.auction_house ?? '—')
                        ) : id === 'sale_status' ? (
                          typeof r.sale_status === 'string' && r.sale_status.trim().toUpperCase() === 'SOLD' ? (
                            <img src="/soldicon.webp" alt="Sold" width={64} height={28} style={{ display: 'block', margin: '0 auto' }} />
                          ) : (r.sale_status ?? '—')
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
                              <button className="vin-badge" title={`Show ${vinCounts[r.vin]} results for this VIN`} onClick={() => focusVinAll(r.vin)}>
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

        .ww-header { background: var(--card); border-bottom: 4px solid var(--accent); width: 100vw;
          margin-left: 50%; transform: translateX(-50%); position: sticky; top: 0; z-index: 50;
          padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }
        .ww-header__inner { max-width: min(100vw - 24px, 1600px); margin: 0 auto; padding: 12px 16px;
          display: flex; align-items: center; justify-content: space-between; }
        .ww-logo { font-weight: 800; letter-spacing: 0.2px; font-size: 28px; }

        .input { height: 38px; border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; background: var(--card); color: var(--fg); }
        .btn { height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--fg); transition: background .15s, border-color .15s; }
        .btn:hover { background: var(--hover); }
        .btn-ghost { background: transparent; }
        .btn-accent { background: var(--accent); border-color: var(--accent); color: #0a0a0a; font-weight: 600; }

        .border { border-color: var(--border) !important; }
        .border-t { border-top-color: var(--border) !important; }

        table { border-collapse: separate; border-spacing: 0; }
        thead.sticky-header th { position: sticky; top: 0; z-index: 2; background: var(--card);
          border-bottom: 1px solid var(--border); box-shadow: 0 1px 0 var(--border), 0 1px 6px rgba(0,0,0,0.04); }
        .row-hover:hover { background: var(--hover); }

        td[data-col="auction_house"], th[data-col="auction_house"] { width: 56px; min-width: 56px; max-width: 56px; text-align: center; }
        td[data-col="sale_status"], th[data-col="sale_status"],
        td[data-col="wovr_status"], th[data-col="wovr_status"] { text-align: center; }

        td[data-col="vin"], th[data-col="vin"] { width: 24ch; min-width: 24ch; max-width: 24ch; white-space: nowrap; }
        td[data-col="vin"] .vin { letter-spacing: .02em; }
        .vin-badge { font-size: 11px; line-height: 1; padding: 3px 6px; border-radius: 9999px; border: 1px solid #edc001; background: #ffed29; color: #000; cursor: pointer; margin-left: 8px; }

        td[data-col="link"], th[data-col="link"] { width: 64px; min-width: 64px; max-width: 64px; text-align: center; }
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
      {options.map((o) => (<option key={o} value={o}>{o}</option>))}
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
            <button className="text-xs underline" onClick={() => onChange([])}>Clear (All)</button>
            <button className="text-xs underline" onClick={() => onChange(rawOpts.slice(0, 50))} title="Select many raw variants quickly">Select many</button>
          </div>

          {/* QUICK PICKS: "(ALL) …" */}
          {allOpts.length > 0 && (
            <>
              <div className="px-2 pb-1 text-[11px] uppercase tracking-wide opacity-60">Quick picks</div>
              {allOpts.map((opt) => (
                <label key={opt} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--hover)] cursor-pointer">
                  <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} />
                  <span className="truncate font-medium">{opt}</span>
                </label>
              ))}
              <div className="my-2 border-t" />
            </>
          )}

          {/* RAW VARIANTS */}
          <div className="px-2 pb-1 text-[11px] uppercase tracking-wide opacity-60">Variants</div>
          {rawOpts.map((opt) => (
            <label key={opt} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--hover)] cursor-pointer">
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} />
              <span className="truncate">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
