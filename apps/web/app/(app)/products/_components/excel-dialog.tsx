'use client';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { readAsDataUrl } from '@/lib/upload';
import { useI18n } from '@/lib/i18n';
import { Button, Dialog, ErrorBox, Table, Td, Th, clsx } from '@/components/ui';

interface Issue { row: number; code?: string; ar: string; en: string }
interface Result {
  rows: number; created: number; updated: number; unchanged: number; newGroups: number; errors: Issue[]; warnings: Issue[]; applied: boolean;
  creates: { row: number; code: string; nameAr: string | null; listPrice: number | null }[];
  updates: { row: number; code: string; changes: { field: string; label: string; from: unknown; to: unknown }[] }[];
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'نعم' : 'لا') : String(v));

/** Download the products workbook (all products — the template) as a file. */
export async function downloadProductsExcel() {
  const res = await fetch('/api/products/excel/export', { credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `mmc-products-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}

/** Upload the edited workbook → preview (new / changed / errors) → apply. */
export function ExcelImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const t = (i: Issue) => `${bi('سطر', 'Row')} ${i.row}${i.code ? ` (${i.code})` : ''}: ${locale === 'en' ? i.en : i.ar}`;

  const reset = () => { setFile(null); setRes(null); setError(null); };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    reset();
    if (!/\.xlsx$/i.test(f.name)) { setError(new Error(bi('اختر ملف Excel بصيغة ‎.xlsx', 'Choose an Excel .xlsx file'))); return; }
    if (f.size > 10 * 1024 * 1024) { setError(new Error(bi('الملف أكبر من 10 ميجابايت', 'File larger than 10 MB'))); return; }
    const url = await readAsDataUrl(f);
    const data = url.slice(url.indexOf(',') + 1);
    setFile({ name: f.name, data });
    await run(data, false);
  };
  const run = async (data: string, apply: boolean) => {
    setBusy(apply ? 'apply' : 'preview'); setError(null);
    try {
      const r = await api.post<Result>('/products/excel/import', { data, apply });
      setRes(r);
      if (apply) {
        qc.invalidateQueries({ queryKey: ['products'] });
        toast.success(bi(`تم: ${r.created} منتج جديد و ${r.updated} تعديل`, `Done: ${r.created} new, ${r.updated} updated`));
      }
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const close = () => { reset(); onClose(); };
  const canApply = !!file && !!res && !res.applied && res.errors.length === 0 && res.created + res.updated > 0;

  return (
    <Dialog open={open} onClose={close} wide title={bi('رفع ملف Excel للمنتجات', 'Upload products Excel')}
      footer={<>
        <Button variant="outline" onClick={close}>{res?.applied ? bi('إغلاق', 'Close') : bi('إلغاء', 'Cancel')}</Button>
        {!res?.applied && <Button icon={<CheckCircle2 className="size-4" />} disabled={!canApply} loading={busy === 'apply'} onClick={() => file && run(file.data, true)}>{bi('تطبيق التغييرات', 'Apply changes')}</Button>}
      </>}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted">
          {bi('ارفع الملف الذي نزّلته من «تنزيل Excel» بعد التعديل. تُطابَق الصفوف بالكود: الكود الجديد يُضاف، والمتغيّر يُعدَّل، ولا يُحذف أي منتج. ستظهر معاينة قبل الحفظ.',
            'Upload the file from “Download Excel” after editing. Rows match by code: new codes are added, changed cells updated, nothing is deleted. You will see a preview first.')}
        </p>
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" icon={<Upload className="size-4" />} loading={busy === 'preview'} onClick={() => input.current?.click()}>{file ? bi('اختيار ملف آخر', 'Choose another file') : bi('اختيار ملف Excel', 'Choose Excel file')}</Button>
          {file && <span className="flex items-center gap-1 text-xs text-muted"><FileSpreadsheet className="size-4 text-ok" />{file.name}</span>}
        </div>
        <ErrorBox error={error} />
        {res && (
          <>
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
              {[
                [bi('صفوف', 'Rows'), res.rows, ''],
                [bi('جديد', 'New'), res.created, 'text-ok'],
                [bi('تعديل', 'Changed'), res.updated, 'text-gold-dark'],
                [bi('بدون تغيير', 'Unchanged'), res.unchanged, 'text-muted'],
                [bi('أخطاء', 'Errors'), res.errors.length, res.errors.length ? 'text-danger' : 'text-muted'],
              ].map(([l, n, c]) => (
                <div key={String(l)} className="rounded-lg border border-line bg-tint/30 p-2"><div className={clsx('num text-xl font-extrabold', c as string)}>{n as number}</div><div className="text-[11px] text-muted">{l as string}</div></div>
              ))}
            </div>
            {res.applied && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{bi('تم حفظ التغييرات في النظام.', 'The changes were saved.')}</div>}
            {res.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                <b>{bi('صحّح هذه الأخطاء في الملف ثم ارفعه مرة أخرى:', 'Fix these in the file and upload again:')}</b>
                <ul className="mt-1 list-disc space-y-0.5 ps-5">{res.errors.map((e, i) => <li key={i}>{t(e)}</li>)}</ul>
              </div>
            )}
            {res.warnings.length > 0 && (
              <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <summary className="cursor-pointer font-bold">{bi(`تنبيهات (${res.warnings.length})`, `Warnings (${res.warnings.length})`)}</summary>
                <ul className="mt-1 list-disc space-y-0.5 ps-5">{res.warnings.map((e, i) => <li key={i}>{t(e)}</li>)}</ul>
              </details>
            )}
            {res.creates.length > 0 && (
              <details open={res.creates.length <= 20} className="rounded-lg border border-line">
                <summary className="cursor-pointer px-3 py-2 text-sm font-bold">{bi(`منتجات جديدة (${res.created})`, `New products (${res.created})`)}</summary>
                <div className="max-h-60 overflow-y-auto">
                  <Table>
                    <thead><tr><Th>{bi('سطر', 'Row')}</Th><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th className="text-end">{bi('السعر', 'Price')}</Th></tr></thead>
                    <tbody>{res.creates.map((c) => <tr key={c.code}><Td className="num text-muted">{c.row}</Td><Td><span dir="ltr" className="num font-bold">{c.code}</span></Td><Td className="max-w-[18rem] truncate text-xs">{c.nameAr}</Td><Td className="num text-end">{show(c.listPrice)}</Td></tr>)}</tbody>
                  </Table>
                </div>
              </details>
            )}
            {res.updates.length > 0 && (
              <details open={res.updates.length <= 20} className="rounded-lg border border-line">
                <summary className="cursor-pointer px-3 py-2 text-sm font-bold">{bi(`تعديلات (${res.updated})`, `Changes (${res.updated})`)}</summary>
                <div className="max-h-60 overflow-y-auto">
                  <Table>
                    <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الحقل', 'Field')}</Th><Th>{bi('من', 'From')}</Th><Th>{bi('إلى', 'To')}</Th></tr></thead>
                    <tbody>{res.updates.flatMap((u) => u.changes.map((c, i) => (
                      <tr key={`${u.code}-${c.field}`}>
                        <Td>{i === 0 && <span dir="ltr" className="num font-bold">{u.code}</span>}</Td><Td className="text-xs">{c.label}</Td>
                        <Td className="max-w-[12rem] truncate text-xs text-muted line-through">{show(c.from)}</Td><Td className="max-w-[12rem] truncate text-xs font-bold">{show(c.to)}</Td>
                      </tr>
                    )))}</tbody>
                  </Table>
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
