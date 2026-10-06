'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { INCOTERMS } from '@mmc/domain';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { NumInput } from '../../../quotes/_components/common';
import { Amount, CURRENCIES, defaultRate, fixed } from '../../_components/common';
import { ProductPicker, ProjectPicker, SupplierPicker, type PickedProduct, type PickedProject, type PickedSupplier } from '../../_components/pickers';
import type { PoView, SupplierItem } from '../../_components/types';

interface Line { key: string; product: PickedProduct | null; code: string; description: string; qty: string; unitPrice: string; materialRequestLineId: string | null }

let seq = 0;
const newLine = (): Line => ({ key: `l${++seq}`, product: null, code: '', description: '', qty: '1', unitPrice: '', materialRequestLineId: null });

function PoForm() {
  const sp = useSearchParams();
  const editId = sp.get('edit');
  const projectId = sp.get('projectId');
  const router = useRouter();
  const qc = useQueryClient();
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const canCost = can('purchase.cost.read');

  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [rate, setRate] = useState('3.75');
  const [incoterm, setIncoterm] = useState('');
  const [deposit, setDeposit] = useState('0');
  const [orderDate, setOrderDate] = useState('');
  const [expectedOn, setExpectedOn] = useState('');
  const [project, setProject] = useState<PickedProject | null>(null);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [loaded, setLoaded] = useState(!editId);

  const existing = useQuery({ queryKey: ['po', editId], queryFn: () => api.get<PoView>(`/inventory/purchase-orders/${editId}`), enabled: !!editId });
  const preProject = useQuery({ queryKey: ['project-mini', projectId], queryFn: () => api.get<PickedProject>(`/projects/${projectId}`), enabled: !!projectId && !editId });

  useEffect(() => {
    const po = existing.data;
    if (!po || loaded) return;
    if (po.supplier) setSupplier(po.supplier);
    setCurrency(po.currency);
    setRate(po.rateToSar);
    setIncoterm(po.incoterm ?? '');
    setDeposit(String(po.depositPercent));
    setOrderDate(po.orderDate ?? '');
    setExpectedOn(po.expectedOn ?? '');
    setProject(po.project);
    setNotes(po.notes ?? '');
    setLines(po.lines.map((l) => ({
      key: l.id, product: l.productId ? { id: l.productId, code: l.code, nameAr: l.description ?? l.code, nameEn: null } : null,
      code: l.code, description: l.description ?? '', qty: String(Number(l.qty)), unitPrice: l.unitPrice === null ? '' : String(Number(l.unitPrice)), materialRequestLineId: l.materialRequestLineId,
    })));
    setLoaded(true);
  }, [existing.data, loaded]);

  useEffect(() => {
    if (preProject.data && !project) setProject({ id: preProject.data.id, number: preProject.data.number, name: preProject.data.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preProject.data]);

  // catalogue prices of the chosen supplier (prefill when a product is picked)
  const catalogue = useQuery({
    queryKey: ['supplier-items', { supplierId: supplier?.id }],
    queryFn: () => api.get<SupplierItem[]>(`/inventory/supplier-items${qs({ supplierId: supplier!.id })}`),
    enabled: !!supplier && can('purchase.read'),
    staleTime: 60_000,
  });

  const priceFor = (p: PickedProduct): string => {
    const si = (catalogue.data ?? []).find((i) => i.productId === p.id && i.currency === currency && i.price !== null);
    if (si?.price) return String(Number(si.price));
    if (p.costPrice && p.costCurrency === currency) return String(Number(p.costPrice));
    return '';
  };

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key: string, p: PickedProduct | null) => setLines((ls) => ls.map((l) => {
    if (l.key !== key) return l;
    if (!p) return { ...l, product: null };
    return { ...l, product: p, code: p.code, description: locale === 'en' ? p.nameEn || p.nameAr : p.nameAr, unitPrice: l.unitPrice || priceFor(p) };
  }));
  const onCurrency = (c: string) => { setCurrency(c); setRate(defaultRate(c) || ''); };

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
    const vat = currency === 'SAR' && supplier?.vatNumber ? subtotal * 0.15 : 0;
    const total = subtotal + vat;
    return { subtotal, vat, total, totalSar: total * (Number(rate) || 0) };
  }, [lines, currency, supplier, rate]);

  const valid = !!supplier && Number(rate) > 0 && lines.length > 0 && lines.every((l) => (l.product || l.code.trim()) && Number(l.qty) > 0 && l.unitPrice !== '' && Number(l.unitPrice) >= 0);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        supplierId: supplier!.id, currency, rateToSar: rate, incoterm: incoterm || null, depositPercent: Math.max(0, Math.min(100, Math.round(Number(deposit) || 0))),
        orderDate: orderDate || null, expectedOn: expectedOn || null, projectId: project?.id ?? null, notes: notes.trim() || null,
        lines: lines.map((l) => ({
          productId: l.product?.id ?? null, code: l.code.trim(), description: l.description.trim() || null, qty: fixed(Number(l.qty), 3), unitPrice: fixed(Number(l.unitPrice), 4),
          materialRequestLineId: l.materialRequestLineId,
        })),
      };
      return editId ? api.put<PoView>(`/inventory/purchase-orders/${editId}`, body) : api.post<PoView>('/inventory/purchase-orders', body);
    },
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: ['po-list'] });
      qc.setQueryData(['po', po.id], po);
      toast.success(editId ? bi('تم حفظ أمر الشراء', 'Purchase order saved') : bi(`تم إنشاء أمر الشراء ${po.number}`, `Purchase order ${po.number} created`));
      router.push(`/purchasing/orders/${po.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!can('purchase.write')) return <ErrorBox error={new Error(bi('لا تملك صلاحية إنشاء أوامر الشراء', 'You cannot create purchase orders'))} />;
  if (editId && !canCost) return <ErrorBox error={new Error(bi('تعديل أمر الشراء يتطلب صلاحية عرض التكلفة', 'Editing a purchase order needs the cost permission'))} />;
  if (editId && !loaded) return existing.error ? <ErrorBox error={existing.error} /> : <Spinner />;
  if (existing.data && existing.data.status !== 'draft') return <ErrorBox error={new Error(bi('لا يمكن تعديل إلا أمر الشراء المسودة', 'Only a draft purchase order can be edited'))} />;

  return (
    <>
      <PageHeader
        back={editId ? `/purchasing/orders/${editId}` : '/purchasing/orders'}
        title={editId ? <>{bi('تعديل أمر الشراء', 'Edit purchase order')} <span dir="ltr" className="num">{existing.data?.number}</span></> : bi('أمر شراء جديد', 'New purchase order')}
        actions={<Button icon={<Save className="size-4" />} disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ كمسودة', 'Save as draft')}</Button>}
      />
      <div className="space-y-4">
        <Card title={bi('بيانات الأمر', 'Order details')}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label={bi('المورد *', 'Supplier *')} className="md:col-span-2"><SupplierPicker value={supplier} onChange={setSupplier} /></Field>
            <Field label={bi('المشروع (اختياري)', 'Project (optional)')} className="md:col-span-2"><ProjectPicker value={project} onChange={setProject} /></Field>
            <Field label={bi('العملة', 'Currency')}>
              <Select value={currency} onChange={(e) => onCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            </Field>
            <Field label={bi('سعر الصرف (ريال لكل وحدة)', 'Rate (SAR per unit)')} error={Number(rate) > 0 ? null : bi('أدخل سعر الصرف', 'Enter the rate')}>
              <NumInput value={rate} onChange={setRate} disabled={currency === 'SAR'} step="0.0001" />
            </Field>
            <Field label={bi('شرط التسليم (Incoterm)', 'Incoterm')}>
              <Select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}><option value="">—</option>{INCOTERMS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            </Field>
            <Field label={bi('الدفعة المقدمة %', 'Deposit %')}><NumInput value={deposit} onChange={setDeposit} step="1" /></Field>
            <Field label={bi('تاريخ الأمر', 'Order date')}><Input type="date" dir="ltr" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>
            <Field label={bi('تاريخ الوصول المتوقع', 'Expected date')}><Input type="date" dir="ltr" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></Field>
          </div>
        </Card>

        <Card title={bi('البنود', 'Lines')} padded={false} actions={<Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, newLine()])}>{bi('إضافة بند', 'Add line')}</Button>}>
          <Table>
            <thead><tr>
              <Th className="min-w-[16rem]">{bi('المنتج', 'Product')}</Th><Th className="min-w-[12rem]">{bi('الوصف', 'Description')}</Th>
              <Th className="w-28">{bi('الكمية', 'Qty')}</Th><Th className="w-36">{bi('سعر الوحدة', 'Unit price')} ({currency})</Th><Th className="text-end">{bi('الإجمالي', 'Line total')}</Th><Th />
            </tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="align-top">
                  <Td>
                    <ProductPicker value={l.product} onChange={(p) => pickProduct(l.key, p)} />
                    {!l.product && <Input dir="ltr" className="mt-1.5" placeholder={bi('أو كود حر', 'or a free code')} value={l.code} onChange={(e) => setLine(l.key, { code: e.target.value })} />}
                  </Td>
                  <Td><Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} /></Td>
                  <Td><NumInput value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} step="1" /></Td>
                  <Td><NumInput value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v })} step="0.01" /></Td>
                  <Td className="text-end"><Amount value={(Number(l.qty) || 0) * (Number(l.unitPrice) || 0)} currency={currency} /></Td>
                  <Td>
                    <button type="button" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1.5 text-muted hover:bg-rose-50 hover:text-danger disabled:opacity-30" aria-label={bi('حذف البند', 'Remove line')}><Trash2 className="size-4" /></button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex justify-end border-t border-line p-4">
            <dl className="w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">{bi('المجموع', 'Subtotal')}</dt><dd><Amount value={totals.subtotal} currency={currency} /></dd></div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{bi('ضريبة القيمة المضافة', 'VAT')}{currency !== 'SAR' && <span className="block text-[11px]">{bi('الاستيراد: الضريبة تُدفع في الجمارك', 'Import: VAT is paid at customs')}</span>}</dt>
                <dd><Amount value={totals.vat} currency={currency} /></dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-line pt-1 font-extrabold"><dt>{bi('الإجمالي', 'Total')}</dt><dd><Amount value={totals.total} currency={currency} /></dd></div>
              {currency !== 'SAR' && <div className="flex justify-between gap-3 text-primary"><dt>{bi('بالريال', 'In SAR')}</dt><dd><Money value={fixed(totals.totalSar)} fixed /></dd></div>}
            </dl>
          </div>
        </Card>

        <Card title={bi('ملاحظات', 'Notes')}>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Card>
      </div>
    </>
  );
}

export default function NewPoPage() {
  return <Suspense fallback={<Spinner />}><PoForm /></Suspense>;
}
