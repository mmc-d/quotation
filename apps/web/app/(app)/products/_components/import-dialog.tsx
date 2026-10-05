'use client';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, FileUp } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Checkbox, Dialog, ErrorBox, Field, Input, Table, Td, Textarea, Th } from '@/components/ui';
import { num } from './types';

interface Preview { count: number; errors: string[]; sample: { code: string; description: string; price: string; install: string; costUsd: string | null }[] }
interface Result { created: number; updated: number; errors: string[] }

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reset = () => { setCsv(''); setFileName(null); setRate(''); setHasHeader(true); setPreview(null); setResult(null); setError(null); if (fileRef.current) fileRef.current.value = ''; };
  const close = () => { reset(); onClose(); };
  const rateErr = rate && !/^\d+(\.\d{1,4})?$/.test(rate.trim()) ? 'رقم موجب حتى 4 منازل عشرية' : null;
  const body = (dryRun: boolean) => ({ csv, hasHeader, dryRun, ...(rate.trim() ? { cnyPerUsd: rate.trim() } : {}) });

  const pick = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setCsv(String(r.result ?? '').replace(/^﻿/, '')); setFileName(f.name); setPreview(null); setResult(null); };
    r.onerror = () => toast.error('تعذّرت قراءة الملف');
    r.readAsText(f, 'utf-8');
  };

  const runPreview = async () => {
    setBusy('preview'); setError(null); setResult(null);
    try { setPreview(await api.post<Preview>('/products/import', body(true))); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const runImport = async () => {
    setBusy('import'); setError(null);
    try {
      const r = await api.post<Result>('/products/import', body(false));
      setResult(r);
      toast.success(`تم الاستيراد: ${r.created} جديد، ${r.updated} محدّث`);
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (e) { setError(e); } finally { setBusy(null); }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title="استيراد المنتجات من الشيت"
      footer={result ? <Button onClick={close}>تم</Button> : <>
        <Button variant="outline" onClick={close}>إلغاء</Button>
        <Button variant="outline" onClick={runPreview} loading={busy === 'preview'} disabled={!csv.trim() || !!rateErr || busy === 'import'}>معاينة</Button>
        <Button onClick={runImport} loading={busy === 'import'} disabled={!preview || preview.count === 0 || !!rateErr || busy === 'preview'}>استيراد</Button>
      </>}
    >
      {result ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="size-10 text-ok" />
          <p className="text-lg font-extrabold text-primary">اكتمل الاستيراد</p>
          <p className="text-sm"><b className="num">{result.created}</b> منتج جديد · <b className="num">{result.updated}</b> منتج محدّث</p>
          {result.errors.length > 0 && <ul className="mt-2 list-inside list-disc text-start text-xs text-danger">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-gold/40 bg-tint/60 p-3 text-xs leading-relaxed text-ink">
            <b className="text-gold-dark">الأعمدة المتوقعة (نفس ترتيب شيت Products القديم):</b>
            <div className="mt-1">A رقم القطعة · B الوصف «عربي | English» · C السعر · D التركيب · E سعر الشراء بالدولار</div>
            <div className="mt-1 text-muted">صف INS يُتجاهل (يُحسب تلقائيًا). الأكواد الموجودة تُحدَّث، والجديدة تُضاف. من Google Sheets: ملف ← تنزيل ← CSV.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <Button type="button" variant="outline" icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()}>اختيار ملف CSV</Button>
            {fileName && <span className="text-xs text-muted" dir="ltr">{fileName}</span>}
          </div>
          <Field label="أو الصق محتوى CSV هنا">
            <Textarea rows={6} dir="ltr" className="font-mono text-xs" value={csv} onChange={(e) => { setCsv(e.target.value); setFileName(null); setPreview(null); }} placeholder={'Part No,Description,Price,Installation,Cost USD\nDS-KH6320,"شاشة داخلية 7 بوصة | 7in Indoor Station",450,50,38.5'} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="سعر اليوان مقابل الدولار (الخلية I2)" hint="اختياري — يُحفظ كسعر صرف USD→CNY" error={rateErr}>
              <Input dir="ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="7.10" />
            </Field>
            <div className="flex items-end pb-2"><Checkbox label="يحتوي على صف عناوين" checked={hasHeader} onChange={(v) => { setHasHeader(v); setPreview(null); }} /></div>
          </div>
          <ErrorBox error={error} />
          {preview && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3 text-sm">
                <span>عدد الأصناف: <b className="num">{preview.count}</b></span>
                {preview.errors.length > 0 && <span className="text-danger">أخطاء: <b className="num">{preview.errors.length}</b></span>}
              </div>
              {preview.errors.length > 0 && <ul className="max-h-28 list-inside list-disc overflow-y-auto rounded-lg bg-rose-50 p-2 text-xs text-danger">{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              {preview.sample.length > 0 && (
                <Table className="rounded-lg border border-line">
                  <thead><tr><Th>الكود</Th><Th>الوصف</Th><Th>السعر</Th><Th>التركيب</Th><Th>الشراء $</Th></tr></thead>
                  <tbody>
                    {preview.sample.map((r, i) => (
                      <tr key={`${r.code}-${i}`}>
                        <Td className="num text-xs" ><span dir="ltr">{r.code}</span></Td>
                        <Td className="max-w-xs truncate text-xs">{r.description || <span className="text-danger">—</span>}</Td>
                        <Td className="num text-xs">{num(r.price)}</Td>
                        <Td className="num text-xs">{num(r.install)}</Td>
                        <Td className="num text-xs">{num(r.costUsd)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {preview.count > preview.sample.length && <p className="text-xs text-muted">تُعرض أول {preview.sample.length} صفوف فقط.</p>}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
