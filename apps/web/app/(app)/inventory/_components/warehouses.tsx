'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Plus, Warehouse as WarehouseIcon } from 'lucide-react';
import { toast } from 'sonner';
import { WAREHOUSE_KINDS, WAREHOUSE_KIND_LABELS } from '@mmc/domain';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, Input, Select, Spinner, Table, Td, Th, clsx } from '@/components/ui';
import { UserSelect } from '@/components/user-select';
import { Ltr, ProjectPicker, WhKindChip, errMsg, useWarehouses, whName, type PickedProject, type Warehouse } from './common';

export function WarehousesPanel() {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const canWrite = can('inventory.write');
  const [archived, setArchived] = useState(false);
  const list = useWarehouses(archived);
  const [edit, setEdit] = useState<Warehouse | 'new' | null>(null);
  const rows = list.data ?? [];
  return (
    <Card padded={false} title={bi('المستودعات', 'Warehouses')} actions={<>
      <Checkbox label={bi('المؤرشفة', 'Archived')} checked={archived} onChange={setArchived} />
      {canWrite && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit('new')}>{bi('مستودع جديد', 'New warehouse')}</Button>}
    </>}>
      <ErrorBox error={list.error} />
      {list.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<WarehouseIcon className="size-8" />} title={bi('لا توجد مستودعات', 'No warehouses')} /> : (
        <Table>
          <thead><tr>
            <Th>{bi('الرمز', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th>{bi('النوع', 'Kind')}</Th><Th>{bi('المسؤول / المشروع', 'Custodian / project')}</Th>
            <Th className="text-end">{bi('أصناف', 'Items')}</Th><Th />
          </tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className={clsx(w.archivedAt && 'opacity-60')}>
                <Td className="font-bold text-primary"><Ltr>{w.code}</Ltr></Td>
                <Td>{whName(w, locale)}{w.archivedAt && <Badge tone="gray"><Archive className="me-1 size-3" />{bi('مؤرشف', 'Archived')}</Badge>}</Td>
                <Td><WhKindChip kind={w.kind} /></Td>
                <Td className="text-xs">{w.kind === 'van' ? w.custodianName ?? '—' : w.project ? <span><Ltr>{w.project.number}</Ltr> <span className="text-muted">{w.project.name}</span></span> : '—'}</Td>
                <Td className="text-end"><Ltr>{w.productCount}</Ltr></Td>
                <Td className="text-end">{canWrite && w.kind !== 'transit' && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(w)}>{bi('تعديل', 'Edit')}</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <WarehouseDialog value={edit} onClose={() => setEdit(null)} />
    </Card>
  );
}

function WarehouseDialog({ value, onClose }: { value: Warehouse | 'new' | null; onClose: () => void }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const isNew = value === 'new';
  const w = value && value !== 'new' ? value : null;
  const [f, setF] = useState({ code: '', nameAr: '', nameEn: '', kind: 'main' as string, custodianId: null as string | null, archived: false });
  const [project, setProject] = useState<PickedProject | null>(null);
  useEffect(() => {
    if (!value) return;
    if (w) {
      setF({ code: w.code, nameAr: w.nameAr, nameEn: w.nameEn ?? '', kind: w.kind, custodianId: w.custodianId, archived: !!w.archivedAt });
      setProject(w.project);
    } else {
      setF({ code: '', nameAr: '', nameEn: '', kind: 'van', custodianId: null, archived: false });
      setProject(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: f.code.trim(), nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() || null, kind: f.kind,
        custodianId: f.kind === 'van' ? f.custodianId : null, projectId: f.kind === 'site' ? project?.id ?? null : null, branchId: w?.branchId ?? null, archived: f.archived,
      };
      return w ? api.put(`/inventory/warehouses/${w.id}`, body) : api.post('/inventory/warehouses', body);
    },
    onSuccess: () => {
      toast.success(bi('تم الحفظ', 'Saved'));
      qc.invalidateQueries({ queryKey: ['inv-warehouses'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const kinds = WAREHOUSE_KINDS.filter((k) => k !== 'transit');
  const isMain = w?.code === 'MAIN';
  const invalid = !f.code.trim() || !f.nameAr.trim() || (f.kind === 'van' && !f.custodianId) || (f.kind === 'site' && !project);
  return (
    <Dialog open={!!value} onClose={onClose} title={isNew ? bi('مستودع جديد', 'New warehouse') : bi('تعديل المستودع', 'Edit warehouse')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('الرمز', 'Code')}><Input dir="ltr" value={f.code} disabled={isMain} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="VAN-01" /></Field>
        <Field label={bi('النوع', 'Kind')}>
          <Select value={f.kind} disabled={isMain} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {kinds.map((k) => <option key={k} value={k}>{locale === 'en' ? WAREHOUSE_KIND_LABELS[k].en : WAREHOUSE_KIND_LABELS[k].ar}</option>)}
          </Select>
        </Field>
        <Field label={bi('الاسم بالعربية', 'Arabic name')}><Input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
        <Field label={bi('الاسم بالإنجليزية', 'English name')}><Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        {f.kind === 'van' && <Field className="sm:col-span-2" label={bi('الفني المسؤول', 'Technician (custodian)')}><UserSelect value={f.custodianId} onChange={(id) => setF({ ...f, custodianId: id })} emptyLabel={bi('— اختر الفني —', '— Select technician —')} /></Field>}
        {f.kind === 'site' && <Field className="sm:col-span-2" label={bi('المشروع', 'Project')}><ProjectPicker value={project} onChange={setProject} /></Field>}
        {!isNew && !isMain && (
          <div className="sm:col-span-2">
            <Checkbox label={bi('أرشفة المستودع (يجب أن يكون فارغًا)', 'Archive the warehouse (must be empty)')} checked={f.archived} onChange={(v) => setF({ ...f, archived: v })} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
