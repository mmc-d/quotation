'use client';
import { useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { Button, Dialog, Field, Input, Textarea } from '@/components/ui';

/** Read-only link with copy + open buttons. */
export function CopyLink({ url, label }: { url: string; label?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('تم نسخ الرابط');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('تعذّر النسخ — انسخ الرابط يدويًا');
    }
  };
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      {label && <div className="mb-1.5 text-xs font-bold text-primary">{label}</div>}
      <div className="flex gap-2">
        <Input readOnly dir="ltr" value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <Button type="button" variant="outline" onClick={copy} icon={copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />} aria-label="نسخ">نسخ</Button>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-line bg-white px-2.5 text-ink hover:bg-tint" aria-label="فتح"><ExternalLink className="size-4" /></a>
      </div>
    </div>
  );
}

/** Confirmation dialog (native confirm() is unreliable in embedded browsers). */
export function ConfirmDialog({ open, title, message, confirmLabel = 'تأكيد', danger, loading, onConfirm, onClose }: { open: boolean; title: ReactNode; message?: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <div className="text-sm leading-relaxed">{message}</div>
    </Dialog>
  );
}

/** Dialog that asks for a reason / comment before an action. */
export function ReasonDialog({ open, title, label = 'السبب', required, confirmLabel = 'تأكيد', danger, loading, multiline = true, onConfirm, onClose, hint }: { open: boolean; title: ReactNode; label?: string; required?: boolean; confirmLabel?: string; danger?: boolean; loading?: boolean; multiline?: boolean; onConfirm: (reason: string) => void; onClose: () => void; hint?: ReactNode }) {
  const [reason, setReason] = useState('');
  const close = () => { setReason(''); onClose(); };
  return (
    <Dialog open={open} onClose={close} title={title} footer={<><Button variant="outline" onClick={close}>إلغاء</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} disabled={required && !reason.trim()} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button></>}>
      {hint && <div className="mb-3 text-sm text-muted">{hint}</div>}
      <Field label={`${label}${required ? ' *' : ''}`}>
        {multiline ? <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /> : <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
      </Field>
    </Dialog>
  );
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) return `${e.message} — أعد تحميل الصفحة لرؤية آخر نسخة`;
  return (e as Error)?.message ?? String(e);
}

export function isConflict(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

/** Number input that keeps the raw text while typing (so "12." or "" don't jump). */
export function NumInput({ value, onChange, className, disabled, placeholder, min, step, ariaLabel }: { value: string; onChange: (v: string) => void; className?: string; disabled?: boolean; placeholder?: string; min?: number; step?: string; ariaLabel?: string }) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      dir="ltr"
      min={min ?? 0}
      step={step ?? 'any'}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  );
}
