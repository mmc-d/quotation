'use client';
/**
 * AI-01 BOQ → draft quote. Upload an Excel/CSV/PDF BOQ or paste rows → the AI suggests up to 3
 * catalog products per row with confidence → the user reviews every line → "Create draft quote"
 * (needs quote.write + ai.approve). The AI never creates the quote by itself.
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, FileSpreadsheet, FileText, Sparkles, Upload, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { readAsDataUrl } from '@/lib/upload';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { Badge, Button, Card, Checkbox, clsx, Empty, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';

interface Match { productCode: string; confidence: number; reason: string }
interface Row { ref: string; description: string; qty: number; unit?: string; matches: Match[]; suggestedLabour?: boolean; notes: string }
interface Draft {
  id: string; status: string; createdAt: string; appliedEntityId: string | null;
  payload: { rows: Row[]; partyId: string | null; sandbox: boolean; source: { kind: string; filename: string | null }; droppedCodes?: string[] };
  products: Record<string, { id: string; nameAr: string; nameEn: string | null; listPrice: string; uom: string }>;
  party: { id: string; nameAr: string; nameEn: string | null } | null;
}
interface DraftRow { id: string; status: string; createdAt: string; createdByName: string | null; rows: number; source: { kind: string; filename: string | null } | null; sandbox: boolean }
interface LineState { code: string; other: string; qty: string; include: boolean }

const MAX_BYTES = 3.5 * 1024 * 1024;
const OTHER = '__other__';

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return <Badge tone={value >= 0.85 ? 'green' : value >= 0.5 ? 'gold' : 'red'}><span className="num">{pct}%</span></Badge>;
}

function BoqPage() {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const draftId = sp.get('draft');
  const [party, setParty] = useState<PickedParty | null>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<LineState[]>([]);

  const draft = useQuery({ queryKey: ['ai-draft', draftId], queryFn: () => api.get<Draft>(`/ai/drafts/${draftId}`), enabled: !!draftId });
  const recent = useQuery({ queryKey: ['ai-drafts'], queryFn: () => api.get<DraftRow[]>(`/ai/drafts${qs({ status: 'pending' })}`) });
  const d = draft.data;

  // initial review state: the top suggestion, included when reasonably confident
  useEffect(() => {
    if (!d) return;
    setLines(d.payload.rows.map((r) => ({ code: r.matches[0]?.productCode ?? '', other: '', qty: String(r.qty), include: !!r.matches[0] && r.matches[0].confidence >= 0.5 })));
    if (d.party && !party) setParty({ id: d.party.id, nameAr: d.party.nameAr, nameEn: d.party.nameEn, phone: null, email: null, vatNumber: null });
  }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useMutation({
    mutationFn: async () => {
      if (file) {
        if (file.size > MAX_BYTES) throw new Error(bi('الملف أكبر من 3.5 ميجابايت', 'The file is larger than 3.5 MB'));
        const url = await readAsDataUrl(file);
        const contentType = file.type || (/\.csv$/i.test(file.name) ? 'text/csv' : /\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return api.post<Draft>('/ai/boq', { file: { name: file.name, contentType, data: url.slice(url.indexOf(',') + 1) }, partyId: party?.id ?? null });
      }
      return api.post<Draft>('/ai/boq', { text, partyId: party?.id ?? null });
    },
    onSuccess: (r) => { qc.setQueryData(['ai-draft', r.id], r); qc.invalidateQueries({ queryKey: ['ai-drafts'] }); router.push(`/ai/boq?draft=${r.id}`); },
  });
  const apply = useMutation({
    mutationFn: () => api.post<{ quoteId: string }>(`/ai/drafts/${draftId}/apply`, {
      partyId: party?.id ?? null,
      title: title.trim() || null,
      lines: d!.payload.rows.map((r, i) => {
        const l = lines[i]!;
        const code = l.code === OTHER ? l.other.trim() : l.code;
        return { ref: r.ref, productCode: code || '-', qty: Number(l.qty) || 0, include: l.include && !!code && Number(l.qty) > 0 };
      }),
    }),
    onSuccess: (r) => { toast.success(bi('أُنشئ عرض سعر مسودة — راجعه قبل الإرسال', 'Draft quote created — review it before sending')); qc.invalidateQueries({ queryKey: ['ai-drafts'] }); router.push(`/quotes/${r.quoteId}`); },
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/ai/drafts/${draftId}/reject`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-drafts'] }); router.push('/ai/boq'); },
  });

  const set = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const included = lines.filter((l) => l.include).length;
  const estimate = useMemo(() => {
    if (!d) return 0;
    return lines.reduce((s, l) => {
      const p = l.include && l.code !== OTHER ? d.products[l.code] : undefined;
      return s + (p ? Number(p.listPrice) * (Number(l.qty) || 0) : 0);
    }, 0);
  }, [d, lines]);
  const canApply = can('ai.approve') && can('quote.write');
  const pname = (code: string) => { const p = d?.products[code]; return p ? (locale === 'en' ? p.nameEn || p.nameAr : p.nameAr) : code; };

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2"><Sparkles className="size-5 text-gold" />{bi('من جدول الكميات إلى عرض سعر', 'BOQ → quote')}</span>}
        subtitle={bi('ارفع جدول الكميات (Excel / CSV / PDF) أو الصق البنود — يقترح الذكاء الاصطناعي منتجات من الكتالوج وتراجعها أنت سطرًا سطرًا.', 'Upload a BOQ (Excel / CSV / PDF) or paste the rows — AI suggests catalog products and you review every line.')}
        actions={draftId ? <Button variant="outline" icon={<X className="size-4" />} onClick={() => router.push('/ai/boq')}>{bi('جدول جديد', 'New BOQ')}</Button> : undefined}
      />

      {!draftId && (
        <Card title={bi('جدول الكميات', 'Bill of quantities')}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label={bi('العميل (اختياري)', 'Customer (optional)')}><PartyPicker value={party} onChange={setParty} /></Field>
              <Field label={bi('ملف', 'File')} hint={bi('Excel ‎.xlsx أو CSV — ملفات PDF تتطلب تشغيل الذكاء الاصطناعي الفعلي.', 'Excel .xlsx or CSV — PDFs need the live AI.')}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-sm hover:bg-tint/50">
                  <Upload className="size-4 text-gold" />
                  <span className="flex-1 truncate">{file ? file.name : bi('اختر ملفًا…', 'Choose a file…')}</span>
                  {file && <button type="button" onClick={(e) => { e.preventDefault(); setFile(null); }} className="rounded p-0.5 text-muted hover:bg-black/5" aria-label={bi('إزالة', 'Remove')}><X className="size-4" /></button>}
                  <input type="file" className="hidden" accept=".xlsx,.csv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                </label>
              </Field>
            </div>
            <Field label={bi('أو الصق البنود', 'Or paste the rows')} hint={bi('سطر لكل بند، مثل: «1.1 كاميرا قبة 4 ميجا - 12» أو انسخ الجدول من Excel مباشرة.', 'One item per line, e.g. “1.1 IP dome camera 4MP - 12”, or copy the table straight from Excel.')}>
              <Textarea rows={8} value={text} disabled={!!file} onChange={(e) => setText(e.target.value)} placeholder={'1.1\tIP dome camera 4MP\t12\tNos\n1.2\tNVR 8 channel\t1\tNos'} />
            </Field>
          </div>
          <ErrorBox error={run.error} />
          <div className="mt-3 flex justify-end">
            <Button variant="gold" loading={run.isPending} disabled={!file && !text.trim()} icon={<Sparkles className="size-4" />} onClick={() => run.mutate()}>{bi('حلّل وطابق مع الكتالوج', 'Analyse and match the catalog')}</Button>
          </div>
        </Card>
      )}

      {draftId && draft.isLoading && <Spinner />}
      {draftId && draft.error && <ErrorBox error={draft.error} />}
      {d && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="flex-1">{bi('اقتراح من الذكاء الاصطناعي — راجع كل سطر (المنتج والكمية) قبل إنشاء العرض.', 'AI suggestion — review every line (product and quantity) before creating the quote.')}</span>
            {d.payload.sandbox && <Badge tone="blue">{bi('وضع تجريبي — مطابقة بسيطة بدون ذكاء اصطناعي', 'Sandbox — simple matching, no AI')}</Badge>}
            {d.status !== 'pending' && <Badge tone="gray">{d.status === 'applied' ? bi('تم إنشاء العرض', 'Quote created') : bi('مرفوض', 'Rejected')}</Badge>}
          </div>
          <Card
            title={<span className="flex items-center gap-2">{d.payload.source.kind === 'text' ? <FileText className="size-4 text-gold" /> : <FileSpreadsheet className="size-4 text-gold" />}{d.payload.source.filename ?? bi('بنود ملصقة', 'Pasted rows')} · {bi(`${d.payload.rows.length} بند`, `${d.payload.rows.length} rows`)}</span>}
            padded={false}
          >
            <Table>
              <thead>
                <tr>
                  <Th className="w-10">{bi('تضمين', 'Use')}</Th>
                  <Th>{bi('البند', 'Ref')}</Th>
                  <Th>{bi('وصف جدول الكميات', 'BOQ description')}</Th>
                  <Th className="min-w-72">{bi('المنتج المقترح', 'Suggested product')}</Th>
                  <Th className="w-24">{bi('الكمية', 'Qty')}</Th>
                </tr>
              </thead>
              <tbody>
                {d.payload.rows.map((r, i) => {
                  const l = lines[i];
                  if (!l) return null;
                  const chosen = r.matches.find((m) => m.productCode === l.code);
                  const unmatched = !r.matches.length;
                  return (
                    <tr key={i} className={clsx(unmatched && 'bg-amber-50/70', !l.include && 'opacity-60')}>
                      <Td><Checkbox label="" checked={l.include} disabled={d.status !== 'pending'} onChange={(v) => set(i, { include: v })} /></Td>
                      <Td><span className="num text-xs">{r.ref || '—'}</span></Td>
                      <Td>
                        <p className="text-sm">{r.description}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.unit && <Badge>{r.unit}</Badge>}
                          {r.suggestedLabour && <Badge tone="blue">{bi('أعمال تركيب', 'Labour')}</Badge>}
                          {unmatched && <Badge tone="red">{bi('لا يوجد تطابق', 'No match')}</Badge>}
                        </div>
                        {r.notes && <p className="mt-1 text-xs text-muted">{r.notes}</p>}
                      </Td>
                      <Td>
                        <Select value={l.code} disabled={d.status !== 'pending'} onChange={(e) => set(i, { code: e.target.value, include: !!e.target.value })}>
                          <option value="">{bi('— بدون منتج —', '— no product —')}</option>
                          {r.matches.map((m) => <option key={m.productCode} value={m.productCode}>{`${m.productCode} · ${pname(m.productCode)} (${Math.round(m.confidence * 100)}%)`}</option>)}
                          <option value={OTHER}>{bi('رمز منتج آخر…', 'Other product code…')}</option>
                        </Select>
                        {l.code === OTHER && <Input className="mt-1" dir="ltr" value={l.other} placeholder={bi('رمز المنتج', 'Product code')} onChange={(e) => set(i, { other: e.target.value, include: !!e.target.value.trim() })} />}
                        {chosen && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <ConfidenceBadge value={chosen.confidence} />
                            <span>{chosen.reason}</span>
                            {d.products[chosen.productCode] && <span className="ms-auto"><Money value={d.products[chosen.productCode]!.listPrice} /></span>}
                          </div>
                        )}
                      </Td>
                      <Td><Input type="number" min={0} step="any" dir="ltr" value={l.qty} disabled={d.status !== 'pending'} onChange={(e) => set(i, { qty: e.target.value })} /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {d.status === 'pending' && (
            <Card className="mt-3" title={bi('إنشاء عرض سعر مسودة', 'Create a draft quote')}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={bi('العميل', 'Customer')}><PartyPicker value={party} onChange={setParty} /></Field>
                <Field label={bi('اسم المشروع', 'Project name')}><Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} /></Field>
              </div>
              <p className="mt-3 text-sm text-muted">
                {bi(`${included} سطر مُضمَّن · تقدير بسعر القائمة: `, `${included} lines included · list-price estimate: `)}<Money value={estimate} fixed />
                {' · '}{bi('الأسعار وخصومات العميل وسطر التركيب تُحسب في محرر العرض.', 'Prices, customer discounts and the installation line are calculated in the quote editor.')}
              </p>
              {!canApply && <p className="mt-2 text-sm text-amber-800">{bi('يتطلب إنشاء العرض صلاحية اعتماد مقترحات الذكاء الاصطناعي — اطلب من مديرك فتح هذه الصفحة واعتمادها.', 'Creating the quote needs the “approve AI suggestions” permission — ask your manager to open this page and approve it.')}</p>}
              <ErrorBox error={apply.error ?? reject.error} />
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" loading={reject.isPending} onClick={() => reject.mutate()}>{bi('رفض الاقتراح', 'Reject suggestion')}</Button>
                <Button loading={apply.isPending} disabled={!canApply || !included} onClick={() => apply.mutate()}>{bi('إنشاء عرض سعر مسودة', 'Create draft quote')}</Button>
              </div>
            </Card>
          )}
        </>
      )}

      {!draftId && (
        <Card className="mt-3" title={bi('مقترحات بانتظار المراجعة', 'Suggestions awaiting review')} padded={false}>
          {recent.isLoading ? <Spinner /> : !recent.data?.length ? <Empty title={bi('لا توجد مقترحات معلّقة', 'No pending suggestions')} /> : (
            <Table>
              <thead><tr><Th>{bi('المصدر', 'Source')}</Th><Th>{bi('البنود', 'Rows')}</Th><Th>{bi('بواسطة', 'By')}</Th><Th>{bi('التاريخ', 'Date')}</Th></tr></thead>
              <tbody>
                {recent.data.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-tint/40" onClick={() => router.push(`/ai/boq?draft=${r.id}`)}>
                    <Td>{r.source?.filename ?? bi('بنود ملصقة', 'Pasted rows')} {r.sandbox && <Badge tone="blue">{bi('تجريبي', 'Sandbox')}</Badge>}</Td>
                    <Td><span className="num">{r.rows}</span></Td>
                    <Td>{r.createdByName ?? '—'}</Td>
                    <Td><span className="num">{dateTime(r.createdAt)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><BoqPage /></Suspense>;
}
