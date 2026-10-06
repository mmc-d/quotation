'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, Plus, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CERT_KINDS, CERT_LABELS, type CertKind } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Stat, StatusBadge, Table, Td, Th, Textarea, clsx } from '@/components/ui';
import { AttachmentPicker, type AttachmentMeta } from '@/components/attachments';
import { ConfirmDialog } from '../../quotes/_components/common';
import { Chip, InventoryNav, Ltr, Qty, SERIAL_STATUS, WhKindChip, errMsg, useRefLabel, type StockMove } from '../_components/common';
import { MoveRow } from '../_components/move-row';

interface Cert { id: string; kind: string; number: string; issuedOn: string | null; expiresOn: string | null; fileId: string | null; notes: string | null }
interface Issue { key: string; level: 'block' | 'warn'; ar: string; en: string }
interface StockCard {
  product: { id: string; code: string; nameAr: string; nameEn: string | null; uom: string; type: string; serialTracked: boolean; radio: boolean; hsCode: string | null; originCountry: string | null; reorderLevel: string | null; reorderQty: string | null; warrantyMonths: number | null; avgCostSar: string | null };
  onHand: string; reserved: string; incoming: string; projected: string; value: string | null;
  balances: { warehouseId: string; code: string; nameAr: string; kind: string; qty: string; reserved: string }[];
  serials: { id: string; serial: string; macs: string[]; status: string; warehouseId: string | null; warehouseCode: string | null; supplierWarrantyEnd: string | null }[];
  moves: StockMove[];
  reservations: { id: string; projectId: string | null; projectNumber: string | null; projectName: string | null; warehouseCode: string; qty: string; createdAt: string }[];
  openPurchaseOrders: { orderId: string; number: string; status: string; expectedOn: string | null; supplierName: string; qty: string; receivedQty: string; unitPrice: string | null }[];
  certificates: Cert[];
  compliance: { ok: boolean; issues: Issue[] } | null;
}

export default function ProductStockPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const canCost = can('purchase.cost.read');
  const canWrite = can('inventory.write') || can('product.write') || can('purchase.write');
  const q = useQuery({ queryKey: ['inv-stock-one', productId], queryFn: () => api.get<StockCard>(`/inventory/stock/${productId}`) });
  const [settings, setSettings] = useState(false);
  const [addCert, setAddCert] = useState(false);
  const [serialFilter, setSerialFilter] = useState('');
  const [delId, setDelId] = useState<string | null>(null);
  const refLabel = useRefLabel();
  const delCert = useMutation({
    mutationFn: (id: string) => api.del(`/inventory/certificates/${id}`),
    onSuccess: () => { setDelId(null); toast.success(bi('حُذفت الشهادة', 'Certificate deleted')); qc.invalidateQueries({ queryKey: ['inv-stock-one', productId] }); qc.invalidateQueries({ queryKey: ['inv-compliance'] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return <><PageHeader back="/inventory" title={bi('بطاقة الصنف', 'Stock card')} /><ErrorBox error={q.error} /></>;
  const p = d.product;
  const blocks = d.compliance?.issues.filter((i) => i.level === 'block') ?? [];
  const warns = d.compliance?.issues.filter((i) => i.level === 'warn') ?? [];
  const serials = d.serials.filter((s) => !serialFilter.trim() || s.serial.includes(serialFilter.trim().toUpperCase()) || s.macs.some((m) => m.replace(/:/g, '').includes(serialFilter.trim().toUpperCase().replace(/[^0-9A-F]/g, '') || '§')));
  const certLabel = (k: string) => { const l = CERT_LABELS[k as CertKind]; return l ? (locale === 'en' ? l.en : l.ar) : k; };
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        back="/inventory"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{p.code}</span><span className="text-lg">{locale === 'en' ? p.nameEn || p.nameAr : p.nameAr}</span></span>}
        subtitle={<span className="flex flex-wrap gap-1.5">
          {p.serialTracked && <Badge tone="gold">{bi('متتبع بالرقم التسلسلي', 'Serial-tracked')}</Badge>}
          {p.radio && <Badge tone="blue">{bi('جهاز لاسلكي (CST)', 'Radio device (CST)')}</Badge>}
          {p.hsCode && <Badge>HS <span dir="ltr" className="num ms-1">{p.hsCode}</span></Badge>}
          {p.originCountry && <Badge>{bi('المنشأ', 'Origin')} <span dir="ltr" className="num ms-1">{p.originCountry}</span></Badge>}
          {p.warrantyMonths !== null && <Badge>{bi('الضمان', 'Warranty')} <span className="num mx-1">{p.warrantyMonths}</span>{bi('شهر', 'mo')}</Badge>}
        </span>}
        actions={<>
          <Link href={`/products/${p.id}`} className="text-xs font-bold text-gold-dark hover:underline">{bi('بطاقة المنتج', 'Product card')}</Link>
          {canWrite && <Button variant="outline" icon={<Settings2 className="size-4" />} onClick={() => setSettings(true)}>{bi('إعدادات المخزون', 'Inventory settings')}</Button>}
        </>}
      />
      <InventoryNav />

      {blocks.length > 0 && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <div className="mb-1 flex items-center gap-2 font-extrabold"><AlertTriangle className="size-4" />{bi('الصنف موقوف للشراء والبيع حتى تُستكمل الشهادات', 'Blocked for purchase and sale until the certificates are complete')}</div>
          <ul className="list-disc ps-5 text-xs">{blocks.map((i) => <li key={i.key}>{locale === 'en' ? i.en : i.ar}</li>)}</ul>
        </div>
      )}
      {warns.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="mb-1 flex items-center gap-2 font-extrabold"><AlertTriangle className="size-4" />{bi('شهادات قاربت على الانتهاء', 'Certificates expiring soon')}</div>
          <ul className="list-disc ps-5 text-xs">{warns.map((i) => <li key={i.key}>{locale === 'en' ? i.en : i.ar}</li>)}</ul>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={bi('الرصيد', 'On hand')} value={<Qty value={d.onHand} />} hint={p.uom} />
        <Stat label={bi('محجوز', 'Reserved')} value={<Qty value={d.reserved} />} />
        <Stat label={bi('وارد', 'Incoming')} value={<Qty value={d.incoming} />} />
        <Stat label={bi('المتوقع', 'Projected')} tone={p.reorderLevel !== null && Number(d.projected) < Number(p.reorderLevel) ? 'red' : undefined} value={<Qty value={d.projected} />}
          hint={p.reorderLevel !== null ? <>{bi('حد الطلب', 'Reorder at')} <Qty value={p.reorderLevel} /></> : undefined} />
        {canCost && <Stat label={bi('القيمة', 'Value')} value={<Money value={d.value} />} hint={<>{bi('متوسط', 'Avg')} <Money value={p.avgCostSar} fixed /></>} />}
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card padded={false} title={bi('الأرصدة حسب المستودع', 'Balances by warehouse')}>
          {d.balances.length === 0 ? <Empty title={bi('لا رصيد', 'No stock')} /> : (
            <Table>
              <thead><tr><Th>{bi('المستودع', 'Warehouse')}</Th><Th>{bi('النوع', 'Kind')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th className="text-end">{bi('محجوز', 'Reserved')}</Th></tr></thead>
              <tbody>
                {d.balances.map((b) => (
                  <tr key={b.warehouseId}>
                    <Td><Ltr className="font-bold">{b.code}</Ltr> <span className="text-xs text-muted">{b.nameAr}</span></Td>
                    <Td><WhKindChip kind={b.kind} /></Td>
                    <Td className="text-end font-bold"><Qty value={b.qty} /></Td>
                    <Td className="text-end"><Qty value={b.reserved} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false} title={bi('الشهادات والامتثال', 'Compliance certificates')}
          actions={<>
            {d.compliance && (d.compliance.ok ? <Badge tone="green"><ShieldCheck className="me-1 size-3" />{bi('مستوفٍ', 'Compliant')}</Badge> : <Badge tone="red">{bi('موقوف', 'Blocked')}</Badge>)}
            {canWrite && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAddCert(true)}>{bi('إضافة شهادة', 'Add certificate')}</Button>}
          </>}>
          {d.certificates.length === 0 ? <Empty title={bi('لا شهادات', 'No certificates')} hint={p.radio ? bi('مطلوب: سابر PCoC واعتماد CST', 'Required: SABER PCoC and CST type approval') : bi('مطلوب: شهادة سابر PCoC', 'Required: SABER PCoC')} /> : (
            <Table>
              <thead><tr><Th>{bi('النوع', 'Kind')}</Th><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('الإصدار', 'Issued')}</Th><Th>{bi('الانتهاء', 'Expires')}</Th><Th /></tr></thead>
              <tbody>
                {d.certificates.map((c) => (
                  <tr key={c.id}>
                    <Td className="text-xs font-bold">{certLabel(c.kind)}{c.notes && <div className="font-normal text-muted">{c.notes}</div>}</Td>
                    <Td className="text-xs"><Ltr>{c.number}</Ltr></Td>
                    <Td className="num whitespace-nowrap text-xs">{date(c.issuedOn)}</Td>
                    <Td className={clsx('num whitespace-nowrap text-xs', c.expiresOn && c.expiresOn < today && 'font-bold text-danger')}>{date(c.expiresOn)}</Td>
                    <Td className="whitespace-nowrap text-end">
                      {c.fileId && <a href={`/api/files/${c.fileId}`} target="_blank" rel="noopener noreferrer" className="inline-flex rounded p-1 text-primary hover:bg-tint" aria-label={bi('الملف', 'File')}><FileText className="size-4" /></a>}
                      {canWrite && <button type="button" className="inline-flex rounded p-1 text-muted hover:bg-rose-50 hover:text-danger" aria-label={bi('حذف', 'Delete')} disabled={delCert.isPending}
                        onClick={() => setDelId(c.id)}><Trash2 className="size-4" /></button>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {p.serialTracked && (
        <Card padded={false} className="mb-5" title={<>{bi('الأرقام التسلسلية في المخزون', 'Serials in stock')} <span className="num ms-1 text-xs text-muted">{d.serials.length}</span></>}
          actions={<Input dir="ltr" value={serialFilter} onChange={(e) => setSerialFilter(e.target.value)} placeholder={bi('تصفية…', 'Filter…')} className="max-w-[12rem] py-1 text-xs" />}>
          {serials.length === 0 ? <Empty title={bi('لا أرقام تسلسلية', 'No serials')} /> : (
            <Table className="max-h-80 overflow-y-auto">
              <thead><tr><Th>{bi('الرقم التسلسلي', 'Serial')}</Th><Th>MAC</Th><Th>{bi('المستودع', 'Warehouse')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('ضمان المورد', 'Supplier warranty')}</Th></tr></thead>
              <tbody>
                {serials.map((s) => (
                  <tr key={s.id}>
                    <Td><Link href={`/inventory/serials?q=${encodeURIComponent(s.serial)}`} dir="ltr" className="num font-bold text-primary hover:underline">{s.serial}</Link></Td>
                    <Td className="text-xs"><Ltr>{s.macs.join(', ')}</Ltr></Td>
                    <Td className="text-xs"><Ltr>{s.warehouseCode}</Ltr></Td>
                    <Td><Chip map={SERIAL_STATUS} value={s.status} /></Td>
                    <Td className="num text-xs">{date(s.supplierWarrantyEnd)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card padded={false} title={bi('أوامر الشراء المفتوحة', 'Open purchase orders')}>
          {d.openPurchaseOrders.length === 0 ? <Empty title={bi('لا أوامر مفتوحة', 'No open orders')} /> : (
            <Table>
              <thead><tr><Th>{bi('الأمر', 'Order')}</Th><Th>{bi('المورد', 'Supplier')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th className="text-end">{bi('المستلم', 'Received')}</Th>{canCost && <Th className="text-end">{bi('السعر', 'Price')}</Th>}<Th>{bi('المتوقع', 'Expected')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
              <tbody>
                {d.openPurchaseOrders.map((o, i) => (
                  <tr key={`${o.orderId}-${i}`}>
                    <Td><Link href={`/purchasing/orders/${o.orderId}`} dir="ltr" className="num font-bold text-primary hover:underline">{o.number}</Link></Td>
                    <Td className="text-xs">{o.supplierName}</Td>
                    <Td className="text-end"><Qty value={o.qty} /></Td>
                    <Td className="text-end"><Qty value={o.receivedQty} /></Td>
                    {canCost && <Td className="text-end text-xs"><Ltr>{o.unitPrice}</Ltr></Td>}
                    <Td className="num text-xs">{date(o.expectedOn)}</Td>
                    <Td><StatusBadge status={o.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card padded={false} title={bi('الحجوزات', 'Reservations')}>
          {d.reservations.length === 0 ? <Empty title={bi('لا حجوزات', 'No reservations')} /> : (
            <Table>
              <thead><tr><Th>{bi('المشروع', 'Project')}</Th><Th>{bi('المستودع', 'Warehouse')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th>{bi('منذ', 'Since')}</Th></tr></thead>
              <tbody>
                {d.reservations.map((r) => (
                  <tr key={r.id}>
                    <Td>{r.projectId ? <Link href={`/projects/${r.projectId}`} className="text-primary hover:underline"><Ltr className="font-bold">{r.projectNumber}</Ltr> <span className="text-xs">{r.projectName}</span></Link> : '—'}</Td>
                    <Td className="text-xs"><Ltr>{r.warehouseCode}</Ltr></Td>
                    <Td className="text-end font-bold"><Qty value={r.qty} /></Td>
                    <Td className="num text-xs">{date(r.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card padded={false} title={bi('آخر 50 حركة', 'Last 50 moves')} actions={<Link href={`/inventory/moves?productId=${p.id}`} className="text-xs font-bold text-gold-dark hover:underline">{bi('كل الحركات', 'Full ledger')}</Link>}>
        {d.moves.length === 0 ? <Empty title={bi('لا حركات', 'No moves')} /> : (
          <Table>
            <thead><tr><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('النوع', 'Kind')}</Th><Th>{bi('من ← إلى', 'From → to')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th>{canCost && <Th className="text-end">{bi('تكلفة الوحدة', 'Unit cost')}</Th>}<Th>{bi('المرجع', 'Reference')}</Th></tr></thead>
            <tbody>
              {d.moves.map((m) => <MoveRow key={m.id} m={m} canCost={canCost} refLabel={refLabel} />)}
            </tbody>
          </Table>
        )}
      </Card>

      {settings && <SettingsDialog productId={p.id} card={d} onClose={() => setSettings(false)} />}
      <CertDialog productId={p.id} open={addCert} onClose={() => setAddCert(false)} />
      <ConfirmDialog open={!!delId} danger title={bi('حذف الشهادة', 'Delete certificate')} message={bi('حذف هذه الشهادة نهائيًا؟', 'Delete this certificate permanently?')} confirmLabel={bi('حذف', 'Delete')}
        loading={delCert.isPending} onConfirm={() => delId && delCert.mutate(delId)} onClose={() => setDelId(null)} />
    </>
  );
}

function SettingsDialog({ productId, card, onClose }: { productId: string; card: StockCard; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const p = card.product;
  const full = useQuery({ queryKey: ['product', productId], queryFn: () => api.get<{ weightKg: string | null }>(`/products/${productId}`), retry: false });
  const [f, setF] = useState({
    serialTracked: p.serialTracked, radio: p.radio, hsCode: p.hsCode ?? '', originCountry: p.originCountry ?? '',
    reorderLevel: p.reorderLevel !== null ? String(Number(p.reorderLevel)) : '', reorderQty: p.reorderQty !== null ? String(Number(p.reorderQty)) : '',
    weightKg: '', warrantyMonths: p.warrantyMonths !== null ? String(p.warrantyMonths) : '',
  });
  useEffect(() => { if (full.data?.weightKg) setF((x) => (x.weightKg ? x : { ...x, weightKg: String(Number(full.data!.weightKg)) })); }, [full.data]);
  const hasStock = Number(card.onHand) !== 0 || card.balances.some((b) => Number(b.qty) !== 0);
  const save = useMutation({
    mutationFn: () => {
      const n = (v: string) => (v.trim() === '' ? null : v.trim());
      return api.put(`/inventory/products/${productId}/settings`, {
        ...(f.serialTracked !== p.serialTracked ? { serialTracked: f.serialTracked } : {}), radio: f.radio, hsCode: n(f.hsCode), originCountry: n(f.originCountry.toUpperCase()),
        reorderLevel: n(f.reorderLevel), reorderQty: n(f.reorderQty), weightKg: n(f.weightKg), warrantyMonths: f.warrantyMonths.trim() === '' ? null : Number(f.warrantyMonths),
      });
    },
    onSuccess: () => {
      toast.success(bi('تم الحفظ', 'Saved'));
      for (const k of ['inv-stock-one', 'inv-stock', 'inv-reorder', 'inv-compliance', 'product']) qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open onClose={onClose} title={bi('إعدادات المخزون', 'Inventory settings')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label={bi('يُتتبع بالرقم التسلسلي', 'Serial-tracked')} checked={f.serialTracked} disabled={hasStock} onChange={(v) => setF({ ...f, serialTracked: v })} />
          {hasStock && <p className="text-xs text-muted">{bi('لا يمكن تغيير التتبع التسلسلي أثناء وجود رصيد.', 'Serial tracking can only change while the item has no stock.')}</p>}
          <div><Checkbox label={bi('جهاز لاسلكي (Wi-Fi / Zigbee / BLE / LoRa / خلوي) — يتطلب اعتماد CST', 'Radio device (Wi-Fi / Zigbee / BLE / LoRa / cellular) — needs CST approval')} checked={f.radio} onChange={(v) => setF({ ...f, radio: v })} /></div>
        </div>
        <Field label={bi('رمز النظام المنسق HS', 'HS code')}><Input dir="ltr" value={f.hsCode} onChange={set('hsCode')} placeholder="8517.62" /></Field>
        <Field label={bi('بلد المنشأ (رمز من حرفين)', 'Origin country (2 letters)')}><Input dir="ltr" maxLength={2} value={f.originCountry} onChange={(e) => setF({ ...f, originCountry: e.target.value.toUpperCase() })} placeholder="CN" /></Field>
        <Field label={bi('حد إعادة الطلب', 'Reorder level')}><Input dir="ltr" inputMode="decimal" value={f.reorderLevel} onChange={set('reorderLevel')} /></Field>
        <Field label={bi('كمية إعادة الطلب', 'Reorder quantity')}><Input dir="ltr" inputMode="decimal" value={f.reorderQty} onChange={set('reorderQty')} /></Field>
        <Field label={bi('الوزن (كجم)', 'Weight (kg)')}><Input dir="ltr" inputMode="decimal" value={f.weightKg} onChange={set('weightKg')} /></Field>
        <Field label={bi('الضمان (أشهر)', 'Warranty (months)')}><Input dir="ltr" inputMode="numeric" value={f.warrantyMonths} onChange={set('warrantyMonths')} /></Field>
      </div>
    </Dialog>
  );
}

function CertDialog({ productId, open, onClose }: { productId: string; open: boolean; onClose: () => void }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const empty = { kind: 'saber_pcoc' as string, number: '', issuedOn: '', expiresOn: '', notes: '' };
  const [f, setF] = useState(empty);
  const [files, setFiles] = useState<AttachmentMeta[]>([]);
  const close = () => { setF(empty); setFiles([]); onClose(); };
  const save = useMutation({
    mutationFn: () => api.post(`/inventory/products/${productId}/certificates`, { kind: f.kind, number: f.number.trim(), issuedOn: f.issuedOn || null, expiresOn: f.expiresOn || null, fileId: files[0]?.id ?? null, notes: f.notes.trim() || null }),
    onSuccess: () => {
      toast.success(bi('أُضيفت الشهادة', 'Certificate added'));
      qc.invalidateQueries({ queryKey: ['inv-stock-one', productId] });
      qc.invalidateQueries({ queryKey: ['inv-compliance'] });
      close();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onClose={close} title={bi('إضافة شهادة', 'Add certificate')}
      footer={<><Button variant="outline" onClick={close}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!f.number.trim()} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field className="sm:col-span-2" label={bi('النوع', 'Kind')}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {CERT_KINDS.map((k) => <option key={k} value={k}>{locale === 'en' ? CERT_LABELS[k].en : CERT_LABELS[k].ar}</option>)}
          </Select>
        </Field>
        <Field className="sm:col-span-2" label={bi('رقم الشهادة', 'Certificate number')}><Input dir="ltr" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
        <Field label={bi('تاريخ الإصدار', 'Issued on')}><Input type="date" dir="ltr" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} /></Field>
        <Field label={bi('تاريخ الانتهاء', 'Expires on')}><Input type="date" dir="ltr" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></Field>
        <Field className="sm:col-span-2" label={bi('الملف', 'File')}><AttachmentPicker value={files} onChange={setFiles} multiple={false} label={bi('إرفاق الشهادة (PDF / صورة)', 'Attach the certificate (PDF / image)')} /></Field>
        <Field className="sm:col-span-2" label={bi('ملاحظات', 'Notes')}><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
