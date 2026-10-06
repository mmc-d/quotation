'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Building2, ChevronDown, FolderTree, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, clsx, Dialog, Empty, ErrorBox, Field, Input, Select, Spinner } from '@/components/ui';
import { ConfirmDialog } from '../../quotes/_components/common';
import { LOCATION_KIND, useLabel } from './common';
import type { LocationNode, LocationTreeResponse } from './types';

export const locKey = (siteId: string | null | undefined) => ['field-locations', siteId];

export function useLocationTree(siteId: string | null | undefined) {
  return useQuery({ queryKey: locKey(siteId), queryFn: () => api.get<LocationTreeResponse>(`/field/sites/${siteId}/locations`), enabled: !!siteId, staleTime: 30_000 });
}

export interface FlatLocation { id: string; name: string; kind: string; depth: number; path: string; assetCount: number; parentId: string | null }

export function flatten(tree: LocationNode[] | undefined): FlatLocation[] {
  const out: FlatLocation[] = [];
  const walk = (list: LocationNode[], depth: number, prefix: string) => {
    for (const n of list) {
      const path = prefix ? `${prefix}/${n.name}` : n.name;
      out.push({ id: n.id, name: n.name, kind: n.kind, depth, path, assetCount: n.assetCount, parentId: n.parentId });
      walk(n.children, depth + 1, path);
    }
  };
  walk(tree ?? [], 0, '');
  return out;
}

/** Location select for one site (indented tree, value = location id). */
export function LocationPicker({ siteId, value, onChange, disabled }: { siteId: string | null | undefined; value: string | null; onChange: (id: string | null) => void; disabled?: boolean }) {
  const { bi } = useI18n();
  const tree = useLocationTree(siteId);
  const flat = useMemo(() => flatten(tree.data?.tree), [tree.data]);
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled || !siteId} dir="ltr" className="text-start">
      <option value="">{!siteId ? bi('اختر الموقع أولًا', 'Pick the site first') : tree.isLoading ? bi('جارٍ التحميل…', 'Loading…') : flat.length ? bi('— بدون مكان محدد —', '— No specific location —') : bi('لا توجد أماكن مسجلة', 'No locations yet')}</option>
      {flat.map((l) => <option key={l.id} value={l.id}>{'  '.repeat(l.depth)}{l.name}</option>)}
    </Select>
  );
}

/** Location tree manager for a site: add child, rename, archive, generate a building. */
export function LocationsPanel({ siteId, canWrite, selectedId, onSelect }: { siteId: string; canWrite: boolean; selectedId?: string | null; onSelect?: (id: string | null) => void }) {
  const { bi } = useI18n();
  const label = useLabel();
  const qc = useQueryClient();
  const tree = useLocationTree(siteId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ mode: 'add' | 'rename'; parentId: string | null; node?: LocationNode } | null>(null);
  const [archive, setArchive] = useState<LocationNode | null>(null);
  const [generate, setGenerate] = useState(false);
  const invalidate = () => { qc.invalidateQueries({ queryKey: locKey(siteId) }); qc.invalidateQueries({ queryKey: ['field-assets'] }); };

  const doArchive = useMutation({
    mutationFn: (id: string) => api.del<{ archived: number }>(`/field/locations/${id}`),
    onSuccess: (r) => { toast.success(bi(`تمت أرشفة ${r.archived} مكان`, `${r.archived} location(s) archived`)); setArchive(null); if (archive && selectedId === archive.id) onSelect?.(null); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const renderNode = (n: LocationNode, depth: number) => (
    <li key={n.id}>
      <div className={clsx('group flex items-center gap-1 rounded-md py-1 pe-1 text-sm hover:bg-tint/60', selectedId === n.id && 'bg-tint font-bold text-primary')} style={{ paddingInlineStart: `${depth * 1}rem` }}>
        {n.children.length > 0 ? (
          <button type="button" onClick={() => toggle(n.id)} className="rounded p-0.5 text-muted hover:bg-black/5" aria-label={bi('طي/توسيع', 'Collapse/expand')}>
            <ChevronDown className={clsx('size-3.5 transition', collapsed.has(n.id) && 'rotate-90 rtl:-rotate-90')} />
          </button>
        ) : <span className="inline-block w-4.5" />}
        <button type="button" onClick={() => onSelect?.(selectedId === n.id ? null : n.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-start">
          <span dir="ltr" className="num truncate">{n.name}</span>
          <span className="text-[10px] text-muted">{label(LOCATION_KIND, n.kind)}</span>
          {n.assetCount > 0 && <span className="num rounded-full bg-tint px-1.5 text-[10px] font-bold text-gold-dark">{n.assetCount}</span>}
        </button>
        {canWrite && (
          <span className="flex shrink-0 items-center opacity-60 group-hover:opacity-100">
            <button type="button" onClick={() => setEdit({ mode: 'add', parentId: n.id })} className="rounded p-1 hover:bg-black/5" title={bi('إضافة فرعي', 'Add child')} aria-label={bi('إضافة فرعي', 'Add child')}><Plus className="size-3.5" /></button>
            <button type="button" onClick={() => setEdit({ mode: 'rename', parentId: n.parentId, node: n })} className="rounded p-1 hover:bg-black/5" title={bi('إعادة تسمية', 'Rename')} aria-label={bi('إعادة تسمية', 'Rename')}><Pencil className="size-3.5" /></button>
            <button type="button" onClick={() => setArchive(n)} className="rounded p-1 text-danger hover:bg-rose-50" title={bi('أرشفة', 'Archive')} aria-label={bi('أرشفة', 'Archive')}><Archive className="size-3.5" /></button>
          </span>
        )}
      </div>
      {n.children.length > 0 && !collapsed.has(n.id) && <ul>{n.children.map((c) => renderNode(c, depth + 1))}</ul>}
    </li>
  );

  return (
    <div>
      {canWrite && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ mode: 'add', parentId: null })}>{bi('مكان رئيسي', 'Top-level location')}</Button>
          <Button size="sm" variant="gold" icon={<Building2 className="size-3.5" />} onClick={() => setGenerate(true)}>{bi('توليد مبنى', 'Generate building')}</Button>
        </div>
      )}
      <ErrorBox error={tree.error} />
      {tree.isLoading ? <Spinner /> : !tree.data?.tree.length ? (
        <Empty icon={<FolderTree className="size-7" />} title={bi('لا توجد أماكن لهذا الموقع', 'No locations for this site')} hint={bi('أضف المباني والطوابق والوحدات، أو ولّد مبنى كاملًا دفعة واحدة.', 'Add buildings, floors and units — or generate a whole building at once.')} />
      ) : (
        <ul className="max-h-[60vh] overflow-y-auto">{tree.data.tree.map((n) => renderNode(n, 0))}</ul>
      )}
      {edit && <LocationDialog siteId={siteId} edit={edit} onClose={() => setEdit(null)} onDone={invalidate} />}
      <GenerateBuildingDialog open={generate} siteId={siteId} onClose={() => setGenerate(false)} onDone={invalidate} />
      <ConfirmDialog
        open={!!archive}
        danger
        title={bi('أرشفة المكان', 'Archive location')}
        message={archive && <>{bi('ستتم أرشفة', 'This archives')} <b dir="ltr">{archive.name}</b> {bi('وكل ما تحته. يُرفض الطلب إن كانت هناك أجهزة مسجلة فيه.', 'and everything below it. Refused while devices are registered there.')}</>}
        loading={doArchive.isPending}
        confirmLabel={bi('أرشفة', 'Archive')}
        onConfirm={() => archive && doArchive.mutate(archive.id)}
        onClose={() => setArchive(null)}
      />
    </div>
  );
}

function LocationDialog({ siteId, edit, onClose, onDone }: { siteId: string; edit: { mode: 'add' | 'rename'; parentId: string | null; node?: LocationNode }; onClose: () => void; onDone: () => void }) {
  const { bi } = useI18n();
  const label = useLabel();
  const [name, setName] = useState(edit.node?.name ?? '');
  const [kind, setKind] = useState(edit.node?.kind ?? (edit.parentId ? 'unit' : 'building'));
  const save = useMutation({
    mutationFn: () => edit.mode === 'add'
      ? api.post(`/field/sites/${siteId}/locations`, { parentId: edit.parentId, kind, name: name.trim() })
      : api.put(`/field/locations/${edit.node!.id}`, { parentId: edit.node!.parentId, kind, name: name.trim(), sort: edit.node!.sort }),
    onSuccess: () => { toast.success(bi('تم الحفظ', 'Saved')); onDone(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} title={edit.mode === 'add' ? bi('إضافة مكان', 'Add location') : bi('تعديل المكان', 'Edit location')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('الاسم', 'Name')}><Input dir="ltr" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="B1 / F2 / 203" /></Field>
        <Field label={bi('النوع', 'Kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.keys(LOCATION_KIND).map((k) => <option key={k} value={k}>{label(LOCATION_KIND, k)}</option>)}</Select>
        </Field>
      </div>
    </Dialog>
  );
}

export function GenerateBuildingDialog({ open, siteId, onClose, onDone }: { open: boolean; siteId: string; onClose: () => void; onDone: () => void }) {
  const { bi } = useI18n();
  const [building, setBuilding] = useState('B1');
  const [floors, setFloors] = useState('5');
  const [units, setUnits] = useState('4');
  const [prefix, setPrefix] = useState('');
  const [floorPrefix, setFloorPrefix] = useState('F');
  const [firstFloor, setFirstFloor] = useState('1');
  const f = Number(floors), u = Number(units), ff = Number(firstFloor);
  const valid = building.trim() && Number.isInteger(f) && f >= 1 && f <= 200 && Number.isInteger(u) && u >= 1 && u <= 100 && Number.isInteger(ff);
  const sample = valid ? `${building.trim()}/${floorPrefix}${ff}/${prefix}${ff}01 … ${floorPrefix}${ff + f - 1}/${prefix}${ff + f - 1}${String(u).padStart(2, '0')}` : '';
  const run = useMutation({
    mutationFn: () => api.post<{ created: number }>(`/field/sites/${siteId}/locations/bulk`, { building: building.trim(), floors: f, unitsPerFloor: u, unitPrefix: prefix.trim() || undefined, floorPrefix, firstFloor: ff }),
    onSuccess: (r) => { toast.success(bi(`تم إنشاء ${r.created} مكان`, `${r.created} location(s) created`)); onDone(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onClose={onClose} title={bi('توليد مبنى', 'Generate building')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={run.isPending} disabled={!valid} onClick={() => run.mutate()}>{bi('توليد', 'Generate')}</Button></>}>
      <p className="mb-3 text-sm text-muted">{bi('ينشئ المبنى ثم الطوابق ثم الوحدات دفعة واحدة. الأماكن الموجودة بنفس الاسم يُعاد استخدامها.', 'Creates the building, its floors and units in one go. Existing nodes with the same names are reused.')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('اسم المبنى', 'Building name')}><Input dir="ltr" value={building} onChange={(e) => setBuilding(e.target.value)} /></Field>
        <Field label={bi('عدد الطوابق', 'Floors')}><Input dir="ltr" type="number" min={1} max={200} value={floors} onChange={(e) => setFloors(e.target.value)} /></Field>
        <Field label={bi('وحدات لكل طابق', 'Units per floor')}><Input dir="ltr" type="number" min={1} max={100} value={units} onChange={(e) => setUnits(e.target.value)} /></Field>
        <Field label={bi('بادئة الوحدة', 'Unit prefix')} hint={bi('اختياري، مثل U', 'Optional, e.g. U')}><Input dir="ltr" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></Field>
        <Field label={bi('بادئة الطابق', 'Floor prefix')}><Input dir="ltr" value={floorPrefix} onChange={(e) => setFloorPrefix(e.target.value)} /></Field>
        <Field label={bi('رقم أول طابق', 'First floor number')}><Input dir="ltr" type="number" value={firstFloor} onChange={(e) => setFirstFloor(e.target.value)} /></Field>
      </div>
      {valid && (
        <div className="mt-3 rounded-lg bg-tint/60 px-3 py-2 text-xs">
          <span className="font-bold text-gold-dark">{bi('المعاينة:', 'Preview:')}</span> <span dir="ltr" className="num">{sample}</span>
          <span className="ms-2 text-muted">({bi('الإجمالي', 'total')} <span className="num">{1 + f + f * u}</span>)</span>
        </div>
      )}
    </Dialog>
  );
}
