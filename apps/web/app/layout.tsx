import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Tajawal } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const tajawal = Tajawal({ subsets: ['arabic', 'latin'], weight: ['400', '500', '700', '800'], variable: '--font-tajawal', display: 'swap' });

/** UI language chosen by the user (`mmc_locale` cookie, written by lib/i18n.tsx). Arabic by default. */
async function readLocale(): Promise<'ar' | 'en'> {
  const v = (await cookies()).get('mmc_locale')?.value;
  return v === 'en' ? 'en' : 'ar';
}

export async function generateMetadata(): Promise<Metadata> {
  const en = (await readLocale()) === 'en';
  return {
    title: en ? { default: 'Al-Mada Al-Mubarak Platform', template: '%s · Al-Mada Al-Mubarak' } : { default: 'منصة المدى المبارك', template: '%s · المدى المبارك' },
    description: 'MMC Core — CRM, quotations, contracts and billing for Al-Mada Al-Mubarak',
    robots: { index: false, follow: false },
  };
}
export const viewport: Viewport = { themeColor: '#0D4A2E', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await readLocale();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={tajawal.variable} suppressHydrationWarning>
      <body><Providers locale={locale}>{children}</Providers></body>
    </html>
  );
}
