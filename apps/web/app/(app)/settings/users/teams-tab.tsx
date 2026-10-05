'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, UsersRound } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, Dialog, Empty, ErrorBox, Field, Input, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { UserSelect } from '@/components/user-select';
import { useTeams, type AppUser } from './users-tab';

const KIND_AR: Record<string, string> = { sales: 'مبيعات', presales: 'ما قبل البيع', installation: 'تركيب', support: 'دعم فني', finance: 'مالية', other: 'أخرى' };

interface TeamRow { id: string; nameAr: string; nameEn: string | null; kind: string; managerId: string | null }

export function TeamsTab() {
  const teams = useTeams();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<AppUser[]>('/users') });
  const [edit, setEdit] = useState<TeamRow | 'new' | null>(null);
  const userName = (id: string | null) => { if (!id) return '—'; const u = users.data?.find((x) => x.id === id); return u ? u.nameAr ?? u.email : '—'; };
  const members = (id: string) => (users.data ?? []).filter((u) => u.teamIds.includes(id));
  return (
    <Card padded={false} title="الفرق" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>فريق جديد</Button>}>
      <ErrorBox error={teams.error} />
      {teams.isLoading ? <Spinner /> : !teams.data?.length ? <Empty icon={<UsersRound className="size-8" />} title="لا توجد فرق بعد" hint="الفرق تحدد نطاق «الفريق» في الصلاحيات (مثلًا: مدير المبيعات يرى عروض فريقه)." /> : (
        <Table>
          <thead><tr><Th>الفريق</Th><Th>النوع</Th><Th>المدير</Th><Th>الأعضاء</Th><Th /></tr></thead>
          <tbody>
            {teams.data.map((t) => (
              <tr key={t.id} className="hover:bg-tint/50">
                <Td><div className="font-bold">{t.nameAr}</div>{t.nameEn && <div className="text-xs text-muted" dir="ltr">{t.nameEn}</div>}</Td>
                <Td>{KIND_AR[t.kind] ?? t.kind}</Td>
                <Td>{userName(t.managerId)}</Td>
                <Td className="text-xs">{members(t.id).map((u) => u.nameAr ?? u.email).join('، ') || '—'}</Td>
                <Td className="text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(t)}>تعديل</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="p-3 text-xs text-muted">يُضاف الأعضاء إلى الفريق من نافذة تعديل المستخدم في تبويب «المستخدمون».</p>
      {edit && <TeamDialog team={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function TeamDialog({ team, onClose }: { team: TeamRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ nameAr: team?.nameAr ?? '', nameEn: team?.nameEn ?? '', kind: team?.kind ?? 'sales', managerId: team?.managerId ?? null as string | null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put(`/users/teams/${team?.id ?? 'new'}`, { nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() || null, kind: f.kind, managerId: f.managerId || null });
      toast.success('تم حفظ الفريق');
      qc.invalidateQueries({ queryKey: ['teams'] });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={team ? 'تعديل الفريق' : 'فريق جديد'} footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button loading={busy} disabled={!f.nameAr.trim()} onClick={save}>حفظ</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="اسم الفريق *"><Input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
        <Field label="Team name (English)"><Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <Field label="النوع">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {Object.entries(KIND_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            {!KIND_AR[f.kind] && <option value={f.kind}>{f.kind}</option>}
          </Select>
        </Field>
        <Field label="مدير الفريق"><UserSelect value={f.managerId} onChange={(managerId) => setF({ ...f, managerId })} emptyLabel="— بدون —" /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}
