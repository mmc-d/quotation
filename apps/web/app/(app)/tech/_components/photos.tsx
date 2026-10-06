'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CloudOff, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clsx } from '@/components/ui';
import { prepareImage } from '@/lib/upload';
import { errMsg, isTransient, tap, tapTone, type WOView } from './shared';
import { useOutbox } from './outbox';

interface Pending { id: string; name: string; contentType: string; data: string; at: number }

const outboxKey = (woId: string) => `mmc_tech_outbox_${woId}`;

function readOutbox(woId: string): Pending[] {
  try {
    const raw = localStorage.getItem(outboxKey(woId));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
/** Returns false when the browser refused to store (quota / private mode) — the items stay in memory only. */
function writeOutbox(woId: string, items: Pending[]): boolean {
  try {
    if (items.length) localStorage.setItem(outboxKey(woId), JSON.stringify(items));
    else localStorage.removeItem(outboxKey(woId));
    return true;
  } catch {
    return false;
  }
}

const prepare = prepareImage;

/** Photos: camera capture, client-side downscale, upload with a local outbox for weak signal. */
export function PhotosStep({ wo, editable, onView }: { wo: WOView; editable: boolean; onView: (v: WOView) => void }) {
  const { bi } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [outbox, setOutbox] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [memOnly, setMemOnly] = useState(false);

  useEffect(() => setOutbox(readOutbox(wo.id)), [wo.id]);
  // the job header counts these too, and its "retry" button retries them (FSM-48)
  const shared = useOutbox();
  const { setPhotoPending, photoRetry } = shared;
  useEffect(() => setPhotoPending(outbox.length), [outbox.length, setPhotoPending]);
  const outboxRef = useRef<Pending[]>([]);
  outboxRef.current = outbox;
  const persist = useCallback((items: Pending[]) => { outboxRef.current = items; setOutbox(items); setMemOnly(!writeOutbox(wo.id, items)); }, [wo.id]);

  const upload = (p: { name: string; contentType: string; data: string }) => api.post<WOView>(`/field/work-orders/${wo.id}/photos`, p);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    setBusy((n) => n + list.length);
    let queued = [...outboxRef.current];
    for (const f of list) {
      try {
        const p = await prepare(f);
        if (p.data.length * 0.75 > 8_000_000) { toast.error(bi('الصورة أكبر من 8 ميجابايت', 'Image larger than 8 MB')); continue; }
        try {
          onView(await upload(p));
        } catch (e) {
          if (!isTransient(e)) { toast.error(errMsg(e)); continue; }
          queued = [...queued, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...p, at: Date.now() }];
          persist(queued);
          toast.warning(bi('تعذّر الرفع — حُفظت الصورة في صندوق الانتظار', 'Upload failed — photo kept in the outbox'));
        }
      } catch {
        toast.error(bi(`تعذّرت قراءة الصورة ${f.name}`, `Could not read image ${f.name}`));
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (input.current) input.current.value = '';
  };

  const retry = async () => {
    setRetrying(true);
    const start = [...outboxRef.current];
    let left = [...start];
    for (const p of start) {
      try {
        onView(await upload(p));
        left = left.filter((x) => x.id !== p.id);
        persist(left);
      } catch (e) {
        if (!isTransient(e)) {
          toast.error(errMsg(e));
          left = left.filter((x) => x.id !== p.id);
          persist(left);
        } else {
          toast.error(bi('ما زال الاتصال ضعيفًا — حاول لاحقًا', 'Still no connection — try again later'));
          break;
        }
      }
    }
    if (!left.length) toast.success(bi('رُفعت كل الصور المعلّقة', 'All pending photos uploaded'));
    setRetrying(false);
  };

  // The shared outbox replays photos too (on `online` and from the header's retry button).
  useEffect(() => {
    photoRetry.current = async () => { if (outboxRef.current.length) await retry(); return outboxRef.current.length; };
    return () => { photoRetry.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo.id, outbox.length]);

  const remove = async (fileId: string) => {
    setRemoving(fileId);
    try {
      onView(await api.del<WOView>(`/field/work-orders/${wo.id}/photos/${fileId}`));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-3">
      {editable && (
        <>
          <input ref={input} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          <button type="button" className={clsx(tap, tapTone.primary, 'w-full')} onClick={() => input.current?.click()} disabled={busy > 0 || retrying}>
            {busy > 0 ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
            {busy > 0 ? bi(`جارٍ الرفع (${busy})…`, `Uploading (${busy})…`) : bi('التقاط / إضافة صور', 'Take / add photos')}
          </button>
        </>
      )}

      {outbox.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <CloudOff className="size-4" />
            {bi('صور بانتظار الرفع', 'Photos waiting to upload')}: <span className="num">{outbox.length}</span>
          </p>
          {memOnly && <p className="mt-1 text-xs text-amber-800">{bi('تعذّر حفظها على الجهاز — لا تغلق الصفحة قبل الرفع.', 'Could not save them on the device — keep this page open until they upload.')}</p>}
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {outbox.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={`data:${p.contentType};base64,${p.data}`} alt="" className="size-14 shrink-0 rounded-lg object-cover opacity-70" />
            ))}
          </div>
          <button type="button" className={clsx(tap, tapTone.gold, 'mt-2 w-full')} onClick={() => void retry()} disabled={retrying}>
            <RefreshCw className={clsx('size-5', retrying && 'animate-spin')} />{bi('إعادة المحاولة', 'Retry')}
          </button>
        </div>
      )}

      {wo.photos.length === 0 ? (
        <p className="text-sm text-muted">{bi('لا توجد صور بعد — صورة واحدة على الأقل مطلوبة للإنجاز.', 'No photos yet — at least one is required to complete.')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {wo.photos.map((p) => (
            <div key={p.fileId} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-tint">
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.filename} loading="lazy" className="size-full object-cover" />
              </a>
              {editable && (
                <button type="button" onClick={() => void remove(p.fileId)} disabled={removing === p.fileId} className="absolute end-1 top-1 flex size-10 items-center justify-center rounded-full bg-black/55 text-white" aria-label={bi('حذف الصورة', 'Delete photo')}>
                  {removing === p.fileId ? <Loader2 className="size-5 animate-spin" /> : <Trash2 className="size-5" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
