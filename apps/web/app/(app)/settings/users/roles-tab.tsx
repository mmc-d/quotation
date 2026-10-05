'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw, Save } from 'lucide-react';
import { useMe } from '@/lib/me';
import { api } from '@/lib/api';
import { Button, Card, ErrorBox, Input, Spinner, clsx } from '@/components/ui';
import { InfoNote, PERM_AR, PERM_GROUP_AR, PERM_GROUP_ORDER, SCOPES, SCOPE_AR, type RoleRow, type Scope } from '../_components/common';

interface Draft { nameAr: string; nameEn: string; grants: Record<string, Scope>; maxDiscountPercent: number }
const toDraft = (r: RoleRow): Draft => ({ nameAr: r.nameAr, nameEn: r.nameEn, grants: { ...(r.grants ?? {}) }, maxDiscountPercent: r.maxDiscountPercent });
const same = (a: Draft, b: Draft) => a.nameAr === b.nameAr && a.nameEn === b.nameEn && a.maxDiscountPercent === b.maxDiscountPercent && JSON.stringify(Object.entries(a.grants).sort()) === JSON.stringify(Object.entries(b.grants).sort());

const SCOPE_TONE: Record<Scope, string> = { own: 'bg-sky-50 text-sky-800', team: 'bg-indigo-50 text-indigo-800', branch: 'bg-violet-50 text-violet-800', company: 'bg-emerald-50 text-emerald-800', all: 'bg-primary-50 text-primary font-bold' };

export function RolesTab({ data, loading, error, canEdit }: { data?: { roles: RoleRow[]; permissions: string[] }; loading: boolean; error: unknown; canEdit: boolean }) {
  const qc = useQueryClient();
  const { refetch } = useMe();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  useEffect(() => { if (data) setDrafts(Object.fromEntries(data.roles.map((r) => [r.id, toDraft(r)]))); }, [data]);

  const groups = useMemo(() => {
    const perms = data?.permissions ?? [];
    const by = new Map<string, string[]>();
    for (const p of perms) {
      const g = p.split('.')[0]!;
      by.set(g, [...(by.get(g) ?? []), p]);
    }
    const order = [...PERM_GROUP_ORDER, ...[...by.keys()].filter((g) => !PERM_GROUP_ORDER.includes(g))];
    return order.filter((g) => by.has(g)).map((g) => ({ key: g, perms: by.get(g)! }));
  }, [data]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const roles = data.roles;

  const setGrant = (roleId: string, perm: string, scope: string) => setDrafts((d) => {
    const cur = d[roleId]!;
    const grants = { ...cur.grants };
    if (scope) grants[perm] = scope as Scope; else delete grants[perm];
    return { ...d, [roleId]: { ...cur, grants } };
  });
  const setField = (roleId: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [roleId]: { ...d[roleId]!, ...patch } }));

  const save = async (r: RoleRow) => {
    const d = drafts[r.id];
    if (!d) return;
    if (r.key === 'owner' && (!d.grants['admin.roles'] || !d.grants['admin.users'])) { toast.error('لا يمكن نزع إدارة المستخدمين والأدوار من دور المالك'); return; }
    setSaving(r.id); setSaveError(null);
    try {
      await api.put(`/users/roles/${r.id}`, { nameAr: d.nameAr.trim() || r.nameAr, nameEn: d.nameEn.trim() || r.nameEn, grants: d.grants, maxDiscountPercent: Math.round(d.maxDiscountPercent) });
      toast.success(`تم حفظ دور «${d.nameAr}»`);
      qc.invalidateQueries({ queryKey: ['roles'] });
      refetch();
    } catch (e) { setSaveError(e); } finally { setSaving(null); }
  };

  return (
    <div className="space-y-3">
      <InfoNote>
        الأدوار تراكمية: من يحمل أكثر من دور يأخذ أوسع نطاق لكل صلاحية. النطاق يحدد السجلات المسموحة —
        <b> الخاصة</b>: ما يملكه المستخدم فقط · <b>الفريق</b>: سجلاته وسجلات فريقه · <b>الفرع</b>: سجلات فرعه · <b>المنشأة</b>/<b>الكل</b>: كل السجلات.
        التعديل يسري على المستخدمين عند طلبهم التالي. احفظ كل دور على حدة.
      </InfoNote>
      <ErrorBox error={saveError} />
      <Card padded={false}>
        <div className="max-h-[75vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky start-0 z-30 min-w-56 border-b border-line bg-tint px-3 py-2 text-start text-xs font-extrabold text-gold-dark">الصلاحية</th>
                {roles.map((r) => {
                  const d = drafts[r.id];
                  const dirty = d ? !same(d, toDraft(r)) : false;
                  return (
                    <th key={r.id} className={clsx('min-w-36 border-b border-s border-line bg-tint px-2 py-2 align-top text-start', dirty && 'bg-amber-50')}>
                      {d && canEdit ? (
                        <Input value={d.nameAr} onChange={(e) => setField(r.id, { nameAr: e.target.value })} className="px-2 py-1 text-xs font-bold" aria-label="اسم الدور" />
                      ) : <div className="text-xs font-extrabold text-primary">{r.nameAr}</div>}
                      <div className="mt-0.5 text-[10px] font-normal text-muted" dir="ltr">{r.key}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sticky start-0 z-10 border-b border-line bg-white px-3 py-2 text-xs font-bold">أقصى خصم مسموح (%)</td>
                {roles.map((r) => (
                  <td key={r.id} className="border-b border-s border-line px-2 py-1.5">
                    <Input type="number" min={0} max={100} disabled={!canEdit} value={drafts[r.id]?.maxDiscountPercent ?? 0} onChange={(e) => setField(r.id, { maxDiscountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} className="px-2 py-1 text-xs" />
                  </td>
                ))}
              </tr>
              {groups.map((g) => (
                <GroupRows key={g.key} group={g} roles={roles} drafts={drafts} canEdit={canEdit} onChange={setGrant} />
              ))}
            </tbody>
            {canEdit && (
              <tfoot className="sticky bottom-0 z-20">
                <tr>
                  <td className="sticky start-0 z-30 border-t border-line bg-tint px-3 py-2 text-xs font-bold text-muted">حفظ / تراجع</td>
                  {roles.map((r) => {
                    const d = drafts[r.id];
                    const dirty = d ? !same(d, toDraft(r)) : false;
                    return (
                      <td key={r.id} className="border-s border-t border-line bg-tint px-2 py-2">
                        <div className="flex gap-1">
                          <Button size="sm" disabled={!dirty} loading={saving === r.id} icon={<Save className="size-3.5" />} onClick={() => save(r)}>حفظ</Button>
                          {dirty && <Button size="sm" variant="ghost" title="تراجع" aria-label="تراجع" onClick={() => setField(r.id, toDraft(r))}><RotateCcw className="size-3.5" /></Button>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}

function GroupRows({ group, roles, drafts, canEdit, onChange }: { group: { key: string; perms: string[] }; roles: RoleRow[]; drafts: Record<string, Draft>; canEdit: boolean; onChange: (roleId: string, perm: string, scope: string) => void }) {
  return (
    <>
      <tr>
        <td colSpan={roles.length + 1} className="border-b border-line bg-primary-50/60 px-3 py-1.5 text-xs font-extrabold text-primary">
          <span className="sticky start-3">{PERM_GROUP_AR[group.key] ?? group.key}</span>
        </td>
      </tr>
      {group.perms.map((p) => (
        <tr key={p} className="hover:bg-tint/40">
          <td className="sticky start-0 z-10 border-b border-line bg-white px-3 py-1.5">
            <div className="text-xs font-bold">{PERM_AR[p] ?? p}</div>
            <div className="text-[10px] text-muted" dir="ltr">{p}</div>
          </td>
          {roles.map((r) => {
            const v = drafts[r.id]?.grants[p] ?? '';
            return (
              <td key={r.id} className="border-b border-s border-line px-2 py-1">
                <select
                  value={v}
                  disabled={!canEdit}
                  onChange={(e) => onChange(r.id, p, e.target.value)}
                  aria-label={`${PERM_AR[p] ?? p} — ${r.nameAr}`}
                  className={clsx('w-full rounded-md border border-line px-1.5 py-1 text-xs outline-none focus:border-gold disabled:opacity-80', v ? SCOPE_TONE[v as Scope] : 'bg-white text-muted')}
                >
                  <option value="">— لا شيء</option>
                  {SCOPES.map((s) => <option key={s} value={s}>{SCOPE_AR[s]}</option>)}
                </select>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
