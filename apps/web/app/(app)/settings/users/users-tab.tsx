'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, UserPlus, Users } from 'lucide-react';
import { normalizeSaudiMobile } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, Input, SearchBox, Select, Spinner, StatusBadge, Table, Td, Th } from '@/components/ui';
import { UserSelect } from '@/components/user-select';
import { InfoNote, roleLabel, type RoleRow } from '../_components/common';

export interface AppUser {
  id: string; email: string; nameAr: string | null; nameEn: string | null; mobile: string | null; status: 'invited' | 'active' | 'suspended';
  userCode: string | null; branchId: string | null; managerId: string | null; lastLoginAt: string | null; invitedAt: string | null;
  roles: string[]; teamIds: string[];
}
interface Team { id: string; nameAr: string }
interface Branch { id: string; code: string; nameAr: string }

export function useTeams() {
  return useQuery({ queryKey: ['teams'], queryFn: () => api.get<(Team & { nameEn: string | null; kind: string; managerId: string | null })[]>('/users/teams') });
}

function useBranches() {
  return useQuery({ queryKey: ['branches-min'], queryFn: () => api.get<{ branches: Branch[] }>('/settings/company').then((c) => c.branches ?? []).catch(() => [] as Branch[]), staleTime: 300_000 });
}

function RolePicker({ roles, value, onChange }: { roles: RoleRow[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
      {roles.map((r) => (
        <Checkbox key={r.id} label={<span>{r.nameAr} <span className="text-[11px] text-muted" dir="ltr">({r.key})</span></span>} checked={value.includes(r.key)} onChange={(c) => onChange(c ? [...value, r.key] : value.filter((k) => k !== r.key))} />
      ))}
      {roles.length === 0 && <span className="text-xs text-muted">جارٍ تحميل الأدوار…</span>}
    </div>
  );
}

export function UsersTab({ roles }: { roles: RoleRow[] }) {
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<AppUser[]>('/users') });
  const teams = useTeams();
  const [search, setSearch] = useState('');
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<AppUser | null>(null);
  const term = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((u) => !term || u.email.toLowerCase().includes(term) || (u.nameAr ?? '').toLowerCase().includes(term) || (u.mobile ?? '').includes(term));
  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.nameAr ?? '—';
  return (
    <>
      <div className="mb-3"><InfoNote>لا يوجد تسجيل ذاتي: يُضاف الموظف بدعوة على بريده الإلكتروني، ثم يدخل بحساب Google بنفس البريد أو يفعّل حسابه بالبريد الإلكتروني (رابط/كلمة مرور) ويستطيع بعدها إضافة مفتاح مرور. تبقى حالته «مدعو» حتى أول دخول.</InfoNote></div>
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="الاسم، البريد، الجوال…" />
          <Button icon={<UserPlus className="size-4" />} onClick={() => setInvite(true)}>دعوة مستخدم</Button>
        </div>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<Users className="size-8" />} title="لا يوجد مستخدمون" /> : (
          <Table>
            <thead><tr><Th>الاسم</Th><Th>البريد الإلكتروني</Th><Th>الأدوار</Th><Th>الفرق</Th><Th>الحالة</Th><Th>آخر دخول</Th><Th /></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-tint/50">
                  <Td><div className="font-bold">{u.nameAr ?? '—'}</div>{u.mobile && <div className="num text-xs text-muted" dir="ltr">{u.mobile}</div>}</Td>
                  <Td className="text-xs"><span dir="ltr">{u.email}</span></Td>
                  <Td><div className="flex flex-wrap gap-1">{u.roles.map((k) => <Badge key={k} tone={k === 'owner' ? 'gold' : 'blue'}>{roleLabel(k, roles)}</Badge>)}{u.roles.length === 0 && <span className="text-xs text-muted">—</span>}</div></Td>
                  <Td className="text-xs">{u.teamIds.length ? u.teamIds.map(teamName).join('، ') : '—'}</Td>
                  <Td><StatusBadge status={u.status} /></Td>
                  <Td className="num whitespace-nowrap text-xs text-muted">{dateTime(u.lastLoginAt)}</Td>
                  <Td className="text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(u)}>تعديل</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {invite && <InviteDialog roles={roles} onClose={() => setInvite(false)} />}
      {edit && <EditUserDialog user={edit} roles={roles} teams={teams.data ?? []} onClose={() => setEdit(null)} />}
    </>
  );
}

function InviteDialog({ roles, onClose }: { roles: RoleRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const branches = useBranches();
  const [f, setF] = useState({ email: '', nameAr: '', nameEn: '', mobile: '', roleKeys: [] as string[], branchId: '', userCode: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mobileErr = f.mobile.trim() && !normalizeSaudiMobile(f.mobile) ? 'رقم جوال سعودي غير صالح' : null;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) && f.nameAr.trim() && f.roleKeys.length > 0 && !mobileErr;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.post('/users/invite', { email: f.email.trim(), nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() || null, mobile: f.mobile.trim() || null, roleKeys: f.roleKeys, branchId: f.branchId || null, userCode: f.userCode.trim() || null });
      toast.success('تمت إضافة الدعوة — يمكن للموظف الدخول الآن ببريده');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['users-min'] });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} wide title="دعوة مستخدم" footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button loading={busy} disabled={!valid} onClick={submit}>إرسال الدعوة</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="البريد الإلكتروني *" hint="بريد Google الخاص بالموظف إن أمكن"><Input dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="الجوال" error={mobileErr}><Input dir="ltr" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="05XXXXXXXX" /></Field>
        <Field label="الاسم بالعربية *"><Input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
        <Field label="Name (English)"><Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <Field label="الفرع">
          <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            <option value="">—</option>
            {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.nameAr} ({b.code})</option>)}
          </Select>
        </Field>
        <Field label="رمز المستخدم (القديم)" hint="الرمز الرقمي في الأداة القديمة، إن وُجد"><Input dir="ltr" inputMode="numeric" value={f.userCode} onChange={(e) => setF({ ...f, userCode: e.target.value })} /></Field>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-bold text-gold-dark">الأدوار * (الصلاحيات تُجمع من كل الأدوار المختارة)</span>
        <RolePicker roles={roles} value={f.roleKeys} onChange={(roleKeys) => setF({ ...f, roleKeys })} />
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}

function EditUserDialog({ user, roles, teams, onClose }: { user: AppUser; roles: RoleRow[]; teams: Team[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useMe();
  const branches = useBranches();
  const [f, setF] = useState({ nameAr: user.nameAr ?? '', mobile: user.mobile ?? '', roleKeys: user.roles, teamIds: user.teamIds, managerId: user.managerId, branchId: user.branchId ?? '' });
  const [busy, setBusy] = useState<'save' | 'status' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const isSelf = me?.user.id === user.id;
  const mobileErr = f.mobile.trim() && !normalizeSaudiMobile(f.mobile) ? 'رقم جوال سعودي غير صالح' : null;
  const done = (msg: string) => { toast.success(msg); qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['users-min'] }); onClose(); };
  const save = async () => {
    setBusy('save'); setError(null);
    try {
      await api.put(`/users/${user.id}`, { nameAr: f.nameAr.trim() || undefined, mobile: f.mobile.trim() || null, roleKeys: f.roleKeys, teamIds: f.teamIds, managerId: f.managerId || null, branchId: f.branchId || null });
      done('تم حفظ المستخدم');
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const toggleStatus = async () => {
    setBusy('status'); setError(null);
    const next = user.status === 'suspended' ? 'active' : 'suspended';
    try {
      await api.put(`/users/${user.id}`, { status: next });
      done(next === 'suspended' ? 'تم إيقاف المستخدم وإنهاء جلساته' : 'تمت إعادة تفعيل المستخدم');
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  return (
    <Dialog open onClose={onClose} wide title={`تعديل: ${user.nameAr ?? user.email}`} footer={<>
      {!isSelf && <Button variant={user.status === 'suspended' ? 'outline' : 'danger'} className="me-auto" loading={busy === 'status'} onClick={toggleStatus}>{user.status === 'suspended' ? 'إعادة التفعيل' : 'إيقاف المستخدم'}</Button>}
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button loading={busy === 'save'} disabled={f.roleKeys.length === 0 || !!mobileErr} onClick={save}>حفظ</Button>
    </>}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted"><span dir="ltr">{user.email}</span><StatusBadge status={user.status} />{user.status === 'invited' && <span>لم يسجّل الدخول بعد</span>}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الاسم بالعربية"><Input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
        <Field label="الجوال" error={mobileErr}><Input dir="ltr" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
        <Field label="المدير المباشر"><UserSelect value={f.managerId} onChange={(managerId) => setF({ ...f, managerId })} emptyLabel="— بدون —" /></Field>
        <Field label="الفرع">
          <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            <option value="">—</option>
            {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.nameAr} ({b.code})</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-bold text-gold-dark">الأدوار *</span>
        <RolePicker roles={roles} value={f.roleKeys} onChange={(roleKeys) => setF({ ...f, roleKeys })} />
        {isSelf && <p className="mt-1 text-xs text-amber-700">تعديل أدوارك يغيّر صلاحياتك فورًا. يجب أن يبقى مالك واحد على الأقل.</p>}
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-bold text-gold-dark">الفرق</span>
        <div className="flex flex-wrap gap-3 rounded-lg border border-line p-3">
          {teams.map((t) => <Checkbox key={t.id} label={t.nameAr} checked={f.teamIds.includes(t.id)} onChange={(c) => setF({ ...f, teamIds: c ? [...f.teamIds, t.id] : f.teamIds.filter((x) => x !== t.id) })} />)}
          {teams.length === 0 && <span className="text-xs text-muted">لا توجد فرق — أضفها من تبويب «الفرق».</span>}
        </div>
      </div>
      {user.status !== 'suspended' && !isSelf && <p className="mt-3 text-xs text-muted">إيقاف المستخدم يمنعه من الدخول وينهي جلساته المفتوحة فورًا، ولا تُحذف بياناته أبدًا.</p>}
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}
