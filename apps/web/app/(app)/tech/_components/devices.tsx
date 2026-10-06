'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cpu, Plus, ScanLine, X } from 'lucide-react';
import { toast } from 'sonner';
import { normalizeMac } from '@mmc/domain';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clsx } from '@/components/ui';
import { errMsg, tap, tapTone, type WOView } from './shared';

interface LocNode { id: string; name: string; kind: string; children: LocNode[] }
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  return (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
}

function flatten(nodes: LocNode[], prefix = '', depth = 0, out: { id: string; path: string; depth: number }[] = []) {
  for (const n of nodes) {
    const path = prefix ? `${prefix}/${n.name}` : n.name;
    out.push({ id: n.id, path, depth });
    flatten(n.children ?? [], path, depth + 1, out);
  }
  return out;
}

const fieldCls = 'min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/20';
const empty = { code: '', serial: '', mac: '', ip: '', firmware: '', locationId: '', description: '' };

/** On-site device registration (FSM-44): barcode scan of serial/MAC, bound to a unit of the site. */
export function DevicesStep({ wo, editable, onAdded }: { wo: WOView; editable: boolean; onAdded: () => void }) {
  const { bi } = useI18n();
  const [f, setF] = useState({ ...empty, locationId: wo.locationId ?? '' });
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<null | 'serial' | 'mac'>(null);
  const [open, setOpen] = useState(false);
  const canScan = useMemo(() => !!detectorCtor() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia, []);
  const locs = useQuery({
    queryKey: ['site-locations', wo.siteId],
    queryFn: () => api.get<{ tree: LocNode[] }>(`/field/sites/${wo.siteId}/locations`),
    enabled: !!wo.siteId && open,
    staleTime: 60_000,
  });
  const options = useMemo(() => flatten(locs.data?.tree ?? []), [locs.data]);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const macBad = !!f.mac.trim() && !normalizeMac(f.mac);

  const submit = async () => {
    if (!f.code.trim()) return toast.error(bi('أدخل رمز الجهاز', 'Enter the device code'));
    if (macBad) return toast.error(bi('عنوان MAC غير صالح', 'Invalid MAC address'));
    setBusy(true);
    try {
      await api.post('/field/assets', {
        code: f.code.trim(), serial: f.serial.trim() || null, mac: f.mac.trim() || null, ip: f.ip.trim() || null, firmware: f.firmware.trim() || null,
        description: f.description.trim() || null, locationId: f.locationId || null, workOrderId: wo.id,
      });
      toast.success(bi('سُجّل الجهاز', 'Device registered'));
      setF((x) => ({ ...empty, code: x.code, locationId: x.locationId, firmware: x.firmware }));
      onAdded();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const onScanned = (raw: string) => {
    const v = raw.trim();
    if (scan === 'mac') setF((x) => ({ ...x, mac: normalizeMac(v) ?? v }));
    else if (scan === 'serial') {
      // A MAC scanned into the serial field goes to MAC instead.
      if (/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(v)) setF((x) => ({ ...x, mac: normalizeMac(v)! }));
      else setF((x) => ({ ...x, serial: v }));
    }
    setScan(null);
    toast.success(bi('تمت قراءة الرمز', 'Code scanned'));
  };

  return (
    <div className="space-y-3">
      {wo.assets.length > 0 ? (
        <ul className="space-y-2">
          {wo.assets.map((a) => (
            <li key={a.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex items-center gap-2 font-bold text-ink"><Cpu className="size-4 text-gold" /><span className="num" dir="ltr">{a.code}</span>{a.description && <span className="truncate text-muted">{a.description}</span>}</div>
              <div className="mt-1 grid grid-cols-1 gap-0.5 text-xs text-muted">
                {a.serial && <span>{bi('الرقم التسلسلي', 'Serial')}: <span className="num text-ink" dir="ltr">{a.serial}</span></span>}
                {a.mac && <span>MAC: <span className="num text-ink" dir="ltr">{a.mac}</span></span>}
                {a.ip && <span>IP: <span className="num text-ink" dir="ltr">{a.ip}</span></span>}
                {a.locationPath && <span>{bi('الوحدة', 'Unit')}: <span className="num text-ink" dir="ltr">{a.locationPath}</span></span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{bi('لم تُسجَّل أجهزة على هذا الأمر بعد.', 'No devices registered on this job yet.')}</p>
      )}

      {editable && !open && (
        <button type="button" className={clsx(tap, tapTone.outline, 'w-full')} onClick={() => setOpen(true)}><ScanLine className="size-5" />{bi('مسح / إضافة جهاز', 'Scan / add device')}</button>
      )}

      {editable && open && (
        <div className="space-y-2 rounded-xl border border-gold/40 bg-tint/40 p-3">
          <label className="block text-xs font-bold text-gold-dark">{bi('رمز الجهاز (الموديل) *', 'Device code (model) *')}
            <input className={clsx(fieldCls, 'num mt-1')} dir="ltr" value={f.code} onChange={set('code')} placeholder="DS-KD8003" autoCapitalize="characters" />
          </label>
          <label className="block text-xs font-bold text-gold-dark">{bi('الرقم التسلسلي', 'Serial number')}
            <div className="mt-1 flex gap-2">
              <input className={clsx(fieldCls, 'num')} dir="ltr" value={f.serial} onChange={set('serial')} autoCapitalize="characters" />
              {canScan && <button type="button" className={clsx(tap, tapTone.gold, 'min-w-12 px-3')} onClick={() => setScan('serial')} aria-label={bi('مسح الرقم التسلسلي', 'Scan serial')}><ScanLine className="size-5" /></button>}
            </div>
          </label>
          <label className="block text-xs font-bold text-gold-dark">MAC
            <div className="mt-1 flex gap-2">
              <input className={clsx(fieldCls, 'num', macBad && 'border-danger')} dir="ltr" value={f.mac} onChange={set('mac')} placeholder="AA:BB:CC:DD:EE:FF" autoCapitalize="characters" />
              {canScan && <button type="button" className={clsx(tap, tapTone.gold, 'min-w-12 px-3')} onClick={() => setScan('mac')} aria-label={bi('مسح MAC', 'Scan MAC')}><ScanLine className="size-5" /></button>}
            </div>
            {macBad && <span className="mt-1 block text-xs text-danger">{bi('12 خانة ست عشرية', '12 hex digits')}</span>}
          </label>
          {!canScan && <p className="text-xs text-muted">{bi('المسح بالكاميرا غير مدعوم في هذا المتصفح — أدخل القيم يدويًا.', 'Camera scanning is not supported in this browser — enter the values by hand.')}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-bold text-gold-dark">IP<input className={clsx(fieldCls, 'num mt-1')} dir="ltr" inputMode="decimal" value={f.ip} onChange={set('ip')} placeholder="10.0.0.20" /></label>
            <label className="block text-xs font-bold text-gold-dark">{bi('إصدار البرنامج', 'Firmware')}<input className={clsx(fieldCls, 'num mt-1')} dir="ltr" value={f.firmware} onChange={set('firmware')} /></label>
          </div>
          <label className="block text-xs font-bold text-gold-dark">{bi('الوحدة / الموقع', 'Unit / location')}
            <select className={clsx(fieldCls, 'mt-1')} value={f.locationId} onChange={set('locationId')} disabled={!wo.siteId}>
              <option value="">{wo.locationPath ? bi(`موقع أمر العمل (${wo.locationPath})`, `Work-order location (${wo.locationPath})`) : bi('— بدون وحدة —', '— no unit —')}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{`${'  '.repeat(o.depth)}${o.path}`}</option>)}
            </select>
            {locs.error ? <span className="mt-1 block text-xs text-danger">{errMsg(locs.error)}</span> : null}
          </label>
          <label className="block text-xs font-bold text-gold-dark">{bi('وصف (اختياري)', 'Description (optional)')}<input className={clsx(fieldCls, 'mt-1')} value={f.description} onChange={set('description')} /></label>
          <div className="flex gap-2 pt-1">
            <button type="button" className={clsx(tap, tapTone.primary, 'flex-1')} onClick={() => void submit()} disabled={busy}><Plus className="size-5" />{bi('تسجيل الجهاز', 'Register device')}</button>
            <button type="button" className={clsx(tap, tapTone.outline)} onClick={() => setOpen(false)}>{bi('إغلاق', 'Close')}</button>
          </div>
        </div>
      )}

      {scan && <ScannerModal onClose={() => setScan(null)} onResult={onScanned} title={scan === 'mac' ? bi('مسح عنوان MAC', 'Scan MAC address') : bi('مسح الرقم التسلسلي', 'Scan serial number')} />}
    </div>
  );
}

/** Camera + BarcodeDetector in a small full-screen modal. */
function ScannerModal({ onClose, onResult, title }: { onClose: () => void; onResult: (v: string) => void; title: string }) {
  const { bi } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);

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
          if (hit && !done.current) { done.current = true; onResult(hit.rawValue); return; }
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
        <h3 className="font-extrabold">{title}</h3>
        <button type="button" onClick={onClose} className="flex size-12 items-center justify-center rounded-full bg-white/15" aria-label={bi('إغلاق', 'Close')}><X className="size-6" /></button>
      </div>
      <div className="relative mx-auto w-full max-w-md flex-1 overflow-hidden rounded-2xl bg-black">
        <video ref={video} className="size-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-gold" />
      </div>
      <p className="mt-3 text-center text-sm text-white/80">{err ?? bi('وجّه الكاميرا إلى الباركود أو رمز QR على الجهاز.', 'Point the camera at the barcode or QR code on the device.')}</p>
    </div>
  );
}
