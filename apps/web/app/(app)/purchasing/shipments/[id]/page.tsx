'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Calculator, Check, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SHIPMENT_STATUSES, importCharges, toHalalas } from '@mmc/domain';
import { ApiError, api } from '@/lib/api';
import { date, dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { AttachmentList, AttachmentPicker } from '@/components/attachments';
import { Button, Card, Checkbox, clsx, Dialog, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { NumInput } from '../../../quotes/_components/common';
import { Info, LANDED_BASIS, Ltr, PoStatusBadge, SHIP_MODE, SHIP_STATUS, ShipStatusBadge, WarningList, fixed, useLabel } from '../../_components/common';
import { ShipmentDialog } from '../../_components/shipment-form';
import type { LandedResult, ShipmentView } from '../../_components/types';

type Warning = { key: string; ar: string; en: string };

export default function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi, locale, dir } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const qc = useQueryClient();
  const key = ['shipment', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<ShipmentView>(`/inventory/shipments/${id}`) });
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState('');
  const [blocked, setBlocked] = useState<Warning[] | null>(null);
  const [lastWarnings, setLastWarnings] = useState<Warning[]>([]);

  const put = (s: ShipmentView) => { qc.setQueryData(key, s); qc.invalidateQueries({ queryKey: ['shipments'] }); };
  const move = useMutation({
    mutationFn: (force: boolean) => api.post<ShipmentView>(`/inventory/shipments/${id}/status`, { status: target, force: force || undefined }),
    onSuccess: (s) => {
      put(s);
      setBlocked(null);
      setTarget('');
      setLastWarnings(s.warnings ?? []);
      if (s.warnings?.length) toast.warning(bi('تم النقل مع تنبيهات', 'Moved with warnings'));
      else toast.success(bi('تم تحديث حالة الشحنة', 'Shipment status updated'));
    },
    onError: (e) => {
      const w = e instanceof ApiError ? (e.details as { warnings?: Warning[] } | undefined)?.warnings : undefined;
      if (w?.length) setBlocked(w);
      else toast.error((e as Error).message);
    },
  });

  const sh = q.data;
  if (q.isLoading) return <Spinner />;
  if (!sh) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;

  const write = can('purchase.write');
  const canCost = can('purchase.cost.read');
  const idx = SHIPMENT_STATUSES.indexOf(sh.status as (typeof SHIPMENT_STATUSES)[number]);
  const later = SHIPMENT_STATUSES.slice(idx + 1);
  const locked = !!sh.landedPostedAt;
  const Arrow = dir === 'rtl' ? ArrowLeft : ArrowRight;

  return (
    <>
      <PageHeader
        back="/purchasing/shipments"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{sh.number}</span><ShipStatusBadge status={sh.status} /></span>}
        subtitle={<>{sh.supplier?.nameAr ?? bi('بدون مورد', 'No supplier')} · {label(SHIP_MODE, sh.mode)}</>}
        actions={write && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{bi('تعديل بيانات الشحن', 'Edit logistics')}</Button>}
      />

      <Card className="mb-4">
        <ol className="flex flex-wrap items-center gap-1.5">
          {SHIPMENT_STATUSES.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold', i < idx ? 'bg-emerald-100 text-emerald-800' : i === idx ? 'bg-primary text-white' : 'bg-gray-100 text-muted')}>
                {i < idx && <Check className="size-3" />}{label(SHIP_STATUS, s)}
              </span>
              {i < SHIPMENT_STATUSES.length - 1 && <Arrow className="size-3.5 text-muted" />}
            </li>
          ))}
        </ol>
        {write && later.length > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <Field label={bi('نقل إلى', 'Move to')} className="w-48">
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">—</option>
                {later.map((s) => <option key={s} value={s}>{label(SHIP_STATUS, s)}</option>)}
              </Select>
            </Field>
            <Button disabled={!target} loading={move.isPending && !blocked} onClick={() => move.mutate(false)}>{bi('تحديث الحالة', 'Update status')}</Button>
          </div>
        )}
        <WarningList className="mt-3" title={bi('تم النقل رغم التنبيهات', 'Moved despite warnings')} items={lastWarnings} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <DocsCard sh={sh} editable={write} onSaved={put} />
          <DeclarationCard sh={sh} editable={write && canCost && !locked} canCost={canCost} onSaved={put} />
          <ChargesCard sh={sh} editable={write && canCost && !locked} canCost={canCost} onSaved={put} />
          {canCost && <LandedCard sh={sh} editable={write} onPosted={() => qc.invalidateQueries({ queryKey: key })} />}
        </div>
        <div className="space-y-4">
          <Card title={bi('بيانات الشحن', 'Logistics')}>
            <Info label={bi('البوليصة', 'B/L / AWB')}><Ltr>{sh.blNumber}</Ltr></Info>
            <Info label={bi('السفينة / الرحلة', 'Vessel / flight')}><Ltr>{sh.vessel}</Ltr></Info>
            <Info label="ETD"><Ltr>{sh.etd ? date(sh.etd) : null}</Ltr></Info>
            <Info label="ETA"><Ltr>{sh.eta ? date(sh.eta) : null}</Ltr></Info>
            <Info label={bi('المخلص الجمركي', 'Broker')}>{sh.broker ?? '—'}</Info>
            <Info label={bi('الحاويات', 'Containers')}>{sh.containers.length ? <span dir="ltr" className="num text-xs">{sh.containers.join(', ')}</span> : '—'}</Info>
            {sh.notes && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{sh.notes}</p>}
          </Card>
          <Card title={bi('أوامر الشراء', 'Purchase orders')}>
            {sh.orders.length === 0 ? <p className="text-sm text-muted">{bi('لا توجد أوامر مرتبطة.', 'No linked orders.')}</p> : (
              <ul className="space-y-1.5">
                {sh.orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <Link href={`/purchasing/orders/${o.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{o.number}</Link>
                    <span className="flex items-center gap-1.5"><span className="num text-xs text-muted">{o.currency}</span><PoStatusBadge status={o.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={bi('سندات الاستلام', 'Goods receipts')}>
            {sh.receipts.length === 0 ? <p className="text-sm text-muted">{bi('لم يُستلم شيء على هذه الشحنة بعد. استلم من أمر الشراء مع اختيار الشحنة.', 'Nothing received against this shipment yet. Receive from the purchase order and pick this shipment.')}</p> : (
              <ul className="space-y-1.5">
                {sh.receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/purchasing/orders/${r.orderId}`} dir="ltr" className="num font-bold text-primary hover:underline">{r.number}</Link>
                    <span className="num text-xs text-muted">{date(r.receivedOn)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {editing && <ShipmentDialog shipment={sh} open onClose={() => setEditing(false)} onDone={(s) => { put(s); setEditing(false); }} />}
      <Dialog open={!!blocked} onClose={() => setBlocked(null)} title={bi('الشحنة غير جاهزة للتخليص', 'The shipment is not ready for clearance')}
        footer={<><Button variant="outline" onClick={() => setBlocked(null)}>{bi('إلغاء', 'Cancel')}</Button><Button variant="danger" loading={move.isPending} onClick={() => move.mutate(true)}>{bi('المتابعة رغم ذلك', 'Continue anyway')}</Button></>}>
        <ul className="list-disc space-y-1 ps-5 text-sm leading-relaxed text-amber-900">{(blocked ?? []).map((w) => <li key={w.key}>{locale === 'en' ? w.en : w.ar}</li>)}</ul>
        <p className="mt-3 text-xs text-muted">{bi('أكمل المستندات أولًا، أو تابع وسيُسجَّل ذلك في السجل.', 'Complete the documents first, or continue — it will be recorded in the audit log.')}</p>
      </Dialog>
    </>
  );
}

// ───────────────────────── documents checklist ─────────────────────────

function DocsCard({ sh, editable, onSaved }: { sh: ShipmentView; editable: boolean; onSaved: (s: ShipmentView) => void }) {
  const { bi, locale } = useI18n();
  const save = useMutation({
    mutationFn: (d: { key: string; done: boolean; fileId: string | null }) => api.put<ShipmentView>(`/inventory/shipments/${sh.id}/docs`, { docs: { [d.key]: { done: d.done, fileId: d.fileId } } }),
    onSuccess: onSaved,
    onError: (e) => toast.error((e as Error).message),
  });
  const done = sh.checklist.filter((c) => c.done).length;
  return (
    <Card title={<>{bi('مستندات الاستيراد', 'Import documents')} <span className="num ms-1 text-xs font-bold text-muted">{done}/{sh.checklist.length}</span></>} padded={false}>
      <ul className="divide-y divide-line/70">
        {sh.checklist.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <Checkbox checked={c.done} disabled={!editable || save.isPending} onChange={(v) => save.mutate({ key: c.key, done: v, fileId: c.fileId })}
              label={<span className={clsx(c.done && 'text-ok')}>{locale === 'en' ? c.en : c.ar}</span>} />
            <div className="flex items-center gap-2">
              {c.fileId && <AttachmentList ids={[c.fileId]} size="sm" onRemove={editable ? () => save.mutate({ key: c.key, done: c.done, fileId: null }) : undefined} />}
              {editable && !c.fileId && (
                <AttachmentPicker value={[]} multiple={false} label={bi('إرفاق', 'Attach')} onChange={(v) => v[0] && save.mutate({ key: c.key, done: true, fileId: v[0].id })} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ───────────────────────── customs declaration ─────────────────────────

function DeclarationCard({ sh, editable, canCost, onSaved }: { sh: ShipmentView; editable: boolean; canCost: boolean; onSaved: (s: ShipmentView) => void }) {
  const { bi } = useI18n();
  const [fasahNumber, setNo] = useState(sh.fasahNumber ?? '');
  const [fasahDate, setDate] = useState(sh.fasahDate ?? '');
  const [cif, setCif] = useState(sh.cifSar ? String(Number(sh.cifSar)) : '');
  const [mode, setMode] = useState<'rate' | 'amount'>(sh.dutySar ? 'amount' : 'rate');
  const [rate, setRate] = useState('5');
  const [duty, setDuty] = useState(sh.dutySar ? String(Number(sh.dutySar)) : '');
  const cifH = cif ? toHalalas(cif) : 0;
  const dutyH = mode === 'rate' ? importCharges(cifH, Number(rate) || 0).duty : duty ? toHalalas(duty) : 0;
  const vatH = importCharges(cifH + dutyH, 0).importVat;
  const valid = !!fasahNumber.trim() && !!fasahDate && cif !== '' && (mode === 'rate' ? rate !== '' : duty !== '');
  const save = useMutation({
    mutationFn: () => api.put<ShipmentView>(`/inventory/shipments/${sh.id}/declaration`, {
      fasahNumber: fasahNumber.trim(), fasahDate, cifSar: fixed(Number(cif)), ...(mode === 'rate' ? { dutyRatePercent: fixed(Number(rate), 4) } : { dutySar: fixed(Number(duty)) }),
    }),
    onSuccess: (s) => { onSaved(s); toast.success(bi('تم حفظ البيان الجمركي', 'Declaration saved')); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card title={bi('البيان الجمركي (فسح)', 'Customs declaration (FASAH)')}
      actions={editable && <Button size="sm" icon={<Save className="size-3.5" />} disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button>}>
      {!canCost && <p className="mb-3 text-xs text-muted">{bi('المبالغ مخفية — تتطلب صلاحية عرض التكلفة.', 'Amounts are hidden — they need the cost permission.')}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={bi('رقم البيان', 'Declaration no.')}><Input dir="ltr" disabled={!editable} value={fasahNumber} onChange={(e) => setNo(e.target.value)} /></Field>
        <Field label={bi('تاريخ البيان', 'Declaration date')}><Input type="date" dir="ltr" disabled={!editable} value={fasahDate} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={bi('القيمة CIF (ريال)', 'CIF value (SAR)')}><NumInput value={cif} onChange={setCif} disabled={!editable} step="0.01" /></Field>
        <Field label={bi('الرسوم الجمركية', 'Customs duty')}>
          <Select value={mode} disabled={!editable} onChange={(e) => setMode(e.target.value as 'rate' | 'amount')}>
            <option value="rate">{bi('نسبة من CIF', 'Rate on CIF')}</option>
            <option value="amount">{bi('مبلغ بالريال', 'Amount in SAR')}</option>
          </Select>
        </Field>
        {mode === 'rate'
          ? <Field label={bi('نسبة الرسوم %', 'Duty rate %')}><NumInput value={rate} onChange={setRate} disabled={!editable} step="0.5" /></Field>
          : <Field label={bi('الرسوم (ريال)', 'Duty (SAR)')}><NumInput value={duty} onChange={setDuty} disabled={!editable} step="0.01" /></Field>}
      </div>
      {canCost && (
        <div className="mt-3 grid gap-2 rounded-lg bg-tint/50 p-3 text-sm sm:grid-cols-3">
          <div><div className="text-xs font-bold text-muted">{bi('الرسوم', 'Duty')}</div><Money value={dutyH} fixed /></div>
          <div><div className="text-xs font-bold text-muted">{bi('ضريبة الاستيراد 15%', 'Import VAT 15%')}</div><Money value={vatH} fixed /><div className="text-[11px] text-ok">{bi('قابلة للاسترداد — ليست تكلفة', 'Recoverable — not a cost')}</div></div>
          <div><div className="text-xs font-bold text-muted">{bi('المحفوظ', 'Saved')}</div>
            {sh.dutySar !== null ? <span className="text-xs">{bi('رسوم', 'Duty')} <Money value={sh.dutySar} fixed /> · {bi('ضريبة', 'VAT')} <Money value={sh.importVatSar} fixed /></span> : <span className="text-xs text-muted">—</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

// ───────────────────────── charges ─────────────────────────

const CHARGE_KINDS: [string, string, string][] = [
  ['freight', 'شحن دولي', 'Freight'], ['clearance', 'تخليص جمركي', 'Clearance'], ['port', 'رسوم ميناء', 'Port charges'], ['transport', 'نقل داخلي', 'Inland transport'],
  ['insurance', 'تأمين', 'Insurance'], ['saber', 'رسوم سابر', 'SABER fees'], ['storage', 'تخزين / أرضيات', 'Storage / demurrage'], ['other', 'أخرى', 'Other'],
];

function ChargesCard({ sh, editable, canCost, onSaved }: { sh: ShipmentView; editable: boolean; canCost: boolean; onSaved: (s: ShipmentView) => void }) {
  const { bi, locale } = useI18n();
  const [rows, setRows] = useState(() => sh.charges.map((c, i) => ({ k: `c${i}`, kind: c.kind, amount: c.amountSar === null ? '' : String(Number(c.amountSar)), note: c.note ?? '' })));
  const [dirty, setDirty] = useState(false);
  const upd = (k: string, patch: Partial<{ kind: string; amount: string; note: string }>) => { setRows((r) => r.map((x) => (x.k === k ? { ...x, ...patch } : x))); setDirty(true); };
  const kindLabel = (k: string) => { const f = CHARGE_KINDS.find((c) => c[0] === k); return f ? (locale === 'en' ? f[2] : f[1]) : k; };
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const valid = rows.every((r) => r.kind.trim() && r.amount !== '' && Number(r.amount) >= 0);
  const save = useMutation({
    mutationFn: () => api.put<ShipmentView>(`/inventory/shipments/${sh.id}/charges`, { charges: rows.map((r) => ({ kind: r.kind.trim(), amountSar: fixed(Number(r.amount)), ...(r.note.trim() ? { note: r.note.trim() } : {}) })) }),
    onSuccess: (s) => { onSaved(s); setDirty(false); toast.success(bi('تم حفظ المصاريف', 'Charges saved')); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card title={bi('مصاريف الاستيراد', 'Landed charges')} padded={false}
      actions={editable && <>
        <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => { setRows((r) => [...r, { k: `n${Date.now()}`, kind: 'freight', amount: '', note: '' }]); setDirty(true); }}>{bi('إضافة', 'Add')}</Button>
        <Button size="sm" icon={<Save className="size-3.5" />} disabled={!dirty || !valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button>
      </>}>
      {rows.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد مصاريف.', 'No charges.')}</p> : (
        <Table>
          <thead><tr><Th>{bi('النوع', 'Kind')}</Th><Th className="w-40">{bi('المبلغ (ريال)', 'Amount (SAR)')}</Th><Th>{bi('ملاحظة', 'Note')}</Th><Th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <Td>
                  {editable ? (
                    <Select value={CHARGE_KINDS.some((c) => c[0] === r.kind) ? r.kind : 'other'} onChange={(e) => upd(r.k, { kind: e.target.value })}>
                      {CHARGE_KINDS.map((c) => <option key={c[0]} value={c[0]}>{locale === 'en' ? c[2] : c[1]}</option>)}
                    </Select>
                  ) : kindLabel(r.kind)}
                </Td>
                <Td>{editable ? <NumInput value={r.amount} onChange={(v) => upd(r.k, { amount: v })} step="0.01" /> : canCost ? <Money value={r.amount || null} fixed /> : '—'}</Td>
                <Td>{editable ? <Input value={r.note} onChange={(e) => upd(r.k, { note: e.target.value })} /> : <span className="text-xs">{r.note || '—'}</span>}</Td>
                <Td>{editable && <button type="button" onClick={() => { setRows((x) => x.filter((y) => y.k !== r.k)); setDirty(true); }} className="rounded p-1.5 text-muted hover:bg-rose-50 hover:text-danger" aria-label={bi('حذف', 'Remove')}><Trash2 className="size-4" /></button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {canCost && rows.length > 0 && <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5 text-sm font-bold">{bi('الإجمالي', 'Total')}: <Money value={fixed(total)} fixed /></div>}
    </Card>
  );
}

// ───────────────────────── landed cost ─────────────────────────

function LandedCard({ sh, editable, onPosted }: { sh: ShipmentView; editable: boolean; onPosted: () => void }) {
  const { bi } = useI18n();
  const label = useLabel();
  const [basis, setBasis] = useState('value');
  const [result, setResult] = useState<LandedResult | null>(null);
  const chargeH = toHalalas(sh.dutySar ?? '0') + sh.charges.reduce((s, c) => s + toHalalas(c.amountSar ?? '0'), 0);
  const posted = !!sh.landedPostedAt;
  const post = useMutation({
    mutationFn: () => api.post<LandedResult>(`/inventory/shipments/${sh.id}/landed-cost`, { basis }),
    onSuccess: (r) => { setResult(r); onPosted(); toast.success(bi('تم ترحيل تكلفة الاستيراد', 'Landed cost posted')); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card title={bi('تكلفة الاستيراد (Landed cost)', 'Landed cost')}>
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span>{bi('المبلغ للتوزيع (الرسوم + المصاريف)', 'To allocate (duty + charges)')}: <Money value={chargeH} fixed className="font-bold" /></span>
        <span className="text-xs text-muted">{bi('ضريبة الاستيراد لا تُوزَّع (قابلة للاسترداد)', 'Import VAT is not allocated (recoverable)')}</span>
      </div>
      {posted ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-900">
            {bi('رُحّلت', 'Posted')} <span dir="ltr" className="num">{dateTime(sh.landedPostedAt)}</span> — {label(LANDED_BASIS, sh.landedBasis)}
          </div>
          {!result && sh.landedMoves.length > 0 && (
            <ul className="space-y-1 text-xs leading-relaxed text-muted" dir="ltr">{sh.landedMoves.map((m) => <li key={m.id}>{m.note}</li>)}</ul>
          )}
        </div>
      ) : editable && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={bi('أساس التوزيع', 'Allocation basis')} className="w-48">
            <Select value={basis} onChange={(e) => setBasis(e.target.value)}>{Object.keys(LANDED_BASIS).map((b) => <option key={b} value={b}>{label(LANDED_BASIS, b)}</option>)}</Select>
          </Field>
          <Button icon={<Calculator className="size-4" />} disabled={chargeH <= 0 || sh.receipts.length === 0} loading={post.isPending} onClick={() => post.mutate()}>{bi('توزيع وترحيل', 'Allocate & post')}</Button>
          {sh.receipts.length === 0 && <p className="w-full text-xs text-muted">{bi('استلم البضاعة على هذه الشحنة أولًا.', 'Receive goods against this shipment first.')}</p>}
          {chargeH <= 0 && <p className="w-full text-xs text-muted">{bi('سجّل البيان الجمركي أو المصاريف أولًا.', 'Record the declaration or charges first.')}</p>}
          <p className="w-full text-xs text-amber-800">{bi('الترحيل نهائي ويقفل البيان والمصاريف.', 'Posting is final and locks the declaration and charges.')}</p>
        </div>
      )}
      {result && (
        <Table className="mt-3">
          <thead><tr>
            <Th>{bi('المنتج', 'Product')}</Th><Th className="text-end">{bi('الموزَّع', 'Allocated')}</Th><Th className="text-end">{bi('لكل وحدة', 'Per unit')}</Th>
            <Th className="text-end">{bi('متوسط التكلفة قبل', 'Avg before')}</Th><Th className="text-end">{bi('متوسط التكلفة بعد', 'Avg after')}</Th>
          </tr></thead>
          <tbody>
            {result.products.map((p) => (
              <tr key={p.productId}>
                <Td><Ltr className="font-bold">{p.code}</Ltr></Td>
                <Td className="text-end"><Money value={p.allocatedSar} fixed /></Td>
                <Td className="text-end"><Money value={p.perUnitSar} fixed /></Td>
                <Td className="text-end">{p.avgBefore === null ? '—' : <Money value={p.avgBefore} fixed />}</Td>
                <Td className="text-end font-bold">{p.avgAfter === null ? '—' : <Money value={p.avgAfter} fixed />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
