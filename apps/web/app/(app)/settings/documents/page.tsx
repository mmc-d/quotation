'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Hash, Pencil, Plus, ScrollText, MessageSquareText } from 'lucide-react';
import { formatSeries } from '@mmc/domain';
import { api } from '@/lib/api';
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th } from '@/components/ui';
import { InfoNote, RequirePerm } from '../_components/common';

type Tab = 'numbering' | 'clauses' | 'templates';

export default function DocumentsSettingsPage() {
  return <RequirePerm perm="admin.settings" title="المستندات والترقيم"><DocumentsSettings /></RequirePerm>;
}

function DocumentsSettings() {
  const [tab, setTab] = useState<Tab>('numbering');
  return (
    <>
      <PageHeader title="المستندات والترقيم" subtitle="أنماط الترقيم، بنود العقود، وقوالب الرسائل" />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'numbering', label: 'الترقيم' }, { value: 'clauses', label: 'بنود العقود' }, { value: 'templates', label: 'قوالب الرسائل' }]} />
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

/** Next sequence the server would allocate (for period resets: the first number of a fresh period). */
function nextSeq(s: { reset: string; start_at: number; last_value: number | string }, startAt = s.start_at): number {
  const last = Number(s.last_value) || 0;
  return s.reset === 'never' ? Math.max(last + 1, startAt) : Math.max(startAt, 1);
}

function preview(pattern: string, seq: number): string {
  try { return formatSeries(pattern, seq); } catch { return '—'; }
}

function Numbering() {
  const q = useQuery({ queryKey: ['numbering'], queryFn: () => api.get<Series[]>('/settings/numbering') });
  const [edit, setEdit] = useState<Series | null>(null);
  return (
    <div className="space-y-3">
      <InfoNote>الأرقام لا تُعاد ولا تُستخدم مرتين: يمكن تقديم بداية التسلسل للأمام (مثلًا لمواصلة أرقام الأداة القديمة) لكن لا يمكن إرجاعها للخلف أبدًا.</InfoNote>
      <Card padded={false}>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty icon={<Hash className="size-8" />} title="لا توجد سلاسل ترقيم" /> : (
          <Table>
            <thead><tr><Th>المستند</Th><Th>النمط</Th><Th>إعادة الترقيم</Th><Th>آخر رقم</Th><Th>الرقم التالي (تقريبي)</Th><Th /></tr></thead>
            <tbody>
              {q.data.map((s) => (
                <tr key={s.id} className="hover:bg-tint/50">
                  <Td className="font-bold">{DOC_AR[s.document_type] ?? s.document_type}</Td>
                  <Td><code dir="ltr" className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{s.pattern}</code></Td>
                  <Td className="text-xs">{RESET_AR[s.reset] ?? s.reset}</Td>
                  <Td className="num">{Number(s.last_value) || '—'}</Td>
                  <Td className="num text-xs"><span dir="ltr">{preview(s.pattern, nextSeq(s))}</span></Td>
                  <Td className="text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(s)}>تعديل</Button></Td>
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
  const qc = useQueryClient();
  const [pattern, setPattern] = useState(series.pattern);
  const [startAt, setStartAt] = useState(String(series.start_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const start = Number(startAt);
  const patternErr = !/\{SEQ(:\d+)?\}/.test(pattern) ? 'يجب أن يحتوي النمط على {SEQ} أو {SEQ:n}' : null;
  const startErr = !Number.isInteger(start) || start < 1 ? 'عدد صحيح ≥ 1' : start < series.start_at ? `لا يمكن الرجوع عن ${series.start_at} — سيُحفظ ${series.start_at}` : null;
  const effectiveStart = Math.max(series.start_at, Number.isInteger(start) ? start : series.start_at);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put(`/settings/numbering/${series.id}`, { pattern: pattern.trim(), startAt: effectiveStart });
      toast.success('تم حفظ نمط الترقيم');
      qc.invalidateQueries({ queryKey: ['numbering'] });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const tokens = ['{YY}', '{YYYY}', '{MM}', '{WW}', '{DD}', '{SEQ}', '{SEQ:4}', '{SEQ:5}'];
  return (
    <Dialog open onClose={onClose} title={`ترقيم ${DOC_AR[series.document_type] ?? series.document_type}`} footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button loading={busy} disabled={!!patternErr || !Number.isInteger(start) || start < 1} onClick={save}>حفظ</Button></>}>
      <div className="space-y-3">
        <Field label="النمط" error={patternErr}><Input dir="ltr" className="font-mono" value={pattern} onChange={(e) => setPattern(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-1">
          {tokens.map((t) => <button key={t} type="button" onClick={() => setPattern((p) => p + t)} className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] hover:bg-tint" dir="ltr">{t}</button>)}
        </div>
        <p className="text-xs text-muted">{'{YY}'} السنة برقمين · {'{YYYY}'} السنة كاملة · {'{MM}'} الشهر · {'{WW}'} رقم الأسبوع · {'{DD}'} اليوم · {'{SEQ}'} التسلسل · {'{SEQ:5}'} التسلسل بخمس خانات (00042). التاريخ بتوقيت الرياض.</p>
        <Field label="يبدأ التسلسل من" error={startErr} hint={`الحالي: ${series.start_at} · آخر رقم صادر: ${Number(series.last_value) || 0}`}>
          <Input type="number" min={series.start_at} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </Field>
        <div className="rounded-lg border border-primary/20 bg-primary-50 p-3 text-center">
          <div className="text-xs text-muted">{series.reset === 'never' ? 'الرقم التالي سيكون' : 'أول رقم في الفترة الجديدة'}</div>
          <div className="mt-1 font-mono text-lg font-extrabold text-primary" dir="ltr">{patternErr ? '—' : preview(pattern, nextSeq(series, effectiveStart))}</div>
        </div>
        <InfoNote tone="amber">يمكن تقديم الأرقام للأمام فقط، ولا ترجع للخلف أبدًا (الأرقام الصادرة لا يُعاد استخدامها). تغيير النمط لا يغيّر أرقام المستندات الصادرة سابقًا.</InfoNote>
        <ErrorBox error={error} />
      </div>
    </Dialog>
  );
}

/* ───────────── Contract clauses ───────────── */

interface Clause { id: string; key: string; category: string; titleAr: string; bodyAr: string; titleEn: string | null; bodyEn: string | null; sort: number; active: boolean; clauseVersion: number; templateSet: TemplateSet }

type TemplateSet = 'supply_install' | 'supply_only' | 'maintenance';
const TEMPLATE_SETS: { value: TemplateSet; label: string; hint: string }[] = [
  { value: 'supply_install', label: 'توريد وتركيب', hint: 'العقد الافتراضي: توريد المواد وتركيبها وبرمجتها.' },
  { value: 'supply_only', label: 'توريد فقط', hint: 'توريد دون تركيب أو برمجة؛ الضمان على المواد فقط.' },
  { value: 'maintenance', label: 'عقد صيانة سنوي', hint: 'زيارات وقائية، أوقات استجابة، استثناءات، مدة 12 شهرًا وتجديد.' },
];

const CATEGORY_AR: Record<string, string> = { general: 'عام', scope: 'نطاق العمل', payment: 'الدفع', warranty: 'الضمان', delivery: 'التوريد والتنفيذ', obligations: 'الالتزامات', termination: 'الإنهاء', disputes: 'النزاعات', other: 'أخرى' };

function Clauses() {
  const q = useQuery({ queryKey: ['clauses'], queryFn: () => api.get<Clause[]>('/settings/clauses') });
  const [edit, setEdit] = useState<Clause | 'new' | null>(null);
  const [set, setSet] = useState<TemplateSet>('supply_install');
  const all = q.data ?? [];
  const rows = all.filter((c) => (c.templateSet ?? 'supply_install') === set).sort((a, b) => a.sort - b.sort);
  return (
    <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="قالب العقد">
      {TEMPLATE_SETS.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={set === t.value} onClick={() => setSet(t.value)}
          className={`rounded-full border px-3 py-1.5 text-sm font-bold ${set === t.value ? 'border-primary bg-primary text-white' : 'border-line bg-white hover:bg-tint'}`}>
          {t.label} <span className="num text-xs opacity-75">({all.filter((c) => (c.templateSet ?? 'supply_install') === t.value).length})</span>
        </button>
      ))}
    </div>
    <InfoNote>{TEMPLATE_SETS.find((t) => t.value === set)?.hint} تُنسخ البنود المفعّلة من القالب إلى العقد عند إنشائه من العرض أو عند تغيير قالب العقد وهو مسودة. البند الذي عنوانه يحتوي «المواصفات» يُطبع معه جدول البنود، وبعد البند الذي عنوانه يحتوي «نطاق» تُطبع مادة الدفعات تلقائيًا.</InfoNote>
    <Card padded={false} title={`بنود العقود — ${TEMPLATE_SETS.find((t) => t.value === set)?.label}`} actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>بند جديد</Button>}>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<ScrollText className="size-8" />} title="لا توجد بنود" /> : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3 hover:bg-tint/40">
              <span className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-tint text-xs font-bold text-gold-dark">{c.sort}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm text-primary">{c.titleAr}</b>
                  <Badge>{CATEGORY_AR[c.category] ?? c.category}</Badge>
                  <span className="text-[11px] text-muted" dir="ltr">{c.key} · v{c.clauseVersion}</span>
                  {!c.active && <Badge tone="red">غير مفعّل</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-muted">{c.bodyAr}</p>
              </div>
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(c)}>تعديل</Button>
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
      toast.success('تم حفظ البند');
      qc.invalidateQueries({ queryKey: ['clauses'] });
      qc.invalidateQueries({ queryKey: ['clause-templates'] });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} wide title={clause ? 'تعديل بند' : 'بند جديد'} footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button loading={busy} disabled={!valid} onClick={save}>حفظ</Button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="العنوان *" className="sm:col-span-2"><Input value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} /></Field>
        <Field label="التصنيف">
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(CATEGORY_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            {!CATEGORY_AR[f.category] && <option value={f.category}>{f.category}</option>}
          </Select>
        </Field>
        <Field label="الترتيب"><Input type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} /></Field>
        <Field label="قالب العقد" className="sm:col-span-2">
          <Select value={f.templateSet} onChange={(e) => setF({ ...f, templateSet: e.target.value as TemplateSet })}>
            {TEMPLATE_SETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="المفتاح *" hint="معرّف ثابت بالإنجليزية (فريد داخل القالب)" className="sm:col-span-2"><Input dir="ltr" value={f.key} disabled={!!clause} onChange={(e) => setF({ ...f, key: e.target.value.replace(/\s+/g, '_').toLowerCase() })} placeholder="payment_terms" /></Field>
        <div className="flex items-end pb-2 sm:col-span-2"><Checkbox label="مفعّل (يظهر في العقود الجديدة)" checked={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
      </div>
      <Field label="نص البند *" className="mt-3"><Textarea rows={14} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} /></Field>
      <button type="button" className="mt-2 text-xs font-bold text-gold-dark hover:underline" onClick={() => setShowEn((v) => !v)}>{showEn ? 'إخفاء النسخة الإنجليزية' : '+ النسخة الإنجليزية (اختياري)'}</button>
      {showEn && (
        <div className="mt-2 grid gap-3">
          <Field label="Title (English)"><Input dir="ltr" value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} /></Field>
          <Field label="Clause text (English)"><Textarea dir="ltr" rows={8} value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} /></Field>
        </div>
      )}
      {clause && <p className="mt-2 text-xs text-muted">تعديل نص البند يرفع رقم إصداره؛ العقود الموقعة سابقًا تحتفظ بنصها الأصلي.</p>}
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}

/* ───────────── Message templates ───────────── */

interface Template { id: string; key: string; channel: string; category: string; language: string; providerTemplateName: string | null; body: string; variables: string[]; active: boolean }

const CHANNEL_AR: Record<string, string> = { whatsapp: 'واتساب', sms: 'رسالة نصية', email: 'بريد إلكتروني' };
const TCAT_AR: Record<string, string> = { utility: 'خدمية', marketing: 'تسويقية', authentication: 'تحقق' };

function varsOf(t: { body: string; variables?: string[] }): string[] {
  const found = [...t.body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set([...(t.variables ?? []), ...found])];
}

function Templates() {
  const q = useQuery({ queryKey: ['message-templates'], queryFn: () => api.get<Template[]>('/settings/message-templates') });
  const [edit, setEdit] = useState<Template | null>(null);
  return (
    <div className="space-y-3">
      <InfoNote tone="blue">قوالب واتساب يجب اعتمادها أيضًا في Meta Business Manager <b>بنفس اسم القالب</b> ونفس عدد المتغيرات وترتيبها؛ أي تعديل على النص هنا يتطلب إعادة اعتماده هناك قبل الإرسال.</InfoNote>
      <Card padded={false}>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty icon={<MessageSquareText className="size-8" />} title="لا توجد قوالب" /> : (
          <Table>
            <thead><tr><Th>القالب</Th><Th>القناة</Th><Th>الفئة</Th><Th>اللغة</Th><Th>النص</Th><Th /></tr></thead>
            <tbody>
              {q.data.map((t) => (
                <tr key={t.id} className="align-top hover:bg-tint/50">
                  <Td><div className="font-bold" dir="ltr">{t.key}</div>{t.providerTemplateName && <div className="text-[11px] text-muted" dir="ltr">{t.providerTemplateName}</div>}{!t.active && <Badge tone="red">غير مفعّل</Badge>}</Td>
                  <Td>{CHANNEL_AR[t.channel] ?? t.channel}</Td>
                  <Td className="text-xs">{TCAT_AR[t.category] ?? t.category}</Td>
                  <Td className="text-xs">{t.language === 'ar' ? 'العربية' : t.language === 'en' ? 'English' : t.language}</Td>
                  <Td className="max-w-md"><p className="line-clamp-3 whitespace-pre-line text-xs">{t.body}</p></Td>
                  <Td className="text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(t)}>تعديل</Button></Td>
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
      toast.success('تم حفظ القالب');
      qc.invalidateQueries({ queryKey: ['message-templates'] });
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} wide title={`قالب: ${template.key}`} footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button loading={busy} disabled={!body.trim()} onClick={save}>حفظ</Button></>}>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Badge tone="blue">{CHANNEL_AR[template.channel] ?? template.channel}</Badge>
        <Badge>{TCAT_AR[template.category] ?? template.category}</Badge>
        <Badge>{template.language}</Badge>
      </div>
      <Field label="نص الرسالة"><Textarea rows={8} dir={template.language === 'en' ? 'ltr' : 'rtl'} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="mt-2">
        <span className="mb-1 block text-xs font-bold text-gold-dark">المتغيرات المتاحة (انقر للإدراج)</span>
        <div className="flex flex-wrap gap-1">
          {varsOf({ body: template.body, variables: declared }).map((v) => (
            <button key={v} type="button" onClick={() => setBody((b) => `${b}{{${v}}}`)} className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] hover:bg-tint" dir="ltr">{`{{${v}}}`}</button>
          ))}
        </div>
        {unknown.length > 0 && <p className="mt-1 text-xs text-danger">متغيرات غير معروفة لن تُستبدل: <span dir="ltr">{unknown.map((v) => `{{${v}}}`).join(' ')}</span></p>}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="اسم القالب لدى المزوّد" hint={template.channel === 'whatsapp' ? 'نفس الاسم المعتمد في Meta Business Manager' : undefined}><Input dir="ltr" value={provider} onChange={(e) => setProvider(e.target.value)} /></Field>
        <div className="flex items-end pb-2"><Checkbox label="مفعّل" checked={active} onChange={setActive} /></div>
      </div>
      {template.channel === 'whatsapp' && <div className="mt-3"><InfoNote tone="amber">بعد تعديل النص، أعد إرسال القالب للاعتماد في Meta Business Manager بنفس الاسم؛ الرسائل خارج نافذة الـ24 ساعة لا تُرسل إلا بقالب معتمد.</InfoNote></div>}
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}
