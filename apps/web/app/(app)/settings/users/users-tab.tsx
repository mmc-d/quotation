'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, UserPlus, Users } from 'lucide-react';
import { normalizeSaudiMobile } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
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
  const { bi, locale } = useI18n();
  return (
    <div className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
      {roles.map((r) => (
        <Checkbox key={r.id} label={<span>{locale === 'en' ? r.nameEn || r.nameAr : r.nameAr} <span className="text-[11px] text-muted" dir="ltr">({r.key})</span></span>} checked={value.includes(r.key)} onChange={(c) => onChange(c ? [...value, r.key] : value.filter((k) => k !== r.key))} />
      ))}
      {roles.length === 0 && <span className="text-xs text-muted">{bi('جارٍ تحميل الأدوار…', 'Loading roles…')}</span>}
    </div>
  );
}

export function UsersTab({ roles }: { roles: RoleRow[] }) {
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<AppUser[]>('/users') });
  const teams = useTeams();
  const { bi, locale } = useI18n();
  const en = locale === 'en';
  const [search, setSearch] = useState('');
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<AppUser | null>(null);
  const term = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((u) => !term || u.email.toLowerCase().includes(term) || (u.nameAr ?? '').toLowerCase().includes(term) || (u.mobile ?? '').includes(term));
  const teamName = (id: string) => { const tm = teams.data?.find((t) => t.id === id); return (en && tm?.nameEn) || tm?.nameAr || '—'; };
  return (
    <>
      <div className="mb-3"><InfoNote>{bi('لا يوجد تسجيل ذاتي: يُضاف الموظف بدعوة على بريده الإلكتروني، ثم يدخل بحساب Google بنفس البريد أو يفعّل حسابه بالبريد الإلكتروني (رابط/كلمة مرور) ويستطيع بعدها إضافة مفتاح مرور. تبقى حالته «مدعو» حتى أول دخول.', 'There is no self sign-up: staff are added by an invitation to their e-mail, then sign in with Google using the same address or activate their account by e-mail (link/password), after which they can add a passkey. They stay “Invited” until their first sign-in.')}</InfoNote></div>
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
          <SearchBox value={search} onChange={setSearch} placeholder={bi('الاسم، البريد، الجوال…', 'Name, e-mail, mobile…')} />
          <Button icon={<UserPlus className="size-4" />} onClick={() => setInvite(true)}>{bi('دعوة مستخدم', 'Invite user')}</Button>
        </div>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<Users className="size-8" />} title={bi('لا يوجد مستخدمون', 'No users')} /> : (
          <Table>
            <thead><tr><Th>{bi('الاسم', 'Name')}</Th><Th>{bi('البريد الإلكتروني', 'E-mail')}</Th><Th>{bi('الأدوار', 'Roles')}</Th><Th>{bi('الفرق', 'Teams')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('آخر دخول', 'Last sign-in')}</Th><Th /></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-tint/50">
                  <Td><div className="font-bold">{(en && u.nameEn) || (u.nameAr ?? '—')}</div>{u.mobile && <div className="num text-xs text-muted" dir="ltr">{u.mobile}</div>}</Td>
                  <Td className="text-xs"><span dir="ltr">{u.email}</span></Td>
                  <Td><div className="flex flex-wrap gap-1">{u.roles.map((k) => <Badge key={k} tone={k === 'owner' ? 'gold' : 'blue'}>{roleLabel(k, roles, locale)}</Badge>)}{u.roles.length === 0 && <span className="text-xs text-muted">—</span>}</div></Td>
                  <Td className="text-xs">{u.teamIds.length ? u.teamIds.map(teamName).join(en ? ', ' : '، ') : '—'}</Td>
                  <Td><StatusBadge status={u.status} /></Td>
                  <Td className="num whitespace-nowrap text-xs text-muted">{dateTime(u.lastLoginAt)}</Td>
                  <Td className="text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(u)}>{bi('تعديل', 'Edit')}</Button></Td>
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
  const { bi } = useI18n();
  const [f, setF] = useState({ email: '', nameAr: '', nameEn: '', mobile: '', roleKeys: [] as string[], branchId: '', userCode: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mobileErr = f.mobile.trim() && !normalizeSaudiMobile(f.mobile) ? bi('رقم جوال سعودي غير صالح', 'Invalid Saudi mobile number') : null;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) && f.nameAr.trim() && f.roleKeys.length > 0 && !mobileErr;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.post('/users/invite', { email: f.email.trim(), nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() || null, mobile: f.mobile.trim() || null, roleKeys: f.roleKeys, branchId: f.branchId || null, userCode: f.userCode.trim() || null });
      toast.success(bi('تمت إضافة الدعوة — يمكن للموظف الدخول الآن ببريده', 'Invitation added — the employee can now sign in with their e-mail'));
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['users-min'] });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} wide title={bi('دعوة مستخدم', 'Invite user')} footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={busy} disabled={!valid} onClick={submit}>{bi('إرسال الدعوة', 'Send invitation')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('البريد الإلكتروني *', 'E-mail *')} hint={bi('بريد Google الخاص بالموظف إن أمكن', 'The employee’s Google e-mail if possible')}><Input dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={bi('الجوال', 'Mobile')} error={mobileErr}><Input dir="ltr" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="05XXXXXXXX" /></Field>
        <Field label={bi('الاسم بالعربية *', 'Name (Arabic) *')}><Input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
        <Field label="Name (English)"><Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <Field label={bi('الفرع', 'Branch')}>
          <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            <option value="">—</option>
            {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.nameAr} ({b.code})</option>)}
          </Select>
        </Field>
        <Field label={bi('رمز المستخدم (القديم)', 'User code (legacy)')} hint={bi('الرمز الرقمي في الأداة القديمة، إن وُجد', 'The numeric code in the old tool, if any')}><Input dir="ltr" inputMode="numeric" value={f.userCode} onChange={(e) => setF({ ...f, userCode: e.target.value })} /></Field>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('الأدوار * (الصلاحيات تُجمع من كل الأدوار المختارة)', 'Roles * (permissions are combined from all selected roles)')}</span>
        <RolePicker roles={roles} value={f.roleKeys} onChange={(roleKeys) => setF({ ...f, roleKeys })} />
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}

function EditUserDialog({ user, roles, teams, onClose }: { user: AppUser; roles: RoleRow[]; teams: Team[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useMe();
  const { bi } = useI18n();
  const branches = useBranches();
  const [f, setF] = useState({ nameAr: user.nameAr ?? '', mobile: user.mobile ?? '', roleKeys: user.roles, teamIds: user.teamIds, managerId: user.managerId, branchId: user.branchId ?? '' });
  const [busy, setBusy] = useState<'save' | 'status' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const isSelf = me?.user.id === user.id;
  const mobileErr = f.mobile.trim() && !normalizeSaudiMobile(f.mobile) ? bi('رقم جوال سعودي غير صالح', 'Invalid Saudi mobile number') : null;
  const done = (msg: string) => { toast.success(msg); qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['users-min'] }); onClose(); };
  const save = async () => {
    setBusy('save'); setError(null);
    try {
      await api.put(`/users/${user.id}`, { nameAr: f.nameAr.trim() || undefined, mobile: f.mobile.trim() || null, roleKeys: f.roleKeys, teamIds: f.teamIds, managerId: f.managerId || null, branchId: f.branchId || null });
      done(bi('تم حفظ المستخدم', 'User saved'));
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const toggleStatus = async () => {
    setBusy('status'); setError(null);
    const next = user.status === 'suspended' ? 'active' : 'suspended';
    try {
      await api.put(`/users/${user.id}`, { status: next });
      done(next === 'suspended' ? bi('تم إيقاف المستخدم وإنهاء جلساته', 'User suspended and their sessions ended') : bi('تمت إعادة تفعيل المستخدم', 'User reactivated'));
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  return (
    <Dialog open onClose={onClose} wide title={bi(`تعديل: ${user.nameAr ?? user.email}`, `Edit: ${user.nameEn || user.nameAr || user.email}`)} footer={<>
      {!isSelf && <Button variant={user.status === 'suspended' ? 'outline' : 'danger'} className="me-auto" loading={busy === 'status'} onClick={toggleStatus}>{user.status === 'suspended' ? bi('إعادة التفعيل', 'Reactivate') : bi('إيقاف المستخدم', 'Suspend user')}</Button>}
      <Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button>
      <Button loading={busy === 'save'} disabled={f.roleKeys.length === 0 || !!mobileErr} onClick={save}>{bi('حفظ', 'Save')}</Button>
    </>}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted"><span dir="ltr">{user.email}</span><StatusBadge status={user.status} />{user.status === 'invited' && <span>{bi('لم يسجّل الدخول بعد', 'Has not signed in yet')}</span>}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('الاسم بالعربية', 'Name (Arabic)')}><Input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
        <Field label={bi('الجوال', 'Mobile')} error={mobileErr}><Input dir="ltr" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
        <Field label={bi('المدير المباشر', 'Direct manager')}><UserSelect value={f.managerId} onChange={(managerId) => setF({ ...f, managerId })} emptyLabel={bi('— بدون —', '— None —')} /></Field>
        <Field label={bi('الفرع', 'Branch')}>
          <Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            <option value="">—</option>
            {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.nameAr} ({b.code})</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('الأدوار *', 'Roles *')}</span>
        <RolePicker roles={roles} value={f.roleKeys} onChange={(roleKeys) => setF({ ...f, roleKeys })} />
        {isSelf && <p className="mt-1 text-xs text-amber-700">{bi('تعديل أدوارك يغيّر صلاحياتك فورًا. يجب أن يبقى مالك واحد على الأقل.', 'Changing your own roles changes your permissions immediately. At least one owner must remain.')}</p>}
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('الفرق', 'Teams')}</span>
        <div className="flex flex-wrap gap-3 rounded-lg border border-line p-3">
          {teams.map((t) => <Checkbox key={t.id} label={t.nameAr} checked={f.teamIds.includes(t.id)} onChange={(c) => setF({ ...f, teamIds: c ? [...f.teamIds, t.id] : f.teamIds.filter((x) => x !== t.id) })} />)}
          {teams.length === 0 && <span className="text-xs text-muted">{bi('لا توجد فرق — أضفها من تبويب «الفرق».', 'No teams — add them from the “Teams” tab.')}</span>}
        </div>
      </div>
      {user.status !== 'suspended' && !isSelf && <p className="mt-3 text-xs text-muted">{bi('إيقاف المستخدم يمنعه من الدخول وينهي جلساته المفتوحة فورًا، ولا تُحذف بياناته أبدًا.', 'Suspending a user blocks sign-in and ends their open sessions immediately; their data is never deleted.')}</p>}
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}
