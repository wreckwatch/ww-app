'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type InputChange = React.ChangeEvent<HTMLInputElement>;
type SelectChange = React.ChangeEvent<HTMLSelectElement>;

const TABLE = 'vehicles';

// 🔧 Adjust these if your schema names differ
const BUYER_TABLE = 'buyer_number';          // e.g. 'buyer_numbers'
const BUYER_NO_COL = 'buyer_number';         // the column that stores the buyer number string
// Try mappings in this order: <value in buyer table> joins to <column in vehicles>
const BUYER_LINKS: Array<{ from: string; to: string }> = [
  { from: 'vin',           to: 'vin' },
  { from: 'vehicle_id',    to: 'id' },
  { from: 'auction_number',to: 'auction_number' },
  { from: 'stock_no',      to: 'stock_no' },
];

// Your actual columns in vehicles
const COLUMNS = [
  'id','title','make','model','sub_model','year','vin','odometer',
  'wovr_status','sale_status','sold_price','sold_date',
  'auction_house','stock_no','auction_number','state','color'
] as const;

const DISPLAY: [string, string][] = [
  ['sold_date','Sold'],
  ['title','Title'],
  ['make','Make'],
  ['model','Model'],
  ['year','Year'],
  ['vin','VIN'],
  ['odometer','Odometer'],
  ['wovr_status','WOVR'],
  ['sale_status','Sale Status'],
  ['sold_price','Sold $'],
  ['auction_house','House'],
  ['stock_no','Stock #'],
  ['auction_number','Auction #'],
  ['state','State'],
];

const SORTABLE = new Set(COLUMNS);

// ---------- helpers ----------
function useDebounce<T>(val: T, ms = 400) {
  const [v, setV] = useState(val);
  useEffect(() => { const id = setTimeout(()=>setV(val), ms); return ()=>clearTimeout(id); }, [val, ms]);
  return v;
}

function uniqDefined<T>(arr: (T | null | undefined)[]) {
  return Array.from(new Set(arr.filter((x): x is T => x != null)));
}

// Look up buyer links → return vehicles filter like { col:'vin', values:[...] }
async function findBuyerTargets(buyerNo: string): Promise<null | { col: string; values: (string|number)[] }> {
  for (const map of BUYER_LINKS) {
    const { from, to } = map;
    try {
      // exact case-insensitive match on buyer number (no wildcards)
      const { data, error } = await supabase
        .from(BUYER_TABLE)
        .select(from)
        .ilike(BUYER_NO_COL, buyerNo) // ilike with no % = exact, case-insensitive
        .limit(1000);

      if (error) continue;
      const values = uniqDefined((data ?? []).map((r: any) => r[from]));
      if (values.length > 0) {
        return { col: to, values };
      }
    } catch {
      // try next mapping
    }
  }
  return null;
}

export default function SearchPage() {
  const [filters, setFilters] = useState({
    vin:'', buyer_no:'', make:'', model:'', yearFrom:'', yearTo:'',
    wovr_status:'', sale_status:'', priceMin:'', priceMax:'', auction_house:'', state:''
  });
  const debounced = useDebounce(filters, 400);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [opts, setOpts] = useState<Record<string, string[]>>({
    make:[], model:[], wovr_status:[], sale_status:[], auction_house:[], state:[]
  });
  const [optsLoading, setOptsLoading] = useState(false);

  // Default: newest sales first (fallback to id if sold_date missing)
  const [sort, setSort] = useState<{column: string; direction: 'asc'|'desc'}>({
    column: 'sold_date', direction: 'desc'
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const totalPages = useMemo(()=> Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  // ---------- DISTINCT OPTIONS VIA RPC ----------
  async function loadAllOptions(make?: string) {
    setOptsLoading(true);

    const [
      { data: makeData },
      { data: wovrData },
      { data: saleData },
      { data: houseData },
      { data: stateData },
      modelRes
    ] = await Promise.all([
      supabase.rpc('distinct_make'),
      supabase.rpc('distinct_wovr_status'),
      supabase.rpc('distinct_sale_status'),
      supabase.rpc('distinct_auction_house'),
      supabase.rpc('distinct_state'),
      make ? supabase.rpc('distinct_model', { make_filter: make }) : supabase.rpc('distinct_model')
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

  useEffect(() => { loadAllOptions(); }, []);

  // When Make changes, refresh Model options scoped to that Make
  useEffect(() => {
    (async () => {
      if (!filters.make) { loadAllOptions(undefined); return; }
      const { data } = await supabase.rpc('distinct_model', { make_filter: filters.make });
      const models = (data ?? []).map((r:any) => r.model);
      setOpts(o => ({ ...o, model: models }));
      if (filters.model && !models.includes(filters.model)) {
        setFilters(f => ({ ...f, model: '' }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.make]);

  // ---------- FETCH DATA ----------
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, [debounced, sort, page, pageSize]);

  function update(k: string, v: string){ setPage(1); setFilters(s => ({ ...s, [k]: v })); }
  const onInput  = (k:string) => (e: InputChange)  => update(k, e.target.value);
  const onSelect = (k:string) => (e: SelectChange) => update(k, e.target.value);

  async function fetchData() {
    setLoading(true); setError('');
    try {
      // guard ranges
      let { yearFrom, yearTo, priceMin, priceMax } = debounced;
      if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) [yearFrom, yearTo] = [yearTo, yearFrom];
      if (priceMin && priceMax && Number(priceMin) > Number(priceMax)) [priceMin, priceMax] = [priceMax, priceMin];

      let q = supabase.from(TABLE).select(COLUMNS.join(','), { count:'exact' });

      const f = { ...debounced, yearFrom, yearTo, priceMin, priceMax };

      // VIN: exact only, case-insensitive
      if (f.vin.trim()) {
        const vin = f.vin.trim();
        q = q.ilike('vin', vin);
      }

      // Buyer number: exact (case-insensitive) → lookup → filter vehicles by join column
      if (f.buyer_no.trim()) {
        const target = await findBuyerTargets(f.buyer_no.trim());
        if (!target || target.values.length === 0) {
          setRows([]); setTotal(0); setLoading(false); return; // nothing maps
        }
        q = q.in(target.col as any, target.values as any[]);
      }

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

      const sortCol = SORTABLE.has(sort.column as any) ? sort.column : 'id';
      q = q.order(sortCol, { ascending: sort.direction === 'asc' });

      const from = (page - 1) * pageSize, to = from + pageSize - 1;
      q = q.range(from, to);

      const { data, error, count } = await q;
      if (error) throw error;
      setRows(data || []); setTotal(count || 0);
    } catch (e:any) {
      setError(e.message || 'Failed to fetch');
    } finally { setLoading(false); }
  }

  function toggleSort(col:string){
    setSort(s => ({ column: col, direction: s.column===col && s.direction==='asc' ? 'desc' : 'asc' }));
  }

  function clearFilters() {
    setFilters({
      vin:'', buyer_no:'', make:'', model:'', yearFrom:'', yearTo:'',
      wovr_status:'', sale_status:'', priceMin:'', priceMax:'', auction_house:'', state:''
    });
    setPage(1);
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="text-2xl font-semibold mb-4">WreckWatch Search</h1>

      {/* Filters */}
      <div className="rounded-lg border p-4 mb-6">
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
            <button className="btn" onClick={fetchData} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
            <button className="btn" onClick={clearFilters} disabled={loading}>Clear</button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="text-sm">
            Results <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5">{total.toLocaleString()} items</span>
          </div>
          <div className="flex items-center gap-2">
            <select className="input w-28" value={String(pageSize)} onChange={(e: SelectChange)=>setPageSize(Number(e.target.value))}>
              {[10,25,50,100].map(n=> <option key={n} value={String(n)}>{n} / page</option>)}
            </select>
            <button className="btn" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1}>Prev</button>
            <div className="text-sm tabular-nums">{page} / {totalPages}</div>
            <button className="btn" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page>=totalPages}>Next</button>
          </div>
        </div>

        {error && <div className="p-4 text-red-500 text-sm">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black/5">
              <tr>
                {DISPLAY.map(([id,label]) => (
                  <th key={id} onClick={()=>toggleSort(id)} className="px-3 py-2 text-left cursor-pointer">
                    <div className="inline-flex items-center gap-2">
                      <span>{label}</span>
                      {sort.column===id && <span className="text-xs uppercase text-gray-500">{sort.direction}</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && <tr><td colSpan={DISPLAY.length} className="p-8 text-center text-gray-400">No results.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} className="border-t hover:bg-black/5">
                  {DISPLAY.map(([id]) => (
                    <td key={id} className="px-3 py-2">
                      {id === 'sold_date' && r.sold_date ? new Date(r.sold_date).toLocaleString() :
                       id === 'sold_price' && r.sold_price != null ? `$${Number(r.sold_price).toLocaleString()}` :
                       id === 'vin' || id === 'stock_no' || id === 'auction_number'
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
        .input { height: 38px; border: 1px solid rgba(0,0,0,.1); border-radius: 10px; padding: 0 10px; background: white; color: #111; }
        .btn { height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(0,0,0,.12); background: white; }
      `}</style>
    </div>
  );
}

function Field({label, children}:{label:string;children:any}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value, onChange, options, loading,
}:{
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: string[];
  loading?: boolean;
}) {
  return (
    <select className="input" value={value} onChange={onChange} disabled={loading}>
      <option value="">{loading ? 'Loading…' : 'All'}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

