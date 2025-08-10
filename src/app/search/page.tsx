'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type InputChange = React.ChangeEvent<HTMLInputElement>;
type SelectChange = React.ChangeEvent<HTMLSelectElement>;

const TABLE = 'vehicles';

// Columns that actually exist in your table
const COLUMNS = [
  'id','title','make','model','sub_model','year','vin','odometer',
  'wovr_status','sale_status','sold_price','sold_date',
  'auction_house','stock_no','auction_number','state','color'
];

// Which columns to show in the table (key, label)
const DISPLAY: [keyof any, string][] = [
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

function useDebounce<T>(val: T, ms = 400) {
  const [v, setV] = useState(val);
  useEffect(() => { const id = setTimeout(()=>setV(val), ms); return ()=>clearTimeout(id); }, [val, ms]);
  return v;
}

export default function SearchPage() {
  const [filters, setFilters] = useState({
    vin:'', make:'', model:'', yearFrom:'', yearTo:'',
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

  // default sort by id (newest first). You can switch to 'sold_date' later.
  const [sort, setSort] = useState<{column: string; direction: 'asc'|'desc'}>({
    column:'id', direction:'desc'
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const totalPages = useMemo(()=> Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  // load dropdown options (skip missing cols safely)
  useEffect(() => {
    (async () => {
      const keys = ['make','model','wovr_status','sale_status','auction_house','state'];
      const next: Record<string,string[]> = {};
      for (const k of keys) {
        try {
          const { data, error } = await supabase
            .from(TABLE).select(k).not(k,'is',null).neq(k,'')
            .order(k,{ascending:true}).limit(1000);
          if (error) throw error;
          next[k] = Array.from(new Set((data||[]).map((r:any)=>r[k]).filter(Boolean)));
        } catch { next[k] = []; }
      }
      setOpts(next);
    })();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, [debounced, sort, page, pageSize]);

  async function fetchData() {
    setLoading(true); setError('');
    try {
      let q = supabase.from(TABLE).select(COLUMNS.join(','), { count:'exact' });

      const f = debounced;
      if (f.vin.trim()) q = q.eq('vin', f.vin.trim());
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

      q = q.order(sort.column, { ascending: sort.direction === 'asc' });
      const from = (page - 1) * pageSize, to = from + pageSize - 1;
      q = q.range(from, to);

      const { data, error, count } = await q;
      if (error) throw error;
      setRows(data || []); setTotal(count || 0);
    } catch (e:any) {
      setError(e.message || 'Failed to fetch');
    } finally { setLoading(false); }
  }

  function update(k: string, v: string){ setPage(1); setFilters(s => ({ ...s, [k]: v })); }
  const onInput  = (k:string) => (e: InputChange)  => update(k, e.target.value);
  const onSelect = (k:string) => (e: SelectChange) => update(k, e.target.value);
  function toggleSort(col:string){
    setSort(s => ({ column: col, direction: s.column===col && s.direction==='asc' ? 'desc' : 'asc' }));
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="text-2xl font-semibold mb-4">WreckWatch Search</h1>

      {/* Filters */}
      <div className="rounded-lg border p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Field label="VIN (exact)"><input className="input" value={filters.vin} onChange={onInput('vin')} placeholder="MR0FZ22G401062065" /></Field>
          <Field label="Make"><Select value={filters.make} onChange={onSelect('make')} options={opts.make} /></Field>
          <Field label="Model"><Select value={filters.model} onChange={onSelect('model')} options={opts.model} /></Field>
          <Field label="Year (From)"><input className="input" type="number" value={filters.yearFrom} onChange={onInput('yearFrom')} /></Field>
          <Field label="Year (To)"><input className="input" type="number" value={filters.yearTo} onChange={onInput('yearTo')} /></Field>
          <Field label="WOVR Status"><Select value={filters.wovr_status} onChange={onSelect('wovr_status')} options={opts.wovr_status} /></Field>
          <Field label="Sale Status"><Select value={filters.sale_status} onChange={onSelect('sale_status')} options={opts.sale_status} /></Field>
          <Field label="Price Min"><input className="input" type="number" value={filters.priceMin} onChange={onInput('priceMin')} /></Field>
          <Field label="Price Max"><input className="input" type="number" value={filters.priceMax} onChange={onInput('priceMax')} /></Field>
          <Field label="Auction House"><Select value={filters.auction_house} onChange={onSelect('auction_house')} options={opts.auction_house} /></Field>
          <Field label="State"><Select value={filters.state} onChange={onSelect('state')} options={opts.state} /></Field>
          <div className="flex items-end"><button className="btn" onClick={fetchData} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button></div>
        </div>
      </div>

      {/* Results */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="text-sm">Results <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5">{total.toLocaleString()} items</span></div>
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
                  <th key={String(id)} onClick={()=>toggleSort(String(id))} className="px-3 py-2 text-left cursor-pointer">
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
                    <td key={String(id)} className="px-3 py-2">
                      {id === 'sold_date' && r.sold_date ? new Date(r.sold_date).toLocaleString() :
                       id === 'sold_price' && r.sold_price != null ? `$${Number(r.sold_price).toLocaleString()}` :
                       id === 'vin' || id === 'stock_no' || id === 'auction_number' ? <span className="font-mono text-xs break-all">{r[id as keyof typeof r]}</span> :
                       r[id as keyof typeof r] ?? '—'}
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
  value, onChange, options,
}:{
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: string[];
}) {
  return (
    <select className="input" value={value} onChange={onChange}>
      <option value="">All</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
