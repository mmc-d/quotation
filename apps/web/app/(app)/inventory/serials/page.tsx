'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Barcode, Cpu, ScanLine, Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Input, PageHeader, Spinner, clsx } from '@/components/ui';
import { Chip, InventoryNav, Ltr, SERIAL_STATUS, ScannerModal, useCanScan } from '../_components/common';

interface SerialRow {
  id: string; productId: string; serial: string; macs: string[]; status: string; warehouseId: string | null; supplierWarrantyEnd: string | null; createdAt: string;
  productCode: string; productName: string; warehouseCode: string | null; supplierName: string | null;
  project: { id: string; number: string | null; name: string | null } | null;
  purchaseOrder: { id: string; number: string } | null;
  receipt: { id: string; number: string; receivedOn: string } | null;
  installedAsset: { id: string; code: string; installedOn: string | null; status: string; workOrderId: string | null } | null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 py-1.5 text-sm last:border-0">
      <span className="text-xs font-bold text-muted">{label}</span>
      <span className="text-end">{children}</span>
    </div>
  );
}

function Lookup() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { bi } = useI18n();
  const canScan = useCanScan();
  const [text, setText] = useState(sp.get('q') ?? '');
  const [term, setTerm] = useState(text.trim());
  const [scan, setScan] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  useEffect(() => {
    const next = qs({ q: term });
    if (next !== (sp.toString() ? `?${sp.toString()}` : '')) router.replace(`${pathname}${next}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  const q = useQuery({
    queryKey: ['inv-serials', term],
    queryFn: () => api.get<{ rows: SerialRow[]; total: number }>(`/inventory/serials${qs({ q: term, limit: 50 })}`),
    enabled: term.length >= 3,
    placeholderData: (prev) => prev,
  });
  const rows = term.length >= 3 ? q.data?.rows ?? [] : [];

  return (
    <>
      <PageHeader title={bi('تتبع الأرقام التسلسلية', 'Serial / MAC traceability')} subtitle={bi('من المورد وأمر الشراء والاستلام حتى المستودع أو المشروع والجهاز المركّب', 'Supplier, PO and receipt → warehouse or project → installed device')} />
      <InventoryNav />
      <Card className="mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
            <Input dir="ltr" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={bi('الرقم التسلسلي أو عنوان MAC', 'Serial number or MAC address')} className="min-h-12 ps-10 text-base" />
          </div>
          {canScan && <Button className="min-h-12" variant="gold" icon={<ScanLine className="size-5" />} onClick={() => setScan(true)}>{bi('مسح', 'Scan')}</Button>}
        </div>
        <p className="mt-1.5 text-xs text-muted">{bi('3 أحرف على الأقل. يكفي جزء من MAC (4 خانات ست عشرية أو أكثر).', 'At least 3 characters. Part of a MAC (4+ hex digits) is enough.')}</p>
      </Card>
      <ErrorBox error={q.error} />
      {term.length < 3 ? <Empty icon={<Barcode className="size-8" />} title={bi('ابحث عن رقم تسلسلي', 'Look up a serial number')} /> : q.isLoading ? <Spinner /> : rows.length === 0 ? <Empty title={bi('لا نتائج', 'No results')} /> : (
        <div className={clsx('grid gap-4 md:grid-cols-2', q.isFetching && 'opacity-70')}>
          {q.data && q.data.total > rows.length && <p className="text-xs text-muted md:col-span-2">{bi(`يُعرض ${rows.length} من ${q.data.total} — حدّد البحث أكثر`, `Showing ${rows.length} of ${q.data.total} — refine the search`)}</p>}
          {rows.map((s) => (
            <Card key={s.id} title={<span className="flex flex-wrap items-center gap-2"><Ltr className="text-base">{s.serial}</Ltr><Chip map={SERIAL_STATUS} value={s.status} /></span>}>
              <Row label={bi('الصنف', 'Product')}><Link href={`/inventory/${s.productId}`} className="text-primary hover:underline"><Ltr className="font-bold">{s.productCode}</Ltr></Link> <span className="text-xs text-muted">{s.productName}</span></Row>
              {s.macs.length > 0 && <Row label="MAC"><Ltr className="text-xs">{s.macs.join(', ')}</Ltr></Row>}
              <Row label={bi('المورد', 'Supplier')}>{s.supplierName ?? '—'}</Row>
              <Row label={bi('أمر الشراء', 'Purchase order')}>{s.purchaseOrder ? <Link href={`/purchasing/orders/${s.purchaseOrder.id}`} className="text-primary hover:underline"><Ltr className="font-bold">{s.purchaseOrder.number}</Ltr></Link> : '—'}</Row>
              <Row label={bi('الاستلام', 'Receipt')}>{s.receipt ? <><Ltr className="text-xs">{s.receipt.number}</Ltr> · <span className="num text-xs">{date(s.receipt.receivedOn)}</span></> : '—'}</Row>
              <Row label={bi('المستودع الحالي', 'Current warehouse')}><Ltr className="font-bold">{s.warehouseCode}</Ltr></Row>
              <Row label={bi('المشروع', 'Project')}>{s.project ? <Link href={`/projects/${s.project.id}`} className="text-primary hover:underline"><Ltr className="font-bold">{s.project.number}</Ltr> <span className="text-xs">{s.project.name}</span></Link> : '—'}</Row>
              <Row label={bi('ضمان المورد حتى', 'Supplier warranty until')}><span className="num text-xs">{date(s.supplierWarrantyEnd)}</span></Row>
              <Row label={bi('الجهاز المركّب', 'Installed device')}>
                {s.installedAsset ? (
                  <Link href={`/field/assets/${s.installedAsset.id}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Cpu className="size-3.5" /><Ltr className="font-bold">{s.installedAsset.code}</Ltr>{s.installedAsset.installedOn && <span className="num text-xs text-muted">· {date(s.installedAsset.installedOn)}</span>}</Link>
                ) : '—'}
              </Row>
            </Card>
          ))}
        </div>
      )}
      {scan && <ScannerModal title={bi('مسح الرقم التسلسلي', 'Scan serial number')} onClose={() => setScan(false)} onResult={(v) => { setText(v.trim()); setTerm(v.trim()); }} />}
    </>
  );
}

export default function SerialsPage() {
  return <Suspense fallback={<Spinner />}><Lookup /></Suspense>;
}
