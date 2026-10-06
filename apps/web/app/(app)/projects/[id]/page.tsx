'use client';
import Link from 'next/link';
import { use, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Settings2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, clsx, ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { ApprovalsTab } from '../_components/approvals-tab';
import { ClockCard } from '../_components/clock-card';
import { GateCard } from '../_components/gate-card';
import { HandoverCard } from '../_components/handover-card';
import { Chip, MapChip, StageStepper, stageLabel, useProjectAction } from '../_components/kit';
import { DevicesTab, PaymentsTab, WorkOrdersTab } from '../_components/other-tabs';
import { SettingsDialog } from '../_components/settings-dialog';
import { SnagsTab } from '../_components/snags-tab';
import { TasksTab } from '../_components/tasks-tab';
import { PROJECT_STATUS, type ProjectView } from '../_components/types';

type Tab = 'approvals' | 'payments' | 'tasks' | 'snags' | 'devices' | 'workorders';

function Info({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="min-w-0"><div className="text-[11px] font-bold text-muted">{label}</div><div className="truncate text-sm font-bold">{children}</div></div>;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const q = useQuery({ queryKey: ['project', id], queryFn: () => api.get<ProjectView>(`/projects/${id}`) });
  const action = useProjectAction(id);
  const [tab, setTab] = useState<Tab>('approvals');
  const [settings, setSettings] = useState(false);

  if (q.isLoading) return <Spinner />;
  const p = q.data;
  if (!p) return <><PageHeader back="/projects" title={bi('المشروع', 'Project')} /><ErrorBox error={q.error} /></>;

  const openSnags = p.snags.filter((s) => s.status !== 'verified').length;
  const openTasks = p.tasks.filter((t) => t.status !== 'done').length;
  const pendingApprovals = p.approvals.filter((g) => g.required && g.latest.status !== 'approved').length + ((p.requiredApprovals ?? []) as string[]).filter((k) => !p.approvals.some((g) => g.kind === k)).length;
  const showHandover = ['handover', 'warranty', 'closed'].includes(p.stage);
  const customerName = p.customer ? (locale === 'en' ? p.customer.nameEn || p.customer.nameAr : p.customer.nameAr) : null;

  const tabs: { value: Tab; label: string; count?: number; alert?: boolean }[] = [
    { value: 'approvals', label: bi('اعتمادات العميل', 'Client approvals'), count: pendingApprovals || undefined, alert: pendingApprovals > 0 },
    { value: 'payments', label: bi('الدفعات', 'Payments') },
    { value: 'tasks', label: bi('المهام', 'Tasks'), count: openTasks || undefined },
    { value: 'snags', label: bi('الملاحظات', 'Snags'), count: openSnags || undefined, alert: openSnags > 0 },
    { value: 'devices', label: bi('الأجهزة', 'Devices'), count: p.assetsHidden ? undefined : p.assets.length },
    { value: 'workorders', label: bi('أوامر العمل', 'Work orders'), count: p.workOrders.length || undefined },
  ];

  return (
    <>
      <PageHeader
        back="/projects"
        title={<span className="flex flex-wrap items-center gap-2"><span className="num" dir="ltr">{p.number}</span><span>{p.name}</span><MapChip map={PROJECT_STATUS} value={p.status} /></span>}
        subtitle={p.template.ar ? (locale === 'en' ? p.template.en : p.template.ar) : undefined}
        actions={can('project.write') && <Button variant="outline" icon={<Settings2 className="size-4" />} onClick={() => setSettings(true)}>{bi('الإعدادات', 'Settings')}</Button>}
      />

      <Card className="mb-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Info label={bi('العميل', 'Customer')}>{p.customer ? <Link href={`/customers/${p.customer.id}`} className="text-primary hover:underline">{customerName}</Link> : '—'}</Info>
          <Info label={bi('العقد', 'Contract')}>{p.contract ? <Link href={`/contracts/${p.contract.id}`} className="num text-primary hover:underline" dir="ltr">{p.contract.number}</Link> : '—'}</Info>
          <Info label={bi('مدير المشروع', 'Project manager')}>{p.managerName ?? <span className="text-muted">{bi('غير محدد', 'Not set')}</span>}</Info>
          <Info label={bi('المرحلة الحالية', 'Current stage')}><Chip chip="bg-tint text-gold-dark">{stageLabel(p.stage, locale)}</Chip></Info>
        </div>
        {p.site && (
          <div className="mt-3 flex items-start gap-1.5 text-xs text-muted">
            <MapPin className="mt-0.5 size-3.5 shrink-0" />
            <span>{p.site.name}{p.site.address && ` — ${p.site.address}`}{p.site.mapLink && <> · <a href={p.site.mapLink} target="_blank" rel="noreferrer" className="font-bold text-gold-dark hover:underline">{bi('الخريطة', 'Map')}</a></>}</span>
          </div>
        )}
        <div className="-mx-4 mt-4 overflow-x-auto border-t border-line px-4 pt-4">
          <StageStepper stage={p.stage} />
        </div>
      </Card>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <GateCard p={p} action={action} />
        <ClockCard p={p} action={action} />
      </div>

      {showHandover && <div className="mb-5"><HandoverCard key={`${p.acceptedOn}`} p={p} action={action} /></div>}

      <Card className="mb-5">
        <div role="tablist" className="-mx-4 -mt-4 mb-4 flex overflow-x-auto border-b border-line px-2">
          {tabs.map((t) => (
            <button key={t.value} role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
              className={clsx('-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-bold whitespace-nowrap transition', tab === t.value ? 'border-gold text-primary' : 'border-transparent text-muted hover:text-ink')}>
              {t.label}
              {t.count !== undefined && <span className={clsx('num ms-1.5 rounded-full px-1.5 text-[11px]', t.alert ? 'bg-rose-100 text-rose-800' : 'bg-tint text-gold-dark')}>{t.count}</span>}
            </button>
          ))}
        </div>
        {tab === 'approvals' && <ApprovalsTab p={p} action={action} />}
        {tab === 'payments' && <PaymentsTab p={p} />}
        {tab === 'tasks' && <TasksTab p={p} action={action} />}
        {tab === 'snags' && <SnagsTab p={p} action={action} />}
        {tab === 'devices' && <DevicesTab p={p} />}
        {tab === 'workorders' && <WorkOrdersTab p={p} />}
      </Card>

      <Card title={bi('سجل المراحل', 'Stage history')}>
        {p.stageLog.length === 0 ? <p className="text-sm text-muted">{bi('لا يوجد سجل', 'No history')}</p> : (
          <ol className="space-y-2">
            {p.stageLog.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-s-2 border-gold/50 ps-3 text-sm">
                <span className="num text-xs text-muted">{dateTime(l.at)}</span>
                <span className="font-bold">{l.fromStage === l.toStage ? stageLabel(l.toStage, locale) : `${stageLabel(l.fromStage, locale)} ${locale === 'en' ? '→' : '←'} ${stageLabel(l.toStage, locale)}`}</span>
                {l.byName && <span className="text-xs text-muted">{l.byName}</span>}
                {l.overriddenChecks.length > 0 && <Badge tone="red">{bi(`تجاوز ${l.overriddenChecks.length} شرط`, `${l.overriddenChecks.length} check(s) overridden`)}</Badge>}
                {l.reason && <div className="w-full text-xs text-muted">{l.reason}</div>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <SettingsDialog p={p} open={settings} onClose={() => setSettings(false)} action={action} />
    </>
  );
}
