'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { PoStatusBadge, SHIP_MODE, useLabel } from './common';
import { SupplierPicker, type PickedSupplier } from './pickers';
import type { PoRow, ShipmentView } from './types';

/** Create (no `shipment`) or edit the logistics of an import shipment (PUT replaces the whole record). */
export function ShipmentDialog({ shipment, open, onClose, onDone }: { shipment?: ShipmentView; open: boolean; onClose: () => void; onDone: (s: ShipmentView) => void }) {
  const { bi } = useI18n();
  const label = useLabel();
  const [supplier, setSupplier] = useState<PickedSupplier | null>(shipment?.supplier ? { ...shipment.supplier, nameEn: null, phone: null, email: null, vatNumber: null } : null);
  const [orderIds, setOrderIds] = useState<string[]>(shipment?.orderIds ?? []);
  const [mode, setMode] = useState(shipment?.mode ?? 'sea');
  const [blNumber, setBl] = useState(shipment?.blNumber ?? '');
  const [containers, setContainers] = useState((shipment?.containers ?? []).join('\n'));
  const [vessel, setVessel] = useState(shipment?.vessel ?? '');
  const [etd, setEtd] = useState(shipment?.etd ?? '');
  const [eta, setEta] = useState(shipment?.eta ?? '');
  const [broker, setBroker] = useState(shipment?.broker ?? '');
  const [notes, setNotes] = useState(shipment?.notes ?? '');

  const pos = useQuery({
    queryKey: ['po-list', { supplierId: supplier?.id, forShipment: true }],
    queryFn: () => api.get<{ rows: PoRow[] }>(`/inventory/purchase-orders${qs({ supplierId: supplier!.id, status: 'approved,sent,partially_received,received', limit: 100 })}`).then((r) => r.rows),
    enabled: !!supplier,
  });
  // keep already-linked orders visible even when their status no longer matches the filter
  const linkedExtra = (shipment?.orders ?? []).filter((o) => !(pos.data ?? []).some((p) => p.id === o.id));
  const toggle = (oid: string, on: boolean) => setOrderIds((ids) => (on ? [...new Set([...ids, oid])] : ids.filter((x) => x !== oid)));

  const badDates = !!etd && !!eta && eta < etd;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        supplierId: supplier?.id ?? null, orderIds, mode, blNumber: blNumber.trim() || null,
        containers: containers.split(/[\n,]/).map((c) => c.trim().toUpperCase()).filter(Boolean), vessel: vessel.trim() || null,
        etd: etd || null, eta: eta || null, broker: broker.trim() || null, notes: notes.trim() || null,
      };
      return shipment ? api.put<ShipmentView>(`/inventory/shipments/${shipment.id}`, body) : api.post<ShipmentView>('/inventory/shipments', body);
    },
    onSuccess: (s) => { toast.success(shipment ? bi('تم الحفظ', 'Saved') : bi(`تم إنشاء الشحنة ${s.number}`, `Shipment ${s.number} created`)); onDone(s); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog wide open={open} onClose={onClose} title={shipment ? bi('بيانات الشحن', 'Logistics') : bi('شحنة مستوردة جديدة', 'New import shipment')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button disabled={badDates} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bi('المورد', 'Supplier')}><SupplierPicker value={supplier} onChange={(s) => { setSupplier(s); setOrderIds([]); }} /></Field>
          <Field label={bi('طريقة الشحن', 'Mode')}>
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>{Object.keys(SHIP_MODE).map((m) => <option key={m} value={m}>{label(SHIP_MODE, m)}</option>)}</Select>
          </Field>
        </div>
        {supplier && (
          <Field label={bi('أوامر الشراء في الشحنة', 'Purchase orders in the shipment')}>
            <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-line p-2.5">
              {pos.isLoading ? <p className="text-sm text-muted">{bi('جارٍ التحميل…', 'Loading…')}</p>
                : (pos.data ?? []).length + linkedExtra.length === 0 ? <p className="text-sm text-muted">{bi('لا توجد أوامر شراء معتمدة لهذا المورد.', 'No approved purchase orders for this supplier.')}</p>
                : <>
                  {(pos.data ?? []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2">
                      <Checkbox checked={orderIds.includes(p.id)} onChange={(on) => toggle(p.id, on)} label={<span dir="ltr" className="num font-bold">{p.number}</span>} />
                      <PoStatusBadge status={p.status} />
                    </div>
                  ))}
                  {linkedExtra.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2">
                      <Checkbox checked={orderIds.includes(p.id)} onChange={(on) => toggle(p.id, on)} label={<span dir="ltr" className="num font-bold">{p.number}</span>} />
                      <PoStatusBadge status={p.status} />
                    </div>
                  ))}
                </>}
            </div>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={bi('رقم البوليصة (B/L / AWB)', 'B/L / AWB number')}><Input dir="ltr" value={blNumber} onChange={(e) => setBl(e.target.value)} /></Field>
          <Field label={bi('السفينة / الرحلة', 'Vessel / flight')}><Input dir="ltr" value={vessel} onChange={(e) => setVessel(e.target.value)} /></Field>
          <Field label={bi('المخلص الجمركي', 'Customs broker')}><Input value={broker} onChange={(e) => setBroker(e.target.value)} /></Field>
          <Field label={bi('تاريخ المغادرة (ETD)', 'ETD')}><Input type="date" dir="ltr" value={etd} onChange={(e) => setEtd(e.target.value)} /></Field>
          <Field label={bi('تاريخ الوصول (ETA)', 'ETA')} error={badDates ? bi('الوصول قبل المغادرة', 'ETA is before ETD') : null}><Input type="date" dir="ltr" value={eta} onChange={(e) => setEta(e.target.value)} /></Field>
          <Field label={bi('الحاويات (سطر لكل حاوية)', 'Containers (one per line)')}><Textarea rows={2} dir="ltr" className="font-mono text-xs" value={containers} onChange={(e) => setContainers(e.target.value)} /></Field>
        </div>
        <Field label={bi('ملاحظات', 'Notes')}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
