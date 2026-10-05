'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { StaffUser } from '@/components/user-select';

/** Same cache key as <UserSelect>, so the list is fetched once. */
export function useUserName() {
  const q = useQuery({ queryKey: ['users-min'], queryFn: () => api.get<StaffUser[]>('/users').catch(() => [] as StaffUser[]), staleTime: 300_000 });
  return (id: string | null | undefined): string | null => {
    if (!id) return null;
    const u = q.data?.find((x) => x.id === id);
    return u ? u.nameAr ?? u.email : null;
  };
}
