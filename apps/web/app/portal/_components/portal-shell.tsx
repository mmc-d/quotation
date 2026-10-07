'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, FileSignature, Home, Loader2, LogOut, ReceiptText, Wrench, FolderKanban } from 'lucide-react';
import { clsx } from '@/components/ui';
import { LanguageToggle, useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalMe } from './portal-api';

const NAV = [
  { href: '/portal', ar: 'الرئيسية', en: 'Home', icon: Home, exact: true },
  { href: '/portal/devices', ar: 'الأجهزة', en: 'Devices', icon: Cpu },
  { href: '/portal/requests', ar: 'طلبات الصيانة', en: 'Service requests', short: ['الطلبات', 'Requests'], icon: Wrench },
  { href: '/portal/projects', ar: 'المشاريع', en: 'Projects', icon: FolderKanban },
  { href: '/portal/billing', ar: 'الفواتير والمدفوعات', en: 'Invoices & payments', short: ['الفواتير', 'Billing'], icon: ReceiptText },
  { href: '/portal/agreements', ar: 'عقود الصيانة', en: 'Agreements', short: ['العقود', 'Contracts'], icon: FileSignature },
] as const;

export function usePortalMe() {
  return useQuery({ queryKey: ['portal', 'me'], queryFn: () => portalFetch<PortalMe>('/me'), retry: portalRetry, staleTime: 60_000 });
}

/** Customer-portal frame: branded header, customer name, desktop tabs and a phone bottom tab bar. */
export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/portal';
  if (pathname.startsWith('/portal/login')) return <>{children}</>;
  return <SignedInShell pathname={pathname}>{children}</SignedInShell>;
}

function SignedInShell({ children, pathname }: { children: ReactNode; pathname: string }) {
  const { bi, dir } = useI18n();
  const me = usePortalMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  async function logout() {
    setLeaving(true);
    try { await portalFetch('/logout', { body: {}, redirectOn401: false }); } catch { /* signed out anyway */ }
    qc.removeQueries({ queryKey: ['portal'] });
    router.replace('/portal/login');
  }

  const customer = me.data?.party.nameAr;
  const person = me.data?.account.name;

  return (
    <div dir={dir} className="flex min-h-screen flex-col bg-[#f6f5f1]">
      <a href="#portal-main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-primary">
        {bi('تخطَّ إلى المحتوى', 'Skip to content')}
      </a>
      <header className="relative overflow-hidden bg-primary text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(194,160,74,.35),transparent_55%)]" aria-hidden />
        <div className="relative mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/portal" className="min-w-0 rounded leading-tight">
            <div className="truncate text-base font-extrabold sm:text-lg">{bi('المدى المبارك', 'Al-Mada Al-Mubarak')}</div>
            <div className="text-[11px] font-bold text-gold-light">{bi('بوابة العملاء', 'Customer portal')}</div>
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden min-w-0 text-end leading-tight sm:block">
              <div className="truncate text-sm font-bold">{customer ?? (me.isLoading ? '…' : '')}</div>
              {person && <div className="truncate text-[11px] text-white/75">{person}</div>}
            </div>
            <LanguageToggle className="rounded-lg border border-white/30 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/10" />
            <button onClick={logout} disabled={leaving} className="inline-flex items-center gap-1 rounded-lg border border-white/30 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-60" aria-label={bi('تسجيل الخروج', 'Sign out')}>
              {leaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <LogOut className="size-3.5" aria-hidden />}
              <span className="hidden sm:inline">{bi('خروج', 'Sign out')}</span>
            </button>
          </div>
        </div>
        {customer && <div className="relative mx-auto max-w-5xl truncate px-4 pb-2 text-xs font-bold text-white/85 sm:hidden">{customer}{person ? ` · ${person}` : ''}</div>}
        <nav aria-label={bi('أقسام البوابة', 'Portal sections')} className="relative hidden bg-primary-600/60 md:block">
          <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3">
            {NAV.map((n) => {
              const active = isActive(n.href, 'exact' in n && n.exact);
              return (
                <li key={n.href}>
                  <Link href={n.href} aria-current={active ? 'page' : undefined} className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-bold transition', active ? 'border-gold text-white' : 'border-transparent text-white/70 hover:text-white')}>
                    <n.icon className="size-4" aria-hidden />{bi(n.ar, n.en)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="h-1 bg-gold" />
      </header>

      <main id="portal-main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 md:pb-10 md:pt-7">{children}</main>

      <footer className="hidden border-t border-line bg-white/60 py-4 text-center text-[11px] text-muted md:block">
        © {new Date().getFullYear()} {bi('المدى المبارك · بيانات مستضافة في المملكة العربية السعودية', 'Al-Mada Al-Mubarak · Data hosted in Saudi Arabia')}
      </footer>

      {/* phones: bottom tab bar */}
      <nav aria-label={bi('أقسام البوابة', 'Portal sections')} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(0,0,0,.06)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-6">
          {NAV.map((n) => {
            const active = isActive(n.href, 'exact' in n && n.exact);
            const label = 'short' in n ? bi(n.short[0], n.short[1]) : bi(n.ar, n.en);
            return (
              <li key={n.href}>
                <Link href={n.href} aria-current={active ? 'page' : undefined} aria-label={bi(n.ar, n.en)} className={clsx('flex flex-col items-center gap-0.5 px-0.5 py-2 text-[10px] font-bold leading-tight', active ? 'text-primary' : 'text-muted')}>
                  <span className={clsx('grid h-7 w-10 place-items-center rounded-full transition', active && 'bg-primary-50')}><n.icon className="size-[18px]" aria-hidden /></span>
                  <span className="max-w-full truncate">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
