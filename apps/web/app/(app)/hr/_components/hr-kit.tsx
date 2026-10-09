'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { idNumberProblem, OFFER_DEFAULTS, offerIssues, offerPackage, tafqitHalalas, type IdType } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { today } from '@/lib/format';
import { Button, Card, Field, Input, Money, Select, Textarea } from '@/components/ui';
import { errMsg, NumInput } from '../../quotes/_components/common';

export interface Allowance { label: string; amount: string }
export interface OfferIssue { code: string; level: 'error' | 'warning'; ar: string; en: string }

export interface Offer {
  id: string; number: string; offerDate: string; validUntil: string; candidateNameAr: string; candidateNameEn: string | null; nationality: string | null;
  idType: IdType | null; idNumber: string | null; mobile: string | null; email: string | null; jobTitleAr: string; jobTitleEn: string | null; department: string | null;
  reportsTo: string | null; workLocation: string | null; contractType: 'unlimited' | 'fixed'; durationMonths: number | null; employmentType: string; startDate: string;
  probationDays: number; weeklyHours: number; workDays: string | null; annualLeaveDays: number; noticeDays: number | null; basicSalary: string; housingAllowance: string;
  transportAllowance: string; otherAllowances: Allowance[]; medicalInsurance: string; annualTicket: string; otherBenefits: string | null; termsAr: string | null; notes: string | null;
  status: 'draft' | 'approved' | 'accepted' | 'rejected' | 'cancelled' | 'expired'; approvedBy: string | null; approvedByName: string | null; approvedAt: string | null;
  respondedAt: string | null; responseNote: string | null; cancelReason: string | null; employeeId: string | null; createdBy: string | null; createdByName: string | null;
  version: number; monthlyTotal: string; annualTotal: string; issues: OfferIssue[]; employee: { id: string; number: string } | null;
}

export interface Employee {
  id: string; number: string; nameAr: string; nameEn: string | null; nationality: string | null; idType: IdType | null; idNumber: string | null; idExpiry: string | null;
  birthDate: string | null; gender: 'male' | 'female' | null; mobile: string | null; email: string | null; jobTitleAr: string; jobTitleEn: string | null; department: string | null;
  managerId: string | null; userId: string | null; workLocation: string | null; hireDate: string; contractType: 'unlimited' | 'fixed'; contractEndDate: string | null;
  employmentType: string; probationEndDate: string | null; annualLeaveDays: number; basicSalary: string; housingAllowance: string; transportAllowance: string;
  otherAllowances: Allowance[]; bankName: string | null; iban: string | null; gosiNumber: string | null; gosiEmployeePercent: string; status: 'active' | 'suspended' | 'terminated';
  terminationDate: string | null; terminationReason: string | null; notes: string | null; version: number; monthlyTotal: string;
  manager: { id: string; number: string; nameAr: string } | null; user: { id: string; email: string; nameAr: string | null } | null; offer: { id: string; number: string } | null;
}

type L = { value: string; ar: string; en: string };
export const CONTRACT: L[] = [{ value: 'unlimited', ar: 'غير محدد المدة', en: 'Open-ended' }, { value: 'fixed', ar: 'محدد المدة', en: 'Fixed-term' }];
export const EMPLOYMENT: L[] = [{ value: 'full_time', ar: 'دوام كامل', en: 'Full time' }, { value: 'part_time', ar: 'دوام جزئي', en: 'Part time' }, { value: 'temporary', ar: 'عمل مؤقت', en: 'Temporary' }];
export const COVER: L[] = [{ value: 'none', ar: 'لا يشمل', en: 'Not included' }, { value: 'employee', ar: 'للموظف', en: 'Employee' }, { value: 'family', ar: 'للموظف وأسرته', en: 'Employee + family' }];
export const ID_TYPE: L[] = [{ value: 'national_id', ar: 'هوية وطنية', en: 'National ID' }, { value: 'iqama', ar: 'إقامة', en: 'Iqama' }, { value: 'passport', ar: 'جواز سفر', en: 'Passport' }];
export const EMP_STATUS: Record<string, [string, string, 'green' | 'gold' | 'red']> = { active: ['على رأس العمل', 'Active', 'green'], suspended: ['موقوف', 'Suspended', 'gold'], terminated: ['انتهت خدمته', 'Left', 'red'] };
export const OFFER_STATUS: Record<string, [string, string, 'gray' | 'blue' | 'green' | 'red' | 'gold']> = {
  draft: ['مسودة', 'Draft', 'gray'], approved: ['صادر — بانتظار رد المرشح', 'Issued — awaiting answer', 'blue'], accepted: ['مقبول', 'Accepted', 'green'],
  rejected: ['مرفوض من المرشح', 'Declined', 'red'], cancelled: ['مسحوب', 'Withdrawn', 'gray'], expired: ['منتهي الصلاحية', 'Expired', 'gold'],
};

export function useLabel() {
  const { locale } = useI18n();
  return (list: L[], v: string | null | undefined) => { const x = list.find((y) => y.value === v); return x ? (locale === 'en' ? x.en : x.ar) : v ?? ''; };
}

const plusDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const moneyOk = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
const str = (v: string | null | undefined) => v ?? '';

function SelectL({ list, value, onChange, empty }: { list: L[]; value: string; onChange: (v: string) => void; empty?: string }) {
  const { locale } = useI18n();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {list.map((x) => <option key={x.value} value={x.value}>{locale === 'en' ? x.en : x.ar}</option>)}
    </Select>
  );
}

/** Basic + housing + transport + any number of named allowances, with the live monthly total. */
function SalaryFields({ v, set }: { v: { basicSalary: string; housingAllowance: string; transportAllowance: string; otherAllowances: Allowance[] }; set: (p: Partial<typeof v>) => void }) {
  const { bi } = useI18n();
  const safe = (x: string) => (moneyOk(x) ? x : '0');
  const pkg = offerPackage({ basicSalary: safe(v.basicSalary), housingAllowance: safe(v.housingAllowance), transportAllowance: safe(v.transportAllowance), otherAllowances: v.otherAllowances.map((a) => ({ amount: safe(a.amount) })) });
  const setA = (i: number, p: Partial<Allowance>) => set({ otherAllowances: v.otherAllowances.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={bi('الراتب الأساسي *', 'Basic salary *')}><NumInput value={v.basicSalary} onChange={(x) => set({ basicSalary: x })} min={0} step="0.01" ariaLabel={bi('الراتب الأساسي', 'Basic salary')} /></Field>
        <Field label={bi('بدل السكن', 'Housing allowance')} hint={bi('عادةً 25% من الأساسي', 'Usually 25% of basic')}><NumInput value={v.housingAllowance} onChange={(x) => set({ housingAllowance: x })} min={0} step="0.01" ariaLabel={bi('بدل السكن', 'Housing')} /></Field>
        <Field label={bi('بدل النقل', 'Transport allowance')} hint={bi('عادةً 10% من الأساسي', 'Usually 10% of basic')}><NumInput value={v.transportAllowance} onChange={(x) => set({ transportAllowance: x })} min={0} step="0.01" ariaLabel={bi('بدل النقل', 'Transport')} /></Field>
      </div>
      {v.otherAllowances.map((a, i) => (
        <div key={i} className="grid grid-cols-[1fr_10rem_auto] items-end gap-2">
          <Field label={bi('اسم البدل', 'Allowance')}><Input value={a.label} onChange={(e) => setA(i, { label: e.target.value })} placeholder={bi('مثال: بدل اتصال', 'e.g. phone allowance')} /></Field>
          <Field label={bi('المبلغ', 'Amount')}><NumInput value={a.amount} onChange={(x) => setA(i, { amount: x })} min={0} step="0.01" ariaLabel={bi('المبلغ', 'Amount')} /></Field>
          <Button variant="ghost" aria-label={bi('حذف', 'Remove')} onClick={() => set({ otherAllowances: v.otherAllowances.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-tint/60 px-4 py-2">
        <Button variant="outline" size="sm" icon={<Plus className="size-4" />} disabled={v.otherAllowances.length >= 10} onClick={() => set({ otherAllowances: [...v.otherAllowances, { label: '', amount: '' }] })}>{bi('بدل آخر', 'Other allowance')}</Button>
        <div className="text-end">
          <div className="text-sm"><span className="font-bold text-gold-dark">{bi('الإجمالي الشهري', 'Monthly total')}: </span><Money value={pkg.monthly} fixed className="text-lg font-extrabold text-primary" /></div>
          {pkg.monthly > 0 && <div className="text-[11px] text-muted">{tafqitHalalas(pkg.monthly)} · {bi('سنويًا', 'yearly')} <Money value={pkg.annual} /></div>}
        </div>
      </div>
    </div>
  );
}

function IdFields({ v, set }: { v: { nationality: string; idType: string; idNumber: string }; set: (p: Partial<typeof v>) => void }) {
  const { bi } = useI18n();
  const p = idNumberProblem((v.idType || null) as IdType | null, v.idNumber.trim() || null);
  return <>
    <Field label={bi('الجنسية', 'Nationality')}><Input value={v.nationality} onChange={(e) => set({ nationality: e.target.value })} placeholder={bi('مثال: سعودي', 'e.g. Saudi')} list="hr-nationalities" /></Field>
    <datalist id="hr-nationalities">{['سعودي', 'مصري', 'يمني', 'سوداني', 'أردني', 'سوري', 'باكستاني', 'هندي', 'بنغلاديشي', 'فلبيني'].map((n) => <option key={n} value={n} />)}</datalist>
    <Field label={bi('نوع الهوية', 'ID type')}><SelectL list={ID_TYPE} value={v.idType} onChange={(x) => set({ idType: x })} empty="—" /></Field>
    <Field label={bi('رقم الهوية / الإقامة / الجواز', 'ID / iqama / passport no.')} error={p ? (p === 'invalid' ? bi('رقم غير صحيح', 'Invalid number') : p === 'not_iqama' ? bi('رقم الإقامة يبدأ بـ 2', 'An iqama starts with 2') : bi('الهوية الوطنية تبدأ بـ 1', 'A national ID starts with 1')) : undefined}>
      <Input dir="ltr" value={v.idNumber} onChange={(e) => set({ idNumber: e.target.value })} />
    </Field>
  </>;
}

// ───────────── offer form ─────────────

interface OfferDraft {
  offerDate: string; validUntil: string; candidateNameAr: string; candidateNameEn: string; nationality: string; idType: string; idNumber: string; mobile: string; email: string;
  jobTitleAr: string; jobTitleEn: string; department: string; reportsTo: string; workLocation: string; contractType: 'unlimited' | 'fixed'; durationMonths: string; employmentType: string;
  startDate: string; probationDays: string; weeklyHours: string; workDays: string; annualLeaveDays: string; noticeDays: string; basicSalary: string; housingAllowance: string;
  transportAllowance: string; otherAllowances: Allowance[]; medicalInsurance: string; annualTicket: string; otherBenefits: string; termsAr: string; notes: string;
}

const fromOffer = (o: Offer | null): OfferDraft => {
  const d = today();
  const n = (x: number | null | undefined, def: number | string = '') => (x === null || x === undefined ? String(def) : String(x));
  const m = (x: string | undefined) => (x !== undefined ? String(Number(x)) : '');
  return {
    offerDate: o?.offerDate ?? d, validUntil: o?.validUntil ?? plusDays(d, OFFER_DEFAULTS.validityDays), candidateNameAr: str(o?.candidateNameAr), candidateNameEn: str(o?.candidateNameEn),
    nationality: str(o?.nationality), idType: str(o?.idType), idNumber: str(o?.idNumber), mobile: str(o?.mobile), email: str(o?.email), jobTitleAr: str(o?.jobTitleAr), jobTitleEn: str(o?.jobTitleEn),
    department: str(o?.department), reportsTo: str(o?.reportsTo), workLocation: str(o?.workLocation), contractType: o?.contractType ?? OFFER_DEFAULTS.contractType, durationMonths: n(o?.durationMonths, 12),
    employmentType: o?.employmentType ?? OFFER_DEFAULTS.employmentType, startDate: o?.startDate ?? plusDays(d, 30), probationDays: n(o?.probationDays, OFFER_DEFAULTS.probationDays),
    weeklyHours: n(o?.weeklyHours, OFFER_DEFAULTS.weeklyHours), workDays: o ? str(o.workDays) : OFFER_DEFAULTS.workDays, annualLeaveDays: n(o?.annualLeaveDays, OFFER_DEFAULTS.annualLeaveDays),
    noticeDays: o ? n(o.noticeDays) : String(OFFER_DEFAULTS.noticeDays), basicSalary: m(o?.basicSalary), housingAllowance: o ? m(o.housingAllowance) : '', transportAllowance: o ? m(o.transportAllowance) : '',
    otherAllowances: o?.otherAllowances.map((a) => ({ label: a.label, amount: String(Number(a.amount)) })) ?? [], medicalInsurance: o?.medicalInsurance ?? 'employee', annualTicket: o?.annualTicket ?? 'none',
    otherBenefits: str(o?.otherBenefits), termsAr: str(o?.termsAr), notes: str(o?.notes),
  };
};

export function OfferForm({ offer, onSaved, onCancel }: { offer: Offer | null; onSaved: (o: Offer) => void; onCancel?: () => void }) {
  const { bi } = useI18n();
  const [d, setD] = useState<OfferDraft>(() => fromOffer(offer));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<OfferDraft>) => setD((x) => ({ ...x, ...p }));
  const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);
  const moneyFields = [d.basicSalary, d.housingAllowance || '0', d.transportAllowance || '0', ...d.otherAllowances.map((a) => a.amount)];
  const problem = !d.candidateNameAr.trim() ? bi('أدخل اسم المرشح', 'Enter the candidate name')
    : !d.jobTitleAr.trim() ? bi('أدخل المسمى الوظيفي', 'Enter the job title')
    : !moneyOk(d.basicSalary) || Number(d.basicSalary) <= 0 ? bi('أدخل الراتب الأساسي', 'Enter the basic salary')
    : moneyFields.some((x) => !moneyOk(x)) ? bi('تحقق من مبالغ البدلات', 'Check the allowance amounts')
    : d.otherAllowances.some((a) => !a.label.trim()) ? bi('أدخل اسم كل بدل', 'Name every allowance')
    : [d.probationDays, d.weeklyHours, d.annualLeaveDays].some((x) => Number.isNaN(int(x))) ? bi('تحقق من الأرقام (التجربة، الساعات، الإجازة)', 'Check probation, hours and leave')
    : idNumberProblem((d.idType || null) as IdType | null, d.idNumber.trim() || null) ? bi('رقم الهوية غير صحيح', 'The ID number is not valid') : null;
  const issues = problem ? [] : offerIssues({
    nationality: d.nationality, contractType: d.contractType, durationMonths: int(d.durationMonths) || null, probationDays: int(d.probationDays), weeklyHours: int(d.weeklyHours),
    annualLeaveDays: int(d.annualLeaveDays), noticeDays: d.noticeDays.trim() ? int(d.noticeDays) : null, offerDate: d.offerDate, startDate: d.startDate, validUntil: d.validUntil,
    basicSalary: d.basicSalary, housingAllowance: d.housingAllowance || '0', transportAllowance: d.transportAllowance || '0', otherAllowances: d.otherAllowances,
  });

  const save = async () => {
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    const t = (x: string) => x.trim() || null;
    const body = {
      offerDate: d.offerDate, validUntil: d.validUntil, candidateNameAr: d.candidateNameAr.trim(), candidateNameEn: t(d.candidateNameEn), nationality: t(d.nationality),
      idType: d.idType || null, idNumber: t(d.idNumber), mobile: t(d.mobile), email: d.email.trim(), jobTitleAr: d.jobTitleAr.trim(), jobTitleEn: t(d.jobTitleEn), department: t(d.department),
      reportsTo: t(d.reportsTo), workLocation: t(d.workLocation), contractType: d.contractType, durationMonths: d.contractType === 'fixed' ? int(d.durationMonths) || null : null,
      employmentType: d.employmentType, startDate: d.startDate, probationDays: int(d.probationDays), weeklyHours: int(d.weeklyHours), workDays: t(d.workDays), annualLeaveDays: int(d.annualLeaveDays),
      noticeDays: d.noticeDays.trim() ? int(d.noticeDays) : null, basicSalary: d.basicSalary.trim(), housingAllowance: d.housingAllowance.trim() || '0', transportAllowance: d.transportAllowance.trim() || '0',
      otherAllowances: d.otherAllowances.map((a) => ({ label: a.label.trim(), amount: a.amount.trim() })), medicalInsurance: d.medicalInsurance, annualTicket: d.annualTicket,
      otherBenefits: t(d.otherBenefits), termsAr: t(d.termsAr), notes: t(d.notes),
    };
    try {
      const o = offer ? await api.put<Offer>(`/hr/offers/${offer.id}`, { ...body, version: offer.version }) : await api.post<Offer>('/hr/offers', body);
      toast.success(offer ? bi('تم حفظ العرض', 'Offer saved') : bi(`أُنشئ العرض ${o.number}`, `Offer ${o.number} created`));
      onSaved(o);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Card title={bi('المرشح', 'Candidate')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={bi('الاسم بالعربية *', 'Name (Arabic) *')}><Input value={d.candidateNameAr} onChange={(e) => set({ candidateNameAr: e.target.value })} /></Field>
          <Field label={bi('الاسم بالإنجليزية', 'Name (English)')}><Input dir="ltr" value={d.candidateNameEn} onChange={(e) => set({ candidateNameEn: e.target.value })} /></Field>
          <Field label={bi('الجوال', 'Mobile')}><Input dir="ltr" inputMode="tel" value={d.mobile} onChange={(e) => set({ mobile: e.target.value })} placeholder="05XXXXXXXX" /></Field>
          <IdFields v={d} set={set} />
          <Field label={bi('البريد الإلكتروني', 'E-mail')}><Input dir="ltr" type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        </div>
      </Card>

      <Card title={bi('الوظيفة والعقد', 'Job and contract')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={bi('المسمى الوظيفي *', 'Job title (Arabic) *')}><Input value={d.jobTitleAr} onChange={(e) => set({ jobTitleAr: e.target.value })} /></Field>
          <Field label={bi('المسمى بالإنجليزية', 'Job title (English)')}><Input dir="ltr" value={d.jobTitleEn} onChange={(e) => set({ jobTitleEn: e.target.value })} /></Field>
          <Field label={bi('الإدارة / القسم', 'Department')}><Input value={d.department} onChange={(e) => set({ department: e.target.value })} /></Field>
          <Field label={bi('المرجع المباشر', 'Reports to')}><Input value={d.reportsTo} onChange={(e) => set({ reportsTo: e.target.value })} /></Field>
          <Field label={bi('مقر العمل', 'Work location')}><Input value={d.workLocation} onChange={(e) => set({ workLocation: e.target.value })} placeholder={bi('مثال: جدة', 'e.g. Jeddah')} /></Field>
          <Field label={bi('تاريخ المباشرة المتوقع *', 'Expected start date *')}><Input type="date" value={d.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label={bi('نوع العقد', 'Contract')}><SelectL list={CONTRACT} value={d.contractType} onChange={(x) => set({ contractType: x as OfferDraft['contractType'] })} /></Field>
          {d.contractType === 'fixed' && <Field label={bi('مدة العقد (أشهر)', 'Duration (months)')}><NumInput value={d.durationMonths} onChange={(x) => set({ durationMonths: x })} min={1} step="1" ariaLabel={bi('المدة', 'Duration')} /></Field>}
          <Field label={bi('نوع الدوام', 'Employment')}><SelectL list={EMPLOYMENT} value={d.employmentType} onChange={(x) => set({ employmentType: x })} /></Field>
          <Field label={bi('فترة التجربة (يوم)', 'Probation (days)')} hint={bi('حتى 90 يومًا، وتمدد كتابةً حتى 180', 'Up to 90, extendable in writing to 180')}><NumInput value={d.probationDays} onChange={(x) => set({ probationDays: x })} min={0} step="1" ariaLabel={bi('التجربة', 'Probation')} /></Field>
          <Field label={bi('ساعات العمل الأسبوعية', 'Weekly hours')} hint={bi('بحد أقصى 48', 'At most 48')}><NumInput value={d.weeklyHours} onChange={(x) => set({ weeklyHours: x })} min={1} step="1" ariaLabel={bi('الساعات', 'Hours')} /></Field>
          <Field label={bi('أيام العمل', 'Working days')}><Input value={d.workDays} onChange={(e) => set({ workDays: e.target.value })} /></Field>
          <Field label={bi('مدة الإشعار (يوم)', 'Notice (days)')}><NumInput value={d.noticeDays} onChange={(x) => set({ noticeDays: x })} min={0} step="1" ariaLabel={bi('الإشعار', 'Notice')} /></Field>
        </div>
      </Card>

      <Card title={bi('الأجر الشهري (ر.س)', 'Monthly pay (SAR)')}>
        <SalaryFields v={d} set={set} />
      </Card>

      <Card title={bi('المزايا والشروط', 'Benefits and terms')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={bi('الإجازة السنوية (يوم)', 'Annual leave (days)')} hint={bi('لا تقل عن 21', 'At least 21')}><NumInput value={d.annualLeaveDays} onChange={(x) => set({ annualLeaveDays: x })} min={0} step="1" ariaLabel={bi('الإجازة', 'Leave')} /></Field>
          <Field label={bi('التأمين الطبي', 'Medical insurance')}><SelectL list={COVER} value={d.medicalInsurance} onChange={(x) => set({ medicalInsurance: x })} /></Field>
          <Field label={bi('تذكرة السفر السنوية', 'Annual air ticket')}><SelectL list={COVER} value={d.annualTicket} onChange={(x) => set({ annualTicket: x })} /></Field>
          <Field label={bi('مزايا أخرى', 'Other benefits')} className="md:col-span-3"><Textarea rows={2} value={d.otherBenefits} onChange={(e) => set({ otherBenefits: e.target.value })} placeholder={bi('مثال: سيارة عمل، عمولة على المبيعات…', 'e.g. company car, sales commission…')} /></Field>
          <Field label={bi('شروط إضافية تُطبع في الخطاب (سطر لكل شرط)', 'Extra terms printed on the letter (one per line)')} className="md:col-span-3"><Textarea rows={3} value={d.termsAr} onChange={(e) => set({ termsAr: e.target.value })} /></Field>
        </div>
      </Card>

      <Card title={bi('العرض', 'Offer')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={bi('تاريخ العرض', 'Offer date')}><Input type="date" value={d.offerDate} onChange={(e) => set({ offerDate: e.target.value })} /></Field>
          <Field label={bi('صالح حتى', 'Valid until')}><Input type="date" value={d.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></Field>
          <Field label={bi('ملاحظات داخلية (لا تُطبع)', 'Internal notes (not printed)')}><Input value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      </Card>

      {issues.length > 0 && <IssueList issues={issues} />}

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 bg-gradient-to-t from-white/95 to-white/0 px-1 py-3">
        {problem && <span className="me-auto text-xs text-danger">{problem}</span>}
        {onCancel && <Button variant="outline" onClick={onCancel}>{bi('إلغاء', 'Cancel')}</Button>}
        <Button loading={busy} disabled={!!problem} onClick={() => void save()}>{offer ? bi('حفظ التعديلات', 'Save changes') : bi('حفظ كمسودة', 'Save as draft')}</Button>
      </div>
    </div>
  );
}

/** Labor Law checks: errors block issuing, warnings are shown to the approver. */
export function IssueList({ issues }: { issues: OfferIssue[] }) {
  const { bi, locale } = useI18n();
  if (!issues.length) return null;
  return (
    <Card title={bi('مراجعة نظام العمل', 'Labor Law check')}>
      <ul className="grid gap-1 text-sm">
        {issues.map((i) => (
          <li key={i.code} className={i.level === 'error' ? 'text-danger' : 'text-gold-dark'}>
            <b>{i.level === 'error' ? bi('يمنع الإصدار: ', 'Blocks issuing: ') : bi('تنبيه: ', 'Warning: ')}</b>{locale === 'en' ? i.en : i.ar}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ───────────── employee form ─────────────

interface EmpDraft {
  nameAr: string; nameEn: string; nationality: string; idType: string; idNumber: string; idExpiry: string; birthDate: string; gender: string; mobile: string; email: string;
  jobTitleAr: string; jobTitleEn: string; department: string; managerId: string; userId: string; workLocation: string; hireDate: string; contractType: 'unlimited' | 'fixed';
  contractEndDate: string; employmentType: string; probationEndDate: string; annualLeaveDays: string; basicSalary: string; housingAllowance: string; transportAllowance: string;
  otherAllowances: Allowance[]; bankName: string; iban: string; gosiNumber: string; gosiEmployeePercent: string; notes: string;
}

const fromEmployee = (e: Employee | null): EmpDraft => {
  const m = (x: string | undefined) => (x !== undefined ? String(Number(x)) : '');
  return {
    nameAr: str(e?.nameAr), nameEn: str(e?.nameEn), nationality: str(e?.nationality), idType: str(e?.idType), idNumber: str(e?.idNumber), idExpiry: str(e?.idExpiry), birthDate: str(e?.birthDate),
    gender: str(e?.gender), mobile: str(e?.mobile), email: str(e?.email), jobTitleAr: str(e?.jobTitleAr), jobTitleEn: str(e?.jobTitleEn), department: str(e?.department), managerId: str(e?.managerId),
    userId: str(e?.userId), workLocation: str(e?.workLocation), hireDate: e?.hireDate ?? today(), contractType: e?.contractType ?? 'unlimited', contractEndDate: str(e?.contractEndDate),
    employmentType: e?.employmentType ?? 'full_time', probationEndDate: str(e?.probationEndDate), annualLeaveDays: String(e?.annualLeaveDays ?? 21), basicSalary: m(e?.basicSalary),
    housingAllowance: e ? m(e.housingAllowance) : '', transportAllowance: e ? m(e.transportAllowance) : '', otherAllowances: e?.otherAllowances.map((a) => ({ label: a.label, amount: String(Number(a.amount)) })) ?? [],
    bankName: str(e?.bankName), iban: str(e?.iban), gosiNumber: str(e?.gosiNumber), gosiEmployeePercent: e ? String(Number(e.gosiEmployeePercent)) : '', notes: str(e?.notes),
  };
};

export function EmployeeForm({ employee, onSaved, onCancel }: { employee: Employee | null; onSaved: (e: Employee) => void; onCancel?: () => void }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const [d, setD] = useState<EmpDraft>(() => fromEmployee(employee));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<EmpDraft>) => setD((x) => ({ ...x, ...p }));
  const people = useQuery({ queryKey: ['hr-employees', 'picker'], queryFn: () => api.get<{ rows: { id: string; number: string; nameAr: string; status: string }[] }>('/hr/employees?limit=200') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ id: string; email: string; nameAr: string | null }[]>('/users'), enabled: can('admin.users') });
  const iban = d.iban.replace(/\s+/g, '').toUpperCase();
  const moneyFields = [d.basicSalary, d.housingAllowance || '0', d.transportAllowance || '0', ...d.otherAllowances.map((a) => a.amount)];
  const problem = !d.nameAr.trim() ? bi('أدخل اسم الموظف', 'Enter the name')
    : !d.jobTitleAr.trim() ? bi('أدخل المسمى الوظيفي', 'Enter the job title')
    : !moneyOk(d.basicSalary) ? bi('أدخل الراتب الأساسي', 'Enter the basic salary')
    : moneyFields.some((x) => !moneyOk(x)) ? bi('تحقق من مبالغ البدلات', 'Check the allowance amounts')
    : d.otherAllowances.some((a) => !a.label.trim()) ? bi('أدخل اسم كل بدل', 'Name every allowance')
    : d.contractType === 'fixed' && !d.contractEndDate ? bi('أدخل تاريخ نهاية العقد', 'Enter the contract end date')
    : d.gosiEmployeePercent.trim() && !/^\d{1,2}(\.\d{1,2})?$/.test(d.gosiEmployeePercent.trim()) ? bi('نسبة التأمينات غير صحيحة', 'Invalid GOSI percent')
    : iban && !/^SA\d{22}$/.test(iban) ? bi('الآيبان يبدأ بـ SA ويليه 22 رقمًا', 'IBAN is SA + 22 digits')
    : idNumberProblem((d.idType || null) as IdType | null, d.idNumber.trim() || null) ? bi('رقم الهوية غير صحيح', 'The ID number is not valid') : null;

  const save = async () => {
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    const t = (x: string) => x.trim() || null;
    const body = {
      nameAr: d.nameAr.trim(), nameEn: t(d.nameEn), nationality: t(d.nationality), idType: d.idType || null, idNumber: t(d.idNumber), idExpiry: d.idExpiry || null, birthDate: d.birthDate || null,
      gender: d.gender || null, mobile: t(d.mobile), email: d.email.trim(), jobTitleAr: d.jobTitleAr.trim(), jobTitleEn: t(d.jobTitleEn), department: t(d.department), managerId: d.managerId || null,
      userId: d.userId || null, workLocation: t(d.workLocation), hireDate: d.hireDate, contractType: d.contractType, contractEndDate: d.contractType === 'fixed' ? d.contractEndDate || null : null,
      employmentType: d.employmentType, probationEndDate: d.probationEndDate || null, annualLeaveDays: Number(d.annualLeaveDays) || 0, basicSalary: d.basicSalary.trim(),
      housingAllowance: d.housingAllowance.trim() || '0', transportAllowance: d.transportAllowance.trim() || '0', otherAllowances: d.otherAllowances.map((a) => ({ label: a.label.trim(), amount: a.amount.trim() })),
      bankName: t(d.bankName), iban, gosiNumber: t(d.gosiNumber), gosiEmployeePercent: d.gosiEmployeePercent.trim() || null, notes: t(d.notes),
    };
    try {
      const e = employee ? await api.put<Employee>(`/hr/employees/${employee.id}`, { ...body, version: employee.version }) : await api.post<Employee>('/hr/employees', body);
      toast.success(employee ? bi('تم حفظ بيانات الموظف', 'Employee saved') : bi(`أُضيف الموظف ${e.number}`, `Employee ${e.number} added`));
      onSaved(e);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Card title={bi('البيانات الشخصية', 'Personal details')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={bi('الاسم بالعربية *', 'Name (Arabic) *')}><Input value={d.nameAr} onChange={(e) => set({ nameAr: e.target.value })} /></Field>
          <Field label={bi('الاسم بالإنجليزية', 'Name (English)')}><Input dir="ltr" value={d.nameEn} onChange={(e) => set({ nameEn: e.target.value })} /></Field>
          <Field label={bi('الجنس', 'Gender')}><Select value={d.gender} onChange={(e) => set({ gender: e.target.value })}><option value="">—</option><option value="male">{bi('ذكر', 'Male')}</option><option value="female">{bi('أنثى', 'Female')}</option></Select></Field>
          <IdFields v={d} set={set} />
          <Field label={bi('انتهاء الهوية / الإقامة', 'ID / iqama expiry')}><Input type="date" value={d.idExpiry} onChange={(e) => set({ idExpiry: e.target.value })} /></Field>
          <Field label={bi('تاريخ الميلاد', 'Date of birth')}><Input type="date" value={d.birthDate} onChange={(e) => set({ birthDate: e.target.value })} /></Field>
          <Field label={bi('الجوال', 'Mobile')}><Input dir="ltr" inputMode="tel" value={d.mobile} onChange={(e) => set({ mobile: e.target.value })} placeholder="05XXXXXXXX" /></Field>
          <Field label={bi('البريد الإلكتروني', 'E-mail')}><Input dir="ltr" type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        </div>
      </Card>

      <Card title={bi('الوظيفة', 'Job')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={bi('المسمى الوظيفي *', 'Job title (Arabic) *')}><Input value={d.jobTitleAr} onChange={(e) => set({ jobTitleAr: e.target.value })} /></Field>
          <Field label={bi('المسمى بالإنجليزية', 'Job title (English)')}><Input dir="ltr" value={d.jobTitleEn} onChange={(e) => set({ jobTitleEn: e.target.value })} /></Field>
          <Field label={bi('الإدارة / القسم', 'Department')}><Input value={d.department} onChange={(e) => set({ department: e.target.value })} /></Field>
          <Field label={bi('المدير المباشر', 'Manager')}>
            <Select value={d.managerId} onChange={(e) => set({ managerId: e.target.value })}>
              <option value="">—</option>
              {people.data?.rows.filter((p) => p.id !== employee?.id && p.status !== 'terminated').map((p) => <option key={p.id} value={p.id}>{p.nameAr} ({p.number})</option>)}
            </Select>
          </Field>
          <Field label={bi('مقر العمل', 'Work location')}><Input value={d.workLocation} onChange={(e) => set({ workLocation: e.target.value })} /></Field>
          {can('admin.users') && (
            <Field label={bi('حساب الدخول للنظام', 'System login')}>
              <Select value={d.userId} onChange={(e) => set({ userId: e.target.value })}>
                <option value="">{bi('— بدون —', '— none —')}</option>
                {users.data?.map((u) => <option key={u.id} value={u.id}>{u.nameAr || u.email}</option>)}
              </Select>
            </Field>
          )}
          <Field label={bi('تاريخ المباشرة *', 'Hire date *')}><Input type="date" value={d.hireDate} onChange={(e) => set({ hireDate: e.target.value })} /></Field>
          <Field label={bi('نوع العقد', 'Contract')}><SelectL list={CONTRACT} value={d.contractType} onChange={(x) => set({ contractType: x as EmpDraft['contractType'] })} /></Field>
          {d.contractType === 'fixed' && <Field label={bi('نهاية العقد *', 'Contract end *')}><Input type="date" value={d.contractEndDate} onChange={(e) => set({ contractEndDate: e.target.value })} /></Field>}
          <Field label={bi('نوع الدوام', 'Employment')}><SelectL list={EMPLOYMENT} value={d.employmentType} onChange={(x) => set({ employmentType: x })} /></Field>
          <Field label={bi('نهاية فترة التجربة', 'Probation ends')}><Input type="date" value={d.probationEndDate} onChange={(e) => set({ probationEndDate: e.target.value })} /></Field>
          <Field label={bi('الإجازة السنوية (يوم)', 'Annual leave (days)')}><NumInput value={d.annualLeaveDays} onChange={(x) => set({ annualLeaveDays: x })} min={0} step="1" ariaLabel={bi('الإجازة', 'Leave')} /></Field>
        </div>
      </Card>

      <Card title={bi('الأجر الشهري (ر.س)', 'Monthly pay (SAR)')}>
        <SalaryFields v={d} set={set} />
      </Card>

      <Card title={bi('البنك والتأمينات', 'Bank and GOSI')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={bi('البنك', 'Bank')}><Input value={d.bankName} onChange={(e) => set({ bankName: e.target.value })} /></Field>
          <Field label={bi('الآيبان', 'IBAN')}><Input dir="ltr" value={d.iban} onChange={(e) => set({ iban: e.target.value })} placeholder="SA00 0000 0000 0000 0000 0000" /></Field>
          <Field label={bi('رقم الاشتراك في التأمينات', 'GOSI number')}><Input dir="ltr" value={d.gosiNumber} onChange={(e) => set({ gosiNumber: e.target.value })} /></Field>
          <Field label={bi('حصة الموظف في التأمينات %', 'Employee GOSI share %')} hint={bi('فارغ = 9.75% للسعودي و0 لغيره. راجع النسبة لمن سُجّل بعد يوليو 2024.', 'Empty = 9.75 % for Saudis, 0 otherwise. Check the rate for staff registered after July 2024.')}>
            <NumInput value={d.gosiEmployeePercent} onChange={(x) => set({ gosiEmployeePercent: x })} min={0} step="0.01" ariaLabel={bi('نسبة التأمينات', 'GOSI %')} />
          </Field>
          <Field label={bi('ملاحظات', 'Notes')} className="md:col-span-3"><Textarea rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 bg-gradient-to-t from-white/95 to-white/0 px-1 py-3">
        {problem && <span className="me-auto text-xs text-danger">{problem}</span>}
        {onCancel && <Button variant="outline" onClick={onCancel}>{bi('إلغاء', 'Cancel')}</Button>}
        <Button loading={busy} disabled={!!problem} onClick={() => void save()}>{employee ? bi('حفظ التعديلات', 'Save changes') : bi('إضافة الموظف', 'Add employee')}</Button>
      </div>
    </div>
  );
}
