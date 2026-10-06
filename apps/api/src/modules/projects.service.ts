import {
  and, appUser, asc, billingMilestone, contract, desc, emit, eq, inArray, installedAsset, isNull, ne, nextNumber, or, party, paymentMirror, paymentRequest,
  project, projectApproval, projectClockPause, projectStageLog, projectTask, quote, site, siteLocation, snag, sql, workOrder, type SQL, type Tx,
} from '@mmc/db';
import {
  APPROVAL_KINDS, APPROVAL_LABELS, PROJECT_STAGE_LABELS, PROJECT_STAGES, REQUIRED_APPROVALS, clockStartDate, deliveryClock, formatNationalAddress, gateFor, riyadhDate, warrantyEnds,
  type ApprovalKind, type CompanyCalendar, type Permission, type ProjectFacts, type ProjectStage,
} from '@mmc/domain';
import type { HandoverDoc } from '@mmc/doc-templates';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { companyBlock } from '../common/company.js';
import { forbidden, notFound } from '../common/errors.js';
import { assertCan, scopeFilter } from '../common/scope.js';
import { loadCalendar } from './calendar.controller.js';
import { CO_TRIGGER, contractFinalInvoice } from './finance.service.js';

export type ProjectRow = typeof project.$inferSelect;

export const TEMPLATE_KEYS = ['villa_intercom', 'building_intercom', 'smart_home', 'smart_locks', 'iot', 'other'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

type StageTasks = Partial<Record<ProjectStage, string[]>>;
const COMMON_KICKOFF = ['اجتماع الانطلاق مع العميل', 'رفع المواصفات والتصميم لاعتماد العميل'];
const COMMON_HANDOVER = ['إغلاق الملاحظات', 'تدريب العميل على الاستخدام', 'إعداد ملف التسليم وتوقيع محضر الاستلام'];

/** Default task lists per project type (PRJ-02). Kept small on purpose — teams add their own tasks. */
export const PROJECT_TEMPLATES: Record<TemplateKey, { ar: string; en: string; tasks: StageTasks }> = {
  villa_intercom: {
    ar: 'انتركوم فيلا', en: 'Villa intercom',
    tasks: {
      kickoff: [...COMMON_KICKOFF, 'زيارة الموقع ورفع المقاسات'],
      procurement: ['طلب الأجهزة من المورد', 'استلام الأجهزة وفحصها'],
      delivery: ['توريد الأجهزة للموقع'],
      installation: ['تمديد الكابلات', 'تركيب الوحدة الخارجية', 'تركيب الشاشات الداخلية'],
      commissioning: ['برمجة الأجهزة وربط التطبيق', 'اختبار الاتصال والفيديو وفتح الباب'],
      handover: COMMON_HANDOVER,
    },
  },
  building_intercom: {
    ar: 'انتركوم مبنى', en: 'Building intercom',
    tasks: {
      kickoff: [...COMMON_KICKOFF, 'اعتماد ترقيم الشقق واتجاهات الأبواب'],
      procurement: ['طلب الأجهزة من المورد', 'استلام الأجهزة وفحصها'],
      delivery: ['توريد الأجهزة للموقع'],
      installation: ['تمديد الكابلات والرايزر', 'تركيب السويتشات والراك', 'تركيب الوحدات الخارجية', 'تركيب الشاشات في الشقق'],
      commissioning: ['برمجة الأجهزة وأرقام الشقق', 'اختبار كل شقة (اتصال، فيديو، فتح)'],
      handover: COMMON_HANDOVER,
    },
  },
  smart_home: {
    ar: 'منزل ذكي', en: 'Smart home',
    tasks: {
      kickoff: [...COMMON_KICKOFF, 'اعتماد سيناريوهات التحكم'],
      procurement: ['طلب الأجهزة من المورد', 'استلام الأجهزة وفحصها'],
      delivery: ['توريد الأجهزة للموقع'],
      installation: ['تركيب المفاتيح والحساسات', 'تركيب البوابة والشبكة'],
      commissioning: ['برمجة السيناريوهات', 'اختبار كل جهاز'],
      handover: COMMON_HANDOVER,
    },
  },
  smart_locks: {
    ar: 'أقفال ذكية', en: 'Smart locks',
    tasks: {
      kickoff: [...COMMON_KICKOFF, 'اعتماد اتجاهات الأبواب وترقيم الغرف'],
      procurement: ['طلب الأقفال من المورد', 'استلام الأقفال وفحصها'],
      delivery: ['توريد الأقفال للموقع'],
      installation: ['تركيب الأقفال', 'تركيب أجهزة الترميز'],
      commissioning: ['برمجة الأقفال والبطاقات', 'اختبار فتح كل باب'],
      handover: COMMON_HANDOVER,
    },
  },
  iot: {
    ar: 'إنترنت الأشياء / LoRaWAN', en: 'IoT / LoRaWAN',
    tasks: {
      kickoff: [...COMMON_KICKOFF, 'مسح تغطية الشبكة'],
      procurement: ['طلب الحساسات والبوابات', 'استلام الأجهزة وفحصها'],
      delivery: ['توريد الأجهزة للموقع'],
      installation: ['تركيب البوابات', 'تركيب الحساسات'],
      commissioning: ['تسجيل الأجهزة على المنصة', 'اختبار القراءات والتنبيهات'],
      handover: COMMON_HANDOVER,
    },
  },
  other: {
    ar: 'أخرى', en: 'Other',
    tasks: { kickoff: COMMON_KICKOFF, installation: ['التركيب'], commissioning: ['الاختبار'], handover: COMMON_HANDOVER },
  },
};

/**
 * Record scope for projects: owner / team / branch copied from the contract, and the project manager
 * counts as an owner (a PM with "own" scope sees and works on the projects they manage).
 */
export function assertProject(actor: RequestActor, perm: Permission, p: Pick<ProjectRow, 'ownerId' | 'teamId' | 'branchId' | 'managerId'>) {
  try {
    assertCan(actor, perm, p);
  } catch (e) {
    if (p.managerId && p.managerId === actor.userId && actor.grants[perm]) return;
    throw e;
  }
}

export function projectScope(actor: RequestActor, perm: Permission): SQL | undefined {
  const f = scopeFilter(actor, perm, { owner: project.ownerId, team: project.teamId, branch: project.branchId });
  return f ? or(f, eq(project.managerId, actor.userId)) : undefined;
}

export async function loadProject(tx: Tx, actor: RequestActor, id: string, perm: Permission): Promise<ProjectRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('project');
  const [p] = await tx.select().from(project).where(eq(project.id, id));
  if (!p) throw notFound('project');
  assertProject(actor, perm, p);
  return p;
}

/** Seed template tasks; `replace` first removes the untouched (todo, unassigned) tasks. */
export async function applyTemplateTasks(tx: Tx, projectId: string, key: TemplateKey, actorId: string | null, replace = false) {
  if (replace) await tx.delete(projectTask).where(and(eq(projectTask.projectId, projectId), eq(projectTask.status, 'todo'), isNull(projectTask.assigneeId)));
  const t = PROJECT_TEMPLATES[key].tasks;
  const rows = PROJECT_STAGES.flatMap((stage) => (t[stage] ?? []).map((title, i) => ({ projectId, stage, title, sort: i, createdBy: actorId, updatedBy: actorId })));
  if (rows.length) await tx.insert(projectTask).values(rows);
}

/**
 * Create the project of a signed contract (PRJ-01). Idempotent: one project per contract
 * (project_contract_uq) — an existing project is returned unchanged.
 */
export async function ensureProjectForContract(tx: Tx, actor: RequestActor | null, contractId: string, opts: { templateKey?: TemplateKey; name?: string | null; managerId?: string | null } = {}) {
  const [existing] = await tx.select().from(project).where(eq(project.contractId, contractId));
  if (existing) return { project: existing, created: false };
  const [c] = await tx.select().from(contract).where(eq(contract.id, contractId));
  if (!c) throw notFound('contract');
  const [q] = c.quoteId ? await tx.select({ siteId: quote.siteId, projectName: quote.projectName, clientName: quote.clientName }).from(quote).where(eq(quote.id, c.quoteId)) : [];
  const [p] = c.partyId ? await tx.select({ nameAr: party.nameAr }).from(party).where(eq(party.id, c.partyId)) : [];
  const client = p?.nameAr ?? c.clientBlock?.name ?? q?.clientName ?? null;
  const name = opts.name?.trim() || q?.projectName?.trim() || (client ? `${c.title} — ${client}` : c.title);
  const templateKey = opts.templateKey ?? (c.templateSet === 'maintenance' ? 'other' : 'villa_intercom');
  const { number } = await nextNumber(tx, 'project');
  const actorId = actor?.userId ?? null;
  const [row] = await tx.insert(project).values({
    number, name, contractId: c.id, partyId: c.partyId, siteId: q?.siteId ?? null, templateKey,
    ownerId: c.ownerId, teamId: c.teamId, branchId: c.branchId, managerId: opts.managerId ?? null,
    clockMinDays: c.deliveryDaysMin ?? 45, clockMaxDays: c.deliveryDaysMax ?? c.deliveryDaysMin ?? 60,
    warrantyLabourMonths: c.warrantyMonths ?? 12, warrantyPartsMonths: c.partsWarrantyMonths ?? c.warrantyMonths ?? 24,
    createdBy: actorId, updatedBy: actorId,
  }).returning();
  await applyTemplateTasks(tx, row!.id, templateKey, actorId);
  await tx.insert(projectStageLog).values({ projectId: row!.id, fromStage: 'kickoff', toStage: 'kickoff', reason: `أُنشئ من العقد ${c.number}`, by: actorId });
  await audit(tx, actor, 'create', 'project', row!.id, null, { number, contract: c.number, templateKey });
  await emit(tx, 'project', row!.id, 'project.created', { number, contract: c.number });
  return { project: row!, created: true };
}

/** Latest approval per kind (highest revision, superseded excluded) + the full history. */
function groupApprovals(rows: (typeof projectApproval.$inferSelect)[]) {
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return kinds.map((kind) => {
    const all = rows.filter((r) => r.kind === kind).sort((a, b) => b.revision - a.revision || +b.createdAt - +a.createdAt);
    return { kind, latest: all.find((r) => r.status !== 'superseded') ?? all[0]!, history: all };
  });
}

/** The facts the stage gates are evaluated on (module 05 §2). */
export async function loadFacts(tx: Tx, p: ProjectRow) {
  const milestones = p.contractId
    ? await tx.select().from(billingMilestone).where(and(eq(billingMilestone.contractId, p.contractId), ne(billingMilestone.trigger, CO_TRIGGER))).orderBy(asc(billingMilestone.sort))
    : [];
  const paidOn = async (milestoneId: string, fallback: Date) => {
    const [r] = await tx.select({ d: sql<string | null>`max(${paymentMirror.paidOn})::text` }).from(paymentMirror)
      .innerJoin(paymentRequest, eq(paymentRequest.id, paymentMirror.paymentRequestId)).where(eq(paymentRequest.milestoneId, milestoneId));
    return r?.d ?? riyadhDate(fallback);
  };
  const adv = milestones[0];
  const advancePaidOn = adv && adv.status === 'paid' ? await paidOn(adv.id, adv.updatedAt) : null;
  const second = milestones[1];
  const deliveryPaymentPaid = milestones.length < 2 ? !!advancePaidOn : second!.status === 'paid';
  const finalInvoiced = p.contractId ? !!(await contractFinalInvoice(tx, p.contractId)) : false;
  const approvals = await tx.select().from(projectApproval).where(eq(projectApproval.projectId, p.id));
  const approvedOn: Partial<Record<ApprovalKind, string>> = {};
  for (const g of groupApprovals(approvals)) if (g.latest.status === 'approved' && g.latest.approvedOn) approvedOn[g.kind as ApprovalKind] = g.latest.approvedOn;
  const [a] = await tx.select({ n: sql<number>`count(*)::int`, untested: sql<number>`count(*) filter (where ${installedAsset.testPassed} is not true)::int` })
    .from(installedAsset).where(and(eq(installedAsset.projectId, p.id), eq(installedAsset.status, 'active')));
  const [s] = await tx.select({ n: sql<number>`count(*)::int` }).from(snag).where(and(eq(snag.projectId, p.id), ne(snag.status, 'verified')));
  const facts: ProjectFacts = {
    advancePaidOn, deliveryPaymentPaid,
    requiredApprovals: (p.requiredApprovals ?? REQUIRED_APPROVALS).filter((k): k is ApprovalKind => (APPROVAL_KINDS as readonly string[]).includes(k)),
    approvedOn, materialsReady: p.materialsReady, assetCount: a?.n ?? 0, assetsUntested: a?.untested ?? 0, finalInvoiced, openSnags: s?.n ?? 0, acceptedOn: p.acceptedOn,
  };
  return { facts, milestones, approvals };
}

/** Delivery clock (PRJ-04): starts at clockStartedOn, or — while in kick-off — the date the conditions were met. */
export async function projectClock(tx: Tx, p: ProjectRow, facts: ProjectFacts | null, calendar?: CompanyCalendar) {
  const pauses = await tx.select().from(projectClockPause).where(eq(projectClockPause.projectId, p.id)).orderBy(asc(projectClockPause.fromDate));
  const startDate = p.clockStartedOn ?? (facts ? clockStartDate(facts) : null);
  const clock = deliveryClock({
    startDate, today: riyadhDate(), minDays: p.clockMinDays, maxDays: p.clockMaxDays, extensionDays: p.clockExtensionDays,
    pauses: pauses.map((x) => ({ from: x.fromDate, to: x.toDate })), stoppedOn: p.deliveredOn, calendar: calendar ?? (await loadCalendar(tx)),
  });
  return { clock, pauses };
}

async function userNames(tx: Tx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await tx.select({ id: appUser.id, nameAr: appUser.nameAr, email: appUser.email }).from(appUser).where(inArray(appUser.id, list)) : [];
  return (id: string | null | undefined) => (id ? (rows.find((r) => r.id === id)?.nameAr || rows.find((r) => r.id === id)?.email) ?? null : null);
}

/** "Building A / Floor 1 / Unit 3" for each location of a site. */
async function locationPaths(tx: Tx, siteIds: string[]) {
  const locs = siteIds.length ? await tx.select({ id: siteLocation.id, parentId: siteLocation.parentId, name: siteLocation.name, sort: siteLocation.sort }).from(siteLocation).where(inArray(siteLocation.siteId, siteIds)) : [];
  const byId = new Map(locs.map((l) => [l.id, l]));
  const path = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const parts: string[] = [];
    let cur = byId.get(id);
    for (let i = 0; cur && i < 12; i++) { parts.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return parts.length ? parts.join(' / ') : null;
  };
  return path;
}

async function projectAssets(tx: Tx, p: ProjectRow) {
  return tx.select({
    id: installedAsset.id, code: installedAsset.code, description: installedAsset.description, serial: installedAsset.serial, mac: installedAsset.mac, ip: installedAsset.ip,
    firmware: installedAsset.firmware, locationId: installedAsset.locationId, siteId: installedAsset.siteId, installedOn: installedAsset.installedOn, testPassed: installedAsset.testPassed, testedOn: installedAsset.testedOn,
    labourWarrantyEnd: installedAsset.labourWarrantyEnd, partsWarrantyEnd: installedAsset.partsWarrantyEnd, manufacturerWarrantyEnd: installedAsset.manufacturerWarrantyEnd, status: installedAsset.status,
  }).from(installedAsset).where(eq(installedAsset.projectId, p.id)).orderBy(asc(installedAsset.code), asc(installedAsset.serial));
}

/** The project cockpit (GET /projects/:id). */
export async function projectView(tx: Tx, actor: RequestActor, id: string) {
  const p = await loadProject(tx, actor, id, 'project.read');
  const { facts, milestones, approvals } = await loadFacts(tx, p);
  const gate = gateFor(p.stage as ProjectStage, facts);
  const { clock, pauses } = await projectClock(tx, p, facts);
  const [c] = p.contractId ? await tx.select({ id: contract.id, number: contract.number, title: contract.title, status: contract.status, total: contract.total, vatOn: contract.vatOn, signedAt: contract.signedAt }).from(contract).where(eq(contract.id, p.contractId)) : [];
  const [pt] = p.partyId ? await tx.select({ id: party.id, nameAr: party.nameAr, nameEn: party.nameEn, phone: party.phone }).from(party).where(eq(party.id, p.partyId)) : [];
  const [st] = p.siteId ? await tx.select().from(site).where(eq(site.id, p.siteId)) : [];
  const tasks = await tx.select().from(projectTask).where(eq(projectTask.projectId, p.id)).orderBy(asc(projectTask.sort), asc(projectTask.createdAt));
  tasks.sort((a, b) => PROJECT_STAGES.indexOf(a.stage as ProjectStage) - PROJECT_STAGES.indexOf(b.stage as ProjectStage) || a.sort - b.sort);
  const snags = await tx.select().from(snag).where(eq(snag.projectId, p.id)).orderBy(desc(snag.createdAt));
  const stageLog = await tx.select().from(projectStageLog).where(eq(projectStageLog.projectId, p.id)).orderBy(desc(projectStageLog.at));
  const workOrders = await tx.select({ id: workOrder.id, number: workOrder.number, type: workOrder.type, status: workOrder.status, title: workOrder.title, scheduledStart: workOrder.scheduledStart })
    .from(workOrder).where(eq(workOrder.projectId, p.id)).orderBy(desc(workOrder.createdAt));
  const canAssets = !!actor.grants['asset.read'];
  const assetRows = canAssets ? await projectAssets(tx, p) : [];
  const path = await locationPaths(tx, [...new Set([p.siteId, ...assetRows.map((a) => a.siteId)].filter((x): x is string => !!x))]);
  const name = await userNames(tx, [p.managerId, p.ownerId, ...tasks.map((t) => t.assigneeId), ...snags.map((s) => s.assigneeId), ...snags.map((s) => s.verifiedBy), ...stageLog.map((l) => l.by)]);
  return {
    ...p,
    stageLabel: PROJECT_STAGE_LABELS[p.stage as ProjectStage] ?? null,
    template: { key: p.templateKey, ...(PROJECT_TEMPLATES[p.templateKey as TemplateKey] ? { ar: PROJECT_TEMPLATES[p.templateKey as TemplateKey].ar, en: PROJECT_TEMPLATES[p.templateKey as TemplateKey].en } : {}) },
    managerName: name(p.managerId),
    ownerName: name(p.ownerId),
    customer: pt ?? null,
    site: st ? { id: st.id, name: st.name, address: formatNationalAddress({ buildingNumber: st.buildingNumber ?? undefined, street: st.street ?? undefined, district: st.district ?? undefined, city: st.city ?? undefined, postalCode: st.postalCode ?? undefined, additionalNumber: st.additionalNumber ?? undefined }) || null, mapLink: st.mapLink } : null,
    contract: c ?? null,
    milestones: milestones.map((m) => ({ id: m.id, sort: m.sort, nameAr: m.nameAr, nameEn: m.nameEn, percent: m.percent, amount: m.amount, paidAmount: m.paidAmount, status: m.status, dueDate: m.dueDate })),
    facts,
    gate,
    clock,
    pauses,
    tasks: tasks.map((t) => ({ ...t, assigneeName: name(t.assigneeId), locationPath: path(t.locationId) })),
    approvals: groupApprovals(approvals).sort((a, b) => APPROVAL_KINDS.indexOf(a.kind as ApprovalKind) - APPROVAL_KINDS.indexOf(b.kind as ApprovalKind))
      .map((g) => ({ ...g, label: APPROVAL_LABELS[g.kind as ApprovalKind] ?? null, required: facts.requiredApprovals.includes(g.kind as ApprovalKind) })),
    snags: snags.map((s) => ({ ...s, assigneeName: name(s.assigneeId), verifiedByName: name(s.verifiedBy), locationPath: path(s.locationId) })),
    assets: assetRows.map((a) => ({ ...a, locationPath: path(a.locationId) })),
    assetsHidden: !canAssets,
    workOrders,
    stageLog: stageLog.map((l) => ({ ...l, byName: name(l.by) })),
  };
}

export type ProjectView = Awaited<ReturnType<typeof projectView>>;

/** Data for the handover package (PRJ-30). Never includes credentials or free-form attributes. */
export async function handoverDoc(tx: Tx, actor: RequestActor, id: string): Promise<HandoverDoc> {
  const v = await projectView(tx, actor, id);
  if (!actor.grants['asset.read']) throw forbidden('the handover package needs asset.read (device schedule)');
  const groups = new Map<string, HandoverDoc['groups'][number]>();
  for (const a of v.assets.filter((x) => x.status === 'active')) {
    const key = a.locationPath ?? '';
    if (!groups.has(key)) groups.set(key, { location: a.locationPath, devices: [] });
    groups.get(key)!.devices.push({ code: a.code, description: a.description, serial: a.serial, mac: a.mac, ip: a.ip, firmware: a.firmware, installedOn: a.installedOn, testPassed: a.testPassed, labourWarrantyEnd: a.labourWarrantyEnd, partsWarrantyEnd: a.partsWarrantyEnd });
  }
  const ends = v.acceptedOn ? warrantyEnds(v.acceptedOn, v.warrantyLabourMonths, v.warrantyPartsMonths) : null;
  return {
    company: await companyBlock(tx),
    project: { number: v.number, name: v.name, contractNumber: v.contract?.number ?? null, managerName: v.managerName },
    customer: { name: v.customer?.nameAr ?? '—', phone: v.customer?.phone ?? null },
    site: v.site ? { name: v.site.name, address: v.site.address } : null,
    date: riyadhDate(),
    groups: [...groups.values()].sort((a, b) => (a.location ?? '￿').localeCompare(b.location ?? '￿', 'ar')),
    warranty: { labourMonths: v.warrantyLabourMonths, partsMonths: v.warrantyPartsMonths, startsOn: v.acceptedOn, labourEnd: ends?.labourEnd ?? null, partsEnd: ends?.partsEnd ?? null },
    approvals: v.approvals.filter((g) => g.latest.status === 'approved').map((g) => ({ kindAr: g.label?.ar ?? g.kind, kindEn: g.label?.en ?? g.kind, title: g.latest.title, revision: g.latest.revision, approvedOn: g.latest.approvedOn, approvedByName: g.latest.approvedByName })),
    acceptance: { acceptedOn: v.acceptedOn, acceptedByName: v.acceptedByName },
  };
}
