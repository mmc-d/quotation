'use client';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Download, FileSpreadsheet, ListTree, Plus, Upload } from 'lucide-react';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, POSTING_KEYS, type AccountType } from '@mmc/domain';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, Input, PageHeader, SearchBox, Select, Spinner, Table, Td, Textarea, Th, clsx } from '@/components/ui';
import { errMsg, ConfirmDialog } from '../../quotes/_components/common';
import { InfoNote, RequirePerm, readFileBase64 } from '../../settings/_components/common';
import { Amt, TypeBadge, accountName, useAccounts, type Account } from '../_components/ledger-kit';

const ROLE_AR: Record<string, string> = {
  cash: 'الصندوق', bank: 'البنك', gateway_clearing: 'بوابة الدفع', ar: 'العملاء', employee_advances: 'سلف الموظفين', inventory: 'المخزون', goods_in_transit: 'بضاعة في الطريق', wip: 'أعمال تحت التنفيذ',
  vat_input: 'ض.ق.م مدخلات', supplier_advances: 'دفعات للموردين', accumulated_depreciation: 'مجمع الإهلاك', ap: 'الموردون', customer_advances: 'دفعات العملاء', grni: 'بضاعة مستلمة لم تُفوتر',
  customs_payable: 'جمارك مستحقة', vat_output: 'ض.ق.م مخرجات', vat_settlement: 'تسوية الضريبة', salaries_payable: 'رواتب مستحقة', gosi_payable: 'تأمينات مستحقة', commissions_payable: 'عمولات مستحقة',
  accrued_expenses: 'مصروفات مستحقة', zakat_payable: 'زكاة مستحقة', eos_provision: 'مخصص نهاية الخدمة', capital: 'رأس المال', owner_current: 'جاري المالك', retained_earnings: 'أرباح مبقاة',
  opening_balance_equity: 'أرصدة افتتاحية', sales_devices: 'مبيعات الأجهزة', sales_installation: 'إيرادات التركيب', sales_service: 'إيرادات الصيانة', sales_discounts: 'خصومات المبيعات',
  other_income: 'إيرادات أخرى', cogs: 'تكلفة البضاعة', stock_adjustments: 'فروقات الجرد', purchase_expenses: 'مشتريات مباشرة', customs_duty: 'رسوم جمركية', price_fx_variance: 'فروقات أسعار',
  salaries: 'الرواتب', allowances: 'البدلات', gosi_expense: 'تأمينات (المنشأة)', bonuses: 'المكافآت', commissions: 'العمولات', eos_expense: 'مصروف نهاية الخدمة', bank_charges: 'رسوم بنكية',
  depreciation: 'الإهلاك', general_expenses: 'مصروفات عمومية', zakat_expense: 'الزكاة', suspense: 'حساب التسوية',
};

interface FormState { id?: string; version?: number; code: string; nameAr: string; nameEn: string; parentId: string; type: AccountType | ''; isGroup: boolean; requiresParty: boolean; postingKey: string; description: string }
const blank: FormState = { code: '', nameAr: '', nameEn: '', parentId: '', type: '', isGroup: false, requiresParty: false, postingKey: '', description: '' };

interface ImportResult { applied: boolean; create: { code: string; nameAr: string; type: string; parentCode: string | null }[]; update: { code: string; changes: Record<string, unknown> }[]; problems: { row: number; message: string }[] }

export default function AccountsPage() {
  return <RequirePerm perm="ledger.read" title="دليل الحسابات"><Chart /></RequirePerm>;
}

function Chart() {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [del, setDel] = useState<Account | null>(null);
  const [importing, setImporting] = useState(false);
  const write = can('ledger.write');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ledger-accounts'] }); };

  const all = accounts.data ?? [];
  const term = q.trim().toLowerCase();
  const rows = all.filter((a) => (showInactive || a.isActive) && (!type || a.type === type) && (!term || a.code.includes(term) || a.nameAr.toLowerCase().includes(term) || (a.nameEn ?? '').toLowerCase().includes(term) || (a.postingKey ?? '').includes(term)));
  const usedKeys = new Set(all.filter((a) => a.postingKey && a.id !== form?.id).map((a) => a.postingKey));

  const toggle = async (a: Account) => {
    try { await api.post(`/accounting/accounts/${a.id}/${a.isActive ? 'deactivate' : 'activate'}`); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <>
      <PageHeader title={bi('دليل الحسابات', 'Chart of accounts')} subtitle={bi('الحسابات الرئيسية تُجمّع فقط ولا تقبل قيودًا؛ الحسابات الفرعية هي التي يُرحَّل إليها.', 'Group accounts only add up; postings go to the sub-accounts.')}
        actions={<>
          <Button variant="outline" icon={<Download className="size-4" />} onClick={() => openFile('/accounting/accounts/excel')}>{bi('تنزيل Excel', 'Download Excel')}</Button>
          {write && <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>{bi('رفع Excel', 'Upload Excel')}</Button>}
          {write && <Button icon={<Plus className="size-4" />} onClick={() => setForm({ ...blank })}>{bi('حساب جديد', 'New account')}</Button>}
        </>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('الرمز أو الاسم أو دور الترحيل…', 'Code, name or posting role…')} />
          <Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-[11rem]">
            <option value="">{bi('كل الأنواع', 'All types')}</option>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{locale === 'en' ? ACCOUNT_TYPE_LABELS[t].en : ACCOUNT_TYPE_LABELS[t].ar}</option>)}
          </Select>
          <Checkbox label={bi('إظهار غير النشطة', 'Show inactive')} checked={showInactive} onChange={setShowInactive} />
          <span className="ms-auto text-xs text-muted">{rows.length} / {all.length}</span>
        </div>
        <ErrorBox error={accounts.error} />
        {accounts.isLoading ? <Spinner /> : !rows.length ? <Empty icon={<ListTree className="size-8" />} title={bi('لا توجد حسابات مطابقة', 'No matching accounts')} /> : (
          <Table>
            <thead><tr><Th>{bi('الرمز', 'Code')}</Th><Th>{bi('اسم الحساب', 'Account')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('دور الترحيل التلقائي', 'Auto-posting role')}</Th><Th className="text-end">{bi('الرصيد (ر.س)', 'Balance (SAR)')}</Th><Th /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={clsx('hover:bg-tint/50', !a.isActive && 'opacity-50', a.isGroup && 'bg-tint/30')}>
                  <Td className="num font-bold text-gold-dark" ><span dir="ltr">{a.code}</span></Td>
                  <Td><span className={clsx(a.isGroup && 'font-extrabold')} style={{ paddingInlineStart: `${Math.max(0, a.depth - 1) * 16}px` }}>{accountName(a, locale)}</span>{a.requiresParty && <Badge tone="gray">{bi('عميل/مورد', 'party')}</Badge>}{!a.isActive && <Badge tone="red">{bi('غير نشط', 'inactive')}</Badge>}</Td>
                  <Td><TypeBadge type={a.type} /></Td>
                  <Td className="text-xs">{a.postingKey ? <span title={a.postingKey}><Badge tone="blue">{locale === 'en' ? a.postingKey : ROLE_AR[a.postingKey] ?? a.postingKey}</Badge></span> : <span className="text-muted/40">—</span>}</Td>
                  <Td className="text-end"><Amt v={a.balance} strong={a.isGroup} /></Td>
                  <Td className="whitespace-nowrap text-end">
                    {write && <>
                      <Button size="sm" variant="ghost" onClick={() => setForm({ id: a.id, version: a.version, code: a.code, nameAr: a.nameAr, nameEn: a.nameEn ?? '', parentId: a.parentId ?? '', type: a.type, isGroup: a.isGroup, requiresParty: a.requiresParty, postingKey: a.postingKey ?? '', description: a.description ?? '' })}>{bi('تعديل', 'Edit')}</Button>
                      {!a.postingKey && <Button size="sm" variant="ghost" onClick={() => void toggle(a)}>{a.isActive ? bi('إيقاف', 'Deactivate') : bi('تفعيل', 'Activate')}</Button>}
                      {!a.hasLines && !a.postingKey && !all.some((x) => x.parentId === a.id) && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDel(a)}>{bi('حذف', 'Delete')}</Button>}
                    </>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {form && <AccountDialog form={form} usedKeys={usedKeys} onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); }} />}
      <ConfirmDialog open={!!del} danger title={bi('حذف الحساب', 'Delete account')} confirmLabel={bi('حذف', 'Delete')} message={del ? `${del.code} — ${del.nameAr}` : ''} onClose={() => setDel(null)}
        onConfirm={() => { const a = del!; api.del(`/accounting/accounts/${a.id}`).then(() => { toast.success(bi('حُذف الحساب', 'Account deleted')); setDel(null); refresh(); }).catch((e) => toast.error(errMsg(e))); }} />
      {importing && <ImportDialog onClose={() => setImporting(false)} onApplied={refresh} />}
    </>
  );
}

function AccountDialog({ form, usedKeys, onClose, onSaved }: { form: FormState; usedKeys: Set<string | null>; onClose: () => void; onSaved: () => void }) {
  const { bi, locale } = useI18n();
  const accounts = useAccounts();
  const [f, setF] = useState<FormState>(form);
  const [busy, setBusy] = useState(false);
  const editing = !!f.id;
  const groups = (accounts.data ?? []).filter((a) => a.isGroup && a.id !== f.id);
  const parent = groups.find((g) => g.id === f.parentId);
  const lines = (accounts.data ?? []).find((a) => a.id === f.id)?.hasLines ?? false;
  const set = (p: Partial<FormState>) => setF((x) => ({ ...x, ...p }));
  const type = parent ? parent.type : f.type;
  const problem = !f.code.trim() ? bi('أدخل رمز الحساب', 'Enter the account code') : !f.nameAr.trim() ? bi('أدخل اسم الحساب بالعربية', 'Enter the Arabic name') : !type ? bi('اختر الحساب الأب أو نوع الحساب', 'Choose a parent or a type') : null;

  const save = async () => {
    setBusy(true);
    const body = { code: f.code.trim(), nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() || null, parentId: f.parentId || null, type: f.parentId ? undefined : (f.type || undefined), isGroup: f.isGroup, requiresParty: f.requiresParty, postingKey: f.isGroup ? null : f.postingKey || null, description: f.description.trim() || null };
    try {
      if (editing) await api.put(`/accounting/accounts/${f.id}`, { ...body, version: f.version });
      else await api.post('/accounting/accounts', body);
      toast.success(bi('تم حفظ الحساب', 'Account saved'));
      onSaved();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} wide title={editing ? bi('تعديل حساب', 'Edit account') : bi('حساب جديد', 'New account')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={busy} disabled={!!problem} onClick={() => void save()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={bi('رمز الحساب *', 'Code *')} hint={lines ? bi('عليه قيود — لا يتغير الرمز', 'Has entries — the code is fixed') : undefined}><Input dir="ltr" value={f.code} disabled={lines} onChange={(e) => set({ code: e.target.value })} /></Field>
        <Field label={bi('الحساب الأب', 'Parent account')}>
          <Select value={f.parentId} onChange={(e) => set({ parentId: e.target.value })}>
            <option value="">{bi('— بدون (حساب رئيسي في القمة) —', '— none (top level) —')}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.code} — {accountName(g, locale)}</option>)}
          </Select>
        </Field>
        <Field label={bi('الاسم بالعربية *', 'Arabic name *')}><Input value={f.nameAr} onChange={(e) => set({ nameAr: e.target.value })} /></Field>
        <Field label={bi('الاسم بالإنجليزية', 'English name')}><Input dir="ltr" value={f.nameEn} onChange={(e) => set({ nameEn: e.target.value })} /></Field>
        <Field label={bi('نوع الحساب', 'Account type')} hint={parent ? bi('يتبع نوع الحساب الأب', 'Follows the parent') : undefined}>
          <Select value={type} disabled={!!parent || lines} onChange={(e) => set({ type: e.target.value as AccountType })}>
            <option value="">—</option>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{locale === 'en' ? ACCOUNT_TYPE_LABELS[t].en : ACCOUNT_TYPE_LABELS[t].ar}</option>)}
          </Select>
        </Field>
        <Field label={bi('دور الترحيل التلقائي', 'Auto-posting role')} hint={bi('يستخدمه الترحيل التلقائي (مثل: العملاء، البنك). لا يتكرر.', 'Used by automatic posting (e.g. receivables, bank). Unique.')}>
          <Select value={f.postingKey} disabled={f.isGroup} onChange={(e) => set({ postingKey: e.target.value })}>
            <option value="">{bi('— بدون —', '— none —')}</option>
            {POSTING_KEYS.filter((k) => !usedKeys.has(k)).map((k) => <option key={k} value={k}>{locale === 'en' ? k : `${ROLE_AR[k] ?? k} (${k})`}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-5 md:col-span-2">
          <Checkbox label={bi('حساب رئيسي (يجمع فقط ولا يقبل قيودًا)', 'Group account (adds up, takes no entries)')} checked={f.isGroup} disabled={lines} onChange={(v) => set({ isGroup: v, postingKey: v ? '' : f.postingKey })} />
          <Checkbox label={bi('يتطلب تحديد العميل/المورد في كل قيد', 'Every entry must name a customer/supplier')} checked={f.requiresParty} disabled={f.isGroup} onChange={(v) => set({ requiresParty: v })} />
        </div>
        <Field label={bi('وصف', 'Description')} className="md:col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      </div>
      {problem && <p className="mt-2 text-xs text-danger">{problem}</p>}
    </Dialog>
  );
}

function ImportDialog({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const { bi } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = async (data: string, apply: boolean) => {
    setBusy(apply ? 'apply' : 'preview'); setError(null);
    try {
      const r = await api.post<ImportResult>('/accounting/accounts/import', { data, apply });
      setRes(r);
      if (apply) { onApplied(); toast.success(bi(`تم: ${r.create.length} حساب جديد و ${r.update.length} تعديل`, `Done: ${r.create.length} new, ${r.update.length} updated`)); }
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setRes(null); setError(null);
    if (!/\.xlsx$/i.test(f.name)) { setError(new Error(bi('اختر ملف Excel بصيغة ‎.xlsx', 'Choose an Excel .xlsx file'))); return; }
    const data = await readFileBase64(f);
    setFile({ name: f.name, data });
    await run(data, false);
  };
  const canApply = !!file && !!res && !res.applied && res.problems.length === 0 && res.create.length + res.update.length > 0;
  return (
    <Dialog open onClose={onClose} wide title={bi('رفع دليل الحسابات من Excel', 'Upload the chart from Excel')}
      footer={<><Button variant="outline" onClick={onClose}>{res?.applied ? bi('إغلاق', 'Close') : bi('إلغاء', 'Cancel')}</Button>{!res?.applied && <Button icon={<CheckCircle2 className="size-4" />} disabled={!canApply} loading={busy === 'apply'} onClick={() => file && void run(file.data, true)}>{bi('تطبيق', 'Apply')}</Button>}</>}>
      <div className="space-y-3">
        <InfoNote>{bi('نزّل الملف الحالي، أضف الحسابات الجديدة في صفوف جديدة، ثم ارفعه. تُضاف الرموز الجديدة وتُحدَّث الأسماء والنشاط للموجودة؛ نوع الحساب والحساب الأب ودور الترحيل لا تتغير بالاستيراد. ستظهر معاينة قبل الحفظ.', 'Download the current file, add new accounts as new rows, then upload it. New codes are added; names and active flags of existing ones are updated. Type, parent and posting role never change by import. You get a preview first.')}</InfoNote>
        <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="flex items-center gap-2">
          <Button variant="outline" icon={<Upload className="size-4" />} loading={busy === 'preview'} onClick={() => input.current?.click()}>{file ? bi('اختيار ملف آخر', 'Choose another file') : bi('اختيار ملف Excel', 'Choose Excel file')}</Button>
          {file && <span className="flex items-center gap-1 text-xs text-muted"><FileSpreadsheet className="size-4 text-ok" />{file.name}</span>}
        </div>
        <ErrorBox error={error} />
        {res && (
          <div className="space-y-2 text-sm">
            <p><b>{res.create.length}</b> {bi('حساب جديد', 'new')} · <b>{res.update.length}</b> {bi('تعديل', 'updated')} · <b className={res.problems.length ? 'text-danger' : ''}>{res.problems.length}</b> {bi('مشكلة', 'problems')}</p>
            {res.problems.length > 0 && <ul className="list-disc ps-5 text-xs text-danger">{res.problems.map((p, i) => <li key={i}>{bi('صف', 'Row')} {p.row}: {p.message}</li>)}</ul>}
            {res.create.length > 0 && <ul className="max-h-40 list-disc overflow-y-auto ps-5 text-xs">{res.create.map((c) => <li key={c.code}><span className="num" dir="ltr">{c.code}</span> — {c.nameAr}</li>)}</ul>}
            {res.applied && <p className="font-bold text-ok">{bi('تم تطبيق التغييرات.', 'Changes applied.')}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
