'use client';
import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, EyeOff, Minus, Plus, Save, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, Checkbox, ErrorBox, Input, PageHeader, Spinner, Stat, Table, Td, Th, clsx } from '@/components/ui';
import { ConfirmDialog } from '../../../quotes/_components/common';
import { COUNT_STATUS, Chip, InventoryNav, Ltr, ProductPicker, Qty, SerialInput, errMsg, fmtQty, parseSerials, useRefLabel, type PickedProduct, type StockMove } from '../../_components/common';
import { MoveRow } from '../../_components/move-row';

interface CountLine { productId: string; code: string; expected: string; counted: string | null; serials?: string[]; difference: string | null }
interface CountView {
  id: string; number: string; status: string; warehouseId: string; accuracy: string | null; postedAt: string | null; createdAt: string;
  warehouse: { code: string; nameAr: string } | null; lines: CountLine[];
  progress: { counted: number; total: number; accuracySoFar: number };
  moves?: StockMove[];
}
interface Info { nameAr: string; nameEn: string | null; serialTracked: boolean }
interface Draft { counted: string; serials: string }

const QTY_RE = /^\d+(\.\d{1,3})?$/;

/** Name + serial-tracked flag for the count's products (stock list of the warehouse, then single lookups). */
function useProductInfo(warehouseId: string | undefined, ids: string[]) {
  const stock = useQuery({
    queryKey: ['inv-count-info', warehouseId],
    enabled: !!warehouseId,
    staleTime: 300_000,
    queryFn: async () => {
      const map: Record<string, Info> = {};
      for (let offset = 0; offset < 5000; offset += 200) {
        const r = await api.get<{ rows: { productId: string; nameAr: string; nameEn: string | null; serialTracked: boolean }[]; total: number }>(`/inventory/stock${qs({ warehouseId, limit: 200, offset })}`);
        for (const x of r.rows) map[x.productId] = { nameAr: x.nameAr, nameEn: x.nameEn, serialTracked: x.serialTracked };
        if (offset + 200 >= r.total) break;
      }
      return map;
    },
  });
  const missing = stock.data ? ids.filter((id) => !stock.data[id]) : [];
  const extra = useQuery({
    queryKey: ['inv-count-info-extra', missing.join(',')],
    enabled: missing.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const map: Record<string, Info> = {};
      for (const id of missing) {
        const p = await api.get<{ nameAr: string; nameEn: string | null; serialTracked: boolean }>(`/products/${id}`).catch(() => null);
        if (p) map[id] = { nameAr: p.nameAr, nameEn: p.nameEn, serialTracked: p.serialTracked };
      }
      return map;
    },
  });
  return { ...(stock.data ?? {}), ...(extra.data ?? {}) } as Record<string, Info>;
}

export default function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const refLabel = useRefLabel();
  const canEdit = can('inventory.count') || can('inventory.write');
  const canPost = can('inventory.count');
  const canCost = can('purchase.cost.read');
  const q = useQuery({ queryKey: ['inv-count', id], queryFn: () => api.get<CountView>(`/inventory/counts/${id}`) });
  const c = q.data;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [extraLines, setExtraLines] = useState<CountLine[]>([]);
  const [blind, setBlind] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [found, setFound] = useState<PickedProduct | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  const [postedMoves, setPostedMoves] = useState<StockMove[] | null>(null);
  const [extraInfo, setExtraInfo] = useState<Record<string, Info>>({});

  // (re)initialise the drafts whenever the server copy changes
  const version = c ? `${c.id}:${c.status}:${c.lines.map((l) => `${l.productId}=${l.counted}/${l.serials?.length ?? ''}`).join('|')}` : '';
  useEffect(() => {
    if (!c) return;
    setDrafts(Object.fromEntries(c.lines.map((l) => [l.productId, { counted: l.counted === null ? '' : fmtQty(l.counted).replace(/,/g, ''), serials: (l.serials ?? []).join('\n') }])));
    setExtraLines([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const lines = useMemo(() => [...(c?.lines ?? []), ...extraLines], [c, extraLines]);
  const info = { ...useProductInfo(c?.warehouseId, lines.map((l) => l.productId)), ...extraInfo };
  const editable = !!c && canEdit && ['open', 'submitted'].includes(c.status);

  const isDirty = !!c && (extraLines.length > 0 || c.lines.some((l) => {
    const d = drafts[l.productId];
    if (!d) return false;
    const was = l.counted === null ? '' : String(Number(l.counted));
    const now = d.counted.trim() === '' ? '' : String(Number(d.counted));
    return was !== now || (l.serials ?? []).join('\n') !== parseSerials(d.serials).join('\n');
  }));
  useEffect(() => {
    if (!isDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [isDirty]);

  const counted = lines.filter((l) => (drafts[l.productId]?.counted ?? '').trim() !== '').length;
  const bad = lines.filter((l) => { const v = (drafts[l.productId]?.counted ?? '').trim(); return v !== '' && !QTY_RE.test(v); });

  const save = useMutation({
    mutationFn: () => {
      if (bad.length) throw new Error(bi(`كمية غير صالحة: ${bad.map((l) => l.code).join(', ')}`, `Invalid quantity: ${bad.map((l) => l.code).join(', ')}`));
      return api.put<CountView>(`/inventory/counts/${id}`, {
        lines: lines.map((l) => {
          const d = drafts[l.productId] ?? { counted: '', serials: '' };
          const serials = parseSerials(d.serials);
          return { productId: l.productId, counted: d.counted.trim() === '' ? null : d.counted.trim(), ...(info[l.productId]?.serialTracked || serials.length ? { serials } : {}) };
        }),
      });
    },
    onSuccess: (v) => { qc.setQueryData(['inv-count', id], v); qc.invalidateQueries({ queryKey: ['inv-counts'] }); toast.success(bi('تم الحفظ', 'Saved')); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const post = useMutation({
    mutationFn: async () => {
      if (isDirty) await save.mutateAsync();
      return api.post<CountView>(`/inventory/counts/${id}/post`);
    },
    onSuccess: (v) => {
      qc.setQueryData(['inv-count', id], v);
      setPostedMoves(v.moves ?? []);
      setConfirmPost(false);
      for (const k of ['inv-counts', 'inv-stock', 'inv-moves', 'inv-stock-one']) qc.invalidateQueries({ queryKey: [k] });
      toast.success(bi('رُحّل الجرد', 'Count posted'));
    },
    onError: (e) => { setConfirmPost(false); toast.error(errMsg(e)); },
  });

  if (q.isLoading) return <Spinner />;
  if (!c) return <><PageHeader back="/inventory/counts" title={bi('الجرد', 'Count')} /><ErrorBox error={q.error} /></>;

  const set = (pid: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [pid]: { ...(d[pid] ?? { counted: '', serials: '' }), ...patch } }));
  const bump = (pid: string, delta: number) => {
    const cur = Number(drafts[pid]?.counted || 0);
    set(pid, { counted: String(Math.max(0, (Number.isFinite(cur) ? cur : 0) + delta)) });
  };
  const term = filter.trim().toUpperCase();
  const name = (pid: string) => { const i = info[pid]; return i ? (locale === 'en' ? i.nameEn || i.nameAr : i.nameAr) : ''; };
  const shown = lines.filter((l) => (!onlyOpen || (drafts[l.productId]?.counted ?? '').trim() === '') && (!term || l.code.toUpperCase().includes(term) || name(l.productId).toUpperCase().includes(term)));
  const addFound = () => {
    if (!found) return;
    if (lines.some((l) => l.productId === found.id)) { toast.message(bi('الصنف موجود في القائمة', 'Already in the list')); setFilter(found.code); setFound(null); return; }
    setExtraLines((x) => [...x, { productId: found.id, code: found.code, expected: '0', counted: null, difference: null }]);
    setExtraInfo((x) => ({ ...x, [found.id]: { nameAr: found.nameAr, nameEn: found.nameEn, serialTracked: found.serialTracked } }));
    set(found.id, { counted: '', serials: '' });
    setFound(null);
  };

  // ───────── posted / read-only ─────────
  if (!editable) {
    const diffs = c.lines.filter((l) => l.difference !== null && Number(l.difference) !== 0);
    return (
      <>
        <PageHeader back="/inventory/counts" title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{c.number}</span><Chip map={COUNT_STATUS} value={c.status} /></span>}
          subtitle={<><Ltr>{c.warehouse?.code}</Ltr> {c.warehouse?.nameAr} · <span className="num">{dateTime(c.postedAt ?? c.createdAt)}</span></>} />
        <InventoryNav />
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label={bi('الدقة', 'Accuracy')} tone={c.accuracy !== null ? (Number(c.accuracy) >= 0.98 ? 'green' : 'red') : undefined}
            value={<span dir="ltr" className="num">{c.accuracy !== null ? `${(Number(c.accuracy) * 100).toFixed(1)}%` : `${(c.progress.accuracySoFar * 100).toFixed(1)}%`}</span>} hint={bi('الهدف ≥ 98%', 'Target ≥ 98%')} />
          <Stat label={bi('الأسطر', 'Lines')} value={<span className="num">{c.progress.counted}/{c.progress.total}</span>} />
          <Stat label={bi('تسويات', 'Adjustments')} tone={diffs.length ? 'red' : 'green'} value={<span className="num">{diffs.length}</span>} />
        </div>
        <Card padded={false} className="mb-5" title={bi('النتيجة', 'Result')}>
          <Table>
            <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th className="text-end">{bi('المتوقع', 'Expected')}</Th><Th className="text-end">{bi('المعدود', 'Counted')}</Th><Th className="text-end">{bi('الفرق', 'Difference')}</Th></tr></thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.productId} className={clsx(l.difference !== null && Number(l.difference) !== 0 && 'bg-rose-50/50')}>
                  <Td><Link href={`/inventory/${l.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{l.code}</Link></Td>
                  <Td className="max-w-[16rem] truncate text-xs">{name(l.productId)}</Td>
                  <Td className="text-end"><Qty value={l.expected} /></Td>
                  <Td className="text-end font-bold"><Qty value={l.counted} /></Td>
                  <Td className="text-end">{l.difference !== null && Number(l.difference) > 0 ? <span dir="ltr" className="num font-bold text-ok">+{fmtQty(l.difference)}</span> : <Qty value={l.difference} className="font-bold" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {postedMoves && postedMoves.length > 0 && (
          <Card padded={false} title={bi('حركات التسوية', 'Adjustment moves')}>
            <Table>
              <thead><tr><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('النوع', 'Kind')}</Th><Th>{bi('من ← إلى', 'From → to')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th>{canCost && <Th className="text-end">{bi('تكلفة الوحدة', 'Unit cost')}</Th>}<Th>{bi('المرجع', 'Reference')}</Th></tr></thead>
              <tbody>{postedMoves.map((m) => <MoveRow key={m.id} m={{ ...m, fromCode: m.fromWarehouseId ? c.warehouse?.code : null, toCode: m.toWarehouseId ? c.warehouse?.code : null }} canCost={canCost} refLabel={refLabel} />)}</tbody>
            </Table>
          </Card>
        )}
      </>
    );
  }

  // ───────── counting screen (phone-first) ─────────
  const total = lines.length;
  const pct = total ? Math.round((counted / total) * 100) : 0;
  return (
    <div>
      <PageHeader back="/inventory/counts" title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{c.number}</span><Chip map={COUNT_STATUS} value={c.status} /></span>}
        subtitle={<><Ltr>{c.warehouse?.code}</Ltr> {c.warehouse?.nameAr}</>} />

      <Card className="mb-3">
        <div className="mb-2 flex items-center justify-between text-sm font-bold">
          <span>{bi('التقدم', 'Progress')}</span>
          <span dir="ltr" className="num">{counted}/{total} · {pct}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-tint"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Checkbox label={<span className="inline-flex items-center gap-1"><EyeOff className="size-3.5" />{bi('جرد أعمى (إخفاء المتوقع)', 'Blind count (hide expected)')}</span>} checked={blind} onChange={setBlind} />
          <Checkbox label={bi('غير المعدود فقط', 'Uncounted only')} checked={onlyOpen} onChange={setOnlyOpen} />
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={bi('ابحث بالكود أو الاسم…', 'Search code or name…')} className="min-h-11 ps-9 text-base" />
        </div>
      </Card>

      <ul className="space-y-2">
        {shown.map((l) => {
          const d = drafts[l.productId] ?? { counted: '', serials: '' };
          const st = info[l.productId]?.serialTracked;
          const v = d.counted.trim();
          const invalid = v !== '' && !QTY_RE.test(v);
          const diff = v !== '' && !invalid ? Number(v) - Number(l.expected) : null;
          return (
            <li key={l.productId} className={clsx('rounded-xl border bg-white p-3', v !== '' ? 'border-emerald-300' : 'border-line')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5"><span dir="ltr" className="num font-extrabold text-primary">{l.code}</span>{st && <Badge tone="gold">{bi('تسلسلي', 'Serial')}</Badge>}{v !== '' && <CheckCircle2 className="size-4 text-ok" />}</div>
                  <div className="truncate text-xs text-muted">{name(l.productId)}</div>
                </div>
                {!blind && (
                  <div className="shrink-0 text-end text-xs">
                    <div className="text-muted">{bi('المتوقع', 'Expected')}</div>
                    <Qty value={l.expected} className="text-base font-bold" />
                    {diff !== null && diff !== 0 && <div dir="ltr" className={clsx('num font-bold', diff > 0 ? 'text-ok' : 'text-danger')}>{diff > 0 ? '+' : ''}{fmtQty(diff)}</div>}
                  </div>
                )}
              </div>
              {st ? (
                <div className="mt-2">
                  <SerialInput large value={d.serials} rows={3} expected={blind ? null : Number(l.expected)}
                    onChange={(s) => set(l.productId, { serials: s, counted: String(parseSerials(s).length) })} />
                  <div className="mt-1 text-xs text-muted">{bi('الكمية المعدودة = عدد الأرقام التسلسلية', 'Counted = number of serials')}: <span dir="ltr" className="num font-bold text-ink">{v || '—'}</span>
                    {v === '' && <button type="button" className="ms-2 font-bold text-gold-dark underline" onClick={() => set(l.productId, { counted: '0' })}>{bi('لا يوجد (0)', 'None (0)')}</button>}</div>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={() => bump(l.productId, -1)} className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-primary active:bg-tint" aria-label={bi('إنقاص', 'Decrease')}><Minus className="size-5" /></button>
                  <input dir="ltr" inputMode="decimal" value={d.counted} onChange={(e) => set(l.productId, { counted: e.target.value })} placeholder={bi('المعدود', 'Counted')}
                    className={clsx('min-h-12 w-full min-w-0 rounded-xl border bg-white px-3 text-center text-xl font-extrabold outline-none focus:border-gold focus:ring-2 focus:ring-gold/20', invalid ? 'border-danger' : 'border-line')} />
                  <button type="button" onClick={() => bump(l.productId, 1)} className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-primary active:bg-tint" aria-label={bi('زيادة', 'Increase')}><Plus className="size-5" /></button>
                  {!blind && v === '' && <button type="button" onClick={() => set(l.productId, { counted: String(Number(l.expected)) })} className="min-h-12 shrink-0 rounded-xl border border-gold/50 bg-tint px-3 text-xs font-bold text-gold-dark">{bi('مطابق', 'Matches')}</button>}
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="py-8 text-center text-sm text-muted">{bi('لا أسطر', 'No lines')}</li>}
      </ul>

      <Card className="mt-4" title={bi('صنف موجود غير متوقع', 'Found an unexpected item')}>
        <div className="flex gap-2">
          <ProductPicker className="min-w-0 flex-1" value={found} onChange={setFound} />
          <Button disabled={!found} icon={<Plus className="size-4" />} onClick={addFound}>{bi('إضافة', 'Add')}</Button>
        </div>
      </Card>

      <div className="sticky bottom-0 z-20 mt-4 rounded-t-xl border border-line bg-white/95 px-3 py-3 shadow-[0_-4px_12px_rgba(0,0,0,.06)] backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="me-auto text-xs text-muted">{isDirty ? <span className="font-bold text-amber-700">{bi('تغييرات غير محفوظة', 'Unsaved changes')}</span> : bi('محفوظ', 'Saved')}</span>
          <Button variant="outline" className="min-h-12" loading={save.isPending} disabled={!isDirty} icon={<Save className="size-4" />} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button>
          {canPost && <Button className="min-h-12" disabled={counted < total || bad.length > 0} title={counted < total ? bi('عُدّ كل الأسطر أولًا', 'Count every line first') : undefined} icon={<Send className="size-4" />} onClick={() => setConfirmPost(true)}>{bi('ترحيل الجرد', 'Post count')}</Button>}
        </div>
      </div>

      <ConfirmDialog open={confirmPost} title={bi('ترحيل الجرد', 'Post the count')} confirmLabel={bi('ترحيل', 'Post')} loading={post.isPending || save.isPending}
        message={bi('ستُرحَّل كل الفروقات كحركات تسوية بمتوسط التكلفة، ولا يمكن تعديل الجرد بعد ذلك.', 'Every difference becomes an adjustment move at average cost; the count cannot change afterwards.')}
        onConfirm={() => post.mutate()} onClose={() => setConfirmPost(false)} />
    </div>
  );
}
