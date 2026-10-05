'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000 } } }));
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster position="top-center" richColors dir="rtl" toastOptions={{ style: { fontFamily: 'var(--font-tajawal)' } }} />
    </QueryClientProvider>
  );
}
