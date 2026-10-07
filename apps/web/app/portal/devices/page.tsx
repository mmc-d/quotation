'use client';
import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cpu, MapPin, Search } from 'lucide-react';
import { Input, Select } from '@/components/ui';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, warrantyUntil, type PortalDevice, type Rows } from '../_components/portal-api';
import { usePortalMe } from '../_components/portal-shell';
import { CoverageBadge, EmptyState, ErrorBlock, Loading, Num, PageTitle } from '../_components/portal-ui';

export default function DevicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = use(searchParams);
  const { bi } = useI18n();
  const me = usePortalMe();
  const [site, setSite] = useState<string>(typeof sp.site === 'string' ? sp.site : '');
  const [q, setQ] = useState('');
  const devices = useQuery({ queryKey: ['portal', 'devices'], queryFn: () => portalFetch<Rows<PortalDevice>>('/devices'), retry: portalRetry });

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (devices.data?.rows ?? []).filter((d) => (!site || d.siteId === site) && (!needle || [d.code, d.description, d.serial, d.mac, d.locationPath].some((v) => v?.toLowerCase().includes(needle))));
    const bySite = new Map<string, { siteName: string | null; locations: Map<string, PortalDevice[]> }>();
    for (const d of rows) {
      const sk = d.siteId ?? '';
      if (!bySite.has(sk)) bySite.set(sk, { siteName: d.siteName, locations: new Map() });
      const g = bySite.get(sk)!;
      const lk = d.locationPath ?? '';
      g.locations.set(lk, [...(g.locations.get(lk) ?? []), d]);
    }
    return { count: rows.length, sites: [...bySite.entries()].map(([id, g]) => ({ id, siteName: g.siteName, locations: [...g.locations.entries()].sort(([a], [b]) => a.localeCompare(b, 'ar')) })) };
  }, [devices.data, site, q]);

  return (
    <div>
      <PageTitle title={bi('الأجهزة', 'Devices')} subtitle={bi('الأجهزة المركبة في مواقعك، وحالة الضمان والتغطية اليوم.', 'Devices installed at your sites, with warranty and coverage today.')} />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="relative block">
          <span className="sr-only">{bi('بحث في الأجهزة', 'Search devices')}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={bi('ابحث بالموديل أو الرقم التسلسلي أو الموقع…', 'Search by model, serial or location…')} className="ps-9" />
        </label>
        {(me.data?.sites.length ?? 0) > 1 && (
          <label className="block">
            <span className="sr-only">{bi('الموقع', 'Site')}</span>
            <Select value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">{bi('كل المواقع', 'All sites')}</option>
              {me.data!.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
        )}
      </div>

      {devices.isLoading ? <Loading /> : devices.error ? <ErrorBlock error={devices.error} onRetry={() => devices.refetch()} /> : groups.count === 0 ? (
        <EmptyState icon={<Cpu className="size-8" />} title={q || site ? bi('لا توجد أجهزة مطابقة', 'No matching devices') : bi('لا توجد أجهزة مسجلة بعد', 'No devices registered yet')}
          hint={bi('تظهر الأجهزة هنا بعد تركيبها وتسجيلها من فريقنا.', 'Devices appear here once our team installs and registers them.')} />
      ) : (
        <div className="space-y-5">
          {groups.sites.map((g) => (
            <section key={g.id} aria-labelledby={`site-${g.id || 'none'}`}>
              <h2 id={`site-${g.id || 'none'}`} className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-primary"><MapPin className="size-4" aria-hidden />{g.siteName ?? bi('بدون موقع محدد', 'No site')}{g.id && <SiteHealth siteId={g.id} />}</h2>
              <div className="space-y-3">
                {g.locations.map(([path, rows]) => (
                  <div key={path} className="overflow-hidden rounded-2xl border border-line bg-white">
                    <div className="border-b border-line bg-tint/50 px-4 py-2 text-xs font-bold text-gold-dark">{path || bi('بدون موقع داخلي', 'No location')} <span className="text-muted">· <Num>{rows.length}</Num></span></div>
                    <ul className="divide-y divide-line">
                      {rows.map((d) => <DeviceRow key={d.id} d={d} />)}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceRow({ d }: { d: PortalDevice }) {
  const { bi } = useI18n();
  const until = warrantyUntil(d.warranty);
  return (
    <li>
      <Link href={`/portal/devices/${d.id}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 transition hover:bg-tint/30 focus-visible:bg-tint/30">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Num className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-ink">{d.code}</Num>
            {d.serial && <span className="text-xs text-muted">{bi('الرقم التسلسلي', 'Serial')}: <Num className="font-bold text-ink">{d.serial}</Num></span>}
          </div>
          {d.description && <p className="mt-1 line-clamp-2 text-sm text-ink">{d.description}</p>}
          <p className="mt-1 text-xs text-muted">{bi('الضمان حتى', 'Warranty until')}: <Num className="font-bold text-ink">{until ? date(until) : '—'}</Num></p>
        </div>
        <CoverageBadge coverage={d.coverageToday.coverage} reasonAr={d.coverageToday.reasonAr} reasonEn={d.coverageToday.reasonEn} showReason={false} />
      </Link>
    </li>
  );
}

/** Phase 7c (IOT-07): monitored devices online and active alarms of the site — shown only when the site has monitored devices. */
function SiteHealth({ siteId }: { siteId: string }) {
  const { bi } = useI18n();
  const h = useQuery({ queryKey: ['portal', 'site-health', siteId], queryFn: () => portalFetch<{ devicesBound: number; online: number; onlinePercent: number | null; activeAlarms: number }>(`/sites/${siteId}/health`), retry: portalRetry, staleTime: 60_000 });
  if (!h.data || h.data.devicesBound === 0) return null;
  const pct = h.data.onlinePercent ?? 0;
  return (
    <span className="ms-auto flex flex-wrap items-center gap-2 text-xs font-bold">
      <span className={pct >= 95 ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800' : 'rounded-full bg-amber-100 px-2 py-0.5 text-amber-800'}>{bi('متصل', 'Online')} <Num>{`${pct}%`}</Num></span>
      <span className={h.data.activeAlarms ? 'rounded-full bg-rose-100 px-2 py-0.5 text-rose-800' : 'rounded-full bg-gray-100 px-2 py-0.5 text-gray-700'}>{bi('تنبيهات نشطة', 'Active alerts')} <Num>{h.data.activeAlarms}</Num></span>
    </span>
  );
}
