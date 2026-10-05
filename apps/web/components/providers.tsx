'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { I18nProvider, useI18n, type Locale } from '@/lib/i18n';

function LocalizedToaster() {
  const { dir } = useI18n();
  return <Toaster position="top-center" richColors dir={dir} toastOptions={{ style: { fontFamily: 'var(--font-tajawal)' } }} />;
}

export function Providers({ children, locale = 'ar' }: { children: ReactNode; locale?: Locale }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000 } } }));
  return (
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale={locale}>
        {children}
        <LocalizedToaster />
      </I18nProvider>
    </QueryClientProvider>
  );
}
