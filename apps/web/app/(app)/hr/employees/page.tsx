'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Card, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Select, Spinner, Stat, Table, Tabs, Td, Th } from '@/components/ui';
import { EMP_STATUS } from '../_components/hr-kit';

interface Row {
  id: string; number: string; nameAr: string; jobTitleAr: string; department: string | null; mobile: string | null; nationality: string | null; hireDate: string;
  idExpiry: string | null; contractEndDate: string | null; probationEndDate: string | null; status: string; monthlyTotal: string;
}
interface ListResult { rows: Row[]; total: number; summary: { active: number; idExpiring: number; contractEnding: number; payroll: string }; departments: string[] }

const plusDays = (n: number) => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function EmployeesPage() {
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const [status, setStatus] = useState('active');
  const [department, setDepartment] = useState('');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['hr-employees', status, department, q],
    queryFn: () => api.get<ListResult>(`/hr/employees${qs({ status: status === 'all' ? undefined : status, department: department || undefined, q: q || undefined, limit: 200 })}`),
  });
  const s = list.data?.summary;
  const soon = plusDays(60);
  const t = today();

  return (
    <>
      <PageHeader
        title={bi('الموظفون', 'Employees')}
        subtitle={bi('سجل الموظفين: البيانات الشخصية والوظيفية والأجر وتواريخ الهوية والعقد.', 'The employee register: personal and job details, pay, ID and contract dates.')}
        actions={<>
          <LinkButton href="/hr/offers" icon={<Users className="size-4" />}>{bi('العروض الوظيفية', 'Job offers')}</LinkButton>
          {can('hr.write') && <LinkButton href="/hr/employees/new" variant="primary" icon={<Plus className="size-4" />}>{bi('إضافة موظف', 'Add employee')}</LinkButton>}
        </>}
      />
      {s && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Stat label={bi('على رأس العمل', 'Active')} value={s.active} tone="green" />
          <Stat label={bi('إجمالي الأجور الشهرية', 'Monthly payroll')} value={<Money value={s.payroll} />} />
          <Stat label={bi('هويات / إقامات تنتهي خلال 60 يومًا', 'IDs expiring in 60 days')} value={s.idExpiring} tone={s.idExpiring ? 'red' : undefined} />
          <Stat label={bi('عقود تنتهي خلال 60 يومًا', 'Contracts ending in 60 days')} value={s.contractEnding} tone={s.contractEnding ? 'gold' : undefined} />
        </div>
      )}
      <Card padded={false}>
        <div className="border-b border-line px-3 pt-2">
          <Tabs value={status} onChange={setStatus} items={[
            { value: 'active', label: bi('على رأس العمل', 'Active') },
            { value: 'suspended', label: bi('موقوفون', 'Suspended') },
            { value: 'terminated', label: bi('انتهت خدمتهم', 'Left') },
            { value: 'all', label: bi('الكل', 'All') },
          ]} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('الرقم، الاسم، الوظيفة، الجوال، الهوية…', 'Number, name, job, mobile, ID…')} />
          {!!list.data?.departments.length && (
            <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="max-w-[14rem]">
              <option value="">{bi('كل الأقسام', 'All departments')}</option>
              {list.data.departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          )}
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<Users className="size-8" />} title={bi('لا يوجد موظفون', 'No employees')} hint={can('hr.write') ? bi('أضف موظفًا، أو حوّل عرضًا وظيفيًا مقبولًا إلى ملف موظف.', 'Add an employee, or turn an accepted job offer into one.') : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'No.')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th>{bi('الوظيفة', 'Job')}</Th><Th>{bi('المباشرة', 'Hired')}</Th><Th>{bi('تنبيهات', 'Alerts')}</Th><Th className="text-end">{bi('الأجر الشهري', 'Monthly pay')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
            <tbody>
              {list.data.rows.map((r) => {
                const st = EMP_STATUS[r.status];
                const live = r.status !== 'terminated';
                return (
                  <tr key={r.id} className="hover:bg-tint/50">
                    <Td><Link href={`/hr/employees/${r.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{r.number}</Link></Td>
                    <Td><Link href={`/hr/employees/${r.id}`} className="font-bold hover:underline">{r.nameAr}</Link>{r.mobile && <div className="num text-[11px] text-muted" dir="ltr">{r.mobile}</div>}</Td>
                    <Td className="text-xs">{r.jobTitleAr}{r.department && <span className="text-muted"> · {r.department}</span>}</Td>
                    <Td className="num text-xs">{date(r.hireDate)}</Td>
                    <Td><div className="flex flex-wrap gap-1">
                      {live && r.idExpiry && r.idExpiry <= soon && <Badge tone="red">{r.idExpiry < t ? bi('الهوية منتهية', 'ID expired') : bi('الهوية تنتهي', 'ID expiring')} {date(r.idExpiry)}</Badge>}
                      {live && r.contractEndDate && r.contractEndDate <= soon && <Badge tone="gold">{bi('العقد ينتهي', 'Contract ends')} {date(r.contractEndDate)}</Badge>}
                      {live && r.probationEndDate && r.probationEndDate >= t && <Badge tone="blue">{bi('تحت التجربة حتى', 'Probation until')} {date(r.probationEndDate)}</Badge>}
                    </div></Td>
                    <Td className="text-end"><Money value={r.monthlyTotal} fixed /></Td>
                    <Td>{st && <Badge tone={st[2]}>{locale === 'en' ? st[1] : st[0]}</Badge>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
