'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Hash, Pencil, Plus, ScrollText, MessageSquareText } from 'lucide-react';
import { formatSeries } from '@mmc/domain';
import { api } from '@/lib/api';
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th } from '@/components/ui';
import { InfoNote, RequirePerm } from '../_components/common';
import { useI18n } from '@/lib/i18n';

type Tab = 'numbering' | 'clauses' | 'templates';

export default function DocumentsSettingsPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="admin.settings" title={bi('المستندات والترقيم', 'Documents & numbering')}><DocumentsSettings /></RequirePerm>;
}

function DocumentsSettings() {
  const { bi } = useI18n();
  const [tab, setTab] = useState<Tab>('numbering');
  return (
    <>
      <PageHeader title={bi('المستندات والترقيم', 'Documents & numbering')} subtitle={bi('أنماط الترقيم، بنود العقود، وقوالب الرسائل', 'Numbering patterns, contract clauses and message templates')} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'numbering', label: bi('الترقيم', 'Numbering') }, { value: 'clauses', label: bi('بنود العقود', 'Contract clauses') }, { value: 'templates', label: bi('قوالب الرسائل', 'Message templates') }]} />
      {tab === 'numbering' && <Numbering />}
      {tab === 'clauses' && <Clauses />}
      {tab === 'templates' && <Templates />}
    </>
  );
}

/* ───────────── Numbering ───────────── */

interface Series { id: string; document_type: string; pattern: string; reset: string; start_at: number; last_value: number | string }

const DOC_AR: Record<string, string> = { quote: 'عروض الأسعار', contract: 'العقود', invoice: 'الفواتير', payment_request: 'طلبات الدفع', change_order: 'أوامر التغيير', lead: 'العملاء المحتملون' };
const RESET_AR: Record<string, string> = { never: 'لا يُعاد (تسلسل مستمر)', daily: 'يوميًا', yearly: 'سنويًا', monthly: 'شهريًا' };
const DOC_EN: Record<string, string> = { quote: 'Quotes', contract: 'Contracts', invoice: 'Invoices', payment_request: 'Payment requests', change_order: 'Change orders', lead: 'Leads' };
const RESET_EN: Record<string, string> = { never: 'Never (continuous sequence)', daily: 'Daily', yearly: 'Yearly', monthly: 'Monthly' };

/** Next sequence the server would allocate (for period resets: the first number of a fresh period). */
function nextSeq(s: { reset: string; start_at: number; last_value: number | string }, startAt = s.start_at): number {
  const last = Number(s.last_value) || 0;
  return s.reset === 'never' ? Math.max(last + 1, startAt) : Math.max(startAt, 1);
}

function preview(pattern: string, seq: number): string {
  try { return formatSeries(pattern, seq); } catch { return '—'; }
}

function Numbering() {
  const { bi, locale } = useI18n();
  const q = useQuery({ queryKey: ['numbering'], queryFn: () => api.get<Series[]>('/settings/numbering') });
  const [edit, setEdit] = useState<Series | null>(null);
  return (
    <div className="space-y-3">
      <InfoNote>{bi('الأرقام لا تُعاد ولا تُستخدم مرتين: يمكن تقديم بداية التسلسل للأمام (مثلًا لمواصلة أرقام الأداة القديمة) لكن لا يمكن إرجاعها للخلف أبدًا.', 'Numbers are never reset or reused: the sequence start can be moved forward (e.g. to continue the old tool’s numbers) but never backward.')}</InfoNote>
      <Card padded={false}>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty icon={<Hash className="size-8" />} title={bi('لا توجد سلاسل ترقيم', 'No numbering series')} /> : (
          <Table>
            <thead><tr><Th>{bi('المستند', 'Document')}</Th><Th>{bi('النمط', 'Pattern')}</Th><Th>{bi('إعادة الترقيم', 'Reset')}</Th><Th>{bi('آخر رقم', 'Last number')}</Th><Th>{bi('الرقم التالي (تقريبي)', 'Next number (approx.)')}</Th><Th /></tr></thead>
            <tbody>
              {q.data.map((s) => (
                <tr key={s.id} className="hover:bg-tint/50">
                  <Td className="font-bold">{(locale === 'en' ? DOC_EN : DOC_AR)[s.document_type] ?? s.document_type}</Td>
                  <Td><code dir="ltr" className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{s.pattern}</code></Td>
                  <Td className="text-xs">{(locale === 'en' ? RESET_EN : RESET_AR)[s.reset] ?? s.reset}</Td>
                  <Td className="num">{Number(s.last_value) || '—'}</Td>
                  <Td className="num text-xs"><span dir="ltr">{preview(s.pattern, nextSeq(s))}</span></Td>
                  <Td className="text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(s)}>{bi('تعديل', 'Edit')}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {edit && <NumberingDialog series={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function NumberingDialog({ series, onClose }: { series: Series; onClose: () => void }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const [pattern, setPattern] = useState(series.pattern);
  const [startAt, setStartAt] = useState(String(series.start_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const start = Number(startAt);
  const patternErr = !/\{SEQ(:\d+)?\}/.test(pattern) ? bi('يجب أن يحتوي النمط على {SEQ} أو {SEQ:n}', 'The pattern must contain {SEQ} or {SEQ:n}') : null;
  const startErr = !Number.isInteger(start) || start < 1 ? bi('عدد صحيح ≥ 1', 'Whole number ≥ 1') : start < series.start_at ? bi(`لا يمكن الرجوع عن ${series.start_at} — سيُحفظ ${series.start_at}`, `Cannot go back below ${series.start_at} — ${series.start_at} will be saved`) : null;
  const effectiveStart = Math.max(series.start_at, Number.isInteger(start) ? start : series.start_at);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put(`/settings/numbering/${series.id}`, { pattern: pattern.trim(), startAt: effectiveStart });
      toast.success(bi('تم حفظ نمط الترقيم', 'Numbering pattern saved'));
      qc.invalidateQueries({ queryKey: ['numbering'] });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const tokens = ['{YY}', '{YYYY}', '{MM}', '{WW}', '{DD}', '{SEQ}', '{SEQ:4}', '{SEQ:5}'];
  return (
    <Dialog open onClose={onClose} title={bi(`ترقيم ${DOC_AR[series.document_type] ?? series.document_type}`, `Numbering: ${DOC_EN[series.document_type] ?? series.document_type}`)} footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={busy} disabled={!!patternErr || !Number.isInteger(start) || start < 1} onClick={save}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="space-y-3">
        <Field label={bi('النمط', 'Pattern')} error={patternErr}><Input dir="ltr" className="font-mono" value={pattern} onChange={(e) => setPattern(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-1">
          {tokens.map((t) => <button key={t} type="button" onClick={() => setPattern((p) => p + t)} className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] hover:bg-tint" dir="ltr">{t}</button>)}
        </div>
        <p className="text-xs text-muted">{locale === 'en'
          ? <>{'{YY}'} 2-digit year · {'{YYYY}'} full year · {'{MM}'} month · {'{WW}'} week number · {'{DD}'} day · {'{SEQ}'} sequence · {'{SEQ:5}'} 5-digit sequence (00042). Dates use Riyadh time.</>
          : <>{'{YY}'} السنة برقمين · {'{YYYY}'} السنة كاملة · {'{MM}'} الشهر · {'{WW}'} رقم الأسبوع · {'{DD}'} اليوم · {'{SEQ}'} التسلسل · {'{SEQ:5}'} التسلسل بخمس خانات (00042). التاريخ بتوقيت الرياض.</>}</p>
        <Field label={bi('يبدأ التسلسل من', 'Sequence starts at')} error={startErr} hint={bi(`الحالي: ${series.start_at} · آخر رقم صادر: ${Number(series.last_value) || 0}`, `Current: ${series.start_at} · Last issued: ${Number(series.last_value) || 0}`)}>
          <Input type="number" min={series.start_at} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </Field>
        <div className="rounded-lg border border-primary/20 bg-primary-50 p-3 text-center">
          <div className="text-xs text-muted">{series.reset === 'never' ? bi('الرقم التالي سيكون', 'The next number will be') : bi('أول رقم في الفترة الجديدة', 'First number of the new period')}</div>
          <div className="mt-1 font-mono text-lg font-extrabold text-primary" dir="ltr">{patternErr ? '—' : preview(pattern, nextSeq(series, effectiveStart))}</div>
        </div>
        <InfoNote tone="amber">{bi('يمكن تقديم الأرقام للأمام فقط، ولا ترجع للخلف أبدًا (الأرقام الصادرة لا يُعاد استخدامها). تغيير النمط لا يغيّر أرقام المستندات الصادرة سابقًا.', 'Numbers can only move forward, never backward (issued numbers are never reused). Changing the pattern does not change previously issued document numbers.')}</InfoNote>
        <ErrorBox error={error} />
      </div>
    </Dialog>
  );
}

/* ───────────── Contract clauses ───────────── */

interface Clause { id: string; key: string; category: string; titleAr: string; bodyAr: string; titleEn: string | null; bodyEn: string | null; sort: number; active: boolean; clauseVersion: number; templateSet: TemplateSet }

type TemplateSet = 'supply_install' | 'supply_only' | 'maintenance';
const TEMPLATE_SETS: { value: TemplateSet; label: string; hint: string; labelEn: string; hintEn: string }[] = [
  { value: 'supply_install', label: 'توريد وتركيب', hint: 'العقد الافتراضي: توريد المواد وتركيبها وبرمجتها.', labelEn: 'Supply & installation', hintEn: 'Default contract: supply, installation and programming of the materials.' },
  { value: 'supply_only', label: 'توريد فقط', hint: 'توريد دون تركيب أو برمجة؛ الضمان على المواد فقط.', labelEn: 'Supply only', hintEn: 'Supply without installation or programming; warranty covers materials only.' },
  { value: 'maintenance', label: 'عقد صيانة سنوي', hint: 'زيارات وقائية، أوقات استجابة، استثناءات، مدة 12 شهرًا وتجديد.', labelEn: 'Annual maintenance contract', hintEn: 'Preventive visits, response times, exclusions, 12-month term and renewal.' },
];

const CATEGORY_AR: Record<string, string> = { general: 'عام', scope: 'نطاق العمل', payment: 'الدفع', warranty: 'الضمان', delivery: 'التوريد والتنفيذ', obligations: 'الالتزامات', termination: 'الإنهاء', disputes: 'النزاعات', other: 'أخرى' };
const CATEGORY_EN: Record<string, string> = { general: 'General', scope: 'Scope of work', payment: 'Payment', warranty: 'Warranty', delivery: 'Supply & execution', obligations: 'Obligations', termination: 'Termination', disputes: 'Disputes', other: 'Other' };

function Clauses() {
  const { bi, locale } = useI18n();
  const q = useQuery({ queryKey: ['clauses'], queryFn: () => api.get<Clause[]>('/settings/clauses') });
  const [edit, setEdit] = useState<Clause | 'new' | null>(null);
  const [set, setSet] = useState<TemplateSet>('supply_install');
  const all = q.data ?? [];
  const rows = all.filter((c) => (c.templateSet ?? 'supply_install') === set).sort((a, b) => a.sort - b.sort);
  return (
    <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={bi('قالب العقد', 'Contract template')}>
      {TEMPLATE_SETS.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={set === t.value} onClick={() => setSet(t.value)}
          className={`rounded-full border px-3 py-1.5 text-sm font-bold ${set === t.value ? 'border-primary bg-primary text-white' : 'border-line bg-white hover:bg-tint'}`}>
          {locale === 'en' ? t.labelEn : t.label} <span className="num text-xs opacity-75">({all.filter((c) => (c.templateSet ?? 'supply_install') === t.value).length})</span>
        </button>
      ))}
    </div>
    <InfoNote>{locale === 'en'
      ? <>{TEMPLATE_SETS.find((t) => t.value === set)?.hintEn} Active clauses are copied from the template into the contract when it is created from a quote, or when the template of a draft contract is changed. A clause whose title contains «المواصفات» is printed with the items table, and the payments article is printed automatically after the clause whose title contains «نطاق».</>
      : <>{TEMPLATE_SETS.find((t) => t.value === set)?.hint} تُنسخ البنود المفعّلة من القالب إلى العقد عند إنشائه من العرض أو عند تغيير قالب العقد وهو مسودة. البند الذي عنوانه يحتوي «المواصفات» يُطبع معه جدول البنود، وبعد البند الذي عنوانه يحتوي «نطاق» تُطبع مادة الدفعات تلقائيًا.</>}</InfoNote>
    <Card padded={false} title={bi(`بنود العقود — ${TEMPLATE_SETS.find((t) => t.value === set)?.label}`, `Contract clauses — ${TEMPLATE_SETS.find((t) => t.value === set)?.labelEn}`)} actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>{bi('بند جديد', 'New clause')}</Button>}>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<ScrollText className="size-8" />} title={bi('لا توجد بنود', 'No clauses')} /> : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3 hover:bg-tint/40">
              <span className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-tint text-xs font-bold text-gold-dark">{c.sort}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm text-primary">{c.titleAr}</b>
                  <Badge>{(locale === 'en' ? CATEGORY_EN : CATEGORY_AR)[c.category] ?? c.category}</Badge>
                  <span className="text-[11px] text-muted" dir="ltr">{c.key} · v{c.clauseVersion}</span>
                  {!c.active && <Badge tone="red">{bi('غير مفعّل', 'Inactive')}</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-muted">{c.bodyAr}</p>
              </div>
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(c)}>{bi('تعديل', 'Edit')}</Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <ClauseDialog clause={edit === 'new' ? null : edit} defaultSet={set} nextSort={(rows.at(-1)?.sort ?? 0) + 10} onClose={() => setEdit(null)} />}
    </Card>
    </div>
  );
}

function ClauseDialog({ clause, nextSort, defaultSet, onClose }: { clause: Clause | null; nextSort: number; defaultSet: TemplateSet; onClose: () => void }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({ templateSet: clause?.templateSet ?? defaultSet, key: clause?.key ?? '', category: clause?.category ?? 'general', titleAr: clause?.titleAr ?? '', bodyAr: clause?.bodyAr ?? '', titleEn: clause?.titleEn ?? '', bodyEn: clause?.bodyEn ?? '', sort: String(clause?.sort ?? nextSort), active: clause?.active ?? true });
  const [showEn, setShowEn] = useState(!!(clause?.titleEn || clause?.bodyEn));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid = f.key.trim() && f.category.trim() && f.titleAr.trim() && f.bodyAr.trim() && /^-?\d+$/.test(f.sort);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put(`/settings/clauses/${clause?.id ?? 'new'}`, { templateSet: f.templateSet, key: f.key.trim(), category: f.category, titleAr: f.titleAr.trim(), bodyAr: f.bodyAr, titleEn: f.titleEn.trim() || null, bodyEn: f.bodyEn.trim() || null, sort: Number(f.sort), active: f.active });
      toast.success(bi('تم حفظ البند', 'Clause saved'));
      qc.invalidateQueries({ queryKey: ['clauses'] });
      qc.invalidateQueries({ queryKey: ['clause-templates'] });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} wide title={clause ? bi('تعديل بند', 'Edit clause') : bi('بند جديد', 'New clause')} footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={busy} disabled={!valid} onClick={save}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={bi('العنوان *', 'Title *')} className="sm:col-span-2"><Input value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} /></Field>
        <Field label={bi('التصنيف', 'Category')}>
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(CATEGORY_AR).map(([k, v]) => <option key={k} value={k}>{locale === 'en' ? CATEGORY_EN[k] ?? v : v}</option>)}
            {!CATEGORY_AR[f.category] && <option value={f.category}>{f.category}</option>}
          </Select>
        </Field>
        <Field label={bi('الترتيب', 'Order')}><Input type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} /></Field>
        <Field label={bi('قالب العقد', 'Contract template')} className="sm:col-span-2">
          <Select value={f.templateSet} onChange={(e) => setF({ ...f, templateSet: e.target.value as TemplateSet })}>
            {TEMPLATE_SETS.map((t) => <option key={t.value} value={t.value}>{locale === 'en' ? t.labelEn : t.label}</option>)}
          </Select>
        </Field>
        <Field label={bi('المفتاح *', 'Key *')} hint={bi('معرّف ثابت بالإنجليزية (فريد داخل القالب)', 'Fixed English identifier (unique within the template)')} className="sm:col-span-2"><Input dir="ltr" value={f.key} disabled={!!clause} onChange={(e) => setF({ ...f, key: e.target.value.replace(/\s+/g, '_').toLowerCase() })} placeholder="payment_terms" /></Field>
        <div className="flex items-end pb-2 sm:col-span-2"><Checkbox label={bi('مفعّل (يظهر في العقود الجديدة)', 'Active (appears in new contracts)')} checked={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
      </div>
      <Field label={bi('نص البند *', 'Clause text *')} className="mt-3"><Textarea rows={14} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} /></Field>
      <button type="button" className="mt-2 text-xs font-bold text-gold-dark hover:underline" onClick={() => setShowEn((v) => !v)}>{showEn ? bi('إخفاء النسخة الإنجليزية', 'Hide English version') : bi('+ النسخة الإنجليزية (اختياري)', '+ English version (optional)')}</button>
      {showEn && (
        <div className="mt-2 grid gap-3">
          <Field label="Title (English)"><Input dir="ltr" value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} /></Field>
          <Field label="Clause text (English)"><Textarea dir="ltr" rows={8} value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} /></Field>
        </div>
      )}
      {clause && <p className="mt-2 text-xs text-muted">{bi('تعديل نص البند يرفع رقم إصداره؛ العقود الموقعة سابقًا تحتفظ بنصها الأصلي.', 'Editing the clause text bumps its version; previously signed contracts keep their original text.')}</p>}
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}

/* ───────────── Message templates ───────────── */

interface Template { id: string; key: string; channel: string; category: string; language: string; providerTemplateName: string | null; body: string; variables: string[]; active: boolean }

const CHANNEL_AR: Record<string, string> = { whatsapp: 'واتساب', sms: 'رسالة نصية', email: 'بريد إلكتروني' };
const TCAT_AR: Record<string, string> = { utility: 'خدمية', marketing: 'تسويقية', authentication: 'تحقق' };
const CHANNEL_EN: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
const TCAT_EN: Record<string, string> = { utility: 'Utility', marketing: 'Marketing', authentication: 'Authentication' };

function varsOf(t: { body: string; variables?: string[] }): string[] {
  const found = [...t.body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set([...(t.variables ?? []), ...found])];
}

function Templates() {
  const { bi, locale } = useI18n();
  const q = useQuery({ queryKey: ['message-templates'], queryFn: () => api.get<Template[]>('/settings/message-templates') });
  const [edit, setEdit] = useState<Template | null>(null);
  return (
    <div className="space-y-3">
      <InfoNote tone="blue">{locale === 'en'
        ? <>WhatsApp templates must also be approved in Meta Business Manager <b>under the same template name</b> with the same number and order of variables; any change to the text here requires re-approval there before sending.</>
        : <>قوالب واتساب يجب اعتمادها أيضًا في Meta Business Manager <b>بنفس اسم القالب</b> ونفس عدد المتغيرات وترتيبها؛ أي تعديل على النص هنا يتطلب إعادة اعتماده هناك قبل الإرسال.</>}</InfoNote>
      <Card padded={false}>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty icon={<MessageSquareText className="size-8" />} title={bi('لا توجد قوالب', 'No templates')} /> : (
          <Table>
            <thead><tr><Th>{bi('القالب', 'Template')}</Th><Th>{bi('القناة', 'Channel')}</Th><Th>{bi('الفئة', 'Category')}</Th><Th>{bi('اللغة', 'Language')}</Th><Th>{bi('النص', 'Text')}</Th><Th /></tr></thead>
            <tbody>
              {q.data.map((t) => (
                <tr key={t.id} className="align-top hover:bg-tint/50">
                  <Td><div className="font-bold" dir="ltr">{t.key}</div>{t.providerTemplateName && <div className="text-[11px] text-muted" dir="ltr">{t.providerTemplateName}</div>}{!t.active && <Badge tone="red">{bi('غير مفعّل', 'Inactive')}</Badge>}</Td>
                  <Td>{(locale === 'en' ? CHANNEL_EN : CHANNEL_AR)[t.channel] ?? t.channel}</Td>
                  <Td className="text-xs">{(locale === 'en' ? TCAT_EN : TCAT_AR)[t.category] ?? t.category}</Td>
                  <Td className="text-xs">{t.language === 'ar' ? bi('العربية', 'Arabic') : t.language === 'en' ? 'English' : t.language}</Td>
                  <Td className="max-w-md"><p className="line-clamp-3 whitespace-pre-line text-xs">{t.body}</p></Td>
                  <Td className="text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(t)}>{bi('تعديل', 'Edit')}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {edit && <TemplateDialog template={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TemplateDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const [body, setBody] = useState(template.body);
  const [provider, setProvider] = useState(template.providerTemplateName ?? '');
  const [active, setActive] = useState(template.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const declared = template.variables ?? [];
  const used = varsOf({ body });
  const unknown = declared.length ? used.filter((v) => !declared.includes(v)) : [];
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put(`/settings/message-templates/${template.id}`, { body, providerTemplateName: provider.trim() || null, active });
      toast.success(bi('تم حفظ القالب', 'Template saved'));
      qc.invalidateQueries({ queryKey: ['message-templates'] });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} wide title={bi(`قالب: ${template.key}`, `Template: ${template.key}`)} footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={busy} disabled={!body.trim()} onClick={save}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Badge tone="blue">{(locale === 'en' ? CHANNEL_EN : CHANNEL_AR)[template.channel] ?? template.channel}</Badge>
        <Badge>{(locale === 'en' ? TCAT_EN : TCAT_AR)[template.category] ?? template.category}</Badge>
        <Badge>{template.language}</Badge>
      </div>
      <Field label={bi('نص الرسالة', 'Message text')}><Textarea rows={8} dir={template.language === 'en' ? 'ltr' : 'rtl'} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="mt-2">
        <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('المتغيرات المتاحة (انقر للإدراج)', 'Available variables (click to insert)')}</span>
        <div className="flex flex-wrap gap-1">
          {varsOf({ body: template.body, variables: declared }).map((v) => (
            <button key={v} type="button" onClick={() => setBody((b) => `${b}{{${v}}}`)} className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] hover:bg-tint" dir="ltr">{`{{${v}}}`}</button>
          ))}
        </div>
        {unknown.length > 0 && <p className="mt-1 text-xs text-danger">{bi('متغيرات غير معروفة لن تُستبدل:', 'Unknown variables will not be replaced:')} <span dir="ltr">{unknown.map((v) => `{{${v}}}`).join(' ')}</span></p>}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={bi('اسم القالب لدى المزوّد', 'Provider template name')} hint={template.channel === 'whatsapp' ? bi('نفس الاسم المعتمد في Meta Business Manager', 'Same name as approved in Meta Business Manager') : undefined}><Input dir="ltr" value={provider} onChange={(e) => setProvider(e.target.value)} /></Field>
        <div className="flex items-end pb-2"><Checkbox label={bi('مفعّل', 'Active')} checked={active} onChange={setActive} /></div>
      </div>
      {template.channel === 'whatsapp' && <div className="mt-3"><InfoNote tone="amber">{bi('بعد تعديل النص، أعد إرسال القالب للاعتماد في Meta Business Manager بنفس الاسم؛ الرسائل خارج نافذة الـ24 ساعة لا تُرسل إلا بقالب معتمد.', 'After editing the text, resubmit the template for approval in Meta Business Manager under the same name; messages outside the 24-hour window can only be sent with an approved template.')}</InfoNote></div>}
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}
