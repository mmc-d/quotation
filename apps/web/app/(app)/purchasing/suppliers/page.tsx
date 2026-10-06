'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Pencil, Plus, Star } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, Checkbox, clsx, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { NumInput } from '../../quotes/_components/common';
import { Amount, CURRENCIES, Ltr, fixed, qty } from '../_components/common';
import { ProductPicker, SupplierPicker, type PickedProduct, type PickedSupplier } from '../_components/pickers';
import type { SupplierItem } from '../_components/types';

export default function SupplierCataloguePage() {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [editing, setEditing] = useState<SupplierItem | 'new' | null>(null);
  const filters = { supplierId: supplier?.id, productId: product?.id };
  const list = useQuery({ queryKey: ['supplier-items', filters], queryFn: () => api.get<SupplierItem[]>(`/inventory/supplier-items${qs(filters)}`) });
  const rows = list.data ?? [];
  const canCost = can('purchase.cost.read');
  const canEdit = can('purchase.write') && canCost;
  const today = new Date().toISOString().slice(0, 10);

  const togglePreferred = useMutation({
    mutationFn: (i: SupplierItem) => api.put(`/inventory/supplier-items/${i.id}`, {
      supplierId: i.supplierId, productId: i.productId, vendorSku: i.vendorSku, price: i.price, currency: i.currency, moq: i.moq, leadTimeDays: i.leadTimeDays, validUntil: i.validUntil, preferred: !i.preferred,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-items'] }),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <>
      <PageHeader
        back="/purchasing/orders"
        title={bi('كتالوج الموردين', 'Supplier catalogue')}
        subtitle={bi('أسعار الموردين لكل منتج — يُستخدم المورد المفضّل عند إنشاء أوامر الشراء من طلبات المواد.', 'Supplier prices per product — the preferred supplier is used when ordering from material requests.')}
        actions={canEdit && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{bi('إضافة سعر مورد', 'Add supplier price')}</Button>}
      />
      <Card padded={false}>
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 lg:max-w-3xl">
          <SupplierPicker value={supplier} onChange={setSupplier} placeholder={bi('تصفية حسب المورد…', 'Filter by supplier…')} />
          <ProductPicker value={product} onChange={setProduct} placeholder={bi('تصفية حسب المنتج…', 'Filter by product…')} />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<BookOpen className="size-8" />} title={bi('لا توجد أسعار موردين', 'No supplier prices')} />
        ) : (
          <Table>
            <thead><tr>
              <Th>{bi('المنتج', 'Product')}</Th><Th>{bi('المورد', 'Supplier')}</Th><Th>{bi('كود المورد', 'Vendor SKU')}</Th><Th className="text-end">{bi('السعر', 'Price')}</Th>
              <Th className="text-end">{bi('أقل كمية', 'MOQ')}</Th><Th className="text-end">{bi('مدة التوريد', 'Lead time')}</Th><Th>{bi('صالح حتى', 'Valid until')}</Th><Th>{bi('مفضّل', 'Preferred')}</Th><Th />
            </tr></thead>
            <tbody>
              {rows.map((i) => {
                const expired = i.validUntil && i.validUntil < today;
                return (
                  <tr key={i.id}>
                    <Td><Ltr className="font-bold">{i.productCode}</Ltr><div className="max-w-[16rem] truncate text-xs text-muted">{i.productName}</div></Td>
                    <Td className="font-bold">{i.supplierName}</Td>
                    <Td><Ltr className="text-xs">{i.vendorSku}</Ltr></Td>
                    <Td className="text-end"><Amount value={i.price} currency={i.currency} /></Td>
                    <Td className="text-end"><Ltr>{i.moq ? qty(i.moq) : null}</Ltr></Td>
                    <Td className="text-end">{i.leadTimeDays !== null ? <span><span className="num">{i.leadTimeDays}</span> {bi('يوم', 'days')}</span> : '—'}</Td>
                    <Td><span className={clsx('num text-xs', expired && 'font-bold text-danger')}>{date(i.validUntil)}</span></Td>
                    <Td>
                      <button type="button" disabled={!canEdit || togglePreferred.isPending} onClick={() => togglePreferred.mutate(i)} aria-pressed={i.preferred}
                        className={clsx('rounded p-1 transition disabled:cursor-default', i.preferred ? 'text-gold' : 'text-gray-300 hover:text-gold')} aria-label={bi('مفضّل', 'Preferred')}>
                        <Star className={clsx('size-4', i.preferred && 'fill-current')} />
                      </button>
                    </Td>
                    <Td>{canEdit && <button type="button" onClick={() => setEditing(i)} className="rounded p-1.5 text-muted hover:bg-tint" aria-label={bi('تعديل', 'Edit')}><Pencil className="size-4" /></button>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ItemDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['supplier-items'] }); }} />}
    </>
  );
}

function ItemDialog({ item, onClose, onDone }: { item: SupplierItem | null; onClose: () => void; onDone: () => void }) {
  const { bi } = useI18n();
  const [supplier, setSupplier] = useState<PickedSupplier | null>(item ? { id: item.supplierId, nameAr: item.supplierName, nameEn: null, phone: null, email: null, vatNumber: null } : null);
  const [product, setProduct] = useState<PickedProduct | null>(item ? { id: item.productId, code: item.productCode, nameAr: item.productName, nameEn: null } : null);
  const [vendorSku, setSku] = useState(item?.vendorSku ?? '');
  const [price, setPrice] = useState(item?.price ? String(Number(item.price)) : '');
  const [currency, setCurrency] = useState(item?.currency ?? 'USD');
  const [moq, setMoq] = useState(item?.moq ? String(Number(item.moq)) : '');
  const [lead, setLead] = useState(item?.leadTimeDays !== null && item?.leadTimeDays !== undefined ? String(item.leadTimeDays) : '');
  const [validUntil, setValid] = useState(item?.validUntil ?? '');
  const [preferred, setPreferred] = useState(item?.preferred ?? false);
  const valid = !!supplier && !!product && price !== '' && Number(price) >= 0;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        supplierId: supplier!.id, productId: product!.id, vendorSku: vendorSku.trim() || null, price: fixed(Number(price), 4), currency,
        moq: moq && Number(moq) > 0 ? fixed(Number(moq), 3) : null, leadTimeDays: lead !== '' ? Math.max(0, Math.round(Number(lead))) : null, validUntil: validUntil || null, preferred,
      };
      return item ? api.put(`/inventory/supplier-items/${item.id}`, body) : api.post('/inventory/supplier-items', body);
    },
    onSuccess: () => { toast.success(bi('تم الحفظ', 'Saved')); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} title={item ? bi('تعديل سعر المورد', 'Edit supplier price') : bi('إضافة سعر مورد', 'Add supplier price')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="space-y-3">
        <Field label={bi('المورد *', 'Supplier *')}><SupplierPicker value={supplier} onChange={setSupplier} disabled={!!item} /></Field>
        <Field label={bi('المنتج *', 'Product *')}><ProductPicker value={product} onChange={setProduct} disabled={!!item} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bi('كود المورد', 'Vendor SKU')}><Input dir="ltr" value={vendorSku} onChange={(e) => setSku(e.target.value)} /></Field>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Field label={bi('السعر *', 'Price *')}><NumInput value={price} onChange={setPrice} step="0.01" /></Field>
            <Field label={bi('العملة', 'Currency')}><Select value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          </div>
          <Field label={bi('أقل كمية للطلب', 'MOQ')}><NumInput value={moq} onChange={setMoq} step="1" /></Field>
          <Field label={bi('مدة التوريد (أيام)', 'Lead time (days)')}><NumInput value={lead} onChange={setLead} step="1" /></Field>
          <Field label={bi('صالح حتى', 'Valid until')}><Input type="date" dir="ltr" value={validUntil} onChange={(e) => setValid(e.target.value)} /></Field>
        </div>
        <Checkbox checked={preferred} onChange={setPreferred} label={bi('المورد المفضّل لهذا المنتج', 'Preferred supplier for this product')} />
      </div>
    </Dialog>
  );
}
