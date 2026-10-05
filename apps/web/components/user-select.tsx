'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Select } from './ui';

export interface StaffUser { id: string; email: string; nameAr: string | null; status: string; roles: string[] }

/** Staff picker (needs admin.users or quote.approve to list users; otherwise shows only "me"). */
export function UserSelect({ value, onChange, allowEmpty = true, emptyLabel = '— غير مُسند —' }: { value: string | null | undefined; onChange: (id: string | null) => void; allowEmpty?: boolean; emptyLabel?: string }) {
  const q = useQuery({ queryKey: ['users-min'], queryFn: () => api.get<StaffUser[]>('/users').catch(() => [] as StaffUser[]), staleTime: 300_000 });
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {(q.data ?? []).filter((u) => u.status !== 'suspended').map((u) => <option key={u.id} value={u.id}>{u.nameAr ?? u.email}</option>)}
    </Select>
  );
}
