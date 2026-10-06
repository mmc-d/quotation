'use client';
import { useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';
import { UPLOAD_ACCEPT, uploadFile, type UploadedFile } from '@/lib/upload';
import { clsx } from './ui';

export type AttachmentMeta = Pick<UploadedFile, 'id' | 'url' | 'filename' | 'mime'>;

/** Thumbnails (images) and links (PDF) for stored files. Unknown ids still get a plain link. */
export function AttachmentList({ ids, files, onRemove, size = 'md', className }: {
  ids: string[];
  files?: Record<string, Partial<AttachmentMeta>> | null;
  onRemove?: (id: string) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { bi } = useI18n();
  if (!ids.length) return null;
  const box = size === 'sm' ? 'size-10' : 'size-16';
  return (
    <ul className={clsx('flex flex-wrap gap-1.5', className)}>
      {ids.map((id) => {
        const f = files?.[id];
        const url = f?.url ?? `/api/files/${id}`;
        const isImage = f?.mime ? f.mime.startsWith('image/') : false;
        return (
          <li key={id} className={clsx('relative shrink-0 overflow-hidden rounded-lg border border-line bg-tint/40', box)}>
            <a href={url} target="_blank" rel="noopener noreferrer" title={f?.filename ?? undefined} className="flex size-full items-center justify-center">
              {isImage
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={url} alt={f?.filename ?? ''} loading="lazy" className="size-full object-cover" />
                : <span className="flex flex-col items-center gap-0.5 px-0.5 text-primary"><FileText className="size-4" /><span dir="ltr" className="max-w-full truncate text-[9px]">{f?.mime === 'application/pdf' ? 'PDF' : bi('ملف', 'File')}</span></span>}
            </a>
            {onRemove && (
              <button type="button" onClick={() => onRemove(id)} className="absolute end-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white" aria-label={bi('إزالة المرفق', 'Remove attachment')}>
                <X className="size-3" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Upload photos / PDFs (POST /api/files) and keep the list of uploaded files. */
export function AttachmentPicker({ value, onChange, multiple = true, label, max = 30 }: {
  value: AttachmentMeta[];
  onChange: (v: AttachmentMeta[]) => void;
  multiple?: boolean;
  label?: string;
  max?: number;
}) {
  const { bi } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    let next = multiple ? [...value] : [];
    const files = [...list].slice(0, multiple ? Math.max(0, max - value.length) : 1);
    setBusy(files.length);
    for (const f of files) {
      try {
        const up = await uploadFile(f);
        next = multiple ? [...next, up] : [up];
        onChange(next);
      } catch (e) {
        const m = (e as Error).message;
        toast.error(m === 'too_large' ? bi(`${f.name}: الملف أكبر من 8 ميجابايت`, `${f.name}: larger than 8 MB`)
          : m === 'unsupported' ? bi(`${f.name}: يُقبل الصور وملفات PDF فقط`, `${f.name}: only images and PDF files are accepted`)
          : `${f.name}: ${m}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (input.current) input.current.value = '';
  };

  const files = Object.fromEntries(value.map((f) => [f.id, f]));
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept={UPLOAD_ACCEPT} multiple={multiple} className="hidden" onChange={(e) => void onFiles(e.target.files)} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy > 0 || (multiple && value.length >= max)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-xs font-bold text-primary hover:bg-tint disabled:opacity-50">
        {busy > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
        {busy > 0 ? bi('جارٍ الرفع…', 'Uploading…') : label ?? (multiple ? bi('إرفاق صور / PDF', 'Attach photos / PDF') : bi('إرفاق ملف', 'Attach a file'))}
      </button>
      <AttachmentList ids={value.map((f) => f.id)} files={files} onRemove={(id) => onChange(value.filter((f) => f.id !== id))} />
    </div>
  );
}
