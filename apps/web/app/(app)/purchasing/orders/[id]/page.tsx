'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Lock, PackageCheck, Pencil, Receipt, Send, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, openFile, qs } from '@/lib/api';
import { date, dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { AttachmentList } from '@/components/attachments';
import { Button, Card, Dialog, ErrorBox, LinkButton, Money, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { ConfirmDialog, ReasonDialog } from '../../../quotes/_components/common';
import {
  APPROVER_ROLE, Amount, BILL_STATUS, Chip, ComplianceBadge, Info, Ltr, MATCH_STATUS, PoStatusBadge, WarningList, qty,
} from '../../_components/common';
import { ApproveDialog, BillDialog, ReceiveDialog } from '../../_components/po-dialogs';
import { useWarehouses } from '../../_components/pickers';
import type { BillRow, PoView, ReceiptView } from '../../_components/types';

type Simple = 'submit' | 'send' | 'close';

export default function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi, locale } = useI18n();
  const { can, me } = useMe();
  const qc = useQueryClient();
  const key = ['po', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<PoView>(`/inventory/purchase-orders/${id}`) });
  const bills = useQuery({ queryKey: ['po-bills', id], queryFn: () => api.get<{ rows: BillRow[] }>(`/inventory/bills${qs({ orderId: id, limit: 100 })}`).then((r) => r.rows) });
  const wh = useWarehouses();
  const [confirm, setConfirm] = useState<Simple | null>(null);
  const [reason, setReason] = useState<'reject' | 'cancel' | null>(null);
  const [dialog, setDialog] = useState<'approve' | 'receive' | 'bill' | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const refresh = (po?: PoView) => {
    if (po) qc.setQueryData(key, po); else qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['po-list'] });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post<PoView>(`/inventory/purchase-orders/${id}/${path}`, body ?? {}),
    onSuccess: (po) => { refresh(po); toast.success(bi('تم', 'Done')); setConfirm(null); setReason(null); },
    onError: (e) => toast.error((e as Error).message),
  });

  const po = q.data;
  if (q.isLoading) return <Spinner />;
  if (!po) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;

  const s = po.status;
  const write = can('purchase.write');
  const canCost = can('purchase.cost.read');
  const receivable = ['approved', 'sent', 'partially_received'].includes(s) && can('inventory.write') && po.lines.some((l) => Number(l.remainingQty) > 0);
  const billable = write && po.lines.some((l) => Number(l.receivedQty) > 0) && s !== 'cancelled';
  const cancellable = write && ['draft', 'pending_approval', 'approved', 'sent'].includes(s) && po.lines.every((l) => Number(l.receivedQty) === 0);
  const whName = (wid: string) => { const w = wh.data?.find((x) => x.id === wid); return w ? `${w.code} — ${locale === 'en' ? w.nameEn || w.nameAr : w.nameAr}` : '—'; };
  const supplierName = po.supplier ? (locale === 'en' ? po.supplier.nameEn || po.supplier.nameAr : po.supplier.nameAr) : '—';
  const isCreator = po.createdBy === me?.user.id;

  const confirmText: Record<Simple, [string, string]> = {
    submit: [bi('إرسال للاعتماد', 'Submit for approval'), bi('سيُحدَّد المعتمد حسب إجمالي الأمر بالريال. لا يمكن لمنشئ الأمر اعتماده.', 'The approver is set by the SAR total. The creator cannot approve it.')],
    send: [bi('إرسال للمورد', 'Mark as sent'), bi('يُسجَّل أن أمر الشراء أُرسل للمورد. حمّل ملف PDF وأرسله له.', 'Records that the order was sent to the supplier. Download the PDF and send it.')],
    close: [bi('إغلاق أمر الشراء', 'Close the purchase order'), bi('لن تُستلم الكميات المتبقية، ولن تُحتسب كبضاعة واردة.', 'The open quantities will not be received and stop counting as incoming.')],
  };

  return (
    <>
      <PageHeader
        back="/purchasing/orders"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{po.number}</span><PoStatusBadge status={s} /></span>}
        subtitle={<>{bi('المورد', 'Supplier')}: {po.supplier ? <Link href={`/customers/${po.supplier.id}`} className="font-bold text-primary hover:underline">{supplierName}</Link> : '—'}</>}
        actions={<>
          {canCost && <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => openFile(`/inventory/purchase-orders/${id}/pdf`)}>PDF</Button>}
          {s === 'draft' && write && canCost && <LinkButton href={`/purchasing/orders/new?edit=${id}`} icon={<Pencil className="size-4" />}>{bi('تعديل', 'Edit')}</LinkButton>}
          {s === 'draft' && write && <Button icon={<Send className="size-4" />} onClick={() => setConfirm('submit')}>{bi('إرسال للاعتماد', 'Submit for approval')}</Button>}
          {s === 'pending_approval' && po.canApprove && <Button icon={<CheckCircle2 className="size-4" />} onClick={() => setDialog('approve')}>{bi('اعتماد', 'Approve')}</Button>}
          {s === 'pending_approval' && can('purchase.approve') && <Button variant="outline" icon={<Undo2 className="size-4" />} onClick={() => setReason('reject')}>{bi('رفض وإرجاع', 'Reject')}</Button>}
          {s === 'approved' && write && <Button variant="outline" icon={<Send className="size-4" />} onClick={() => setConfirm('send')}>{bi('أُرسل للمورد', 'Mark as sent')}</Button>}
          {receivable && <Button icon={<PackageCheck className="size-4" />} onClick={() => setDialog('receive')}>{bi('استلام بضاعة', 'Receive goods')}</Button>}
          {billable && <Button variant="outline" icon={<Receipt className="size-4" />} onClick={() => setDialog('bill')}>{bi('فاتورة مورد', 'Supplier bill')}</Button>}
          {['partially_received', 'received'].includes(s) && write && <Button variant="outline" icon={<Lock className="size-4" />} onClick={() => setConfirm('close')}>{bi('إغلاق', 'Close')}</Button>}
          {cancellable && <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setReason('cancel')}>{bi('إلغاء', 'Cancel')}</Button>}
        </>}
      />

      {s === 'pending_approval' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span className="font-bold">{bi('بانتظار اعتماد', 'Awaiting approval by')}:</span>
          <Chip map={APPROVER_ROLE} value={po.approverRole} />
          {!po.canApprove && can('purchase.approve') && <span className="text-xs">{isCreator ? bi('(لا يمكنك اعتماد أمر أنشأته)', '(you cannot approve an order you created)') : bi('(يتطلب صلاحية اعتماد أعلى)', '(needs a higher approval role)')}</span>}
        </div>
      )}
      {po.match.status === 'exception' && <WarningList className="mb-4" tone="red" title={bi('المطابقة الثلاثية: استثناء', '3-way match: exception')} items={po.match.issues} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={bi('البنود', 'Lines')} padded={false}>
            <Table>
              <thead><tr>
                <Th>{bi('الكود', 'Code')}</Th><Th>{bi('الوصف', 'Description')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th>
                <Th className="text-end">{bi('مستلم', 'Received')}</Th><Th className="text-end">{bi('مفوتر', 'Billed')}</Th><Th className="text-end">{bi('المتبقي', 'Remaining')}</Th>
                <Th className="text-end">{bi('سعر الوحدة', 'Unit price')}</Th><Th className="text-end">{bi('الإجمالي', 'Amount')}</Th><Th>{bi('المطابقة', 'Compliance')}</Th>
              </tr></thead>
              <tbody>
                {po.lines.map((l) => (
                  <tr key={l.id}>
                    <Td><Ltr className="font-bold">{l.code}</Ltr></Td>
                    <Td className="text-xs">{l.description ?? '—'}</Td>
                    <Td className="text-end"><Ltr>{qty(l.qty)}</Ltr></Td>
                    <Td className="text-end"><Ltr className={Number(l.receivedQty) > 0 ? 'text-ok' : ''}>{qty(l.receivedQty)}</Ltr></Td>
                    <Td className="text-end"><Ltr>{qty(l.billedQty)}</Ltr></Td>
                    <Td className="text-end"><Ltr className={Number(l.remainingQty) > 0 ? 'font-bold text-gold-dark' : 'text-muted'}>{qty(l.remainingQty)}</Ltr></Td>
                    <Td className="text-end"><Amount value={l.unitPrice} currency={po.currency} /></Td>
                    <Td className="text-end"><Amount value={l.amount} currency={po.currency} /></Td>
                    <Td><ComplianceBadge compliance={l.compliance} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {canCost && (
              <div className="flex justify-end border-t border-line p-4">
                <dl className="w-full max-w-xs space-y-1 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-muted">{bi('المجموع', 'Subtotal')}</dt><dd><Amount value={po.subtotal} currency={po.currency} /></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">{bi('الضريبة', 'VAT')}</dt><dd><Amount value={po.vat} currency={po.currency} /></dd></div>
                  <div className="flex justify-between gap-3 border-t border-line pt-1 font-extrabold"><dt>{bi('الإجمالي', 'Total')}</dt><dd><Amount value={po.total} currency={po.currency} /></dd></div>
                  {po.currency !== 'SAR' && <div className="flex justify-between gap-3 text-primary"><dt>{bi('بالريال', 'In SAR')}</dt><dd><Money value={po.totalSar} fixed /></dd></div>}
                  {po.depositPercent > 0 && po.total !== null && (
                    <div className="flex justify-between gap-3 text-xs text-muted"><dt>{bi('الدفعة المقدمة', 'Deposit')} <span className="num">{po.depositPercent}%</span></dt><dd><Amount value={(Number(po.total) * po.depositPercent) / 100} currency={po.currency} /></dd></div>
                  )}
                </dl>
              </div>
            )}
          </Card>

          <Card title={bi('سندات الاستلام', 'Goods receipts')} padded={false}>
            {po.receipts.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لم تُستلم بضاعة بعد.', 'Nothing received yet.')}</p> : (
              <Table>
                <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('المستودع', 'Warehouse')}</Th><Th>{bi('الشحنة', 'Shipment')}</Th></tr></thead>
                <tbody>
                  {po.receipts.map((r) => (
                    <tr key={r.id} className="cursor-pointer hover:bg-tint/50" onClick={() => setReceipt(r.id)}>
                      <Td><span dir="ltr" className="num font-bold text-primary">{r.number}</span></Td>
                      <Td><Ltr className="text-xs">{date(r.receivedOn)}</Ltr></Td>
                      <Td className="text-xs">{whName(r.warehouseId)}</Td>
                      <Td>{r.shipmentId ? <Link href={`/purchasing/shipments/${r.shipmentId}`} onClick={(e) => e.stopPropagation()} className="text-xs font-bold text-primary hover:underline">{bi('عرض', 'View')}</Link> : <span className="text-muted">—</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title={bi('فواتير المورد', 'Supplier bills')} padded={false}>
            <ErrorBox error={bills.error} />
            {(bills.data ?? []).length === 0 ? <p className="p-4 text-sm text-muted">{bills.isLoading ? bi('جارٍ التحميل…', 'Loading…') : bi('لا توجد فواتير.', 'No bills.')}</p> : (
              <Table>
                <thead><tr>
                  <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('فاتورة المورد', 'Supplier invoice')}</Th><Th>{bi('التاريخ', 'Date')}</Th>
                  <Th className="text-end">{bi('الإجمالي', 'Total')}</Th><Th>{bi('المطابقة', 'Match')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('الملف', 'File')}</Th>
                </tr></thead>
                <tbody>
                  {bills.data!.map((b) => (
                    <tr key={b.id} className="align-top">
                      <Td><Ltr className="font-bold">{b.number}</Ltr></Td>
                      <Td><Ltr>{b.supplierInvoiceNo}</Ltr></Td>
                      <Td><Ltr className="text-xs">{date(b.billDate)}</Ltr></Td>
                      <Td className="text-end"><Amount value={b.total} currency={b.currency} /></Td>
                      <Td>
                        <Chip map={MATCH_STATUS} value={b.matchStatus} />
                        {b.matchIssues.length > 0 && <ul className="mt-1 space-y-0.5 text-[11px] text-danger">{b.matchIssues.map((i, k) => <li key={k}>{locale === 'en' ? i.en : i.ar}</li>)}</ul>}
                      </Td>
                      <Td>
                        <Chip map={BILL_STATUS} value={b.status} />
                        {b.status === 'draft' && b.matchStatus === 'exception' && can('purchase.approve') && (
                          <Button size="sm" variant="outline" className="mt-1 block" onClick={async () => {
                            try {
                              await api.post(`/inventory/bills/${b.id}/approve`);
                              toast.success(bi('تم قبول الفاتورة رغم الاستثناء', 'Bill accepted despite the exception'));
                              refresh(); qc.invalidateQueries({ queryKey: ['po-bills', id] });
                            } catch (e) { toast.error((e as Error).message); }
                          }}>{bi('قبول الاستثناء', 'Accept exception')}</Button>
                        )}
                      </Td>
                      <Td>{b.fileId ? <AttachmentList ids={[b.fileId]} size="sm" /> : <span className="text-muted">—</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={bi('التفاصيل', 'Details')}>
            <Info label={bi('العملة / سعر الصرف', 'Currency / rate')}><Ltr>{po.currency} @ {Number(po.rateToSar)}</Ltr></Info>
            <Info label={bi('شرط التسليم', 'Incoterm')}><Ltr>{po.incoterm}</Ltr></Info>
            <Info label={bi('الدفعة المقدمة', 'Deposit')}><Ltr>{`${po.depositPercent}%`}</Ltr></Info>
            <Info label={bi('تاريخ الأمر', 'Order date')}><Ltr>{po.orderDate ? date(po.orderDate) : null}</Ltr></Info>
            <Info label={bi('الوصول المتوقع', 'Expected')}><Ltr>{po.expectedOn ? date(po.expectedOn) : null}</Ltr></Info>
            <Info label={bi('المشروع', 'Project')}>{po.project ? <Link href={`/projects/${po.project.id}`} className="font-bold text-primary hover:underline"><span dir="ltr" className="num">{po.project.number}</span></Link> : '—'}</Info>
            {po.materialRequestId && <Info label={bi('طلب المواد', 'Material request')}><Link href={`/purchasing/requests/${po.materialRequestId}`} className="font-bold text-primary hover:underline">{bi('عرض', 'View')}</Link></Info>}
            <Info label={bi('المعتمد المطلوب', 'Approver role')}><Chip map={APPROVER_ROLE} value={po.approverRole} /></Info>
            <Info label={bi('أنشأه', 'Created by')}>{po.createdByName ?? '—'}</Info>
            {po.approvedByName && <Info label={bi('اعتمده', 'Approved by')}>{po.approvedByName} <span dir="ltr" className="num text-xs text-muted">{dateTime(po.approvedAt)}</span></Info>}
            {po.notes && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{po.notes}</p>}
          </Card>
          {po.complianceNotes.length > 0 && (
            <Card title={bi('ملاحظات المطابقة عند الاعتماد', 'Compliance notes at approval')}>
              <ul className="list-disc space-y-0.5 ps-5 text-xs leading-relaxed text-amber-900">{po.complianceNotes.map((n, i) => <li key={i} dir="ltr">{n.en}</li>)}</ul>
            </Card>
          )}
          {po.supplier && (
            <Card title={bi('المورد', 'Supplier')}>
              <Info label={bi('الاسم', 'Name')}>{supplierName}</Info>
              <Info label={bi('الرقم الضريبي', 'VAT number')}><Ltr>{po.supplier.vatNumber}</Ltr></Info>
              <Info label={bi('الهاتف', 'Phone')}><Ltr>{po.supplier.phone}</Ltr></Info>
              <Info label={bi('البريد', 'E-mail')}><Ltr>{po.supplier.email}</Ltr></Info>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? confirmText[confirm][0] : ''}
        message={confirm ? confirmText[confirm][1] : ''}
        loading={act.isPending}
        onConfirm={() => confirm && act.mutate({ path: confirm })}
        onClose={() => setConfirm(null)}
      />
      <ReasonDialog
        open={reason === 'reject'}
        title={bi('رفض أمر الشراء', 'Reject the purchase order')}
        hint={bi('يعود الأمر مسودة لمنشئه مع السبب.', 'The order goes back to draft with your reason.')}
        required danger loading={act.isPending}
        onConfirm={(r) => act.mutate({ path: 'reject', body: { reason: r } })}
        onClose={() => setReason(null)}
      />
      <ReasonDialog
        open={reason === 'cancel'}
        title={bi('إلغاء أمر الشراء', 'Cancel the purchase order')}
        danger loading={act.isPending}
        onConfirm={(r) => act.mutate({ path: 'cancel', body: { reason: r || null } })}
        onClose={() => setReason(null)}
      />
      {dialog === 'approve' && <ApproveDialog po={po} open onClose={() => setDialog(null)} onDone={(v) => { refresh(v); setDialog(null); }} />}
      {dialog === 'receive' && <ReceiveDialog po={po} open onClose={() => setDialog(null)} onDone={() => { refresh(); setDialog(null); }} />}
      {dialog === 'bill' && <BillDialog po={po} open onClose={() => setDialog(null)} onDone={() => { refresh(); qc.invalidateQueries({ queryKey: ['po-bills', id] }); setDialog(null); }} />}
      {receipt && <ReceiptDialog id={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

function ReceiptDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['receipt', id], queryFn: () => api.get<ReceiptView>(`/inventory/receipts/${id}`) });
  const r = q.data;
  return (
    <Dialog wide open onClose={onClose} title={<>{bi('سند استلام', 'Goods receipt')} {r && <span dir="ltr" className="num">{r.number}</span>}</>}>
      {q.isLoading ? <Spinner /> : !r ? <ErrorBox error={q.error} /> : (
        <div className="space-y-3">
          <div className="text-sm"><Info label={bi('التاريخ', 'Date')}><Ltr>{date(r.receivedOn)}</Ltr></Info><Info label={bi('المستودع', 'Warehouse')}>{r.warehouse ? `${r.warehouse.code} — ${r.warehouse.nameAr}` : '—'}</Info></div>
          <Table>
            <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th className="text-end">{bi('التكلفة/وحدة', 'Unit cost')}</Th><Th className="text-end">{bi('تكلفة استيراد/وحدة', 'Landed/unit')}</Th><Th>{bi('الأرقام التسلسلية', 'Serials')}</Th></tr></thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id} className="align-top">
                  <Td><Ltr className="font-bold">{l.code}</Ltr></Td>
                  <Td className="text-end"><Ltr>{qty(l.qty)}</Ltr></Td>
                  <Td className="text-end">{l.unitCostSar === null ? '—' : <Money value={l.unitCostSar} fixed />}</Td>
                  <Td className="text-end">{l.landedPerUnitSar === null ? '—' : <Money value={l.landedPerUnitSar} fixed />}</Td>
                  <Td>
                    {l.serials.length === 0 ? <span className="text-muted">—</span> : (
                      <ul dir="ltr" className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px]">
                        {l.serials.map((s) => <li key={s.serial}>{s.serial}{s.macs.length > 0 && <span className="text-muted"> · {s.macs.join(', ')}</span>}</li>)}
                      </ul>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {r.notes && <p className="whitespace-pre-wrap text-sm">{r.notes}</p>}
        </div>
      )}
    </Dialog>
  );
}
