'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info as InfoIcon, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { today } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { AttachmentPicker, type AttachmentMeta } from '@/components/attachments';
import { Button, Card, Checkbox, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { NumInput } from '../../../quotes/_components/common';
import { Amount, CURRENCIES, PAYMENT_METHOD, defaultRate, fixed, useLabel } from '../../_components/common';
import { ProductPicker, ProjectPicker, SupplierPicker, WarehouseSelect, type PickedProduct, type PickedProject, type PickedSupplier } from '../../_components/pickers';
import type { BillView } from '../../_components/types';

interface Line { key: string; product: PickedProduct | null; description: string; qty: string; unitPrice: string; vat: string; serials: string }

let seq = 0;
const newLine = (vat: string): Line => ({ key: `l${++seq}`, product: null, description: '', qty: '1', unitPrice: '', vat, serials: '' });
const splitSerials = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function BillForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const { bi, locale } = useI18n();
  const label = useLabel();
  const { can } = useMe();

  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('SAR');
  const [rate, setRate] = useState('1');
  const [receive, setReceive] = useState(true);
  const [warehouseId, setWarehouseId] = useState('');
  const [project, setProject] = useState<PickedProject | null>(null);
  const [lines, setLines] = useState<Line[]>(() => [newLine('15')]);
  const [vatPrinted, setVatPrinted] = useState('');
  const [paidNow, setPaidNow] = useState(false);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<AttachmentMeta[]>([]);
  const [notes, setNotes] = useState('');

  const defVat = currency === 'SAR' && supplier?.vatNumber ? '15' : '0';
  // supplier / currency decide the default VAT of every line
  useEffect(() => { setLines((ls) => ls.map((l) => ({ ...l, vat: defVat }))); }, [defVat]);

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key: string, p: PickedProduct | null) => setLines((ls) => ls.map((l) => {
    if (l.key !== key) return l;
    if (!p) return { ...l, product: null };
    const price = p.costPrice && p.costCurrency === currency ? String(Number(p.costPrice)) : '';
    return { ...l, product: p, description: locale === 'en' ? p.nameEn || p.nameAr : p.nameAr, unitPrice: l.unitPrice || price };
  }));
  const onCurrency = (c: string) => { setCurrency(c); setRate(defaultRate(c) || ''); };

  const totals = useMemo(() => {
    const per = lines.map((l) => {
      const amount = Math.round((Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * 100);
      return { amount, vat: Math.round(amount * (Number(l.vat) || 0) / 100) };
    });
    const subtotal = per.reduce((s, x) => s + x.amount, 0) / 100;
    const vatCalc = per.reduce((s, x) => s + x.vat, 0) / 100;
    const vat = vatPrinted !== '' ? Number(vatPrinted) || 0 : vatCalc;
    return { subtotal, vatCalc, vat, total: subtotal + vat, totalSar: (subtotal + vat) * (Number(rate) || 0) };
  }, [lines, vatPrinted, rate]);

  const lineProblem = (l: Line): string | null => {
    if (!l.product && !l.description.trim()) return bi('اختر منتجًا أو اكتب وصف المصروف', 'Pick a product or describe the expense');
    if (!(Number(l.qty) > 0)) return bi('الكمية', 'Quantity');
    if (l.unitPrice === '' || Number(l.unitPrice) < 0) return bi('السعر', 'Price');
    if (receive && l.product?.serialTracked) {
      const n = splitSerials(l.serials).length;
      if (n !== Number(l.qty)) return bi(`مطلوب ${l.qty} رقم تسلسلي (أُدخل ${n})`, `${l.qty} serial number(s) needed (${n} given)`);
    }
    return null;
  };
  const valid = !!supplier && invoiceNo.trim() !== '' && !!billDate && Number(rate) > 0 && lines.length > 0 && lines.every((l) => !lineProblem(l)) && totals.total > 0;
  const stockLines = lines.filter((l) => l.product).length;

  const save = useMutation({
    mutationFn: () => api.post<BillView>('/inventory/bills/direct', {
      supplierId: supplier!.id, supplierInvoiceNo: invoiceNo.trim(), billDate, dueDate: dueDate || null, currency, rateToSar: rate,
      receive, warehouseId: receive ? warehouseId || null : null, projectId: project?.id ?? null, notes: notes.trim() || null, fileId: file[0]?.id ?? null,
      vat: vatPrinted !== '' ? fixed(Number(vatPrinted) || 0, 2) : null,
      paidNow: paidNow ? { method, reference: reference.trim() || null } : null,
      lines: lines.map((l) => ({
        productId: l.product?.id ?? null, description: l.description.trim() || null,
        qty: fixed(Number(l.qty), 3), unitPrice: fixed(Number(l.unitPrice), 4), vatPercent: l.vat,
        serials: receive && l.product?.serialTracked ? splitSerials(l.serials) : undefined,
      })),
    }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['bills-aging'] });
      qc.invalidateQueries({ queryKey: ['inv-stock'] });
      toast.success(bi(`تم تسجيل الفاتورة ${b.number}${b.moves.length ? ` واستلام ${b.moves.length} صنف في المخزون` : ''}`, `Bill ${b.number} recorded${b.moves.length ? `, ${b.moves.length} item(s) received into stock` : ''}`));
      router.push(`/purchasing/bills/${b.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!can('purchase.write')) return <ErrorBox error={new Error(bi('لا تملك صلاحية تسجيل فواتير المشتريات', 'You cannot record supplier bills'))} />;
  const canReceive = can('inventory.write') || can('purchase.approve');

  return (
    <>
      <PageHeader
        back="/purchasing/bills"
        title={bi('فاتورة مشتريات جديدة', 'New supplier bill')}
        subtitle={bi('لمشتريات محلية بدون أمر شراء: تُسجَّل الفاتورة وتدخل الأصناف المخزون مباشرة', 'For local purchases without a PO: the bill is recorded and the items go straight into stock')}
        actions={<Button icon={<Save className="size-4" />} disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ الفاتورة', 'Save bill')}</Button>}
      />
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-900">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>{bi('إذا كان للمشتريات أمر شراء، سجّل الفاتورة من صفحة أمر الشراء نفسه لتتم المطابقة الثلاثية. تكلفة الصنف في المخزون = سعر الوحدة بدون الضريبة × سعر الصرف.', 'If the purchase has a PO, record the bill from that PO so the 3-way match runs. Stock cost = unit price without VAT × exchange rate.')}</span>
        </div>

        <Card title={bi('بيانات الفاتورة', 'Invoice details')}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label={bi('المورد *', 'Supplier *')} className="md:col-span-2"><SupplierPicker value={supplier} onChange={setSupplier} /></Field>
            <Field label={bi('رقم فاتورة المورد *', 'Supplier invoice no. *')}><Input dir="ltr" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
            <Field label={bi('تاريخ الفاتورة *', 'Invoice date *')}><Input type="date" dir="ltr" value={billDate} max={today()} onChange={(e) => setBillDate(e.target.value)} /></Field>
            <Field label={bi('العملة', 'Currency')}>
              <Select value={currency} onChange={(e) => onCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            </Field>
            <Field label={bi('سعر الصرف (ريال لكل وحدة)', 'Rate (SAR per unit)')} error={Number(rate) > 0 ? null : bi('أدخل سعر الصرف', 'Enter the rate')}>
              <NumInput value={rate} onChange={setRate} disabled={currency === 'SAR'} step="0.0001" />
            </Field>
            <Field label={bi('تاريخ الاستحقاق', 'Due date')} className="md:col-span-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Input type="date" dir="ltr" className="w-40" value={dueDate} min={billDate} onChange={(e) => setDueDate(e.target.value)} />
                {[0, 15, 30, 60].map((d) => (
                  <button key={d} type="button" onClick={() => setDueDate(addDays(billDate, d))} className="rounded-full border border-line px-2.5 py-1 text-xs font-bold text-muted hover:bg-tint">
                    {d === 0 ? bi('فوري', 'On receipt') : bi(`${d} يومًا`, `${d} days`)}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Card>

        <Card title={bi('الاستلام في المخزون', 'Receiving')}>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="flex items-center">
              <Checkbox checked={receive && canReceive} disabled={!canReceive} onChange={setReceive} label={bi('أدخل الأصناف المخزون الآن', 'Receive the items into stock now')} />
            </div>
            {receive && canReceive && <Field label={bi('المستودع', 'Warehouse')}><WarehouseSelect value={warehouseId} onChange={setWarehouseId} /></Field>}
            <Field label={bi('المشروع (اختياري — تُحجز الكمية له)', 'Project (optional — reserved for it)')}><ProjectPicker value={project} onChange={setProject} /></Field>
          </div>
          {!receive && <p className="mt-2 text-xs text-muted">{bi('لن تتغير كميات المخزون — مناسب لفواتير الخدمات والمصاريف أو بضاعة استُلمت سابقًا.', 'Stock will not change — for service/expense bills or goods already received.')}</p>}
        </Card>

        <Card title={bi('البنود', 'Lines')} padded={false} actions={<Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, newLine(defVat)])}>{bi('إضافة بند', 'Add line')}</Button>}>
          <Table>
            <thead><tr>
              <Th className="min-w-[16rem]">{bi('المنتج أو المصروف', 'Product or expense')}</Th>
              <Th className="w-24">{bi('الكمية', 'Qty')}</Th><Th className="w-32">{bi('سعر الوحدة', 'Unit price')} ({currency})</Th><Th className="w-28">{bi('الضريبة', 'VAT')}</Th>
              <Th className="text-end">{bi('الإجمالي', 'Line total')}</Th><Th />
            </tr></thead>
            <tbody>
              {lines.map((l) => {
                const problem = lineProblem(l);
                return (
                  <tr key={l.key} className="align-top">
                    <Td>
                      <ProductPicker value={l.product} onChange={(p) => pickProduct(l.key, p)} />
                      <Input className="mt-1.5" placeholder={l.product ? bi('وصف (اختياري)', 'Description (optional)') : bi('أو صف المصروف: توصيل، تركيب…', 'or describe the expense: delivery, labour…')} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                      {receive && l.product?.serialTracked && (
                        <Textarea rows={2} dir="ltr" className="mt-1.5 font-mono text-xs" placeholder={bi('الأرقام التسلسلية — رقم في كل سطر', 'Serial numbers — one per line')} value={l.serials} onChange={(e) => setLine(l.key, { serials: e.target.value })} />
                      )}
                      {problem && (l.product || l.description || l.unitPrice) && <p className="mt-1 text-[11px] font-bold text-danger">{problem}</p>}
                    </Td>
                    <Td><NumInput value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} step="1" /></Td>
                    <Td><NumInput value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v })} step="0.01" /></Td>
                    <Td>
                      <Select className="min-w-[6rem]" value={l.vat} onChange={(e) => setLine(l.key, { vat: e.target.value })}>
                        <option value="15">15%</option><option value="0">0%</option>
                      </Select>
                    </Td>
                    <Td className="text-end"><Amount value={(Number(l.qty) || 0) * (Number(l.unitPrice) || 0)} currency={currency} /></Td>
                    <Td>
                      <button type="button" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1.5 text-muted hover:bg-rose-50 hover:text-danger disabled:opacity-30" aria-label={bi('حذف البند', 'Remove line')}><Trash2 className="size-4" /></button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line p-4">
            <p className="max-w-sm text-xs text-muted">
              {receive && canReceive && stockLines > 0
                ? bi(`سيُستلم ${stockLines} صنف في المخزون وتُحدَّث تكلفتها المتوسطة.`, `${stockLines} item(s) will be received and their average cost updated.`)
                : bi('البنود بدون منتج تُسجَّل مصروفًا ولا تدخل المخزون.', 'Lines without a product are expenses and do not enter stock.')}
            </p>
            <dl className="w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">{bi('المجموع قبل الضريبة', 'Subtotal')}</dt><dd><Amount value={totals.subtotal} currency={currency} /></dd></div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">{bi('ضريبة القيمة المضافة', 'VAT')}</dt>
                <dd className="w-32"><NumInput value={vatPrinted} onChange={setVatPrinted} step="0.01" placeholder={fixed(totals.vatCalc).toString()} ariaLabel={bi('الضريبة كما في الفاتورة', 'VAT as printed')} /></dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-line pt-1 font-extrabold"><dt>{bi('الإجمالي', 'Total')}</dt><dd><Amount value={totals.total} currency={currency} /></dd></div>
              {currency !== 'SAR' && <div className="flex justify-between gap-3 text-primary"><dt>{bi('بالريال', 'In SAR')}</dt><dd><Money value={fixed(totals.totalSar)} fixed /></dd></div>}
            </dl>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={bi('الدفع', 'Payment')}>
            <Checkbox checked={paidNow} onChange={setPaidNow} label={bi('دُفعت بالكامل الآن (مشتريات نقدية)', 'Paid in full now (cash purchase)')} />
            {paidNow && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={bi('طريقة الدفع', 'Method')}>
                  <Select value={method} onChange={(e) => setMethod(e.target.value)}>{Object.keys(PAYMENT_METHOD).map((m) => <option key={m} value={m}>{label(PAYMENT_METHOD, m)}</option>)}</Select>
                </Field>
                <Field label={bi('المرجع (اختياري)', 'Reference (optional)')}><Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
              </div>
            )}
            {!paidNow && <p className="mt-2 text-xs text-muted">{bi('تبقى الفاتورة «غير مدفوعة» ويمكن تسجيل الدفعات لاحقًا من صفحتها.', 'The bill stays unpaid; record payments later from its page.')}</p>}
          </Card>
          <Card title={bi('المرفق والملاحظات', 'Attachment & notes')}>
            <div className="space-y-3">
              <Field label={bi('صورة أو PDF الفاتورة', 'Invoice photo or PDF')}><AttachmentPicker value={file} onChange={setFile} multiple={false} /></Field>
              <Textarea rows={2} placeholder={bi('ملاحظات', 'Notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function NewBillPage() {
  return <Suspense fallback={<Spinner />}><BillForm /></Suspense>;
}
