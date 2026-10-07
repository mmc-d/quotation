'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { NumInput } from '../../../quotes/_components/common';
import { Ltr, qty as fmtQty } from '../../_components/common';
import { ProductPicker, SupplierPicker, type PickedProduct, type PickedSupplier } from '../../_components/pickers';
import type { MrView, RfqView } from '../../_components/types';

interface Line { key: string; product: PickedProduct | null; code: string; description: string; qty: string }

let seq = 0;
const newLine = (): Line => ({ key: `l${++seq}`, product: null, code: '', description: '', qty: '1' });

function RfqForm() {
  const sp = useSearchParams();
  const mrId = sp.get('materialRequestId');
  const router = useRouter();
  const qc = useQueryClient();
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const [suppliers, setSuppliers] = useState<PickedSupplier[]>([]);
  const [picker, setPicker] = useState<PickedSupplier | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const mr = useQuery({ queryKey: ['mr', mrId], queryFn: () => api.get<MrView>(`/inventory/material-requests/${mrId}`), enabled: !!mrId });
  const openMrLines = (mr.data?.lines ?? []).filter((l) => Number(l.openQty) > 0);

  const addSupplier = (s: PickedSupplier | null) => {
    if (s && !suppliers.some((x) => x.id === s.id)) setSuppliers((cur) => [...cur, s]);
    setPicker(null);
  };
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const manual = lines.filter((l) => (l.product || l.code.trim()) && Number(l.qty) > 0);
  const valid = suppliers.length > 0 && (mrId ? openMrLines.length > 0 : manual.length > 0 && manual.length === lines.filter((l) => l.product || l.code.trim()).length);

  const save = useMutation({
    mutationFn: () => api.post<RfqView>('/inventory/rfqs', {
      ...(mrId ? { materialRequestId: mrId } : { lines: manual.map((l) => ({ productId: l.product?.id ?? null, code: l.code.trim() || l.product?.code, description: l.description.trim() || null, qty: l.qty })) }),
      supplierIds: suppliers.map((s) => s.id), dueDate: dueDate || null, notes: notes.trim() || null,
    }),
    onSuccess: (r) => {
      toast.success(bi(`تم إنشاء ${r.number}`, `${r.number} created`));
      qc.invalidateQueries({ queryKey: ['rfq-list'] });
      router.push(`/purchasing/rfqs/${r.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!can('purchase.write')) return <ErrorBox error={new Error(bi('لا تملك صلاحية المشتريات', 'You do not have the purchasing permission'))} />;
  if (mrId && mr.isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        back={mrId ? `/purchasing/requests/${mrId}` : '/purchasing/rfqs'}
        title={bi('طلب عروض أسعار جديد', 'New request for quotation')}
        subtitle={mr.data ? <>{bi('من طلب المواد', 'From material request')} <span dir="ltr" className="num font-bold">{mr.data.number}</span></> : undefined}
        actions={<Button icon={<Save className="size-4" />} disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('إنشاء الطلب', 'Create RFQ')}</Button>}
      />
      <ErrorBox error={mr.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={bi('البنود المطلوب تسعيرها', 'Lines to quote')} padded={false}>
            {mrId ? (
              openMrLines.length === 0 ? <Empty title={bi('لا توجد كميات مفتوحة في طلب المواد', 'No open quantities on the material request')} /> : (
                <Table>
                  <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الوصف', 'Description')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th></tr></thead>
                  <tbody>
                    {openMrLines.map((l) => (
                      <tr key={l.id}><Td><Ltr className="font-bold">{l.code}</Ltr></Td><Td className="text-xs">{l.description ?? '—'}</Td><Td className="text-end"><Ltr>{fmtQty(l.openQty)}</Ltr></Td></tr>
                    ))}
                  </tbody>
                </Table>
              )
            ) : (
              <>
                <Table>
                  <thead><tr><Th className="w-[34%]">{bi('المنتج', 'Product')}</Th><Th>{bi('الكود / الوصف', 'Code / description')}</Th><Th className="w-28">{bi('الكمية', 'Qty')}</Th><Th className="w-10" /></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.key}>
                        <Td><ProductPicker value={l.product} onChange={(p) => setLine(l.key, { product: p, code: p?.code ?? l.code, description: p ? (locale === 'en' ? p.nameEn || p.nameAr : p.nameAr) : l.description })} /></Td>
                        <Td>
                          <div className="space-y-1">
                            <Input dir="ltr" value={l.code} onChange={(e) => setLine(l.key, { code: e.target.value })} placeholder={bi('الكود', 'Code')} disabled={!!l.product} />
                            <Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder={bi('الوصف', 'Description')} />
                          </div>
                        </Td>
                        <Td><NumInput value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} ariaLabel={bi('الكمية', 'Qty')} /></Td>
                        <Td><Button variant="ghost" size="sm" aria-label={bi('حذف', 'Remove')} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))} icon={<Trash2 className="size-4" />} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div className="border-t border-line p-3"><Button variant="outline" size="sm" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, newLine()])}>{bi('إضافة بند', 'Add line')}</Button></div>
              </>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={bi('الموردون', 'Suppliers')}>
            <div className="space-y-2">
              <SupplierPicker value={picker} onChange={addSupplier} placeholder={bi('أضف موردًا…', 'Add a supplier…')} />
              {suppliers.length === 0 ? <p className="text-xs text-muted">{bi('اختر موردًا واحدًا على الأقل.', 'Choose at least one supplier.')}</p> : (
                <ul className="space-y-1.5">
                  {suppliers.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                      <span className="min-w-0">
                        <b className="block truncate">{locale === 'en' ? s.nameEn || s.nameAr : s.nameAr}</b>
                        <span dir="ltr" className="num block truncate text-xs text-muted">{s.email || s.phone || bi('لا بريد ولا هاتف', 'no e-mail or phone')}</span>
                      </span>
                      <Button variant="ghost" size="sm" aria-label={bi('إزالة', 'Remove')} icon={<Trash2 className="size-4" />} onClick={() => setSuppliers((cur) => cur.filter((x) => x.id !== s.id))} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card title={bi('التفاصيل', 'Details')}>
            <div className="space-y-3">
              <Field label={bi('آخر موعد للرد', 'Reply by')}><Input type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
              <Field label={bi('ملاحظات للمورد', 'Notes for the supplier')}><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function NewRfqPage() {
  return <Suspense fallback={<Spinner />}><RfqForm /></Suspense>;
}
