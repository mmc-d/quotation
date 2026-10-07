'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Download, QrCode, ReceiptText } from 'lucide-react';
import { PublicCard } from '@/app/_public/public-shell';
import { Dialog, Money } from '@/components/ui';
import { date, h } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { localHref, portalFetch, portalRetry, type PortalInvoice, type PortalPaymentRequest, type Rows } from '../_components/portal-api';
import { EmptyState, ErrorBlock, Loading, Num, PageTitle, PortalStatus, ZatcaQr, sectionTitle } from '../_components/portal-ui';

/** Seller not registered for VAT → plain invoices (no VAT, no QR) and never called "tax" invoices. */
function invoiceLabel(i: PortalInvoice, bi: (a: string, e: string) => string) {
  const plain = !i.qrPayload && h(i.vatAmount) === 0;
  if (plain && i.typeCode === '388') return bi('فاتورة', 'Invoice');
  if (plain && i.typeCode === '386') return bi('فاتورة دفعة مقدمة', 'Prepayment invoice');
  return i.typeLabel ? bi(i.typeLabel.ar, i.typeLabel.en) : i.typeCode;
}

export default function BillingPage() {
  const { bi } = useI18n();
  const prs = useQuery({ queryKey: ['portal', 'payment-requests'], queryFn: () => portalFetch<Rows<PortalPaymentRequest>>('/payment-requests'), retry: portalRetry });
  const invs = useQuery({ queryKey: ['portal', 'invoices'], queryFn: () => portalFetch<Rows<PortalInvoice>>('/invoices'), retry: portalRetry });
  const [qrFor, setQrFor] = useState<PortalInvoice | null>(null);
  const totalDue = prs.data?.rows.reduce((s, r) => s + h(r.due), 0) ?? 0;

  return (
    <div className="space-y-5">
      <PageTitle title={bi('الفواتير والمدفوعات', 'Invoices & payments')} subtitle={bi('طلبات الدفع المفتوحة وفواتيرك الصادرة.', 'Open payment requests and your issued invoices.')} />

      <section aria-labelledby="due-h">
        <h2 id="due-h" className={sectionTitle}><CreditCard className="size-4" aria-hidden />{bi('طلبات الدفع المستحقة', 'Payment requests due')}
          {totalDue > 0 && <span className="ms-auto text-sm font-bold text-ink">{bi('الإجمالي', 'Total')}: <Money value={totalDue} fixed /></span>}
        </h2>
        {prs.isLoading ? <Loading /> : prs.error ? <ErrorBlock error={prs.error} onRetry={() => prs.refetch()} /> : !prs.data?.rows.length ? (
          <EmptyState icon={<CreditCard className="size-8" />} title={bi('لا توجد مبالغ مستحقة', 'Nothing is due')} hint={bi('شكرًا لك — لا توجد طلبات دفع مفتوحة.', 'Thank you — there are no open payment requests.')} />
        ) : (
          <ul className="space-y-2">
            {prs.data.rows.map((r) => {
              const pay = localHref(r.payUrl);
              const ref = r.contractNumber ? <>{bi('العقد', 'Contract')} <Num>{r.contractNumber}</Num></> : r.agreementNumber ? <>{bi('عقد الصيانة', 'Maintenance contract')} <Num>{r.agreementNumber}</Num></> : null;
              return (
                <li key={r.id} className="rounded-2xl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><Num className="text-xs font-bold text-muted">{r.number}</Num><PortalStatus status={r.status} kind="payment" /></div>
                      <div className="mt-1 text-2xl font-extrabold text-primary"><Money value={r.due} fixed /></div>
                      <p className="mt-0.5 text-xs text-muted">
                        {ref}{ref && ' · '}{bi('الاستحقاق', 'Due')} <Num className="font-bold text-ink">{date(r.dueDate)}</Num>
                        {r.periodFrom && r.periodTo && <> · {bi('الفترة', 'Period')} <Num>{date(r.periodFrom)} – {date(r.periodTo)}</Num></>}
                      </p>
                      {h(r.paidAmount) > 0 && <p className="text-xs text-muted">{bi('المدفوع', 'Paid')} <Money value={r.paidAmount} fixed className="text-ok" /> {bi('من', 'of')} <Money value={r.amount} fixed /></p>}
                    </div>
                    {pay ? (
                      <a href={pay} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gold px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-gold-dark sm:w-auto">
                        <CreditCard className="size-4" aria-hidden />{bi('ادفع', 'Pay')}
                      </a>
                    ) : <span className="text-xs text-muted">{bi('تواصل معنا لطريقة الدفع', 'Contact us for payment details')}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="inv-h">
        <h2 id="inv-h" className={sectionTitle}><ReceiptText className="size-4" aria-hidden />{bi('الفواتير', 'Invoices')}</h2>
        {invs.isLoading ? <Loading /> : invs.error ? <ErrorBlock error={invs.error} onRetry={() => invs.refetch()} /> : !invs.data?.rows.length ? (
          <EmptyState icon={<ReceiptText className="size-8" />} title={bi('لا توجد فواتير بعد', 'No invoices yet')} />
        ) : (
          <ul className="space-y-2">
            {invs.data.rows.map((i) => (
              <li key={i.id}>
                <PublicCard className="!p-4">
                  <div className="flex gap-3">
                    {i.qrPayload && (
                      <button type="button" onClick={() => setQrFor(i)} className="shrink-0 rounded-lg" aria-label={bi(`تكبير رمز QR للفاتورة ${i.number}`, `Enlarge the QR code of invoice ${i.number}`)}>
                        <ZatcaQr payload={i.qrPayload} size={84} label={bi('رمز QR للفاتورة (زاتكا)', 'Invoice QR code (ZATCA)')} />
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Num className="font-extrabold text-ink">{i.number}</Num>
                          <div className="text-xs text-gold-dark">{invoiceLabel(i, bi)}</div>
                        </div>
                        <PortalStatus status={i.status} />
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                        <div><dt className="text-muted">{bi('التاريخ', 'Date')}</dt><dd><Num className="font-bold text-ink">{date(i.issueDate)}</Num></dd></div>
                        <div><dt className="text-muted">{bi('الإجمالي', 'Total')}</dt><dd className="font-bold text-ink"><Money value={i.total} fixed /></dd></div>
                        {h(i.vatAmount) > 0 && <div><dt className="text-muted">{bi('ضريبة القيمة المضافة', 'VAT')}</dt><dd className="font-bold text-ink"><Money value={i.vatAmount} fixed /></dd></div>}
                        <div><dt className="text-muted">{bi('المتبقي', 'Balance due')}</dt><dd className="font-bold text-ink"><Money value={i.balanceDue} fixed className={h(i.balanceDue) > 0 ? 'text-danger' : 'text-ok'} /></dd></div>
                      </dl>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {i.pdfUrl && <a href={i.pdfUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-bold text-ink hover:bg-tint"><Download className="size-3.5" aria-hidden />{bi('تحميل PDF', 'Download PDF')}</a>}
                        {i.qrPayload && <button type="button" onClick={() => setQrFor(i)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-bold text-ink hover:bg-tint"><QrCode className="size-3.5" aria-hidden />{bi('رمز QR', 'QR code')}</button>}
                      </div>
                    </div>
                  </div>
                </PublicCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!qrFor} onClose={() => setQrFor(null)} title={<>{bi('رمز QR — فاتورة', 'QR code — invoice')} <Num>{qrFor?.number}</Num></>}>
        {qrFor?.qrPayload && (
          <div className="flex flex-col items-center gap-2 text-center">
            <ZatcaQr payload={qrFor.qrPayload} size={260} label={bi('رمز QR للفاتورة (زاتكا)', 'Invoice QR code (ZATCA)')} />
            <p className="text-xs text-muted">{bi('امسح الرمز بتطبيق زاتكا للتحقق من بيانات الفاتورة.', 'Scan with the ZATCA app to verify the invoice details.')}</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
