'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, FileText, PencilLine, Send, Star, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { INCOTERMS } from '@mmc/domain';
import { api, openFile } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, clsx, Dialog, Empty, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { ConfirmDialog, NumInput } from '../../../quotes/_components/common';
import { Amount, CURRENCIES, Chip, Info, Ltr, RFQ_STATUS, defaultRate, qty as fmtQty } from '../../_components/common';
import type { Comparison, Delivery, RfqView, SupplierQuote } from '../../_components/types';

type Channel = 'auto' | 'email' | 'whatsapp';

export default function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const key = ['rfq', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<RfqView>(`/inventory/rfqs/${id}`) });
  const cmp = useQuery({ queryKey: ['rfq-cmp', id], queryFn: () => api.get<Comparison>(`/inventory/rfqs/${id}/comparison`), enabled: !!q.data?.canSeePrices && q.data.quotes.length > 0 });
  const [sending, setSending] = useState(false);
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [award, setAward] = useState<Comparison['totals'][number] | null>(null);
  const [cancel, setCancel] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['rfq-cmp', id] }); qc.invalidateQueries({ queryKey: ['rfq-list'] }); };

  const doAward = useMutation({
    mutationFn: (supplierQuoteId: string) => api.post<{ rfq: RfqView; purchaseOrder: { id: string; number: string } }>(`/inventory/rfqs/${id}/award`, { supplierQuoteId }),
    onSuccess: (r) => { toast.success(bi(`تم إنشاء أمر الشراء ${r.purchaseOrder.number} كمسودة`, `Draft purchase order ${r.purchaseOrder.number} created`)); refresh(); qc.invalidateQueries({ queryKey: ['po-list'] }); router.push(`/purchasing/orders/${r.purchaseOrder.id}`); },
    onError: (e) => toast.error((e as Error).message),
  });
  const doCancel = useMutation({
    mutationFn: () => api.post<RfqView>(`/inventory/rfqs/${id}/cancel`, {}),
    onSuccess: (r) => { qc.setQueryData(key, r); refresh(); setCancel(false); toast.success(bi('تم إلغاء الطلب', 'RFQ cancelled')); },
    onError: (e) => toast.error((e as Error).message),
  });

  const r = q.data;
  if (q.isLoading) return <Spinner />;
  if (!r) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;
  const open = ['draft', 'sent'].includes(r.status);
  const write = can('purchase.write');
  const name = (s: { nameAr: string; nameEn: string | null }) => (locale === 'en' ? s.nameEn || s.nameAr : s.nameAr);

  return (
    <>
      <PageHeader
        back="/purchasing/rfqs"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{r.number}</span><Chip map={RFQ_STATUS} value={r.status} /></span>}
        subtitle={r.materialRequest ? <>{bi('طلب المواد', 'Material request')}: <Link href={`/purchasing/requests/${r.materialRequest.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{r.materialRequest.number}</Link></> : undefined}
        actions={<>
          {open && write && <Button icon={<Send className="size-4" />} onClick={() => setSending(true)}>{r.status === 'draft' ? bi('إرسال للموردين', 'Send to suppliers') : bi('إعادة الإرسال', 'Send again')}</Button>}
          {open && write && <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setCancel(true)}>{bi('إلغاء', 'Cancel')}</Button>}
        </>}
      />

      {r.purchaseOrder && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2 text-sm text-emerald-900">
          <Award className="size-4" />{bi('تمت الترسية — أمر الشراء', 'Awarded — purchase order')}
          <Link href={`/purchasing/orders/${r.purchaseOrder.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{r.purchaseOrder.number}</Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={bi('مقارنة العروض (التكلفة الواصلة بالريال)', 'Bid comparison (landed cost, SAR)')} padded={false}>
            {!r.canSeePrices ? <p className="p-4 text-sm text-muted">{bi('المقارنة تعرض الأسعار وتتطلب صلاحية عرض التكلفة.', 'The comparison shows prices and needs the cost permission.')}</p>
              : r.quotes.length === 0 ? <Empty title={bi('لا توجد عروض بعد', 'No quotations yet')} hint={bi('سجّل عرض كل مورد من قائمة الموردين.', 'Enter each supplier’s quotation from the supplier list.')} />
              : cmp.isLoading ? <Spinner />
              : cmp.data ? <ComparisonMatrix c={cmp.data} canAward={open && write} onAward={setAward} awardedQuoteId={r.awardedQuoteId} />
              : <ErrorBox error={cmp.error} />}
          </Card>

          <Card title={bi('البنود', 'Lines')} padded={false}>
            <Table>
              <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الوصف', 'Description')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th></tr></thead>
              <tbody>
                {r.lines.map((l) => <tr key={l.code}><Td><Ltr className="font-bold">{l.code}</Ltr></Td><Td className="text-xs">{l.description ?? '—'}</Td><Td className="text-end"><Ltr>{fmtQty(l.qty)}</Ltr></Td></tr>)}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={bi('الموردون والعروض', 'Suppliers and quotations')}>
            <ul className="space-y-2">
              {r.suppliers.map((s) => {
                const quote = r.quotes.find((x) => x.supplierId === s.id);
                return (
                  <li key={s.id} className="rounded-lg border border-line p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <b className="block truncate text-sm">{name(s)}</b>
                        <span dir="ltr" className="num block truncate text-xs text-muted">{s.email || s.phone || '—'}</span>
                      </div>
                      {quote ? <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">{bi('تم استلام العرض', 'Quoted')}</span>
                        : <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">{bi('بانتظار العرض', 'Awaiting')}</span>}
                    </div>
                    {quote && <p className="mt-1 text-xs text-muted"><span dir="ltr" className="num">{quote.currency}</span>{quote.incoterm && <> · <span dir="ltr" className="num">{quote.incoterm}</span></>}{quote.leadTimeDays != null && <> · {bi(`${quote.leadTimeDays} يوم`, `${quote.leadTimeDays} days`)}</>}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {open && write && <Button size="sm" variant="outline" icon={<PencilLine className="size-3.5" />} onClick={() => setQuoteFor(s.id)}>{quote ? bi('تعديل العرض', 'Edit quote') : bi('تسجيل العرض', 'Enter quote')}</Button>}
                      <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => openFile(`/inventory/rfqs/${id}/pdf?supplierId=${s.id}`)}>{bi('مستند الطلب', 'RFQ document')}</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title={bi('التفاصيل', 'Details')}>
            <Info label={bi('آخر موعد للرد', 'Reply by')}><Ltr>{r.dueDate ? date(r.dueDate) : null}</Ltr></Info>
            <Info label={bi('تاريخ الإنشاء', 'Created')}><Ltr>{date(r.createdAt)}</Ltr></Info>
            <Info label={bi('أنشأه', 'Created by')}>{r.createdByName ?? '—'}</Info>
            {r.notes && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{r.notes}</p>}
          </Card>
        </div>
      </div>

      {sending && <SendDialog rfq={r} onClose={() => setSending(false)} onDone={(v) => { qc.setQueryData(key, v); refresh(); }} />}
      {quoteFor && <QuoteDialog rfq={r} supplierId={quoteFor} existing={r.quotes.find((x) => x.supplierId === quoteFor) ?? null} onClose={() => setQuoteFor(null)} onDone={() => { setQuoteFor(null); refresh(); }} />}
      <ConfirmDialog
        open={!!award}
        title={bi('ترسية الطلب', 'Award the RFQ')}
        message={award ? bi(`سيُنشأ أمر شراء (مسودة) للمورد «${award.supplierName}» بأسعار عرضه (${award.quotedLines} بند) ويُغلق الطلب.`, `A draft purchase order for “${award.supplierName}” at its quoted prices (${award.quotedLines} lines) will be created and the RFQ closed.`) : undefined}
        loading={doAward.isPending}
        onConfirm={() => award && doAward.mutate(award.quoteId)}
        onClose={() => setAward(null)}
      />
      <ConfirmDialog open={cancel} danger title={bi('إلغاء طلب عروض الأسعار', 'Cancel the RFQ')} message={bi('لن تُقبل عروض جديدة على هذا الطلب.', 'No more quotations will be taken on this RFQ.')} loading={doCancel.isPending} onConfirm={() => doCancel.mutate()} onClose={() => setCancel(false)} />
    </>
  );
}

// ───────────────────────── comparison matrix ─────────────────────────

function ComparisonMatrix({ c, canAward, onAward, awardedQuoteId }: { c: Comparison; canAward: boolean; onAward: (t: Comparison['totals'][number]) => void; awardedQuoteId: string | null }) {
  const { bi, locale } = useI18n();
  return (
    <div className="space-y-3">
      {c.recommended ? (
        <div className="mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-gold/40 bg-tint px-3 py-2 text-sm">
          <Star className="size-4 text-gold" />{bi('المورد الموصى به', 'Recommended supplier')}: <b>{c.recommended.supplierName}</b> — <Money value={c.recommended.landedTotalSar} fixed />
        </div>
      ) : c.reason && <p className="mx-3 mt-3 text-xs text-muted">{locale === 'en' ? c.reason.en : c.reason.ar}</p>}
      <Table>
        <thead><tr>
          <Th>{bi('البند', 'Line')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th>
          {c.totals.map((t) => (
            <Th key={t.quoteId} className="text-end">
              <div className="flex flex-col items-end gap-0.5">
                <span className="whitespace-nowrap">{t.supplierName}</span>
                <span dir="ltr" className="num text-[11px] font-normal text-muted">{t.currency}{t.currency !== 'SAR' ? ` × ${Number(t.rateToSar)}` : ''}{Number(t.landedPercent) > 0 ? ` +${Number(t.landedPercent)}%` : ''}</span>
                {t.recommended && <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-gold-dark"><Star className="size-3" />{bi('موصى به', 'Recommended')}</span>}
                {t.quoteId === awardedQuoteId && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">{bi('تمت الترسية', 'Awarded')}</span>}
              </div>
            </Th>
          ))}
        </tr></thead>
        <tbody>
          {c.lines.map((l) => (
            <tr key={l.code}>
              <Td><Ltr className="font-bold">{l.code}</Ltr>{l.description && <div className="max-w-[12rem] truncate text-xs text-muted">{l.description}</div>}</Td>
              <Td className="text-end"><Ltr>{fmtQty(l.qty)}</Ltr></Td>
              {l.offers.map((o, i) => (
                <Td key={o.quoteId} className={clsx('text-end', o.best && 'bg-emerald-50')}>
                  {!o.quoted ? <span className="text-xs font-bold text-danger" title={o.note ?? undefined}>{bi('لم يُسعَّر', 'Not quoted')}</span> : (
                    <div className="flex flex-col items-end">
                      <span className={clsx(o.best && 'font-extrabold text-emerald-800')}><Money value={o.landedSar} fixed /></span>
                      <span className="text-[11px] text-muted"><Amount value={o.unitPrice} currency={c.totals[i]!.currency} /> / {bi('وحدة', 'unit')}</span>
                    </div>
                  )}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-extrabold">
            <Td>{bi('إجمالي التكلفة الواصلة', 'Landed total')}</Td><Td />
            {c.totals.map((t) => <Td key={t.quoteId} className={clsx('text-end', t.recommended && 'text-primary')}><Money value={t.landedTotalSar} fixed /></Td>)}
          </tr>
          <tr className="text-xs">
            <Td className="text-muted">{bi('قيمة البضاعة (بعملة العرض)', 'Goods (quote currency)')}</Td><Td />
            {c.totals.map((t) => <Td key={t.quoteId} className="text-end"><Amount value={t.goodsTotal} currency={t.currency} /></Td>)}
          </tr>
          <tr className="text-xs">
            <Td className="text-muted">{bi('مدة التوريد', 'Lead time')}</Td><Td />
            {c.totals.map((t) => <Td key={t.quoteId} className="text-end">{t.leadTimeDays != null ? bi(`${t.leadTimeDays} يوم`, `${t.leadTimeDays} days`) : '—'}</Td>)}
          </tr>
          <tr className="text-xs">
            <Td className="text-muted">{bi('بنود ناقصة', 'Missing lines')}</Td><Td />
            {c.totals.map((t) => <Td key={t.quoteId} className={clsx('text-end', t.missingLines > 0 && 'font-bold text-danger')}><Ltr>{t.missingLines}</Ltr></Td>)}
          </tr>
          <tr className="text-xs">
            <Td className="text-muted">{bi('صلاحية العرض', 'Valid until')}</Td><Td />
            {c.totals.map((t) => <Td key={t.quoteId} className={clsx('text-end', t.expired && 'font-bold text-danger')}><span className="num">{date(t.validUntil)}</span>{t.expired && <> · {bi('منتهي', 'expired')}</>}</Td>)}
          </tr>
          {canAward && (
            <tr>
              <Td /><Td />
              {c.totals.map((t) => <Td key={t.quoteId} className="text-end"><Button size="sm" variant={t.recommended ? 'primary' : 'outline'} icon={<Award className="size-3.5" />} onClick={() => onAward(t)}>{bi('ترسية', 'Award')}</Button></Td>)}
            </tr>
          )}
        </tfoot>
      </Table>
    </div>
  );
}

// ───────────────────────── send ─────────────────────────

function SendDialog({ rfq, onClose, onDone }: { rfq: RfqView; onClose: () => void; onDone: (r: RfqView) => void }) {
  const { bi } = useI18n();
  const [channel, setChannel] = useState<Channel>('auto');
  const [result, setResult] = useState<Delivery[] | null>(null);
  const send = useMutation({
    mutationFn: () => api.post<{ rfq: RfqView; deliveries: Delivery[] }>(`/inventory/rfqs/${rfq.id}/send`, { channel }),
    onSuccess: (r) => { setResult(r.deliveries); onDone(r.rfq); toast.success(bi('تم الإرسال', 'Sent')); },
    onError: (e) => toast.error((e as Error).message),
  });
  const statusLabel = (s: string) => ({ sent: bi('أُرسل', 'Sent'), sandboxed: bi('بيئة تجريبية (سُجّل)', 'Sandbox (logged)'), failed: bi('فشل', 'Failed'), skipped: bi('لم يُرسل', 'Skipped') })[s] ?? s;
  return (
    <Dialog open onClose={onClose} title={<>{bi('إرسال طلب عروض الأسعار', 'Send the RFQ')} — <span dir="ltr" className="num">{rfq.number}</span></>}
      footer={result ? <Button onClick={onClose}>{bi('تم', 'Done')}</Button> : <><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button icon={<Send className="size-4" />} loading={send.isPending} onClick={() => send.mutate()}>{bi('إرسال', 'Send')}</Button></>}>
      {result ? (
        <ul className="space-y-1.5 text-sm">
          {result.map((d) => (
            <li key={d.supplierId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5">
              <b>{d.supplierName}</b>
              <span className={clsx('text-xs', d.status === 'failed' || d.status === 'skipped' ? 'font-bold text-danger' : 'text-muted')}>
                {d.channel !== 'none' && <span dir="ltr" className="num">{d.channel} → {d.to}</span>} · {statusLabel(d.status)}{d.note ? ` · ${d.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          <Field label={bi('القناة', 'Channel')} hint={bi('تلقائي: البريد الإلكتروني مع المستند إن وُجد، وإلا واتساب.', 'Auto: e-mail with the document when available, else WhatsApp.')}>
            <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              <option value="auto">{bi('تلقائي', 'Auto')}</option>
              <option value="email">{bi('البريد الإلكتروني', 'E-mail')}</option>
              <option value="whatsapp">{bi('واتساب', 'WhatsApp')}</option>
            </Select>
          </Field>
          <p className="text-sm text-muted">{bi(`سيُرسل إلى ${rfq.suppliers.length} مورد.`, `Will be sent to ${rfq.suppliers.length} supplier(s).`)}</p>
        </div>
      )}
    </Dialog>
  );
}

// ───────────────────────── supplier quotation ─────────────────────────

function QuoteDialog({ rfq, supplierId, existing, onClose, onDone }: { rfq: RfqView; supplierId: string; existing: SupplierQuote | null; onClose: () => void; onDone: () => void }) {
  const { bi, locale } = useI18n();
  const s = rfq.suppliers.find((x) => x.id === supplierId)!;
  const [currency, setCurrency] = useState(existing?.currency ?? 'USD');
  const [rate, setRate] = useState(existing ? String(Number(existing.rateToSar)) : '3.75');
  const [incoterm, setIncoterm] = useState(existing?.incoterm ?? '');
  const [lead, setLead] = useState(existing?.leadTimeDays != null ? String(existing.leadTimeDays) : '');
  const [validUntil, setValidUntil] = useState(existing?.validUntil ?? '');
  const [landed, setLanded] = useState(existing ? String(Number(existing.landedPercent)) : '0');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [prices, setPrices] = useState<Record<string, { price: string; note: string }>>(() => Object.fromEntries(rfq.lines.map((l) => {
    const e = existing?.lines.find((x) => x.code === l.code);
    return [l.code, { price: e?.unitPrice != null ? String(Number(e.unitPrice)) : '', note: e?.note ?? '' }];
  })));
  const onCurrency = (c: string) => { setCurrency(c); setRate(defaultRate(c)); };
  const priced = rfq.lines.filter((l) => prices[l.code]!.price !== '');
  const valid = priced.length > 0 && (currency === 'SAR' || Number(rate) > 0);
  const save = useMutation({
    mutationFn: () => api.post(`/inventory/rfqs/${rfq.id}/quotes`, {
      supplierId, currency, ...(currency !== 'SAR' ? { rateToSar: rate } : {}), incoterm: incoterm || null, leadTimeDays: lead === '' ? null : Math.round(Number(lead)),
      validUntil: validUntil || null, landedPercent: landed || '0', notes: notes.trim() || null,
      lines: rfq.lines.map((l) => ({ code: l.code, unitPrice: prices[l.code]!.price === '' ? null : prices[l.code]!.price, note: prices[l.code]!.note.trim() || null })),
    }),
    onSuccess: () => { toast.success(bi('تم حفظ العرض', 'Quotation saved')); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog wide open onClose={onClose} title={<>{bi('عرض المورد', 'Supplier quotation')} — {locale === 'en' ? s.nameEn || s.nameAr : s.nameAr}</>}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ العرض', 'Save quotation')}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={bi('العملة', 'Currency')}><Select value={currency} onChange={(e) => onCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label={bi('سعر الصرف للريال', 'Rate to SAR')}><NumInput value={currency === 'SAR' ? '1' : rate} onChange={setRate} disabled={currency === 'SAR'} step="0.0001" /></Field>
          <Field label={bi('شروط التسليم', 'Incoterm')}><Select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}><option value="">—</option>{INCOTERMS.map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
          <Field label={bi('مدة التوريد (يوم)', 'Lead time (days)')}><NumInput value={lead} onChange={setLead} min={0} step="1" /></Field>
          <Field label={bi('صلاحية العرض', 'Valid until')}><Input type="date" dir="ltr" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
          <Field label={bi('تكاليف الوصول %', 'Landed add-on %')} hint={bi('شحن + جمارك + تخليص كنسبة من قيمة البضاعة', 'Freight + duty + clearance as % of goods')}><NumInput value={landed} onChange={setLanded} min={0} step="0.1" /></Field>
        </div>
        <Table>
          <thead><tr><Th>{bi('البند', 'Line')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th className="w-36">{bi('سعر الوحدة', 'Unit price')}</Th><Th>{bi('ملاحظة', 'Note')}</Th></tr></thead>
          <tbody>
            {rfq.lines.map((l) => (
              <tr key={l.code}>
                <Td><Ltr className="font-bold">{l.code}</Ltr>{l.description && <div className="max-w-[14rem] truncate text-xs text-muted">{l.description}</div>}</Td>
                <Td className="text-end"><Ltr>{fmtQty(l.qty)}</Ltr></Td>
                <Td><NumInput value={prices[l.code]!.price} onChange={(v) => setPrices((p) => ({ ...p, [l.code]: { ...p[l.code]!, price: v } }))} step="0.0001" placeholder={bi('فارغ = لم يُسعَّر', 'empty = not quoted')} ariaLabel={bi('سعر الوحدة', 'Unit price')} /></Td>
                <Td><Input value={prices[l.code]!.note} onChange={(e) => setPrices((p) => ({ ...p, [l.code]: { ...p[l.code]!, note: e.target.value } }))} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Field label={bi('ملاحظات', 'Notes')}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

