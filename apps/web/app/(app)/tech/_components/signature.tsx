'use client';
import { useEffect, useRef, useState } from 'react';
import { Eraser, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clsx } from '@/components/ui';
import { errMsg, tap, tapTone, type WOView } from './shared';

/** Customer name + finger signature on a canvas (pointer events) → PNG data URL. */
export function SignatureStep({ wo, editable, onView }: { wo: WOView; editable: boolean; onView: (v: WOView) => void }) {
  const { bi } = useI18n();
  const [name, setName] = useState(wo.signatureName ?? wo.ticket?.contactName ?? '');
  const [resign, setResign] = useState(!wo.signatureName);
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!resign) return;
    const c = canvas.current;
    if (!c) return;
    const fit = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = c.getBoundingClientRect();
      c.width = Math.round(rect.width * ratio);
      c.height = Math.round(rect.height * ratio);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1f2937';
      setDrawn(false);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [resign]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = pos(e);
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1f2937';
    ctx.fill();
    setDrawn(true);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const p = pos(e);
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const up = () => { last.current = null; };
  const clear = () => {
    const c = canvas.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  };

  const submit = async () => {
    if (!name.trim()) return toast.error(bi('اكتب اسم العميل', 'Enter the customer name'));
    if (!drawn) return toast.error(bi('اطلب من العميل التوقيع في المربع', 'Ask the customer to sign in the box'));
    setBusy(true);
    try {
      const signatureImage = canvas.current!.toDataURL('image/png');
      onView(await api.post<WOView>(`/field/work-orders/${wo.id}/sign`, { signatureName: name.trim(), signatureImage }));
      setResign(false);
      toast.success(bi('حُفظ توقيع العميل', 'Customer signature saved'));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!resign && wo.signatureName) {
    return (
      <div className="space-y-2">
        <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{bi('وقّع العميل', 'Signed by')}: {wo.signatureName}</p>
        {wo.signatureFileId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${wo.signatureFileId}`} alt={bi('التوقيع', 'Signature')} className="h-24 rounded-xl border border-line bg-white object-contain" />
        )}
        {editable && <button type="button" className={clsx(tap, tapTone.outline, 'w-full')} onClick={() => setResign(true)}><PenLine className="size-5" />{bi('إعادة التوقيع', 'Sign again')}</button>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold text-gold-dark">{bi('اسم العميل / المستلم *', 'Customer / recipient name *')}
        <input className="mt-1 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-gold" value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
      <div className="relative">
        <canvas
          ref={canvas}
          className="h-48 w-full touch-none rounded-xl border-2 border-dashed border-gold/60 bg-white"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          aria-label={bi('مربع التوقيع', 'Signature box')}
        />
        {!drawn && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">{bi('وقّع هنا بإصبعك', 'Sign here with your finger')}</span>}
      </div>
      {editable && (
        <div className="flex gap-2">
          <button type="button" className={clsx(tap, tapTone.outline)} onClick={clear}><Eraser className="size-5" />{bi('مسح', 'Clear')}</button>
          <button type="button" className={clsx(tap, tapTone.primary, 'flex-1')} onClick={() => void submit()} disabled={busy}><PenLine className="size-5" />{bi('حفظ التوقيع', 'Save signature')}</button>
          {wo.signatureName && <button type="button" className={clsx(tap, tapTone.outline)} onClick={() => setResign(false)}>{bi('إلغاء', 'Cancel')}</button>}
        </div>
      )}
    </div>
  );
}
