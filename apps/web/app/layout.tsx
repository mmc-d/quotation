import type { Metadata, Viewport } from 'next';
import { Tajawal } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const tajawal = Tajawal({ subsets: ['arabic', 'latin'], weight: ['400', '500', '700', '800'], variable: '--font-tajawal', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'منصة المدى المبارك', template: '%s · المدى المبارك' },
  description: 'MMC Core — CRM, quotations, contracts and billing for Al-Mada Al-Mubarak',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#0D4A2E', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
