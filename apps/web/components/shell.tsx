'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import * as Icons from 'lucide-react';
import { Bell, LogOut, Menu, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx, Spinner } from './ui';
import { NAV } from './nav';
import { useMe } from '@/lib/me';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { dateTime } from '@/lib/format';
import { LanguageToggle, useI18n } from '@/lib/i18n';

function Icon({ name, className }: { name: string; className?: string }) {
  const C = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Circle;
  return <C className={className} />;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { me, refetch } = useMe();
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ id: string; titleAr: string; link: string | null; readAt: string | null; createdAt: string }[]>('/me/notifications'), enabled: open });
  const router = useRouter();
  const unread = me?.unreadNotifications ?? 0;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="relative rounded-lg p-2 text-ink hover:bg-black/5" aria-label={t('shell.notifications')}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute -top-0.5 -start-0.5 grid size-4 place-items-center rounded-full bg-gold text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute end-0 z-30 mt-2 w-80 rounded-xl border border-line bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <b className="text-sm text-primary">{t('shell.notifications')}</b>
            <button className="text-xs font-bold text-gold-dark hover:underline" onClick={async () => { await api.post('/me/notifications/read'); refetch(); qc.invalidateQueries({ queryKey: ['notifications'] }); }}>{t('shell.markAllRead')}</button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {q.isLoading ? <Spinner /> : (q.data ?? []).length === 0 ? <p className="p-4 text-center text-sm text-muted">{t('shell.noNotifications')}</p> : q.data!.map((n) => (
              <button key={n.id} onClick={() => { setOpen(false); if (n.link) router.push(n.link); }} className={clsx('block w-full border-b border-line/60 px-3 py-2 text-start text-sm hover:bg-tint', !n.readAt && 'bg-primary-50/50 font-bold')}>
                {n.titleAr}
                <span className="block text-[11px] font-normal text-muted">{dateTime(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { me, loading, can } = useMe();
  const { t, locale, dir, syncUserLocale } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [path]);
  const serverLocale = me?.user.locale;
  useEffect(() => { if (me) syncUserLocale(serverLocale); }, [me, serverLocale, syncUserLocale]);
  useEffect(() => {
    if (!loading && !me) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, me, path, router]);
  if (loading || !me) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));
  const nav = (
    <nav className="flex flex-col gap-4 p-3">
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.perm || can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.label}>
            <div className="mb-1 px-2 text-[11px] font-extrabold tracking-wide text-gold-light/80">{locale === 'en' ? g.en : g.label}</div>
            {items.map((i) => (
              <Link key={i.href} href={i.href} className={clsx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-bold transition', active(i.href) ? 'bg-white/12 text-white shadow-inner' : 'text-white/75 hover:bg-white/8 hover:text-white')}>
                <Icon name={i.icon} className="size-4 shrink-0" />
                {locale === 'en' ? i.en : i.label}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className={clsx('fixed inset-y-0 start-0 z-40 w-[250px] overflow-y-auto overscroll-contain bg-primary transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0', mobileOpen ? 'translate-x-0' : dir === 'rtl' ? 'translate-x-full' : '-translate-x-full')}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <Link href="/" className="leading-tight">
            <div className="text-lg font-extrabold text-white">{t('shell.brand')}</div>
            <div className="text-[11px] font-bold text-gold-light">MMC Core</div>
          </Link>
          <button className="rounded p-1 text-white lg:hidden" onClick={() => setMobileOpen(false)} aria-label={t('common.close')}><X className="size-5" /></button>
        </div>
        {nav}
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <button className="rounded-lg p-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t('shell.menu')}><Menu className="size-5" /></button>
            {!me.company?.vatRegistered && <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800 sm:inline">{t('shell.vatNotRegistered')}</span>}
          </div>
          <div className="flex items-center gap-1">
            <LanguageToggle className="me-1 rounded-lg border border-line px-2.5 py-1 text-xs font-bold text-ink hover:bg-black/5" />
            <Notifications />
            <div className="hidden text-end text-xs leading-tight sm:block">
              <div className="font-bold">{me.user.name}</div>
              <div className="text-muted">{me.user.email}</div>
            </div>
            <button onClick={async () => { await authClient.signOut(); location.href = '/login'; }} className="rounded-lg p-2 text-muted hover:bg-black/5" title={t('shell.signOut')} aria-label={t('shell.signOut')}><LogOut className="size-5" /></button>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
