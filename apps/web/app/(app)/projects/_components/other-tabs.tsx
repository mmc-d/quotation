'use client';
import Link from 'next/link';
import { CheckCircle2, Cpu, ExternalLink, MinusCircle, Plus, Wrench, XCircle } from 'lucide-react';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, dateTime, h } from '@/lib/format';
import { Empty, LinkButton, Money, StatusBadge, Table, Td, Th, clsx } from '@/components/ui';
import { Chip } from './kit';
import type { ProjectView } from './types';

export function PaymentsTab({ p }: { p: ProjectView }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const total = p.milestones.reduce((s, m) => s + h(m.amount), 0);
  const paid = p.milestones.reduce((s, m) => s + h(m.paidAmount), 0);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{bi('المحصّل', 'Collected')} <b><Money value={paid} /></b> {bi('من', 'of')} <Money value={total} /></span>
        {p.contract && can('contract.read') && <LinkButton size="sm" href={`/contracts/${p.contract.id}#billing`} icon={<ExternalLink className="size-3.5" />}>{bi('فوترة العقد', 'Contract billing')}</LinkButton>}
      </div>
      {p.milestones.length === 0 ? <Empty title={bi('لا يوجد جدول دفعات', 'No payment schedule')} hint={!p.contract ? bi('المشروع غير مرتبط بعقد.', 'The project is not linked to a contract.') : undefined} /> : (
        <Table>
          <thead><tr><Th>#</Th><Th>{bi('الدفعة', 'Milestone')}</Th><Th className="text-end">%</Th><Th className="text-end">{bi('المبلغ', 'Amount')}</Th><Th className="text-end">{bi('المدفوع', 'Paid')}</Th><Th>{bi('الاستحقاق', 'Due')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
          <tbody>
            {p.milestones.map((m, i) => (
              <tr key={m.id}>
                <Td className="num text-xs text-muted">{i + 1}</Td>
                <Td className="font-bold">{locale === 'en' ? m.nameEn || m.nameAr : m.nameAr}</Td>
                <Td className="num text-end">{Number(m.percent)}%</Td>
                <Td className="text-end"><Money value={m.amount} /></Td>
                <Td className="text-end"><Money value={m.paidAmount} /></Td>
                <Td className="num whitespace-nowrap text-xs">{date(m.dueDate)}</Td>
                <Td><StatusBadge status={m.status} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function TestMark({ v }: { v: boolean | null }) {
  const { bi } = useI18n();
  if (v === true) return <CheckCircle2 className="size-4 text-ok" aria-label={bi('ناجح', 'Passed')} />;
  if (v === false) return <XCircle className="size-4 text-danger" aria-label={bi('فاشل', 'Failed')} />;
  return <MinusCircle className="size-4 text-gray-300" aria-label={bi('لم يُختبر', 'Not tested')} />;
}

export function DevicesTab({ p }: { p: ProjectView }) {
  const { bi } = useI18n();
  const { can } = useMe();
  if (p.assetsHidden) return <Empty icon={<Cpu className="size-8" />} title={bi('لا تملك صلاحية عرض الأجهزة', 'You cannot view devices')} hint={bi('عرض جدول الأجهزة يحتاج صلاحية الأصول المركبة.', 'The device schedule needs the installed-assets permission.')} />;
  const untested = p.assets.filter((a) => a.status === 'active' && a.testPassed !== true).length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{bi(`${p.assets.length} جهاز · ${untested} بدون اختبار ناجح`, `${p.assets.length} devices · ${untested} without a passed test`)}</span>
        {can('asset.write') && <LinkButton size="sm" href={`/field/assets?projectId=${p.id}`} icon={<Plus className="size-3.5" />}>{bi('تسجيل الأجهزة', 'Register devices')}</LinkButton>}
      </div>
      {p.assets.length === 0 ? <Empty icon={<Cpu className="size-8" />} title={bi('لا توجد أجهزة مسجلة', 'No devices registered')} /> : (
        <Table>
          <thead><tr><Th>{bi('الرمز', 'Code')}</Th><Th>{bi('الوصف', 'Description')}</Th><Th>{bi('الموقع', 'Location')}</Th><Th>{bi('الرقم التسلسلي', 'Serial')}</Th><Th>MAC</Th><Th>IP</Th><Th>{bi('الاختبار', 'Test')}</Th><Th>{bi('نهاية الضمان', 'Warranty ends')}</Th></tr></thead>
          <tbody>
            {p.assets.map((a) => (
              <tr key={a.id} className={clsx('hover:bg-tint/50', a.status !== 'active' && 'opacity-60')}>
                <Td><Link href={`/field/assets/${a.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{a.code}</Link></Td>
                <Td className="text-xs">{a.description ?? '—'}</Td>
                <Td className="text-xs">{a.locationPath ?? '—'}</Td>
                <Td><span className="num text-xs" dir="ltr">{a.serial ?? '—'}</span></Td>
                <Td><span className="num text-xs" dir="ltr">{a.mac ?? '—'}</span></Td>
                <Td><span className="num text-xs" dir="ltr">{a.ip ?? '—'}</span></Td>
                <Td><TestMark v={a.testPassed} /></Td>
                <Td className="num whitespace-nowrap text-xs">{a.labourWarrantyEnd || a.partsWarrantyEnd ? <>{date(a.labourWarrantyEnd)}{a.partsWarrantyEnd && a.partsWarrantyEnd !== a.labourWarrantyEnd && <div className="text-muted">{bi('القطع', 'Parts')} {date(a.partsWarrantyEnd)}</div>}</> : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

const WO_TYPE: Record<string, [string, string]> = {
  survey: ['رفع مساحي / زيارة موقع', 'Site survey'], installation: ['تركيب', 'Installation'], commissioning: ['برمجة واختبار', 'Commissioning'],
  corrective: ['صيانة تصحيحية', 'Corrective'], preventive: ['صيانة وقائية', 'Preventive'], warranty: ['ضمان', 'Warranty'], inspection: ['فحص', 'Inspection'],
};
const WO_STATUS: Record<string, [string, string, string]> = {
  new: ['جديد', 'New', 'bg-sky-100 text-sky-800'], scheduled: ['مجدول', 'Scheduled', 'bg-indigo-100 text-indigo-800'], dispatched: ['مُرسل للفني', 'Dispatched', 'bg-indigo-100 text-indigo-800'],
  en_route: ['في الطريق', 'En route', 'bg-violet-100 text-violet-800'], on_site: ['في الموقع', 'On site', 'bg-amber-100 text-amber-800'], awaiting_parts: ['بانتظار قطع', 'Awaiting parts', 'bg-amber-100 text-amber-800'],
  completed: ['مكتمل', 'Completed', 'bg-emerald-100 text-emerald-800'], closed: ['مغلق', 'Closed', 'bg-gray-200 text-gray-600'], cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-600'],
};

export function WorkOrdersTab({ p }: { p: ProjectView }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const en = locale === 'en';
  return (
    <div>
      <div className="mb-3 flex justify-end">
        {can('workorder.write') && <LinkButton size="sm" href={`/field/work-orders/new?projectId=${p.id}`} icon={<Plus className="size-3.5" />}>{bi('أمر عمل جديد', 'New work order')}</LinkButton>}
      </div>
      {p.workOrders.length === 0 ? <Empty icon={<Wrench className="size-8" />} title={bi('لا توجد أوامر عمل', 'No work orders')} /> : (
        <Table>
          <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('العنوان', 'Title')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('الموعد', 'Scheduled')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
          <tbody>
            {p.workOrders.map((w) => (
              <tr key={w.id} className="hover:bg-tint/50">
                <Td><Link href={`/field/work-orders/${w.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{w.number}</Link></Td>
                <Td>{w.title}</Td>
                <Td className="text-xs">{WO_TYPE[w.type] ? WO_TYPE[w.type]![en ? 1 : 0] : w.type}</Td>
                <Td className="num whitespace-nowrap text-xs">{w.scheduledStart ? dateTime(w.scheduledStart) : '—'}</Td>
                <Td>{WO_STATUS[w.status] ? <Chip chip={WO_STATUS[w.status]![2]}>{WO_STATUS[w.status]![en ? 1 : 0]}</Chip> : <StatusBadge status={w.status} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
