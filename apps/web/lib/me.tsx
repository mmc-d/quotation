'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Me {
  user: { id: string; email: string; name: string; locale: string; roles: string[]; mfaEnabled: boolean };
  grants: Record<string, 'own' | 'team' | 'branch' | 'company' | 'all'>;
  maxDiscountPercent: number;
  company: { legalNameAr: string; legalNameEn: string | null; vatRegistered: boolean; approvalPolicy: { maxDiscountPercent: number; minMarginPercent: number }; quoteDefaults: { validityDays?: number } } | null;
  unreadNotifications: number;
}

const Ctx = createContext<{ me: Me | null; loading: boolean; can: (perm: string) => boolean; refetch: () => void }>({ me: null, loading: true, can: () => false, refetch: () => {} });

export function MeProvider({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me'), retry: false, staleTime: 60_000 });
  const me = q.data ?? null;
  return <Ctx.Provider value={{ me, loading: q.isLoading, can: (p) => !!me?.grants[p], refetch: () => q.refetch() }}>{children}</Ctx.Provider>;
}

export function useMe() {
  return useContext(Ctx);
}
