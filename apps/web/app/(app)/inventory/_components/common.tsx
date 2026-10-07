'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ScanLine, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { WAREHOUSE_KIND_LABELS, type WarehouseKind } from '@mmc/domain';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, clsx, Input, Select, Textarea } from '@/components/ui';

// ───────────── types ─────────────

export interface Warehouse {
  id: string; code: string; nameAr: string; nameEn: string | null; kind: WarehouseKind; custodianId: string | null; projectId: string | null; branchId: string | null;
  archivedAt: string | null; version: number; custodianName: string | null; project: { id: string; number: string; name: string } | null; productCount: number;
}
export interface StockMove {
  id: string; kind: string; productId: string; fromWarehouseId: string | null; toWarehouseId: string | null; qty: string; unitCostSar: string | null; serials: string[];
  projectId: string | null; workOrderId: string | null; refType: string | null; refId: string | null; note: string | null; postedAt: string; postedBy: string | null;
  productCode?: string; productName?: string; fromCode?: string | null; toCode?: string | null; postedByName?: string | null;
}
export interface PickedProduct { id: string; code: string; nameAr: string; nameEn: string | null; serialTracked: boolean; uom?: string }
export interface PickedProject { id: string; number: string; name: string }

// ───────────── labels ─────────────

/** value → [Arabic, English, chip classes] */
type L = Record<string, [string, string, string?]>;

export const MOVE_KIND: L = {
  receipt: ['استلام', 'Receipt', 'bg-emerald-100 text-emerald-800'],
  opening: ['رصيد افتتاحي', 'Opening stock', 'bg-lime-100 text-lime-800'],
  transfer: ['تحويل', 'Transfer', 'bg-sky-100 text-sky-800'],
  issue_project: ['صرف لمشروع', 'Issue to project', 'bg-indigo-100 text-indigo-800'],
  consume_wo: ['استهلاك أمر عمل', 'Work-order use', 'bg-violet-100 text-violet-800'],
  return: ['مرتجع', 'Return', 'bg-teal-100 text-teal-800'],
  adjust: ['تسوية', 'Adjustment', 'bg-amber-100 text-amber-800'],
  count: ['فرق جرد', 'Count difference', 'bg-orange-100 text-orange-800'],
  rma_out: ['إرجاع للمورد', 'RMA to supplier', 'bg-rose-100 text-rose-800'],
  scrap: ['إتلاف', 'Scrap', 'bg-gray-200 text-gray-700'],
};

export const TRANSFER_STATUS: L = {
  draft: ['مسودة', 'Draft', 'bg-gray-100 text-gray-700'],
  in_transit: ['في الطريق', 'In transit', 'bg-amber-100 text-amber-800'],
  received: ['مستلم', 'Received', 'bg-emerald-100 text-emerald-800'],
  cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-500'],
};

export const COUNT_STATUS: L = {
  open: ['مفتوح', 'Open', 'bg-sky-100 text-sky-800'],
  submitted: ['مُسلّم', 'Submitted', 'bg-amber-100 text-amber-800'],
  posted: ['مُرحّل', 'Posted', 'bg-emerald-100 text-emerald-800'],
  cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-500'],
};

export const SERIAL_STATUS: L = {
  in_stock: ['في المخزون', 'In stock', 'bg-emerald-100 text-emerald-800'],
  reserved: ['محجوز', 'Reserved', 'bg-indigo-100 text-indigo-800'],
  in_transit: ['في الطريق', 'In transit', 'bg-amber-100 text-amber-800'],
  consumed: ['مُستهلك', 'Consumed', 'bg-violet-100 text-violet-800'],
  installed: ['مُركّب', 'Installed', 'bg-primary-50 text-primary'],
  rma: ['مرتجع للمورد', 'RMA', 'bg-rose-100 text-rose-800'],
  scrapped: ['مُتلف', 'Scrapped', 'bg-gray-200 text-gray-600'],
};

export const WH_KIND_TONE: Record<string, string> = {
  main: 'bg-primary-50 text-primary', van: 'bg-sky-100 text-sky-800', site: 'bg-indigo-100 text-indigo-800', transit: 'bg-amber-100 text-amber-800', quarantine: 'bg-rose-100 text-rose-800',
};

export function useLabel() {
  const { locale } = useI18n();
  return (map: L, v: string | null | undefined) => {
    if (!v) return '—';
    const e = map[v];
    return e ? (locale === 'en' ? e[1] : e[0]) : v;
  };
}

export function Chip({ map, value, className }: { map: L; value: string | null | undefined; className?: string }) {
  const label = useLabel();
  if (!value) return <span className="text-muted">—</span>;
  return <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', map[value]?.[2] ?? 'bg-gray-100 text-gray-700', className)}>{label(map, value)}</span>;
}

export function WhKindChip({ kind }: { kind: string | null | undefined }) {
  const { locale } = useI18n();
  if (!kind) return null;
  const l = WAREHOUSE_KIND_LABELS[kind as WarehouseKind];
  return <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', WH_KIND_TONE[kind] ?? 'bg-gray-100 text-gray-700')}>{l ? (locale === 'en' ? l.en : l.ar) : kind}</span>;
}

export function whName(w: { nameAr: string; nameEn?: string | null } | null | undefined, locale: string) {
  if (!w) return '—';
  return locale === 'en' ? w.nameEn || w.nameAr : w.nameAr;
}

/** Quantity from the API (NUMERIC string) → "1,234.5" (no trailing zeros). */
export function fmtQty(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 3 }) : String(v);
}

export function Qty({ value, className }: { value: string | number | null | undefined; className?: string }) {
  const n = Number(value);
  return <span dir="ltr" className={clsx('num whitespace-nowrap', n < 0 && 'text-danger', className)}>{fmtQty(value)}</span>;
}

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  if (children === null || children === undefined || children === '') return <span className="text-muted">—</span>;
  return <span dir="ltr" className={clsx('num', className)}>{children}</span>;
}

export const errMsg = (e: unknown) => (e as Error)?.message ?? String(e);

/** Where a move's reference document lives in the app. */
export function refHref(refType: string | null, refId: string | null): string | null {
  if (!refType || !refId) return null;
  switch (refType) {
    case 'stock_transfer': return `/inventory/transfers/${refId}`;
    case 'stock_count': return `/inventory/counts/${refId}`;
    case 'project': return `/projects/${refId}`;
    case 'work_order': return `/field/work-orders/${refId}`;
    case 'purchase_order': return `/purchasing/orders/${refId}`;
    case 'supplier_bill': return `/purchasing/bills/${refId}`;
    case 'stock_opening': return `/inventory/opening/${refId}`;
    case 'goods_receipt': return null;
    case 'import_shipment': case 'landed_cost': return `/purchasing/shipments/${refId}`;
    default: return null;
  }
}

export function useRefLabel() {
  const { bi } = useI18n();
  return (refType: string | null) => {
    switch (refType) {
      case 'stock_transfer': return bi('تحويل', 'Transfer');
      case 'stock_count': return bi('جرد', 'Count');
      case 'project': return bi('مشروع', 'Project');
      case 'work_order': return bi('أمر عمل', 'Work order');
      case 'goods_receipt': return bi('سند استلام', 'Goods receipt');
      case 'purchase_order': return bi('أمر شراء', 'Purchase order');
      case 'supplier_bill': return bi('فاتورة مشتريات', 'Supplier bill');
      case 'stock_opening': return bi('رصيد افتتاحي', 'Opening stock');
      case 'import_shipment': case 'landed_cost': return bi('شحنة', 'Shipment');
      default: return refType ?? '—';
    }
  };
}

// ───────────── warehouses ─────────────

export function useWarehouses(includeArchived = false) {
  return useQuery({
    queryKey: ['inv-warehouses', includeArchived],
    queryFn: () => api.get<Warehouse[]>(`/inventory/warehouses${qs({ includeArchived: includeArchived || undefined })}`),
    staleTime: 60_000,
  });
}

export function WarehouseSelect({ value, onChange, emptyLabel, allowEmpty = true, exclude, excludeTransit = false, className, disabled }: {
  value: string | null; onChange: (id: string | null) => void; emptyLabel?: string; allowEmpty?: boolean; exclude?: string | null; excludeTransit?: boolean; className?: string; disabled?: boolean;
}) {
  const { bi, locale } = useI18n();
  const q = useWarehouses();
  const rows = (q.data ?? []).filter((w) => w.id !== exclude && (!excludeTransit || w.kind !== 'transit'));
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className} disabled={disabled}>
      {allowEmpty && <option value="">{q.isLoading ? bi('جارٍ التحميل…', 'Loading…') : emptyLabel ?? bi('— اختر المستودع —', '— Select a warehouse —')}</option>}
      {rows.map((w) => <option key={w.id} value={w.id}>{w.code} — {whName(w, locale)}</option>)}
    </Select>
  );
}

// ───────────── search pickers ─────────────

function SearchPicker<T extends { id: string }>({ value, onChange, search, render, placeholder, queryKey, className }: {
  value: T | null; onChange: (v: T | null) => void; search: (q: string) => Promise<T[]>; render: (v: T) => ReactNode; placeholder: string; queryKey: string; className?: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const q = useQuery({ queryKey: [queryKey, term], queryFn: () => search(term), enabled: open, staleTime: 30_000 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (value) {
    return (
      <div className={clsx('flex min-h-[38px] items-center justify-between gap-2 rounded-lg border border-line bg-tint/40 px-3 py-1.5 text-sm', className)}>
        <div className="min-w-0 truncate">{render(value)}</div>
        <button type="button" onClick={() => onChange(null)} className="shrink-0 rounded p-0.5 text-muted hover:bg-black/5" aria-label="clear"><X className="size-4" /></button>
      </div>
    );
  }
  return (
    <div ref={box} className={clsx('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder} className="ps-8" />
      </div>
      {open && (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {q.isLoading ? <li className="px-3 py-2 text-xs text-muted">…</li> : (q.data ?? []).length === 0 ? <li className="px-3 py-2 text-xs text-muted">—</li> : (q.data ?? []).map((r) => (
            <li key={r.id}>
              <button type="button" className="block w-full px-3 py-1.5 text-start text-sm hover:bg-tint" onClick={() => { onChange(r); setOpen(false); setText(''); }}>{render(r)}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProductPicker({ value, onChange, className }: { value: PickedProduct | null; onChange: (p: PickedProduct | null) => void; className?: string }) {
  const { bi, locale } = useI18n();
  return (
    <SearchPicker<PickedProduct>
      className={className}
      queryKey="inv-product-pick"
      value={value}
      onChange={onChange}
      placeholder={bi('ابحث بالكود أو الاسم…', 'Search code or name…')}
      search={(q) => api.get<{ rows: PickedProduct[] }>(`/products${qs({ q, limit: 20 })}`).then((r) => r.rows)}
      render={(p) => <span className="flex min-w-0 items-center gap-2"><span dir="ltr" className="num shrink-0 font-bold text-primary">{p.code}</span><span className="truncate text-xs text-muted">{locale === 'en' ? p.nameEn || p.nameAr : p.nameAr}</span>{p.serialTracked && <span className="shrink-0 rounded bg-tint px-1 text-[10px] font-bold text-gold-dark">{bi('تسلسلي', 'Serial')}</span>}</span>}
    />
  );
}

export function ProjectPicker({ value, onChange, className }: { value: PickedProject | null; onChange: (p: PickedProject | null) => void; className?: string }) {
  const { bi } = useI18n();
  return (
    <SearchPicker<PickedProject>
      className={className}
      queryKey="inv-project-pick"
      value={value}
      onChange={onChange}
      placeholder={bi('ابحث برقم أو اسم المشروع…', 'Search project number or name…')}
      search={(q) => api.get<{ rows: PickedProject[] }>(`/projects${qs({ q, limit: 20 })}`).then((r) => r.rows)}
      render={(p) => <span className="flex min-w-0 items-center gap-2"><span dir="ltr" className="num shrink-0 font-bold text-primary">{p.number}</span><span className="truncate text-xs text-muted">{p.name}</span></span>}
    />
  );
}

// ───────────── serials ─────────────

/** Split pasted / scanned serials (one per line, or separated by commas / tabs / semicolons). */
export function parseSerials(text: string): string[] {
  return text.split(/[\n\r,;\t]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/** Serial-number textarea with a live count (vs the expected qty), duplicate warning and optional camera scan. */
export function SerialInput({ value, onChange, expected, rows = 4, large }: { value: string; onChange: (v: string) => void; expected?: number | null; rows?: number; large?: boolean }) {
  const { bi } = useI18n();
  const [scan, setScan] = useState(false);
  const list = useMemo(() => parseSerials(value), [value]);
  const dupes = list.length - new Set(list).size;
  const canScan = useMemo(() => !!detectorCtor() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia, []);
  const ok = expected === undefined || expected === null || list.length === expected;
  const latest = useRef(value);
  latest.current = value;
  return (
    <div>
      <Textarea dir="ltr" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={clsx('font-mono', large ? 'text-base' : 'text-xs')} placeholder={bi('رقم تسلسلي في كل سطر', 'One serial per line')} />
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <span className={clsx('font-bold', ok ? 'text-ok' : 'text-danger')}>
          {bi('العدد', 'Count')}: <span dir="ltr" className="num">{list.length}{expected !== undefined && expected !== null ? ` / ${fmtQty(expected)}` : ''}</span>
        </span>
        {dupes > 0 && <span className="font-bold text-danger">{bi(`${dupes} مكرر`, `${dupes} duplicate(s)`)}</span>}
        {canScan && <Button type="button" size="sm" variant="outline" className="ms-auto" icon={<ScanLine className="size-3.5" />} onClick={() => setScan(true)}>{bi('مسح بالكاميرا', 'Scan with camera')}</Button>}
      </div>
      {scan && (
        <ScannerModal
          continuous
          title={bi('مسح الأرقام التسلسلية', 'Scan serial numbers')}
          onClose={() => setScan(false)}
          onResult={(raw) => {
            const v = raw.trim().toUpperCase();
            if (!v) return;
            const cur = parseSerials(latest.current);
            if (cur.includes(v)) { toast.message(bi(`مكرر: ${v}`, `Already listed: ${v}`)); return; }
            onChange(latest.current.trim() ? `${latest.current.trimEnd()}\n${v}` : v);
            toast.success(v);
          }}
        />
      )}
    </div>
  );
}

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  return (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
}

export function useCanScan() {
  return useMemo(() => !!detectorCtor() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia, []);
}

/** Camera + BarcodeDetector full-screen modal. `continuous` keeps scanning (same code ignored for 2 s). */
export function ScannerModal({ onClose, onResult, title, continuous }: { onClose: () => void; onResult: (v: string) => void; title: string; continuous?: boolean }) {
  const { bi } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const done = useRef(false);
  const last = useRef<{ v: string; at: number } | null>(null);
  const cb = useRef(onResult);
  cb.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const Ctor = detectorCtor();
    if (!Ctor) { setErr(bi('المسح غير مدعوم', 'Scanning is not supported')); return; }
    let detector: BarcodeDetectorLike;
    try {
      detector = new Ctor({ formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'itf', 'codabar', 'pdf417'] });
    } catch {
      detector = new Ctor();
    }
    const tick = async () => {
      if (stopped || done.current) return;
      const v = video.current;
      if (v && v.readyState >= 2) {
        try {
          const codes = await detector.detect(v);
          const hit = codes.find((c) => c.rawValue?.trim());
          if (hit) {
            const val = hit.rawValue.trim();
            const now = Date.now();
            if (!continuous) { done.current = true; cb.current(val); onClose(); return; }
            if (!last.current || last.current.v !== val || now - last.current.at > 2000) {
              last.current = { v: val, at: now };
              cb.current(val);
              setCount((n) => n + 1);
              navigator.vibrate?.(60);
            } else last.current.at = now;
          }
        } catch { /* frame not ready */ }
      }
      timer = setTimeout(() => void tick(), 250);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
        void tick();
      })
      .catch(() => setErr(bi('تعذّر فتح الكاميرا — اسمح بالوصول أو أدخل القيمة يدويًا.', 'Could not open the camera — allow access or type the value.')));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mb-3 flex items-center justify-between text-white">
        <h3 className="font-extrabold">{title}{continuous && <span className="ms-2 rounded-full bg-gold px-2 text-sm"><span className="num">{count}</span></span>}</h3>
        <button type="button" onClick={onClose} className="flex size-12 items-center justify-center rounded-full bg-white/15" aria-label={bi('إغلاق', 'Close')}>{continuous ? <Check className="size-6" /> : <X className="size-6" />}</button>
      </div>
      <div className="relative mx-auto w-full max-w-md flex-1 overflow-hidden rounded-2xl bg-black">
        <video ref={video} className="size-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-gold" />
      </div>
      <p className="mt-3 text-center text-sm text-white/80">{err ?? (continuous ? bi('امسح الأجهزة واحدًا تلو الآخر، ثم اضغط ✓.', 'Scan the devices one after another, then tap ✓.') : bi('وجّه الكاميرا إلى الباركود.', 'Point the camera at the barcode.'))}</p>
    </div>
  );
}

// ───────────── nav ─────────────

export function InventoryNav() {
  const { bi } = useI18n();
  const path = usePathname();
  const items = [
    { href: '/inventory', label: bi('الأرصدة', 'Stock') },
    { href: '/inventory/moves', label: bi('حركة المخزون', 'Ledger') },
    { href: '/inventory/serials', label: bi('تتبع الأرقام التسلسلية', 'Serial lookup') },
    { href: '/inventory/transfers', label: bi('التحويلات', 'Transfers') },
    { href: '/inventory/counts', label: bi('الجرد', 'Counts') },
    { href: '/inventory/opening', label: bi('الرصيد الافتتاحي', 'Opening stock') },
  ];
  return (
    <nav className="mb-4 flex flex-wrap gap-1.5">
      {items.map((i) => <Link key={i.href} href={i.href} className={clsx('rounded-full border px-3 py-1 text-xs font-bold transition', (i.href === '/inventory' ? path === i.href : path?.startsWith(i.href)) ? 'border-primary bg-primary text-white' : 'border-line bg-white text-primary hover:bg-tint')}>{i.label}</Link>)}
    </nav>
  );
}
