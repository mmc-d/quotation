'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CloudOff, RefreshCw, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { bi as biNow, useI18n } from '@/lib/i18n';
import { clsx } from '@/components/ui';
import { errMsg, isTransient, type WOView } from './shared';

/**
 * Offline outbox for the technician app (FSM-48): checklist toggles, parts and findings are queued in
 * localStorage when the network is down and replayed in order — on the `online` event, on page load
 * and from the "retry" button. Later saves of the same thing replace the queued one (last write
 * wins). Photos keep their own outbox (photos.tsx) and report their count here. Status changes and
 * completion are online-only.
 */
export type QueuedKind = 'checklist' | 'parts' | 'findings';
export interface QueuedMutation {
  id: string;
  kind: QueuedKind;
  /** same key → the newer one replaces the older (e.g. "checklist:door_hand", "parts") */
  key: string;
  method: 'PUT';
  path: string;
  body: unknown;
  at: number;
}

const storeKey = (woId: string) => `mmc_tech_mutations_${woId}`;

function read(woId: string): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(storeKey(woId));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
/** false when the browser refused to store (quota / private mode) — the queue then lives in memory only. */
function write(woId: string, items: QueuedMutation[]): boolean {
  try {
    if (items.length) localStorage.setItem(storeKey(woId), JSON.stringify(items));
    else localStorage.removeItem(storeKey(woId));
    return true;
  } catch {
    return false;
  }
}

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

interface OutboxCtx {
  pending: QueuedMutation[];
  memOnly: boolean;
  flushing: boolean;
  online: boolean;
  /** Save now; queue it when offline / on a network error. Returns the new view, or null when queued or refused. */
  send: (m: Omit<QueuedMutation, 'id' | 'at' | 'method'>) => Promise<WOView | null>;
  /** Replay the queue (mutations + photos). Resolves true when nothing is left. */
  flush: () => Promise<boolean>;
  photoPending: number;
  setPhotoPending: (n: number) => void;
  /** photos.tsx registers its retry here so the header button retries everything */
  photoRetry: React.MutableRefObject<(() => Promise<number>) | null>;
}

const Ctx = createContext<OutboxCtx | null>(null);

export function useOutbox(): OutboxCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useOutbox outside OutboxProvider');
  return c;
}

export function OutboxProvider({ woId, onView, children }: { woId: string; onView: (v: WOView) => void; children: ReactNode }) {
  const [pending, setPending] = useState<QueuedMutation[]>([]);
  const [memOnly, setMemOnly] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [online, setOnline] = useState(true);
  const [photoPending, setPhotoPending] = useState(0);
  const photoRetry = useRef<(() => Promise<number>) | null>(null);
  const photoPendingRef = useRef(0);
  photoPendingRef.current = photoPending;
  const ref = useRef<QueuedMutation[]>([]);
  const flushingRef = useRef(false);
  const onViewRef = useRef(onView);
  onViewRef.current = onView;

  const persist = useCallback((items: QueuedMutation[]) => {
    ref.current = items;
    setPending(items);
    setMemOnly(!write(woId, items));
  }, [woId]);

  useEffect(() => {
    const items = read(woId);
    ref.current = items;
    setPending(items);
    setOnline(!isOffline());
  }, [woId]);

  const enqueue = useCallback((m: Omit<QueuedMutation, 'id' | 'at' | 'method'>) => {
    const item: QueuedMutation = { ...m, method: 'PUT', id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() };
    persist([...ref.current.filter((x) => x.key !== m.key), item]);
  }, [persist]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (flushingRef.current) return false;
    flushingRef.current = true;
    setFlushing(true);
    try {
      // oldest first; items queued while flushing are picked up by the next round (max a few rounds)
      let stuck = false;
      for (let round = 0; round < 5 && !stuck && ref.current.length; round++) {
        for (const m of [...ref.current]) {
          if (!ref.current.some((x) => x.id === m.id)) continue; // replaced by a newer save meanwhile
          try {
            onViewRef.current(await api.put<WOView>(m.path, m.body));
          } catch (e) {
            if (isTransient(e)) { stuck = true; break; }
            // refused by the server (e.g. the job was completed meanwhile) — drop it and say why
            toast.error(`${biNow('تعذّر حفظ تعديل معلّق', 'A pending change could not be saved')}: ${errMsg(e)}`);
          }
          persist(ref.current.filter((x) => x.id !== m.id));
        }
      }
      const photosLeft = photoRetry.current ? await photoRetry.current() : 0;
      return ref.current.length === 0 && photosLeft === 0;
    } finally {
      flushingRef.current = false;
      setFlushing(false);
    }
  }, [persist]);

  const send = useCallback(async (m: Omit<QueuedMutation, 'id' | 'at' | 'method'>): Promise<WOView | null> => {
    // keep the order: if something of the same key is still queued, queue behind it
    if (isOffline() || ref.current.some((x) => x.key === m.key)) {
      enqueue(m);
      toast.warning(biNow('لا يوجد اتصال — حُفظ التعديل على الجهاز وسيُرسل تلقائيًا', 'Offline — the change is kept on this device and will be sent automatically'));
      return null;
    }
    try {
      const v = await api.put<WOView>(m.path, m.body);
      onViewRef.current(v);
      return v;
    } catch (e) {
      if (!isTransient(e)) throw e;
      enqueue(m);
      toast.warning(biNow('تعذّر الإرسال — حُفظ التعديل على الجهاز وسيُعاد إرساله', 'Could not send — the change is kept on this device and will be retried'));
      return null;
    }
  }, [enqueue]);

  // back online → replay; also once on load if something is waiting
  useEffect(() => {
    const on = () => { setOnline(true); if (ref.current.length || photoPendingRef.current) void flush(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if (ref.current.length && !isOffline()) void flush();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [flush]);

  const value = useMemo<OutboxCtx>(() => ({ pending, memOnly, flushing, online, send, flush, photoPending, setPhotoPending, photoRetry }), [pending, memOnly, flushing, online, send, flush, photoPending]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Header strip: offline notice + pending counter + retry. */
export function OutboxBar() {
  const { bi } = useI18n();
  const { pending, photoPending, flushing, flush, memOnly, online } = useOutbox();
  const total = pending.length + photoPending;
  if (online && total === 0) return null;
  const retry = async () => {
    if (isOffline()) return toast.error(bi('ما زلت غير متصل بالإنترنت', 'Still offline'));
    const ok = await flush();
    if (ok) toast.success(bi('أُرسلت كل التعديلات المعلّقة', 'All pending changes sent'));
    else toast.error(bi('بقيت تعديلات معلّقة — حاول لاحقًا', 'Some changes are still pending — try again later'));
  };
  return (
    <div className={clsx('flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm', online ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-300 bg-gray-100 text-gray-800')} role="status">
      {online ? <CloudOff className="size-4 shrink-0" /> : <WifiOff className="size-4 shrink-0" />}
      <span className="flex-1">
        {!online && <b>{bi('غير متصل', 'Offline')} · </b>}
        {total > 0
          ? <>{bi('تعديلات بانتظار الإرسال', 'Changes waiting to sync')}: <span dir="ltr" className="num font-bold">{total}</span></>
          : bi('التعديلات تُحفظ على الجهاز حتى يعود الاتصال', 'Changes are kept on this device until the connection returns')}
        {memOnly && <span className="block text-xs">{bi('تعذّر الحفظ على الجهاز — لا تغلق الصفحة.', 'Could not save on the device — keep this page open.')}</span>}
      </span>
      {total > 0 && (
        <button type="button" onClick={() => void retry()} disabled={flushing} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-gold px-3 text-sm font-bold text-white disabled:opacity-60">
          <RefreshCw className={clsx('size-4', flushing && 'animate-spin')} />{bi('إعادة المحاولة', 'Retry')}
        </button>
      )}
    </div>
  );
}
