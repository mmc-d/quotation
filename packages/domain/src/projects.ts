/**
 * Projects & execution (module 05): stages, stage gates, the contractual delivery clock, warranty dates.
 * Pure rules — the API gathers the facts (payments, approvals, tests, snags) and asks these functions.
 */
import { addBusinessDays, businessDaysBetween, type CompanyCalendar } from './calendar.js';

export const PROJECT_STAGES = ['kickoff', 'procurement', 'delivery', 'installation', 'commissioning', 'handover', 'warranty', 'closed'] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, { ar: string; en: string }> = {
  kickoff: { ar: 'الانطلاق', en: 'Kick-off' },
  procurement: { ar: 'التوريد والشراء', en: 'Procurement' },
  delivery: { ar: 'التوريد للموقع', en: 'Delivery to site' },
  installation: { ar: 'التركيب', en: 'Installation' },
  commissioning: { ar: 'البرمجة والاختبار', en: 'Programming & testing' },
  handover: { ar: 'إغلاق الملاحظات والتسليم', en: 'Snags & handover' },
  warranty: { ar: 'الضمان', en: 'Warranty' },
  closed: { ar: 'مغلق', en: 'Closed' },
};

/** Client approval package kinds that start the delivery clock (module 05 PRJ-20). */
export const APPROVAL_KINDS = ['specs', 'door_directions', 'room_numbers', 'design', 'other'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export const REQUIRED_APPROVALS: ApprovalKind[] = ['specs', 'door_directions', 'room_numbers', 'design'];

/** Facts about a project the gates are evaluated on. Dates are YYYY-MM-DD (Asia/Riyadh). */
export interface ProjectFacts {
  /** date the advance (first milestone) was paid in full, or null */
  advancePaidOn: string | null;
  /** second milestone (40% before delivery) paid in full */
  deliveryPaymentPaid: boolean;
  /** approval kinds the project requires (default REQUIRED_APPROVALS); an empty list waives them */
  requiredApprovals: ApprovalKind[];
  /** approved approval packages: kind → approval date */
  approvedOn: Partial<Record<ApprovalKind, string>>;
  materialsReady: boolean;
  /** devices registered on the project */
  assetCount: number;
  /** registered devices without a passed commissioning test */
  assetsUntested: number;
  /** the final (10%) payment request / 388 has been issued */
  finalInvoiced: boolean;
  /** open (not verified) snags */
  openSnags: number;
  /** client acceptance (handover certificate) date, or null */
  acceptedOn: string | null;
}

export interface GateCheck { key: string; ok: boolean; ar: string; en: string }
export interface GateResult { from: ProjectStage; to: ProjectStage; ok: boolean; checks: GateCheck[] }

const c = (key: string, ok: boolean, ar: string, en: string): GateCheck => ({ key, ok, ar, en });

/** What must hold to move from `from` to the next stage. Stages without a gate only need a manual move. */
export function gateFor(from: ProjectStage, f: ProjectFacts): GateResult {
  const i = PROJECT_STAGES.indexOf(from);
  const to = PROJECT_STAGES[Math.min(i + 1, PROJECT_STAGES.length - 1)]!;
  let checks: GateCheck[] = [];
  switch (from) {
    case 'kickoff': {
      checks.push(c('advance', !!f.advancePaidOn, 'استلام الدفعة المقدمة', 'Advance payment received'));
      for (const k of f.requiredApprovals) checks.push(c(`approval:${k}`, !!f.approvedOn[k], `اعتماد العميل: ${APPROVAL_LABELS[k].ar}`, `Client approval: ${APPROVAL_LABELS[k].en}`));
      break;
    }
    case 'procurement':
      checks = [
        c('delivery_payment', f.deliveryPaymentPaid, 'استلام دفعة ما قبل التوريد (40%)', 'Pre-delivery payment (40%) received'),
        c('materials', f.materialsReady, 'المواد جاهزة', 'Materials ready'),
      ];
      break;
    case 'installation':
      checks = [c('assets', f.assetCount > 0, 'تسجيل الأجهزة المركبة', 'Installed devices registered')];
      break;
    case 'commissioning':
      checks = [
        c('tests', f.assetCount > 0 && f.assetsUntested === 0, 'نجاح اختبارات التشغيل لكل الأجهزة', 'Commissioning tests passed for every device'),
        c('final_invoice', f.finalInvoiced, 'إصدار طلب الدفعة الأخيرة (10%)', 'Final (10%) payment requested'),
      ];
      break;
    case 'handover':
      checks = [
        c('snags', f.openSnags === 0, 'إغلاق جميع الملاحظات', 'All snags closed'),
        c('acceptance', !!f.acceptedOn, 'توقيع محضر الاستلام', 'Acceptance certificate signed'),
      ];
      break;
    default:
      checks = [];
  }
  return { from, to, ok: checks.every((x) => x.ok), checks };
}

export const APPROVAL_LABELS: Record<ApprovalKind, { ar: string; en: string }> = {
  specs: { ar: 'المواصفات', en: 'Specifications' },
  door_directions: { ar: 'اتجاهات الأبواب', en: 'Door directions' },
  room_numbers: { ar: 'ترقيم الوحدات', en: 'Room / unit numbering' },
  design: { ar: 'التصميم', en: 'Design' },
  other: { ar: 'أخرى', en: 'Other' },
};

/** Clock start = the later of the advance date and the last required approval (module 05 §2). */
export function clockStartDate(f: Pick<ProjectFacts, 'advancePaidOn' | 'requiredApprovals' | 'approvedOn'>): string | null {
  if (!f.advancePaidOn) return null;
  let start = f.advancePaidOn;
  for (const k of f.requiredApprovals) {
    const d = f.approvedOn[k];
    if (!d) return null;
    if (d > start) start = d;
  }
  return start;
}

export interface ClockPause { from: string; to: string | null }

export interface DeliveryClock {
  started: boolean;
  startDate: string | null;
  /** business days counted so far, pauses excluded */
  elapsed: number;
  pausedDays: number;
  paused: boolean;
  minDays: number;
  maxDays: number;
  /** target dates on the company calendar, shifted by extensions and pauses so far */
  targetMin: string | null;
  targetMax: string | null;
  /** elapsed ÷ maxDays */
  ratio: number;
  level: 'not_started' | 'ok' | 'warn70' | 'warn90' | 'overdue' | 'stopped';
}

/**
 * Contractual delivery clock in working days (module 05 PRJ-04). Extensions (approved change orders,
 * documented delays) add days to both bounds; pauses don't count. Warnings at 70% / 90% of the max
 * window. `stoppedOn` = the date delivery was completed (handover reached) — the clock freezes there.
 */
export function deliveryClock(input: {
  startDate: string | null; today: string; minDays: number; maxDays: number; extensionDays?: number;
  pauses?: ClockPause[]; stoppedOn?: string | null; calendar: CompanyCalendar;
}): DeliveryClock {
  const { startDate, calendar } = input;
  const ext = input.extensionDays ?? 0;
  const minDays = input.minDays + ext;
  const maxDays = input.maxDays + ext;
  if (!startDate) return { started: false, startDate: null, elapsed: 0, pausedDays: 0, paused: false, minDays, maxDays, targetMin: null, targetMax: null, ratio: 0, level: 'not_started' };
  const end = input.stoppedOn ?? input.today;
  const total = end <= startDate ? 0 : businessDaysBetween(startDate, end, calendar);
  let pausedDays = 0;
  let paused = false;
  for (const p of input.pauses ?? []) {
    const from = p.from < startDate ? startDate : p.from;
    const to = p.to ?? end;
    if (!p.to && !input.stoppedOn) paused = true;
    const capped = to > end ? end : to;
    if (capped > from) pausedDays += businessDaysBetween(from, capped, calendar);
  }
  const elapsed = Math.max(0, total - pausedDays);
  const ratio = maxDays > 0 ? elapsed / maxDays : 0;
  const level: DeliveryClock['level'] = input.stoppedOn ? 'stopped' : ratio > 1 ? 'overdue' : ratio >= 0.9 ? 'warn90' : ratio >= 0.7 ? 'warn70' : 'ok';
  return {
    started: true, startDate, elapsed, pausedDays, paused, minDays, maxDays,
    targetMin: addBusinessDays(startDate, minDays + pausedDays, calendar),
    targetMax: addBusinessDays(startDate, maxDays + pausedDays, calendar),
    ratio: Math.round(ratio * 1000) / 1000, level,
  };
}

/** End of a warranty that starts on `start` and runs `months` months (same day-of-month, clamped). */
export function addMonths(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const total = (m - 1) + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Warranty end dates from the acceptance date (labour and parts may differ; owner to reconcile 12+12 vs 24). */
export function warrantyEnds(acceptedOn: string, labourMonths: number, partsMonths: number) {
  return { labourEnd: addMonths(acceptedOn, labourMonths), partsEnd: addMonths(acceptedOn, partsMonths) };
}
