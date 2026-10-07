'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, CreditCard, Cpu, MapPin, Plus, ReceiptText, Wrench } from 'lucide-react';
import { Money, clsx } from '@/components/ui';
import { h } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalDevice, type PortalPaymentRequest, type PortalProject, type PortalTicket, type Rows } from './_components/portal-api';
import { usePortalMe } from './_components/portal-shell';
import { ErrorBlock, Loading, sectionTitle } from './_components/portal-ui';

function greeting(bi: (a: string, e: string) => string) {
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }));
  return hour < 12 ? bi('صباح الخير', 'Good morning') : bi('مساء الخير', 'Good evening');
}

export default function PortalHome() {
  const { bi } = useI18n();
  const me = usePortalMe();
  const devices = useQuery({ queryKey: ['portal', 'devices'], queryFn: () => portalFetch<Rows<PortalDevice>>('/devices'), retry: portalRetry });
  const open = useQuery({ queryKey: ['portal', 'tickets', 'open'], queryFn: () => portalFetch<Rows<PortalTicket>>('/tickets?status=open,in_progress'), retry: portalRetry });
  const projects = useQuery({ queryKey: ['portal', 'projects'], queryFn: () => portalFetch<Rows<PortalProject>>('/projects'), retry: portalRetry });
  const pay = useQuery({ queryKey: ['portal', 'payment-requests'], queryFn: () => portalFetch<Rows<PortalPaymentRequest>>('/payment-requests'), retry: portalRetry });

  if (me.isLoading) return <Loading />;
  if (me.error) return <ErrorBlock error={me.error} onRetry={() => me.refetch()} />;
  const d = me.data!;
  const pendingApprovals = projects.data?.rows.reduce((s, p) => s + p.approvalsPending, 0);
  const unpaid = pay.data?.rows.filter((r) => h(r.due) > 0);
  const dueTotal = unpaid?.reduce((s, r) => s + h(r.due), 0);
  const firstName = (d.account.name ?? '').trim().split(/\s+/)[0];

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-extrabold text-primary">{greeting(bi)}{firstName ? bi('، ', ', ') + firstName : ''}</h1>
        <p className="mt-0.5 text-sm text-muted">{bi('مرحبًا بك في بوابة عملاء المدى المبارك —', 'Welcome to the Al-Mada Al-Mubarak customer portal —')} <b className="text-ink">{d.party.nameAr}</b></p>
      </section>

      <section aria-label={bi('ملخص', 'Summary')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Count href="/portal/devices" icon={<Cpu className="size-5" />} label={bi('الأجهزة', 'Devices')} value={devices.data?.rows.length} loading={devices.isLoading} />
        <Count href="/portal/requests" icon={<Wrench className="size-5" />} label={bi('طلبات مفتوحة', 'Open requests')} value={open.data?.rows.length} loading={open.isLoading} />
        <Count href="/portal/projects" icon={<ClipboardCheck className="size-5" />} label={bi('بانتظار موافقتك', 'Awaiting your approval')} value={pendingApprovals} loading={projects.isLoading} highlight={!!pendingApprovals} />
        <Count href="/portal/billing" icon={<ReceiptText className="size-5" />} label={bi('طلبات دفع مستحقة', 'Payment requests due')} value={unpaid?.length} loading={pay.isLoading} highlight={!!unpaid?.length}
          hint={dueTotal ? <Money value={dueTotal} fixed /> : undefined} />
      </section>

      <section aria-label={bi('إجراءات سريعة', 'Quick actions')} className="grid gap-3 sm:grid-cols-2">
        <Link href="/portal/requests/new" className="flex items-center gap-3 rounded-2xl bg-primary p-4 text-white shadow-sm transition hover:bg-primary-600">
          <span className="grid size-11 place-items-center rounded-full bg-white/15"><Plus className="size-5" aria-hidden /></span>
          <span><span className="block font-extrabold">{bi('طلب صيانة جديد', 'New service request')}</span><span className="text-xs text-white/80">{bi('بلّغ عن عطل أو اطلب زيارة فني', 'Report a fault or ask for a technician visit')}</span></span>
        </Link>
        <Link href="/portal/billing" className="flex items-center gap-3 rounded-2xl bg-gold p-4 text-white shadow-sm transition hover:bg-gold-dark">
          <span className="grid size-11 place-items-center rounded-full bg-white/20"><CreditCard className="size-5" aria-hidden /></span>
          <span><span className="block font-extrabold">{bi('الدفع', 'Pay')}</span><span className="text-xs text-white/85">{bi('ادفع طلبات الدفع المستحقة واطّلع على فواتيرك', 'Pay what is due and see your invoices')}</span></span>
        </Link>
      </section>

      <ErrorBlock error={devices.error ?? open.error ?? projects.error ?? pay.error} />

      <section className="rounded-2xl border border-line bg-white p-4 sm:p-5">
        <h2 className={sectionTitle}><MapPin className="size-4" aria-hidden />{bi('مواقعك', 'Your sites')}</h2>
        {d.sites.length === 0 ? (
          <p className="text-sm text-muted">{bi('لا توجد مواقع مسجلة بعد.', 'No sites registered yet.')}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {d.sites.map((s) => {
              const n = devices.data?.rows.filter((x) => x.siteId === s.id).length;
              return (
                <li key={s.id}>
                  <Link href={`/portal/devices?site=${s.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5 transition hover:bg-tint/40">
                    <span className="min-w-0"><span className="block truncate font-bold text-ink">{s.name}</span><span className="text-xs text-muted">{[s.district, s.city].filter(Boolean).join('، ') || '—'}</span></span>
                    {n !== undefined && <span className="shrink-0 text-xs text-muted"><span className="num font-bold text-ink" dir="ltr">{n}</span> {bi('جهاز', 'devices')}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Count({ href, icon, label, value, loading, highlight, hint }: { href: string; icon: ReactNode; label: string; value: number | undefined; loading: boolean; highlight?: boolean; hint?: ReactNode }) {
  return (
    <Link href={href} className={clsx('rounded-2xl border bg-white p-4 transition hover:shadow-md', highlight ? 'border-gold' : 'border-line')}>
      <div className={clsx('flex items-center gap-1.5 text-xs font-bold', highlight ? 'text-gold-dark' : 'text-muted')}><span aria-hidden>{icon}</span>{label}</div>
      <div className="mt-1 text-3xl font-extrabold text-primary"><span className="num" dir="ltr">{loading ? '…' : value ?? '—'}</span></div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </Link>
  );
}
