'use client';
import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, FileDown, Pencil, Stamp } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, dateTime } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Money, PageHeader, Spinner, StatusBadge } from '@/components/ui';
import { ConfirmDialog, errMsg, ReasonDialog } from '../../../quotes/_components/common';
import { ApprovalSeal, KIND_LABEL, METHODS, VoucherForm, type Voucher } from '../_components/voucher-kit';

export default function VoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, can } = useMe();
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['voucher', id], queryFn: () => api.get<Voucher>(`/vouchers/${id}`) });
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const v = q.data;
  const pay = v.kind === 'payment';
  const title = locale === 'en' ? KIND_LABEL[v.kind][1] : KIND_LABEL[v.kind][0];
  const apply = (nv: Voucher) => { qc.setQueryData(['voucher', id], nv); void qc.invalidateQueries({ queryKey: ['vouchers'] }); };
  const ownDraft = v.createdBy === me?.user.id && !me?.user.roles.includes('owner');
  const canApprove = v.status === 'draft' && can('voucher.approve');
  const canEdit = v.status === 'draft' && can('voucher.write');
  const canCancel = v.status === 'approved' ? can('voucher.approve') : v.status === 'draft' && (can('voucher.write') || can('voucher.approve'));
  const act = async (key: string, fn: () => Promise<Voucher>, ok: string) => {
    setBusy(key);
    try { apply(await fn()); toast.success(ok); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(null); }
  };
  const method = METHODS.find((m) => m.value === v.method);
  const rows: [string, React.ReactNode][] = [
    [pay ? bi('اصرفوا للسيد / السادة', 'Pay to') : bi('استلمنا من', 'Received from'), <>{v.counterpartyName}{v.party && <Badge tone="gray">{bi('مرتبط بسجل', 'linked')}</Badge>}</>],
    [bi('رقم الهوية / السجل', 'ID / CR'), v.counterpartyIdNumber && <span className="num" dir="ltr">{v.counterpartyIdNumber}</span>],
    [bi('الجوال', 'Mobile'), v.counterpartyMobile && <span className="num" dir="ltr">{v.counterpartyMobile}</span>],
    [bi('وذلك مقابل', 'Being for'), <span className="whitespace-pre-line">{v.purpose}</span>],
    [bi('الطريقة', 'Method'), <>{method ? (locale === 'en' ? method.en : method.ar) : v.method}{v.methodRef && <span className="num ms-2" dir="ltr">#{v.methodRef}</span>}{v.bankName && <span className="ms-2">{v.bankName}</span>}{v.methodDate && <span className="num ms-2 text-xs text-muted">{date(v.methodDate)}</span>}</>],
    [bi('الحساب المقابل', 'Counter account'), v.account && <span><span className="num" dir="ltr">{v.account.code}</span> — {v.account.nameAr}</span>],
    [bi('المشروع', 'Project'), v.project && <span><span className="num" dir="ltr">{v.project.number}</span> — {v.project.name}</span>],
    [bi('مركز التكلفة', 'Cost center'), v.costCenter],
    [bi('المرجع', 'Reference'), v.docRef && <span className="num" dir="ltr">{v.docRef}</span>],
    [bi('ملاحظات', 'Notes'), v.notes],
    [bi('أنشأه', 'Created by'), v.createdByName],
  ];

  return (
    <>
      <PageHeader back="/finance/vouchers" title={<span className="flex items-center gap-2">{title} <span className="num" dir="ltr">{v.number}</span></span>}
        subtitle={<span className="flex items-center gap-2">{v.status === 'draft' ? <Badge tone="gold">{bi('مسودة — بانتظار الاعتماد والختم', 'Draft — awaiting approval & stamp')}</Badge> : <StatusBadge status={v.status} />}<span className="num">{date(v.voucherDate)}</span></span>}
        actions={!editing && <>
          <Button variant="outline" icon={<FileDown className="size-4" />} onClick={() => openFile(`/vouchers/${v.id}/pdf`)}>PDF</Button>
          {canEdit && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{bi('تعديل', 'Edit')}</Button>}
          {canCancel && <Button variant="outline" icon={<Ban className="size-4" />} onClick={() => setCancelling(true)}>{bi('إلغاء السند', 'Cancel voucher')}</Button>}
          {canApprove && <Button icon={<Stamp className="size-4" />} disabled={ownDraft} title={ownDraft ? bi('لا يمكنك اعتماد سند أنشأته — يعتمده مسؤول آخر', 'You cannot approve a voucher you created') : undefined} onClick={() => setConfirm(true)}>{bi('اعتماد وختم', 'Approve & stamp')}</Button>}
        </>}
      />

      {editing ? (
        <VoucherForm kind={v.kind} voucher={v} onCancel={() => setEditing(false)} onSaved={(nv) => { apply(nv); setEditing(false); }} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Card>
            <div className="mb-4 flex items-center justify-between rounded-xl bg-tint/60 px-4 py-3">
              <span className="text-sm font-bold text-gold-dark">{bi('المبلغ', 'Amount')}</span>
              <Money value={v.amount} fixed className={`text-2xl font-extrabold ${v.status === 'cancelled' ? 'text-muted line-through' : pay ? 'text-danger' : 'text-ok'}`} />
            </div>
            <dl className="divide-y divide-line">
              {rows.filter(([, val]) => val).map(([k, val]) => (
                <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 py-2 text-sm"><dt className="font-bold text-gold-dark">{k}</dt><dd className="flex flex-wrap items-center gap-2">{val}</dd></div>
              ))}
            </dl>
          </Card>
          <Card title={bi('الاعتماد', 'Approval')}>
            {v.status === 'approved' ? (
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <ApprovalSeal name={v.approvedByName} at={v.approvedAt} />
                <p className="text-xs text-muted">{bi('اعتمده وختمه', 'Approved and stamped by')} <b className="text-ink">{v.approvedByName}</b><br /><span className="num">{v.approvedAt && dateTime(v.approvedAt)}</span></p>
                <p className="text-[11px] text-muted">{bi('يُطبع ختم المنشأة على نسخة PDF المعتمدة.', 'The company stamp is printed on the approved PDF.')}</p>
              </div>
            ) : v.status === 'cancelled' ? (
              <div className="text-sm"><StatusBadge status="cancelled" /><p className="mt-2 text-muted">{bi('سبب الإلغاء:', 'Reason:')} {v.cancelReason}</p></div>
            ) : (
              <div className="grid place-items-center gap-2 py-4 text-center">
                <div className="grid size-28 place-items-center rounded-full border-2 border-dashed border-line text-xs text-muted">{bi('بانتظار الختم', 'Awaiting stamp')}</div>
                <p className="text-xs text-muted">{can('voucher.approve') ? (ownDraft ? bi('أنشأت هذا السند، لذا يعتمده مسؤول آخر.', 'You created this voucher, so another approver must stamp it.') : bi('راجع البيانات ثم اعتمد السند ليُختم ويُقفل.', 'Review the details, then approve to stamp and lock it.')) : bi('يعتمده المدير العام أو المالك.', 'The general manager or owner approves it.')}</p>
              </div>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog open={confirm} title={bi(`اعتماد وختم ${title} ${v.number}`, `Approve & stamp ${v.number}`)} confirmLabel={bi('اعتماد وختم', 'Approve & stamp')} loading={busy === 'approve'}
        message={bi('بعد الاعتماد يُختم السند بختم المنشأة ويُقفل للتعديل، ولا يمكن التراجع إلا بإلغائه مع ذكر السبب.', 'Once approved the voucher carries the company stamp and is locked; it can only be cancelled with a reason.')}
        onClose={() => setConfirm(false)} onConfirm={() => void act('approve', () => api.post<Voucher>(`/vouchers/${v.id}/approve`), bi('اعتُمد السند وخُتم', 'Voucher approved and stamped')).then((ok) => ok && setConfirm(false))} />
      <ReasonDialog open={cancelling} required danger title={bi('إلغاء السند', 'Cancel voucher')} confirmLabel={bi('إلغاء السند', 'Cancel voucher')} loading={busy === 'cancel'}
        hint={bi('يبقى رقم السند محجوزًا ويظهر كملغى.', 'The number stays reserved and shows as cancelled.')}
        onClose={() => setCancelling(false)} onConfirm={(reason) => void act('cancel', () => api.post<Voucher>(`/vouchers/${v.id}/cancel`, { reason }), bi('أُلغي السند', 'Voucher cancelled')).then((ok) => ok && setCancelling(false))} />
    </>
  );
}
