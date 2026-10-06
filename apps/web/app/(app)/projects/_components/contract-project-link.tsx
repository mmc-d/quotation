'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Button, LinkButton } from '@/components/ui';
import { errMsg } from '../../quotes/_components/common';
import type { ProjectRow } from './types';

/** "Project" button on a signed contract: opens its project, or creates it (POST /projects/from-contract/:id). */
export function ContractProjectLink({ contract }: { contract: { id: string; number: string; status: string } }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signed = ['signed', 'active', 'completed'].includes(contract.status);
  const q = useQuery({
    queryKey: ['projects', 'by-contract', contract.id],
    queryFn: () => api.get<{ rows: ProjectRow[] }>(`/projects${qs({ q: contract.number, limit: 20 })}`).then((r) => r.rows.find((p) => p.contractId === contract.id) ?? null),
    enabled: signed && can('project.read'),
  });
  if (!signed || !can('project.read') || q.isLoading) return null;
  if (q.data) return <LinkButton href={`/projects/${q.data.id}`} icon={<FolderKanban className="size-4" />}>{bi('المشروع', 'Project')} <span className="num" dir="ltr">{q.data.number}</span></LinkButton>;
  if (!can('project.write')) return null;
  const create = async () => {
    setBusy(true);
    try {
      const p = await api.post<{ id: string }>(`/projects/from-contract/${contract.id}`, {});
      router.push(`/projects/${p.id}`);
    } catch (e) {
      toast.error(errMsg(e));
      setBusy(false);
    }
  };
  return <Button variant="outline" loading={busy} icon={<FolderKanban className="size-4" />} onClick={() => void create()}>{bi('إنشاء المشروع', 'Create project')}</Button>;
}
