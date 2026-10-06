'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { parseSerialList } from '@mmc/domain';
import { ApiError, api, qs } from '@/lib/api';
import { today } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { AttachmentPicker, type AttachmentMeta } from '@/components/attachments';
import { Button, Checkbox, clsx, Dialog, Field, Input, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { NumInput } from '../../quotes/_components/common';
import { Amount, CURRENCIES, Ltr, WarningList, defaultRate, fixed, qty as fmtQty } from './common';
import { WarehouseSelect } from './pickers';
import type { BillRow, PoView, ReceiptView, ShipmentRow } from './types';

type Msg = { ar: string; en: string };

// ───────────────────────── approve (with compliance acknowledgement) ─────────────────────────

interface Blocking { productId: string; code: string; issues: { key: string; level: string; ar: string; en: string }[] }

export function ApproveDialog({ po, open, onClose, onDone }: { po: PoView; open: boolean; onClose: () => void; onDone: (po: PoView) => void }) {
  const { bi, locale } = useI18n();
  const known: Blocking[] = po.lines.filter((l) => l.compliance && !l.compliance.ok).map((l) => ({ productId: l.productId!, code: l.code, issues: l.compliance!.issues }));
  const [blocking, setBlocking] = useState<Blocking[]>(known);
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState('');
  const approve = useMutation({
    mutationFn: () => api.post<PoView>(`/inventory/purchase-orders/${po.id}/approve`, { acknowledgeCompliance: ack || undefined, note: note.trim() || null }),
    onSuccess: (v) => { toast.success(bi('تم اعتماد أمر الشراء', 'Purchase order approved')); onDone(v); },
    onError: (e) => {
      const d = e instanceof ApiError ? (e.details as { compliance?: Blocking[] } | undefined) : undefined;
      if (e instanceof ApiError && e.status === 400 && d?.compliance?.length) {
        setBlocking(d.compliance);
        setAck(false);
        toast.error(bi('شهادات المطابقة ناقصة أو منتهية — أكّد العلم بها للمتابعة', 'Compliance certificates missing or expired — acknowledge to continue'));
      } else toast.error((e as Error).message);
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title={bi('اعتماد أمر الشراء', 'Approve the purchase order')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button icon={<CheckCircle2 className="size-4" />} disabled={blocking.length > 0 && !ack} loading={approve.isPending} onClick={() => approve.mutate()}>{bi('اعتماد', 'Approve')}</Button></>}>
      <div className="space-y-3">
        {blocking.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-extrabold"><AlertTriangle className="size-4" />{bi('منتجات بدون شهادات مطابقة سارية (سابر / هيئة الاتصالات)', 'Products without valid compliance certificates (SABER / CST)')}</div>
            <ul className="space-y-1 text-xs leading-relaxed">
              {blocking.map((b) => (
                <li key={b.productId}><b dir="ltr" className="num">{b.code}</b>: {b.issues.map((i) => (locale === 'en' ? i.en : i.ar)).join(' · ')}</li>
              ))}
            </ul>
            <div className="mt-2.5 border-t border-rose-200 pt-2.5">
              <Checkbox checked={ack} onChange={setAck} label={<span className="font-bold">{bi('أعلم بذلك وأعتمد أمر الشراء على مسؤوليتي (يُسجَّل في السجل)', 'I acknowledge this and approve on my responsibility (recorded in the audit log)')}</span>} />
            </div>
          </div>
        )}
        <Field label={bi('ملاحظة (اختياري)', 'Note (optional)')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

// ───────────────────────── receive goods ─────────────────────────

interface ProductMini { id: string; code: string; serialTracked: boolean }

export function ReceiveDialog({ po, open, onClose, onDone }: { po: PoView; open: boolean; onClose: () => void; onDone: (r: ReceiptView) => void }) {
  const { bi, locale } = useI18n();
  const openLines = po.lines.filter((l) => Number(l.remainingQty) > 0);
  const [warehouseId, setWarehouseId] = useState('');
  const [receivedOn, setReceivedOn] = useState(today());
  const [shipmentId, setShipmentId] = useState('');
  const [notes, setNotes] = useState('');
  const [vals, setVals] = useState<Record<string, { qty: string; serials: string }>>(() => Object.fromEntries(openLines.map((l) => [l.id, { qty: String(Number(l.remainingQty)), serials: '' }])));
  const [errors, setErrors] = useState<Msg[]>([]);

  const productIds = [...new Set(openLines.map((l) => l.productId).filter((x): x is string => !!x))];
  const products = useQueries({ queries: productIds.map((pid) => ({ queryKey: ['product', pid], queryFn: () => api.get<ProductMini>(`/products/${pid}`), staleTime: 60_000 })) });
  const tracked = (pid: string | null) => {
    if (!pid) return false;
    const i = productIds.indexOf(pid);
    return !!products[i]?.data?.serialTracked;
  };
  const shipments = useQuery({
    queryKey: ['shipments-open'],
    queryFn: () => api.get<{ rows: ShipmentRow[] }>(`/inventory/shipments${qs({ status: 'ordered,shipped,arrived,clearing,released', limit: 100 })}`).then((r) => r.rows),
    staleTime: 30_000,
  });
  const linked = (shipments.data ?? []).filter((s) => s.orderIds.includes(po.id));
  const others = (shipments.data ?? []).filter((s) => !s.orderIds.includes(po.id) && (!s.supplierId || s.supplierId === po.supplierId));

  const set = (id: string, patch: Partial<{ qty: string; serials: string }>) => setVals((v) => ({ ...v, [id]: { ...v[id]!, ...patch } }));
  const parsed = useMemo(() => Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.serials.trim() ? parseSerialList(v.serials) : null])), [vals]);

  const lineProblems = openLines.map((l) => {
    const v = vals[l.id]!;
    const q = Number(v.qty) || 0;
    if (q < 0 || q > Number(l.remainingQty)) return bi('الكمية أكبر من المتبقي', 'More than the open quantity');
    if (tracked(l.productId) && q > 0) {
      if (!Number.isInteger(q)) return bi('وحدات كاملة فقط', 'Whole units only');
      const p = parsed[l.id];
      const n = p?.rows.length ?? 0;
      if (p?.errors.length) return bi('أخطاء في القائمة', 'List has errors');
      if (n !== q) return bi(`مطلوب ${q} رقم تسلسلي، أُدخل ${n}`, `${q} serial(s) needed, ${n} entered`);
    }
    return null;
  });
  const anyQty = openLines.some((l) => Number(vals[l.id]!.qty) > 0);
  const ok = anyQty && lineProblems.every((p) => !p);

  const save = useMutation({
    mutationFn: () => api.post<ReceiptView>(`/inventory/purchase-orders/${po.id}/receipts`, {
      warehouseId: warehouseId || null, receivedOn, shipmentId: shipmentId || null, notes: notes.trim() || null,
      lines: openLines.filter((l) => Number(vals[l.id]!.qty) > 0).map((l) => ({ orderLineId: l.id, qty: fixed(Number(vals[l.id]!.qty), 3), serialsText: vals[l.id]!.serials.trim() || null })),
    }),
    onSuccess: (r) => { toast.success(bi(`تم تسجيل الاستلام ${r.number}`, `Receipt ${r.number} recorded`)); onDone(r); },
    onError: (e) => {
      const d = e instanceof ApiError ? (e.details as { errors?: Msg[] } | undefined) : undefined;
      setErrors(d?.errors ?? []);
      toast.error((e as Error).message);
    },
  });

  return (
    <Dialog wide open={open} onClose={onClose} title={<>{bi('استلام بضاعة', 'Receive goods')} — <span dir="ltr" className="num">{po.number}</span></>}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>{bi('تسجيل الاستلام', 'Record receipt')}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={bi('المستودع', 'Warehouse')}><WarehouseSelect value={warehouseId} onChange={setWarehouseId} /></Field>
          <Field label={bi('تاريخ الاستلام', 'Received on')}><Input type="date" dir="ltr" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></Field>
          <Field label={bi('الشحنة (اختياري)', 'Shipment (optional)')} hint={bi('اربطها لتوزيع تكلفة الاستيراد لاحقًا', 'Link it to allocate the landed cost later')}>
            <Select value={shipmentId} onChange={(e) => setShipmentId(e.target.value)}>
              <option value="">—</option>
              {linked.length > 0 && <optgroup label={bi('شحنات هذا الأمر', 'Shipments of this order')}>{linked.map((s) => <option key={s.id} value={s.id}>{s.number}{s.blNumber ? ` · ${s.blNumber}` : ''}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label={bi('شحنات أخرى', 'Other shipments')}>{others.map((s) => <option key={s.id} value={s.id}>{s.number}{s.blNumber ? ` · ${s.blNumber}` : ''}</option>)}</optgroup>}
            </Select>
          </Field>
        </div>

        {openLines.length === 0 ? <p className="text-sm text-muted">{bi('لا توجد كميات متبقية للاستلام.', 'Nothing left to receive.')}</p> : (
          <div className="space-y-3">
            {openLines.map((l, i) => {
              const v = vals[l.id]!;
              const isTracked = tracked(l.productId);
              const p = parsed[l.id];
              const q = Number(v.qty) || 0;
              const n = p?.rows.length ?? 0;
              return (
                <div key={l.id} className={clsx('rounded-xl border p-3', lineProblems[i] ? 'border-amber-300 bg-amber-50/40' : 'border-line')}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold"><Ltr>{l.code}</Ltr>{isTracked && <span className="ms-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">{bi('بالرقم التسلسلي', 'Serial-tracked')}</span>}</div>
                      <div className="truncate text-xs text-muted">{l.description}</div>
                      <div className="text-xs text-muted">{bi('المتبقي', 'Open')}: <Ltr>{fmtQty(l.remainingQty)}</Ltr></div>
                    </div>
                    <div className="w-32"><NumInput value={v.qty} onChange={(x) => set(l.id, { qty: x })} ariaLabel={bi('الكمية المستلمة', 'Received qty')} /></div>
                  </div>
                  {isTracked && q > 0 && (
                    <div className="mt-2">
                      <Textarea rows={Math.min(8, Math.max(3, q))} dir="ltr" className="font-mono text-xs" value={v.serials} onChange={(e) => set(l.id, { serials: e.target.value })}
                        placeholder={'SN0001,AA:BB:CC:DD:EE:01\nSN0002,AA:BB:CC:DD:EE:02'} />
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-muted">{bi('سطر لكل جهاز: "الرقم التسلسلي,MAC" — يمكن لصقها من قائمة التعبئة', 'One device per line: "serial,mac" — paste from the packing list')}</span>
                        <span className={clsx('font-bold', n === q && !p?.errors.length ? 'text-ok' : 'text-danger')}>{bi('العدد', 'Count')}: <span dir="ltr" className="num">{n} / {q}</span></span>
                      </div>
                      {p && p.errors.length > 0 && (
                        <ul className="mt-1 list-disc ps-5 text-xs text-danger">{p.errors.slice(0, 8).map((e, j) => <li key={j}>{bi('سطر', 'Row')} <span className="num">{e.line}</span>: {locale === 'en' ? e.en : e.ar}</li>)}</ul>
                      )}
                    </div>
                  )}
                  {lineProblems[i] && !(isTracked && q > 0) && <p className="mt-1 text-xs text-danger">{lineProblems[i]}</p>}
                </div>
              );
            })}
          </div>
        )}
        <WarningList tone="red" title={bi('أخطاء في قائمة الأرقام التسلسلية', 'Errors in the serial list')} items={errors} />
        <Field label={bi('ملاحظات', 'Notes')}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

// ───────────────────────── supplier bill (3-way match) ─────────────────────────

export function BillDialog({ po, open, onClose, onDone }: { po: PoView; open: boolean; onClose: () => void; onDone: (b: BillRow) => void }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const [invoiceNo, setInvoiceNo] = useState('');
  const [billDate, setBillDate] = useState(today());
  const [currency, setCurrency] = useState(po.currency);
  const [rate, setRate] = useState(po.rateToSar);
  const [vat, setVat] = useState('0');
  const [file, setFile] = useState<AttachmentMeta[]>([]);
  const [accept, setAccept] = useState(false);
  const [vals, setVals] = useState<Record<string, { qty: string; unitPrice: string }>>(() => Object.fromEntries(po.lines.map((l) => {
    const left = Math.max(0, Number(l.receivedQty) - Number(l.billedQty));
    return [l.id, { qty: String(left), unitPrice: l.unitPrice === null ? '' : String(Number(l.unitPrice)) }];
  })));
  const set = (id: string, patch: Partial<{ qty: string; unitPrice: string }>) => setVals((v) => ({ ...v, [id]: { ...v[id]!, ...patch } }));
  const onCurrency = (c: string) => { setCurrency(c); setRate(c === po.currency ? po.rateToSar : defaultRate(c)); };

  const chosen = po.lines.filter((l) => Number(vals[l.id]!.qty) > 0);
  const subtotal = chosen.reduce((s, l) => s + Number(vals[l.id]!.qty) * (Number(vals[l.id]!.unitPrice) || 0), 0);
  const total = subtotal + (Number(vat) || 0);
  // predicted 3-way-match exception: billed (existing + this bill) > received
  const issues: Msg[] = chosen.filter((l) => Number(l.billedQty) + Number(vals[l.id]!.qty) > Number(l.receivedQty)).map((l) => ({
    ar: `${l.code}: الكمية المفوترة (${fmtQty(Number(l.billedQty) + Number(vals[l.id]!.qty))}) أكبر من المستلمة (${fmtQty(l.receivedQty)})`,
    en: `${l.code}: billed quantity (${fmtQty(Number(l.billedQty) + Number(vals[l.id]!.qty))}) exceeds received (${fmtQty(l.receivedQty)})`,
  }));
  const valid = !!invoiceNo.trim() && !!billDate && chosen.length > 0 && chosen.every((l) => vals[l.id]!.unitPrice !== '') && (currency === 'SAR' || Number(rate) > 0);

  const save = useMutation({
    mutationFn: () => api.post<BillRow>('/inventory/bills', {
      supplierId: po.supplierId, orderId: po.id, supplierInvoiceNo: invoiceNo.trim(), billDate, currency, ...(rate ? { rateToSar: rate } : {}),
      lines: chosen.map((l) => ({ orderLineId: l.id, qty: fixed(Number(vals[l.id]!.qty), 3), unitPrice: fixed(Number(vals[l.id]!.unitPrice), 4) })),
      vat: fixed(Number(vat) || 0, 2), fileId: file[0]?.id ?? null, acceptException: issues.length > 0 && accept ? true : undefined,
    }),
    onSuccess: (b) => {
      if (b.matchStatus === 'exception' && b.status === 'draft') toast.warning(bi(`سُجّلت الفاتورة ${b.number} كمسودة باستثناء مطابقة — تحتاج اعتمادًا`, `Bill ${b.number} saved as a draft with a match exception — needs approval`));
      else toast.success(bi(`تم تسجيل فاتورة المورد ${b.number}`, `Supplier bill ${b.number} recorded`));
      onDone(b);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog wide open={open} onClose={onClose} title={<>{bi('فاتورة مورد', 'Supplier bill')} — <span dir="ltr" className="num">{po.number}</span></>}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('تسجيل الفاتورة', 'Record bill')}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={bi('رقم فاتورة المورد *', 'Supplier invoice no. *')} className="sm:col-span-2"><Input dir="ltr" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
          <Field label={bi('تاريخ الفاتورة', 'Bill date')} className="sm:col-span-2"><Input type="date" dir="ltr" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></Field>
          <Field label={bi('العملة', 'Currency')}><Select value={currency} onChange={(e) => onCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label={bi('سعر الصرف', 'Rate to SAR')}><NumInput value={rate} onChange={setRate} disabled={currency === 'SAR'} step="0.0001" /></Field>
        </div>
        <Table>
          <thead><tr>
            <Th>{bi('البند', 'Line')}</Th><Th className="text-end">{bi('مستلم', 'Received')}</Th><Th className="text-end">{bi('مفوتر سابقًا', 'Billed')}</Th>
            <Th className="w-28">{bi('الكمية', 'Qty')}</Th><Th className="w-32">{bi('سعر الوحدة', 'Unit price')}</Th><Th className="text-end">{bi('الإجمالي', 'Amount')}</Th>
          </tr></thead>
          <tbody>
            {po.lines.map((l) => {
              const v = vals[l.id]!;
              return (
                <tr key={l.id}>
                  <Td><div className="font-bold"><Ltr>{l.code}</Ltr></div><div className="max-w-[14rem] truncate text-xs text-muted">{l.description}</div></Td>
                  <Td className="text-end"><Ltr>{fmtQty(l.receivedQty)}</Ltr></Td>
                  <Td className="text-end"><Ltr>{fmtQty(l.billedQty)}</Ltr></Td>
                  <Td><NumInput value={v.qty} onChange={(x) => set(l.id, { qty: x })} /></Td>
                  <Td><NumInput value={v.unitPrice} onChange={(x) => set(l.id, { unitPrice: x })} step="0.01" /></Td>
                  <Td className="text-end"><Amount value={(Number(v.qty) || 0) * (Number(v.unitPrice) || 0)} currency={currency} /></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Field label={bi('ضريبة القيمة المضافة (مبلغ)', 'VAT (amount)')}>
              <div className="flex gap-2">
                <NumInput value={vat} onChange={setVat} step="0.01" />
                <Button type="button" variant="outline" size="sm" onClick={() => setVat(fixed(subtotal * 0.15))}>15%</Button>
              </div>
            </Field>
            <Field label={bi('ملف الفاتورة', 'Invoice file')}><AttachmentPicker value={file} onChange={setFile} multiple={false} /></Field>
          </div>
          <dl className="space-y-1 self-end text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">{bi('المجموع', 'Subtotal')}</dt><dd><Amount value={subtotal} currency={currency} /></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">{bi('الضريبة', 'VAT')}</dt><dd><Amount value={Number(vat) || 0} currency={currency} /></dd></div>
            <div className="flex justify-between gap-3 border-t border-line pt-1 font-extrabold"><dt>{bi('الإجمالي', 'Total')}</dt><dd><Amount value={total} currency={currency} /></dd></div>
          </dl>
        </div>
        {issues.length > 0 && (
          <div className="space-y-2">
            <WarningList title={bi('المطابقة الثلاثية: استثناء', '3-way match: exception')} items={issues} />
            {can('purchase.approve') ? (
              <Checkbox checked={accept} onChange={setAccept} label={<span className="font-bold">{bi('قبول الاستثناء واعتماد الفاتورة', 'Accept the exception and approve the bill')}</span>} />
            ) : (
              <p className="text-xs text-muted">{bi('ستُسجَّل الفاتورة كمسودة باستثناء حتى يعتمدها صاحب صلاحية الاعتماد.', 'The bill will be saved as a draft exception until someone with approval rights accepts it.')}</p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
