'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { INCOTERMS } from '@mmc/domain';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { CURRENCIES, defaultRate } from './common';
import { ProjectPicker, SupplierPicker, type PickedProject, type PickedSupplier } from './pickers';
import type { MrView, PoView } from './types';

/** Material request created from a project's contract BOQ (reserves free stock, lists the shortage). */
export function NewRequestDialog({ open, onClose, initialProject }: { open: boolean; onClose: () => void; initialProject?: PickedProject | null }) {
  const { bi } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [project, setProject] = useState<PickedProject | null>(initialProject ?? null);
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<MrView>(`/inventory/material-requests/from-project/${project!.id}`, { neededBy: neededBy || null, notes: notes.trim() || null }),
    onSuccess: (mr) => {
      qc.invalidateQueries({ queryKey: ['mr-list'] });
      try { sessionStorage.setItem(`mr-created-${mr.id}`, JSON.stringify({ unmatched: mr.unmatched ?? [], reserved: (mr.reserved ?? []).length })); } catch { /* storage blocked */ }
      toast.success(mr.status === 'closed'
        ? bi(`${mr.number}: كل المواد متوفرة وتم حجزها — لا حاجة للشراء`, `${mr.number}: everything is in stock and reserved — nothing to buy`)
        : bi(`تم إنشاء طلب المواد ${mr.number}`, `Material request ${mr.number} created`));
      onClose();
      router.push(`/purchasing/requests/${mr.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onClose={onClose} title={bi('طلب مواد من مشروع', 'Material request from a project')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button disabled={!project} loading={create.isPending} onClick={() => create.mutate()}>{bi('إنشاء الطلب', 'Create request')}</Button></>}>
      <p className="mb-3 text-sm leading-relaxed text-muted">{bi('يُفكّك جدول كميات عقد المشروع، ويحجز المتوفر في المخزون، وينشئ طلبًا بالنواقص للشراء.', 'Explodes the project contract BOQ, reserves what is in stock and creates a request for the shortage.')}</p>
      <div className="space-y-3">
        <Field label={bi('المشروع *', 'Project *')}><ProjectPicker value={project} onChange={setProject} /></Field>
        <Field label={bi('مطلوب بتاريخ', 'Needed by')}><Input type="date" dir="ltr" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></Field>
        <Field label={bi('ملاحظات', 'Notes')}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

/** Purchase order for the open lines of a material request (supplier catalogue prices). */
export function PoFromRequestDialog({ mr, open, onClose }: { mr: MrView; open: boolean; onClose: () => void }) {
  const { bi } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [currency, setCurrency] = useState('');
  const [rate, setRate] = useState('');
  const [incoterm, setIncoterm] = useState('');
  const [deposit, setDeposit] = useState('0');
  const [expectedOn, setExpectedOn] = useState('');
  const onCurrency = (c: string) => { setCurrency(c); setRate(defaultRate(c)); };
  const needRate = !!currency && !defaultRate(currency) && !rate;
  const create = useMutation({
    mutationFn: () => api.post<PoView>(`/inventory/purchase-orders/from-request/${mr.id}${qs({ supplierId: supplier?.id })}`, {
      ...(currency ? { currency } : {}),
      ...(rate ? { rateToSar: rate } : {}),
      incoterm: incoterm || null,
      depositPercent: Math.max(0, Math.min(100, Math.round(Number(deposit) || 0))),
      expectedOn: expectedOn || null,
    }),
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: ['mr', mr.id] });
      qc.invalidateQueries({ queryKey: ['mr-list'] });
      qc.invalidateQueries({ queryKey: ['po-list'] });
      toast.success(bi(`تم إنشاء أمر الشراء ${po.number}`, `Purchase order ${po.number} created`));
      onClose();
      router.push(`/purchasing/orders/${po.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onClose={onClose} title={bi('إنشاء أمر شراء من الطلب', 'Create a purchase order from the request')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button disabled={needRate} loading={create.isPending} onClick={() => create.mutate()}>{bi('إنشاء أمر الشراء', 'Create purchase order')}</Button></>}>
      <div className="space-y-3">
        <Field label={bi('المورد', 'Supplier')} hint={bi('اتركه فارغًا لاختيار المورد المفضّل من كتالوج الموردين.', 'Leave empty to use the preferred supplier from the supplier catalogue.')}>
          <SupplierPicker value={supplier} onChange={setSupplier} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bi('العملة', 'Currency')}>
            <Select value={currency} onChange={(e) => onCurrency(e.target.value)}>
              <option value="">{bi('حسب كتالوج المورد', 'From the supplier catalogue')}</option>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label={bi('سعر الصرف (ريال لكل وحدة)', 'Rate (SAR per unit)')} error={needRate ? bi('أدخل سعر الصرف لهذه العملة', 'Enter the rate for this currency') : null}>
            <Input dir="ltr" inputMode="decimal" value={rate} disabled={currency === 'SAR'} placeholder={currency ? '' : bi('تلقائي', 'Automatic')} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label={bi('شرط التسليم (Incoterm)', 'Incoterm')}>
            <Select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
              <option value="">—</option>
              {INCOTERMS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label={bi('الدفعة المقدمة %', 'Deposit %')}><Input type="number" dir="ltr" min={0} max={100} value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
          <Field label={bi('تاريخ الوصول المتوقع', 'Expected date')}><Input type="date" dir="ltr" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></Field>
        </div>
      </div>
    </Dialog>
  );
}
