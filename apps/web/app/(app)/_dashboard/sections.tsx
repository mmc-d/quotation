'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { PROJECT_STAGES } from '@mmc/domain';
import { h } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Card, Money, Table, Td, Th, clsx } from '@/components/ui';
import { ClockBar, ClockChip, stageLabel } from '../projects/_components/kit';
import type { ActionItem, Home, Severity } from './types';

// ───────────────────────── shared bits ─────────────────────────

/** Change vs the previous equal-length period; hidden when there is nothing to compare with. */
export function Delta({ cur, prev, goodWhenUp = true }: { cur: string | number; prev: string | number; goodWhenUp?: boolean }) {
  const { bi } = useI18n();
  const c = h(cur);
  const p = h(prev);
  if (p <= 0) return null;
  const change = Math.round(((c - p) / p) * 1000) / 10;
  if (change === 0) return <span className="text-muted">{bi('دون تغيير عن الفترة السابقة', 'flat vs previous period')}</span>;
  const up = change > 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 font-bold', good ? 'text-ok' : 'text-danger')}>
      <Icon className="size-3.5" aria-hidden /><span className="num">{up ? '+' : ''}{change}%</span>
      <span className="ms-1 font-normal text-muted">{bi('عن الفترة السابقة', 'vs previous')}</span>
    </span>
  );
}

function Tile({ label, value, hint, tone, href }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'red'; href?: string }) {
  const body = (
    <>
      <div className="text-xs font-bold text-muted">{label}</div>
      <div className={clsx('mt-1 text-2xl font-extrabold', tone === 'red' ? 'text-danger' : 'text-primary')}>{value}</div>
      {hint && <div className="mt-1 space-y-0.5 text-xs text-muted">{hint}</div>}
    </>
  );
  const cls = 'block rounded-[var(--radius-card)] border border-line bg-white p-4';
  return href ? <Link href={href} className={clsx(cls, 'transition hover:border-gold')}>{body}</Link> : <div className={cls}>{body}</div>;
}

function SectionTitle({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return <h2 className="mb-2 flex items-baseline gap-2 text-sm font-extrabold text-primary">{children}{note && <span className="text-xs font-bold text-muted">{note}</span>}</h2>;
}

// ───────────────────────── action inbox ─────────────────────────

const SEVERITY: Record<Severity, { icon: typeof Info; cls: string; ar: string; en: string }> = {
  critical: { icon: AlertOctagon, cls: 'text-danger bg-rose-50', ar: 'عاجل', en: 'Urgent' },
  warning: { icon: AlertTriangle, cls: 'text-amber-700 bg-amber-50', ar: 'تنبيه', en: 'Attention' },
  info: { icon: Info, cls: 'text-sky-700 bg-sky-50', ar: 'للمتابعة', en: 'Follow up' },
};

/** Label per action key; `n` is the count, `s` the item's secondary count. */
const ACTION_LABELS: Record<string, { ar: string; en: string; sub?: { ar: string; en: string } }> = {
  payment_requests_overdue: { ar: 'طلبات دفع متأخرة السداد', en: 'Overdue payment requests' },
  invoices_overdue: { ar: 'فواتير متأخرة السداد', en: 'Overdue invoices' },
  bills_overdue: { ar: 'فواتير موردين متأخرة', en: 'Overdue supplier bills' },
  tickets_sla_breached: { ar: 'بلاغات تجاوزت مهلة الخدمة', en: 'Tickets past their SLA' },
  projects_clock_overdue: { ar: 'مشاريع تجاوزت مدة التسليم', en: 'Projects past the delivery window' },
  quotes_pending_approval: { ar: 'عروض بانتظار موافقتك', en: 'Quotes awaiting approval' },
  milestones_to_bill: { ar: 'دفعات مستحقة لم تُطلب بعد', en: 'Due milestones not yet requested' },
  quotes_expiring: { ar: 'عروض تنتهي صلاحيتها خلال 7 أيام', en: 'Quotes expiring within 7 days' },
  projects_clock_warn: { ar: 'مشاريع تجاوزت 90% من مدة التسليم', en: 'Projects over 90% of the delivery window' },
  tickets_sla_at_risk: { ar: 'بلاغات تقترب من مهلة الخدمة', en: 'Tickets close to their SLA' },
  work_orders_unassigned: { ar: 'أوامر عمل بلا فني', en: 'Work orders without a technician' },
  bills_due_week: { ar: 'فواتير موردين تستحق خلال أسبوع', en: 'Supplier bills due this week' },
  pos_pending_approval: { ar: 'أوامر شراء بانتظار الاعتماد', en: 'Purchase orders awaiting approval' },
  stock_below_reorder: { ar: 'أصناف تحت حد إعادة الطلب', en: 'Items below reorder level' },
  tasks_overdue: { ar: 'مهامك المتأخرة', en: 'Your overdue tasks' },
  snags_open: { ar: 'ملاحظات تسليم مفتوحة', en: 'Open snags', sub: { ar: 'متأخرة', en: 'overdue' } },
  client_approvals_pending: { ar: 'اعتمادات بانتظار العميل', en: 'Approvals waiting on the client' },
  contracts_awaiting_signature: { ar: 'عقود بانتظار التوقيع', en: 'Contracts awaiting signature' },
  projects_on_hold: { ar: 'مشاريع موقوفة', en: 'Projects on hold' },
  work_orders_awaiting_parts: { ar: 'أوامر عمل بانتظار قطع', en: 'Work orders awaiting parts' },
  leads_new: { ar: 'عملاء محتملون جدد لم يُتواصل معهم', en: 'New leads not contacted yet' },
};

export function ActionInbox({ items }: { items: ActionItem[] }) {
  const { bi, locale, dir } = useI18n();
  const Chevron = dir === 'rtl' ? ChevronLeft : ChevronRight;
  if (!items.length) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50/60 px-4 py-3">
        <CheckCircle2 className="size-6 shrink-0 text-ok" aria-hidden />
        <div>
          <p className="font-bold text-ink">{bi('لا شيء ينتظر إجراءك الآن', 'Nothing needs your action right now')}</p>
          <p className="text-xs text-muted">{bi('لا مبالغ متأخرة ولا موافقات معلقة ولا مشاريع متعثرة ضمن صلاحياتك.', 'No overdue money, pending approvals or late projects within your access.')}</p>
        </div>
      </div>
    );
  }
  return (
    <Card title={<>{bi('يحتاج إجراء', 'Needs action')} <span className="ms-1 rounded-full bg-tint px-2 text-[11px] text-gold-dark num">{items.length}</span></>} actions={<span className="text-xs text-muted">{bi('الوضع الآن، بغض النظر عن الفترة', 'As of now, independent of the period')}</span>} padded={false}>
      <ul className="grid divide-y divide-line/70 md:grid-cols-2 md:divide-y-0">
        {items.map((a) => {
          const s = SEVERITY[a.severity];
          const l = ACTION_LABELS[a.key];
          const Icon = s.icon;
          return (
            <li key={a.key} className="md:border-b md:border-line/70 md:odd:border-e">
              <Link href={a.href} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-tint/50">
                <span className={clsx('grid size-9 shrink-0 place-items-center rounded-lg', s.cls)} title={locale === 'en' ? s.en : s.ar}>
                  <Icon className="size-4.5" aria-hidden /><span className="sr-only">{locale === 'en' ? s.en : s.ar}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{l ? (locale === 'en' ? l.en : l.ar) : a.key}</span>
                  <span className="flex flex-wrap gap-x-2 text-xs text-muted">
                    {a.amount !== null && h(a.amount) > 0 && <Money value={a.amount} />}
                    {!!a.sub && l?.sub && <span className="font-bold text-danger"><span className="num">{a.sub}</span> {locale === 'en' ? l.sub.en : l.sub.ar}</span>}
                  </span>
                </span>
                <span className={clsx('num text-xl font-extrabold', a.severity === 'critical' ? 'text-danger' : 'text-primary')}>{a.count}</span>
                <Chevron className="size-4 text-muted transition group-hover:text-gold-dark" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ───────────────────────── cash ─────────────────────────

export function CashStrip({ cash }: { cash: Home['cash'] }) {
  const { bi } = useI18n();
  const { collected, receivables, expected, payables } = cash;
  const any = [collected?.value, collected?.prev, receivables?.outstanding, expected?.d30, payables?.owed].some((v) => v !== undefined && h(v) > 0);
  if (!collected && !receivables && !payables) return null;
  if (!any) return <p className="text-sm text-muted">{bi('لا حركة نقدية: لا تحصيل في الفترة ولا مستحقات أو التزامات قائمة.', 'No cash activity: nothing collected in the period and nothing outstanding.')}</p>;
  return (
    <section>
      <SectionTitle note={bi('التحصيل للفترة · الباقي حتى اليوم', 'Collected in period · the rest as of today')}>{bi('النقد', 'Cash')}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {collected && <Tile label={bi('المحصّل في الفترة', 'Collected in period')} value={<Money value={collected.value} />} hint={<Delta cur={collected.value} prev={collected.prev} />} />}
        {receivables && (
          <Tile
            label={bi('مستحقات على العملاء', 'Receivables outstanding')}
            value={<Money value={receivables.outstanding} />}
            href="/finance/requests"
            hint={<>
              {h(receivables.overdue) > 0
                ? <div className="font-bold text-danger">{bi('متأخر', 'Overdue')} <Money value={receivables.overdue} /></div>
                : <div>{bi('لا مبالغ متأخرة', 'Nothing overdue')}</div>}
              {receivables.requests !== null && receivables.invoices !== null && h(receivables.invoices) > 0 && (
                <div>{bi('طلبات دفع', 'Requests')} <Money value={receivables.requests} /> · {bi('فواتير', 'Invoices')} <Money value={receivables.invoices} /></div>
              )}
            </>}
          />
        )}
        {expected && (
          <Tile
            label={bi('تحصيل متوقع خلال 30 يومًا', 'Expected in the next 30 days')}
            value={<Money value={expected.d30} />}
            hint={<>
              <div>{bi('خلال 14 يومًا', 'Next 14 days')} <Money value={expected.d14} /></div>
              {h(expected.scheduled30) > 0 && <div>{bi('منها دفعات مجدولة لم تُطلب', 'incl. scheduled, not yet requested')} <Money value={expected.scheduled30} /></div>}
            </>}
          />
        )}
        {payables && (
          <Tile
            label={bi('مستحق للموردين', 'Owed to suppliers')}
            value={<Money value={payables.owed} />}
            href="/purchasing/bills?view=unpaid"
            hint={<>
              {h(payables.overdue) > 0 && <div className="font-bold text-danger">{bi('متأخر', 'Overdue')} <Money value={payables.overdue} /></div>}
              <div>{bi('يستحق خلال 30 يومًا', 'Due in 30 days')} <Money value={payables.d30} /></div>
            </>}
          />
        )}
      </div>
    </section>
  );
}

// ───────────────────────── sales ─────────────────────────

export function SalesStrip({ sales }: { sales: NonNullable<Home['sales']> }) {
  const { bi } = useI18n();
  const items: ReactNode[] = [
    <Tile key="q" label={bi('قيمة العروض الصادرة', 'Quoted value')} value={<Money value={sales.value} />} hint={<><div>{bi(`${sales.count} عرض`, `${sales.count} quotes`)}</div><Delta cur={sales.value} prev={sales.prev.value} /></>} />,
    <Tile key="a" label={bi('عروض مقبولة', 'Accepted')} value={<Money value={sales.acceptedValue} />} hint={<><div>{bi(`${sales.accepted} عرض`, `${sales.accepted} quotes`)}</div><Delta cur={sales.acceptedValue} prev={sales.prev.acceptedValue} /></>} />,
    <Tile key="w" label={bi('نسبة الفوز', 'Win rate')} value={sales.winRate === null ? '—' : <span className="num">{sales.winRate}%</span>} hint={sales.winRate === null ? bi('لم يُحسم أي عرض بعد', 'No quote decided yet') : bi(`${sales.accepted} مقبول · ${sales.lost} خاسر`, `${sales.accepted} won · ${sales.lost} lost`)} />,
    <Tile key="d" label={bi('متوسط الخصم', 'Average discount')} value={<span className="num">{sales.avgDiscountPercent}%</span>} hint={sales.prev.count ? bi(`الفترة السابقة ${sales.prev.avgDiscountPercent}%`, `Previous ${sales.prev.avgDiscountPercent}%`) : undefined} />,
  ];
  if (sales.marginPercent !== null) items.push(<Tile key="m" label={bi('هامش الربح', 'Margin')} value={<span className={clsx('num', sales.marginPercent < 20 && 'text-danger')}>{sales.marginPercent}%</span>} hint={sales.prev.marginPercent !== null ? bi(`الفترة السابقة ${sales.prev.marginPercent}%`, `Previous ${sales.prev.marginPercent}%`) : undefined} />);
  if (sales.pipelineWeighted !== null && h(sales.pipelineWeighted) > 0) items.push(<Tile key="p" label={bi('الفرص المرجّحة', 'Weighted pipeline')} value={<Money value={sales.pipelineWeighted} />} href="/crm/pipeline" hint={bi(`${sales.openOpportunities} فرصة مفتوحة`, `${sales.openOpportunities} open opportunities`)} />);
  if (sales.newLeads) items.push(<Tile key="l" label={bi('عملاء محتملون جدد', 'New leads')} value={<span className="num">{sales.newLeads}</span>} href="/crm/leads" />);
  return (
    <section>
      <SectionTitle note={bi('عروض الفترة', 'Quotes dated in the period')}>{bi('المبيعات', 'Sales')}</SectionTitle>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-3">{items}</div>
    </section>
  );
}

// ───────────────────────── funnel ─────────────────────────

const FUNNEL_LABELS: Record<string, { ar: string; en: string }> = {
  quoted: { ar: 'عروض صادرة', en: 'Quoted' },
  accepted: { ar: 'قبلها العميل', en: 'Accepted' },
  contracted: { ar: 'تعاقد', en: 'Contracted' },
  invoiced: { ar: 'فوتر', en: 'Invoiced' },
  collected: { ar: 'حُصّل', en: 'Collected' },
};

/** Cohort funnel: what became of the quotes dated in the period, by value. One series → one colour. */
export function FunnelCard({ funnel }: { funnel: NonNullable<Home['funnel']> }) {
  const { bi, locale } = useI18n();
  const quoted = h(funnel[0]?.value);
  return (
    <Card title={<>{bi('من العرض إلى التحصيل', 'Quote to cash')} <span className="text-xs font-bold text-muted">· {bi('لعروض الفترة', 'for this period’s quotes')}</span></>}>
      {quoted === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{bi('لا عروض صادرة في هذه الفترة.', 'No quotes issued in this period.')}</p>
      ) : (
        <ol className="space-y-3">
          {funnel.map((s, i) => {
            const w = Math.max(0, Math.min(100, (h(s.value) / quoted) * 100));
            return (
              <li key={s.key}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-bold text-ink">{locale === 'en' ? FUNNEL_LABELS[s.key]?.en : FUNNEL_LABELS[s.key]?.ar}</span>
                  <span className="flex items-baseline gap-2">
                    <Money value={s.value} className="font-bold text-ink" />
                    {i > 0 && <span className="text-muted" title={bi('من الخطوة السابقة', 'of the previous step')}><span className="num">{s.fromPrev ?? 0}%</span></span>}
                  </span>
                </div>
                <div className="h-3 rounded bg-tint" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100} aria-label={locale === 'en' ? FUNNEL_LABELS[s.key]?.en : FUNNEL_LABELS[s.key]?.ar}>
                  {w > 0 && <div className="h-3 rounded bg-primary" style={{ width: `${Math.max(w, 1)}%` }} />}
                </div>
              </li>
            );
          })}
          <li className="pt-1 text-xs text-muted">{bi('النسبة بجانب كل خطوة = من الخطوة التي قبلها. المبالغ شاملة الضريبة.', 'The % beside each step is of the step before. Amounts include VAT.')}</li>
        </ol>
      )}
    </Card>
  );
}

// ───────────────────────── projects ─────────────────────────

export function ProjectsCard({ projects }: { projects: NonNullable<Home['projects']> }) {
  const { bi, locale } = useI18n();
  const stages = PROJECT_STAGES.filter((s) => s !== 'closed');
  const max = Math.max(1, ...stages.map((s) => projects.byStage[s] ?? 0));
  const chips: { n: number; label: string; tone: string; href: string }[] = [
    { n: projects.clocks.overdue ?? 0, label: bi('متأخر', 'overdue'), tone: 'bg-rose-100 text-rose-800', href: '/projects' },
    { n: (projects.clocks.warn90 ?? 0) + (projects.clocks.warn70 ?? 0), label: bi('قرب نهاية المدة', 'near the deadline'), tone: 'bg-amber-100 text-amber-800', href: '/projects' },
    { n: projects.onHold, label: bi('موقوف', 'on hold'), tone: 'bg-gray-100 text-gray-700', href: '/projects' },
    { n: projects.openSnags, label: bi('ملاحظة مفتوحة', 'open snags'), tone: 'bg-sky-100 text-sky-800', href: '/projects' },
    { n: projects.approvalsPending, label: bi('اعتماد لدى العميل', 'approvals with client'), tone: 'bg-indigo-100 text-indigo-800', href: '/projects' },
  ].filter((c) => c.n > 0);
  return (
    <Card title={<>{bi('المشاريع', 'Projects')} <span className="text-xs font-bold text-muted num">· {projects.total} {bi('نشط', 'active')}</span></>} actions={<Link href="/projects" className="text-xs font-bold text-gold-dark hover:underline">{bi('الكل', 'All')}</Link>}>
      {/* stage strip: one cell per stage, bar height ∝ count */}
      <ol className="grid grid-cols-7 gap-1.5" aria-label={bi('المشاريع حسب المرحلة', 'Projects by stage')}>
        {stages.map((s) => {
          const n = projects.byStage[s] ?? 0;
          return (
            <li key={s}>
              <Link href={`/projects?stage=${s}`} className={clsx('flex flex-col items-center gap-1 rounded-lg p-1.5 text-center transition hover:bg-tint', !n && 'opacity-60')}>
                <span className={clsx('num text-lg font-extrabold', n ? 'text-primary' : 'text-muted')}>{n}</span>
                <span className="flex h-8 w-full items-end justify-center rounded bg-tint/60"><span className="w-3/5 rounded-t bg-primary" style={{ height: `${n ? Math.max(12, (n / max) * 100) : 0}%` }} /></span>
                <span className="line-clamp-2 text-[10px] leading-tight text-muted">{stageLabel(s, locale)}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((c) => <Link key={c.label} href={c.href} className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold', c.tone)}><span className="num">{c.n}</span> {c.label}</Link>)}
        </div>
      )}
      <h3 className="mb-2 mt-4 text-xs font-extrabold text-gold-dark">{bi('مشاريع معرضة للتأخير', 'At risk of running late')}</h3>
      {projects.atRisk.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted"><CheckCircle2 className="size-4 text-ok" aria-hidden />{bi('كل المشاريع ضمن مدة التسليم.', 'Every project is within its delivery window.')}</p>
      ) : (
        <ul className="space-y-2.5">
          {projects.atRisk.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="block rounded-lg p-1 transition hover:bg-tint/50">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate"><b className="text-ink">{p.name}</b> <span className="text-muted">· {p.customer ?? p.number} · {stageLabel(p.stage, locale)}</span></span>
                  <ClockChip level={p.level} />
                </div>
                <ClockBar level={p.level} ratio={p.maxDays ? p.elapsed / p.maxDays : 0} />
                <div className="mt-0.5 text-[11px] text-muted">
                  <span className="num">{p.elapsed}/{p.maxDays}</span> {bi('يوم عمل', 'working days')}
                  {p.targetMax && <> · {bi('آخر موعد', 'deadline')} <span className="num">{p.targetMax}</span></>}
                  {p.paused && <> · {bi('متوقف مؤقتًا', 'paused')}</>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ───────────────────────── team ─────────────────────────

export function TeamTable({ team, margin }: { team: NonNullable<Home['team']>; margin: boolean }) {
  const { bi } = useI18n();
  return (
    <Card title={bi('فريق المبيعات', 'Sales team')} padded={false}>
      <Table>
        <thead>
          <tr>
            <Th>{bi('المندوب', 'Rep')}</Th><Th className="text-center">{bi('العروض', 'Quotes')}</Th><Th className="text-center">{bi('مقبول / خاسر', 'Won / lost')}</Th>
            <Th className="text-center">{bi('نسبة الفوز', 'Win rate')}</Th><Th>{bi('قيمة العروض', 'Quoted')}</Th><Th>{bi('قيمة المقبول', 'Won value')}</Th>
            <Th className="text-center">{bi('متوسط الخصم', 'Avg discount')}</Th>{margin && <Th className="text-center">{bi('الهامش', 'Margin')}</Th>}
          </tr>
        </thead>
        <tbody>
          {team.map((r) => (
            <tr key={r.id}>
              <Td className="font-bold">{r.name}</Td>
              <Td className="text-center num">{r.quotes}</Td>
              <Td className="text-center num">{r.won} / {r.lost}</Td>
              <Td className="text-center num">{r.winRate === null ? '—' : `${r.winRate}%`}</Td>
              <Td><Money value={r.value} /></Td>
              <Td><Money value={r.wonValue} /></Td>
              <Td className="text-center num">{r.avgDiscountPercent}%</Td>
              {margin && <Td className={clsx('text-center num', r.marginPercent !== null && r.marginPercent < 20 && 'font-bold text-danger')}>{r.marginPercent === null ? '—' : `${r.marginPercent}%`}</Td>}
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
