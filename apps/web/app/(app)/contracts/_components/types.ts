import { buildSchedule, calculateQuote, type MilestoneTrigger } from '@mmc/domain';
import { cleanMoney, cleanQty, newKey, trimNum } from '../../quotes/_components/types';

export interface ClientBlock { name?: string; representative?: string; idNumber?: string; crNumber?: string; vatNumber?: string; address?: string; mobile?: string }
export interface ContractLine { code: string; description: string; qty: string; unitPrice: string }
export interface ContractClause { id: string; templateId: string | null; sort: number; titleAr: string; bodyAr: string; modified: boolean }
export interface ContractMilestone { id: string; sort: number; nameAr: string; nameEn: string | null; percent: string; amount: string; trigger: MilestoneTrigger; dueDate: string | null; status: string; paidAmount: string }
export interface EsignRow { id: string; provider: string; signerName: string; signerNationalId: string | null; signerMobile: string | null; status: string; signingUrl: string | null; documentSha256: string | null; completedAt: string | null; createdAt: string }
export interface ContractDoc { id: string; number: string; fileId: string; sha256: string; issuedAt: string }

export interface ContractView {
  id: string;
  number: string;
  quoteId: string | null;
  partyId: string | null;
  ownerId: string | null;
  title: string;
  subtitle: string | null;
  templateSet: TemplateSet;
  clientBlock: ClientBlock;
  status: string;
  contractDate: string;
  startDate: string | null;
  endDate: string | null;
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  warrantyMonths: number | null;
  partsWarrantyMonths: number | null;
  sparePartsYears: number | null;
  vatOn: boolean;
  subtotal: string;
  discountAmount: string;
  vatAmount: string;
  total: string;
  lines: ContractLine[];
  stampApplied: boolean;
  signedAt: string | null;
  version: number;
  clauses: ContractClause[];
  milestones: ContractMilestone[];
  quote: { id: string; number: string; revision: number } | null;
  documents: ContractDoc[];
  esignRequests: EsignRow[];
}

export interface ClauseTemplate { id: string; key: string; category: string; titleAr: string; bodyAr: string; sort: number; active: boolean; clauseVersion: number; templateSet: TemplateSet }

/** Contract template sets (each has its own clause library in Settings → Documents). */
export type TemplateSet = 'supply_install' | 'supply_only' | 'maintenance';
export const TEMPLATE_SETS: { value: TemplateSet; label: string; hint: string }[] = [
  { value: 'supply_install', label: 'توريد وتركيب', hint: 'توريد المواد وتركيبها وبرمجتها — دفعات 50/40/10' },
  { value: 'supply_only', label: 'توريد فقط', hint: 'توريد المواد دون تركيب — ضمان على المواد، دفعات 50/50' },
  { value: 'maintenance', label: 'عقد صيانة سنوي', hint: 'زيارات وقائية وأوقات استجابة لمدة 12 شهرًا — أربعة أقساط ربع سنوية' },
];
export const templateSetLabel = (v: string | null | undefined) => TEMPLATE_SETS.find((t) => t.value === v)?.label ?? v ?? '—';

/** Change orders (GET /change-orders). Money fields are NUMERIC strings (SAR); qty may be negative (removal). */
export interface ChangeOrderLine { code: string; description: string; qty: string; unitPrice: string }
export interface ChangeOrderRow {
  id: string; contractId: string; number: string; description: string; reason: string | null; lines: ChangeOrderLine[];
  subtotalDelta: string; vatDelta: string; amountDelta: string; status: string;
  approvedBy: string | null; approvedAt: string | null; signedAt: string | null; milestoneId: string | null;
  createdBy: string | null; createdAt: string; version: number;
}
export interface ChangeOrderView extends ChangeOrderRow {
  createdByName: string | null; approvedByName: string | null;
  milestone: ContractMilestone | null;
  paymentRequests: { id: string; number: string; amount: string; paidAmount: string; status: string; dueDate: string; publicToken: string | null }[];
  invoices: { id: string; number: string; typeCode: string; total: string; balanceDue: string; issueDate: string }[];
}
export const CO_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'مسودة', cls: 'bg-gray-100 text-gray-700' },
  pending_approval: { label: 'بانتظار الموافقة', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'معتمد', cls: 'bg-sky-100 text-sky-800' },
  signed: { label: 'وافق العميل', cls: 'bg-emerald-100 text-emerald-800' },
  billed: { label: 'مفوتر', cls: 'bg-primary-50 text-primary' },
  rejected: { label: 'مرفوض', cls: 'bg-rose-100 text-rose-800' },
  cancelled: { label: 'ملغى', cls: 'bg-gray-200 text-gray-600' },
};

export interface DraftLine extends ContractLine { key: string }
export interface DraftClause { key: string; templateId: string | null; titleAr: string; bodyAr: string }
export interface DraftMilestone { key: string; nameAr: string; nameEn: string; percent: string; trigger: MilestoneTrigger; dueDate: string }

export interface ContractDraft {
  title: string;
  subtitle: string;
  clientBlock: Required<ClientBlock>;
  contractDate: string;
  deliveryDaysMin: string;
  deliveryDaysMax: string;
  warrantyMonths: string;
  partsWarrantyMonths: string;
  sparePartsYears: string;
  discountAmount: string;
  lines: DraftLine[];
  clauses: DraftClause[];
  milestones: DraftMilestone[];
}

export const TRIGGERS: { value: MilestoneTrigger; label: string }[] = [
  { value: 'on_signing', label: 'عند توقيع العقد' },
  { value: 'before_delivery', label: 'قبل توريد المواد' },
  { value: 'after_programming', label: 'بعد البرمجة والتسليم' },
  { value: 'on_handover', label: 'عند التسليم' },
  { value: 'on_date', label: 'في تاريخ محدد' },
  { value: 'manual', label: 'يدوي' },
];

const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function contractDraft(c: ContractView): ContractDraft {
  const b = c.clientBlock ?? {};
  return {
    title: c.title,
    subtitle: c.subtitle ?? '',
    clientBlock: { name: b.name ?? '', representative: b.representative ?? '', idNumber: b.idNumber ?? '', crNumber: b.crNumber ?? '', vatNumber: b.vatNumber ?? '', address: b.address ?? '', mobile: b.mobile ?? '' },
    contractDate: c.contractDate,
    deliveryDaysMin: s(c.deliveryDaysMin),
    deliveryDaysMax: s(c.deliveryDaysMax),
    warrantyMonths: s(c.warrantyMonths),
    partsWarrantyMonths: s(c.partsWarrantyMonths),
    sparePartsYears: s(c.sparePartsYears),
    discountAmount: Number(c.discountAmount) ? trimNum(c.discountAmount) : '',
    lines: c.lines.map((l, i) => ({ key: `l${i}`, code: l.code, description: l.description, qty: trimNum(l.qty), unitPrice: trimNum(l.unitPrice) })),
    clauses: c.clauses.map((x) => ({ key: x.id, templateId: x.templateId, titleAr: x.titleAr, bodyAr: x.bodyAr })),
    milestones: c.milestones.map((m) => ({ key: m.id, nameAr: m.nameAr, nameEn: m.nameEn ?? '', percent: trimNum(m.percent), trigger: m.trigger, dueDate: m.dueDate ?? '' })),
  };
}

export const blankLine = (): DraftLine => ({ key: newKey(), code: '', description: '', qty: '1', unitPrice: '' });
export const blankMilestone = (percent = ''): DraftMilestone => ({ key: newKey(), nameAr: '', nameEn: '', percent, trigger: 'manual', dueDate: '' });

export function percentSum(ms: DraftMilestone[]): number {
  return Math.round(ms.reduce((t, m) => t + (Number(m.percent) || 0), 0) * 10000) / 10000;
}

export function calcContract(d: ContractDraft, vatOn: boolean, vatRegistered: boolean) {
  const calc = calculateQuote({
    lines: d.lines.map((l) => ({ code: l.code || '-', description: l.description, listPrice: cleanMoney(l.unitPrice), unitPrice: cleanMoney(l.unitPrice), qty: cleanQty(l.qty) })),
    discount: { type: 'amount', value: cleanMoney(d.discountAmount) },
    vatRegistered,
    vatOn,
  });
  let schedule: number[] | null = null;
  try {
    schedule = buildSchedule(calc.totals.total, d.milestones.map((m) => ({ name_ar: m.nameAr, name_en: m.nameEn, percent: Number(m.percent) || 0, trigger: m.trigger }))).map((m) => m.amount);
  } catch {
    schedule = null;
  }
  return { calc, schedule };
}

/** Validation messages that block saving. */
export function contractProblems(d: ContractDraft): string[] {
  const out: string[] = [];
  if (!d.title.trim()) out.push('عنوان العقد مطلوب');
  if (!d.contractDate) out.push('تاريخ العقد مطلوب');
  if (!d.lines.length) out.push('أضف بندًا واحدًا على الأقل');
  if (d.lines.some((l) => !l.code.trim() || !l.description.trim())) out.push('كل بند يحتاج رمزًا ووصفًا');
  if (d.clauses.some((c) => !c.titleAr.trim() || !c.bodyAr.trim())) out.push('كل بند قانوني يحتاج عنوانًا ونصًا');
  if (!d.milestones.length) out.push('أضف دفعة واحدة على الأقل');
  if (d.milestones.some((m) => !m.nameAr.trim())) out.push('كل دفعة تحتاج اسمًا');
  if (d.milestones.some((m) => !(Number(m.percent) > 0) || Number(m.percent) > 100)) out.push('نسبة كل دفعة بين 0 و100');
  if (d.milestones.some((m) => m.trigger === 'on_date' && !m.dueDate)) out.push('حدّد تاريخ الاستحقاق للدفعات «في تاريخ محدد»');
  const sum = percentSum(d.milestones);
  if (Math.abs(sum - 100) > 1e-9) out.push(`مجموع نسب الدفعات يجب أن يساوي 100% (الحالي ${sum}%)`);
  const min = d.deliveryDaysMin ? Number(d.deliveryDaysMin) : null;
  const max = d.deliveryDaysMax ? Number(d.deliveryDaysMax) : null;
  if (min !== null && max !== null && min > max) out.push('الحد الأدنى لمدة التوريد أكبر من الحد الأقصى');
  return out;
}

const int = (v: string) => {
  if (!v.trim()) return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function contractBody(d: ContractDraft, version: number) {
  const cb = Object.fromEntries(Object.entries(d.clientBlock).map(([k, v]) => [k, v.trim()]));
  return {
    title: d.title.trim(),
    subtitle: d.subtitle.trim() || null,
    clientBlock: cb,
    contractDate: d.contractDate,
    deliveryDaysMin: int(d.deliveryDaysMin),
    deliveryDaysMax: int(d.deliveryDaysMax),
    warrantyMonths: int(d.warrantyMonths),
    partsWarrantyMonths: int(d.partsWarrantyMonths),
    sparePartsYears: int(d.sparePartsYears),
    discountAmount: cleanMoney(d.discountAmount),
    lines: d.lines.map((l) => ({ code: l.code.trim(), description: l.description.trim(), qty: cleanQty(l.qty), unitPrice: cleanMoney(l.unitPrice) })),
    clauses: d.clauses.map((c) => ({ templateId: c.templateId, titleAr: c.titleAr.trim(), bodyAr: c.bodyAr })),
    milestones: d.milestones.map((m) => ({ nameAr: m.nameAr.trim(), nameEn: m.nameEn.trim() || null, percent: Number(m.percent), trigger: m.trigger, dueDate: m.dueDate || null })),
    version,
  };
}
