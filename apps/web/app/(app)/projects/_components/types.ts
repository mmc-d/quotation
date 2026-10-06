import type { ProjectStage } from '@mmc/domain';

export type ClockLevel = 'not_started' | 'ok' | 'warn70' | 'warn90' | 'overdue' | 'stopped';

export interface Clock {
  started: boolean;
  startDate: string | null;
  elapsed: number;
  pausedDays: number;
  paused: boolean;
  minDays: number;
  maxDays: number;
  targetMin: string | null;
  targetMax: string | null;
  ratio: number;
  level: ClockLevel;
}

export interface ClockSummary { level: ClockLevel; elapsed: number; minDays: number; maxDays: number; targetMax: string | null; startDate: string | null; paused: boolean; ratio: number }

export interface ProjectRow {
  id: string; number: string; name: string; stage: ProjectStage; status: string; managerId: string | null; contractId: string | null; partyId: string | null;
  customerName: string | null; contractNumber: string | null; clock: ClockSummary;
}

export interface ProjectSummary {
  total: number;
  byStage: Record<ProjectStage, number>;
  clocks: Record<ClockLevel, number>;
  openSnags: number;
  atRisk: { id: string; number: string; name: string; level: ClockLevel; elapsed: number; maxDays: number; targetMax: string | null }[];
}

export interface GateCheck { key: string; ok: boolean; ar: string; en: string }
export interface Gate { from: ProjectStage; to: ProjectStage; ok: boolean; checks: GateCheck[] }

export interface Pause { id: string; fromDate: string; toDate: string | null; kind: string; reason: string }
export interface Task { id: string; stage: ProjectStage; title: string; status: 'todo' | 'doing' | 'done'; assigneeId: string | null; assigneeName: string | null; dueDate: string | null; locationPath: string | null; doneAt: string | null }
export interface Approval { id: string; kind: string; title: string; revision: number; status: string; notes: string | null; approvedOn: string | null; approvedByName: string | null; rejectionReason: string | null; createdAt: string }
export interface ApprovalGroup { kind: string; label: { ar: string; en: string } | null; required: boolean; latest: Approval; history: Approval[] }
export interface Snag { id: string; description: string; status: 'open' | 'fixed' | 'verified'; assigneeId: string | null; assigneeName: string | null; dueDate: string | null; locationPath: string | null; fixedAt: string | null; verifiedAt: string | null; verifiedByName: string | null; createdAt: string }
export interface Asset { id: string; code: string; description: string | null; serial: string | null; mac: string | null; ip: string | null; locationPath: string | null; testPassed: boolean | null; labourWarrantyEnd: string | null; partsWarrantyEnd: string | null; status: string }
export interface WorkOrderRow { id: string; number: string; type: string; status: string; title: string; scheduledStart: string | null }
export interface Milestone { id: string; sort: number; nameAr: string; nameEn: string | null; percent: string; amount: string; paidAmount: string; status: string; dueDate: string | null }
export interface StageLogRow { id: string; fromStage: ProjectStage; toStage: ProjectStage; overriddenChecks: string[]; reason: string | null; by: string | null; byName: string | null; at: string }

export interface ProjectView {
  id: string; number: string; name: string; stage: ProjectStage; status: string; version: number;
  templateKey: string; template: { key: string; ar?: string; en?: string };
  managerId: string | null; managerName: string | null; ownerName: string | null;
  requiredApprovals: string[]; materialsReady: boolean;
  clockMinDays: number; clockMaxDays: number; clockExtensionDays: number; clockStartedOn: string | null;
  deliveredOn: string | null; acceptedOn: string | null; acceptedByName: string | null;
  warrantyLabourMonths: number; warrantyPartsMonths: number; plannedStart: string | null; notes: string | null;
  stageLabel: { ar: string; en: string } | null;
  customer: { id: string; nameAr: string; nameEn: string | null; phone: string | null } | null;
  site: { id: string; name: string; address: string | null; mapLink: string | null } | null;
  contract: { id: string; number: string; title: string; status: string; total: string; vatOn: boolean; signedAt: string | null } | null;
  milestones: Milestone[];
  gate: Gate;
  clock: Clock;
  pauses: Pause[];
  tasks: Task[];
  approvals: ApprovalGroup[];
  snags: Snag[];
  assets: Asset[];
  assetsHidden: boolean;
  workOrders: WorkOrderRow[];
  stageLog: StageLogRow[];
}

export const TEMPLATES: { value: string; ar: string; en: string }[] = [
  { value: 'villa_intercom', ar: 'انتركوم فيلا', en: 'Villa intercom' },
  { value: 'building_intercom', ar: 'انتركوم مبنى', en: 'Building intercom' },
  { value: 'smart_home', ar: 'منزل ذكي', en: 'Smart home' },
  { value: 'smart_locks', ar: 'أقفال ذكية', en: 'Smart locks' },
  { value: 'iot', ar: 'إنترنت الأشياء / LoRaWAN', en: 'IoT / LoRaWAN' },
  { value: 'other', ar: 'أخرى', en: 'Other' },
];

export const PAUSE_KINDS: { value: string; ar: string; en: string }[] = [
  { value: 'client_delay', ar: 'تأخير من العميل', en: 'Client delay' },
  { value: 'consultant_delay', ar: 'تأخير من الاستشاري', en: 'Consultant delay' },
  { value: 'site_not_ready', ar: 'الموقع غير جاهز', en: 'Site not ready' },
  { value: 'other', ar: 'أخرى', en: 'Other' },
];

/** Clock level → bar colour, text colour, labels. */
export const CLOCK_LEVEL: Record<ClockLevel, { bar: string; text: string; chip: string; ar: string; en: string }> = {
  not_started: { bar: 'bg-gray-300', text: 'text-muted', chip: 'bg-gray-100 text-gray-700', ar: 'لم يبدأ', en: 'Not started' },
  ok: { bar: 'bg-emerald-500', text: 'text-ok', chip: 'bg-emerald-100 text-emerald-800', ar: 'ضمن المدة', en: 'On track' },
  warn70: { bar: 'bg-amber-400', text: 'text-amber-700', chip: 'bg-amber-100 text-amber-800', ar: 'تجاوز 70%', en: 'Over 70%' },
  warn90: { bar: 'bg-orange-500', text: 'text-orange-700', chip: 'bg-orange-100 text-orange-800', ar: 'تجاوز 90%', en: 'Over 90%' },
  overdue: { bar: 'bg-rose-600', text: 'text-danger', chip: 'bg-rose-100 text-rose-800', ar: 'متأخر', en: 'Overdue' },
  stopped: { bar: 'bg-primary', text: 'text-primary', chip: 'bg-primary-50 text-primary', ar: 'اكتمل التوريد', en: 'Delivered' },
};

export const PROJECT_STATUS: Record<string, { ar: string; en: string; chip: string }> = {
  active: { ar: 'نشط', en: 'Active', chip: 'bg-emerald-100 text-emerald-800' },
  on_hold: { ar: 'معلّق', en: 'On hold', chip: 'bg-amber-100 text-amber-800' },
  cancelled: { ar: 'ملغى', en: 'Cancelled', chip: 'bg-gray-200 text-gray-600' },
  closed: { ar: 'مغلق', en: 'Closed', chip: 'bg-primary-50 text-primary' },
};

export const APPROVAL_STATUS: Record<string, { ar: string; en: string; chip: string }> = {
  draft: { ar: 'مسودة', en: 'Draft', chip: 'bg-gray-100 text-gray-700' },
  sent: { ar: 'أُرسل للعميل', en: 'Sent to client', chip: 'bg-indigo-100 text-indigo-800' },
  approved: { ar: 'معتمد', en: 'Approved', chip: 'bg-emerald-100 text-emerald-800' },
  rejected: { ar: 'مرفوض', en: 'Rejected', chip: 'bg-rose-100 text-rose-800' },
  superseded: { ar: 'مُستبدل', en: 'Superseded', chip: 'bg-gray-100 text-gray-500' },
};

export const SNAG_STATUS: Record<string, { ar: string; en: string; chip: string }> = {
  open: { ar: 'مفتوحة', en: 'Open', chip: 'bg-rose-100 text-rose-800' },
  fixed: { ar: 'تم الإصلاح', en: 'Fixed', chip: 'bg-amber-100 text-amber-800' },
  verified: { ar: 'تم التحقق', en: 'Verified', chip: 'bg-emerald-100 text-emerald-800' },
};
