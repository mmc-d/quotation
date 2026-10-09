import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { and, appUser, asc, desc, employee, eq, ilike, jobOffer, ne, nextNumber, or, sql, type Tx } from '@mmc/db';
import { CONTRACT_TYPES, defaultGosiPercent, EMPLOYMENT_TYPES, isSaudiNationality, halalasToFixed, ID_TYPES, idNumberProblem, offerErrors, offerIssues, offerPackage, offerStatusOn, riyadhDate, toHalalas } from '@mmc/domain';
import { htmlToPdf, renderOfferHtml } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { companyBlock } from '../common/company.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { ZodPipe, zDate, zMoney, zPage, zUuid } from '../common/zod.js';
import { config } from '../config.js';

/**
 * HR — job offers and the employee register. HR staff (hr.write) prepare an offer as a draft; a
 * second person with hr.approve issues it (the owner may issue their own) after the Labor Law
 * checks pass. The candidate's answer is recorded on the issued offer, and an accepted offer
 * becomes an employee in one step. Salaries never leave these hr.* endpoints.
 */

const zText = (max = 2000) => z.string().trim().max(max);
const zPositive = zMoney.refine((v) => Number(v) >= 0, 'must not be negative');
const zAllowances = z.array(z.object({ label: zText(80).min(1), amount: zPositive })).max(10).default([]);
const COVER = ['none', 'employee', 'family'] as const;

const offerSchema = z.object({
  offerDate: zDate,
  validUntil: zDate,
  candidateNameAr: zText(200).min(1),
  candidateNameEn: zText(200).nullish(),
  nationality: zText(60).nullish(),
  idType: z.enum(ID_TYPES).nullish(),
  idNumber: zText(30).nullish(),
  mobile: zText(30).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal('')),
  jobTitleAr: zText(200).min(1),
  jobTitleEn: zText(200).nullish(),
  department: zText(120).nullish(),
  reportsTo: zText(200).nullish(),
  workLocation: zText(200).nullish(),
  contractType: z.enum(CONTRACT_TYPES),
  durationMonths: z.number().int().min(1).max(120).nullish(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  startDate: zDate,
  probationDays: z.number().int().min(0).max(365),
  weeklyHours: z.number().int().min(1).max(84),
  workDays: zText(120).nullish(),
  annualLeaveDays: z.number().int().min(0).max(90),
  noticeDays: z.number().int().min(0).max(365).nullish(),
  basicSalary: zPositive,
  housingAllowance: zPositive.default('0'),
  transportAllowance: zPositive.default('0'),
  otherAllowances: zAllowances,
  medicalInsurance: z.enum(COVER).default('employee'),
  annualTicket: z.enum(COVER).default('none'),
  otherBenefits: zText(2000).nullish(),
  termsAr: zText(4000).nullish(),
  notes: zText(2000).nullish(),
});
type OfferBody = z.infer<typeof offerSchema>;

const employeeSchema = z.object({
  nameAr: zText(200).min(1),
  nameEn: zText(200).nullish(),
  nationality: zText(60).nullish(),
  idType: z.enum(ID_TYPES).nullish(),
  idNumber: zText(30).nullish(),
  idExpiry: zDate.nullish(),
  birthDate: zDate.nullish(),
  gender: z.enum(['male', 'female']).nullish(),
  mobile: zText(30).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal('')),
  jobTitleAr: zText(200).min(1),
  jobTitleEn: zText(200).nullish(),
  department: zText(120).nullish(),
  managerId: zUuid.nullish(),
  userId: zUuid.nullish(),
  workLocation: zText(200).nullish(),
  hireDate: zDate,
  contractType: z.enum(CONTRACT_TYPES),
  contractEndDate: zDate.nullish(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  probationEndDate: zDate.nullish(),
  annualLeaveDays: z.number().int().min(0).max(90),
  basicSalary: zPositive,
  housingAllowance: zPositive.default('0'),
  transportAllowance: zPositive.default('0'),
  otherAllowances: zAllowances,
  bankName: zText(120).nullish(),
  iban: z.string().trim().toUpperCase().regex(/^SA\d{22}$/, 'IBAN must be SA + 22 digits').nullish().or(z.literal('')),
  gosiNumber: zText(30).nullish(),
  /** employee GOSI share (%); omitted → 9.75 for Saudis, 0 otherwise */
  gosiEmployeePercent: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) <= 30, 'invalid percent').nullish(),
  notes: zText(2000).nullish(),
});
type EmployeeBody = z.infer<typeof employeeSchema>;

const offerList = zPage.extend({ status: z.enum(['draft', 'approved', 'accepted', 'rejected', 'cancelled', 'expired']).optional() });
const employeeList = zPage.extend({ status: z.enum(['active', 'suspended', 'terminated']).optional(), department: z.string().optional() });

const money = (v: string | number | null | undefined) => halalasToFixed(toHalalas(v ?? 0));
const allowances = (a: { label: string; amount: string }[]) => a.map((x) => ({ label: x.label, amount: money(x.amount) }));

function checkId(type: string | null | undefined, num: string | null | undefined) {
  const p = idNumberProblem(type as never, num);
  if (p) throw badRequest(p === 'invalid' ? 'the ID / iqama number is not valid' : p === 'not_iqama' ? 'an iqama number starts with 2' : 'a national ID number starts with 1');
}

export async function myName(tx: Tx, actor: RequestActor) {
  const [me] = await tx.select({ nameAr: appUser.nameAr }).from(appUser).where(eq(appUser.id, actor.userId));
  return me?.nameAr || actor.name;
}

// ───────────── offers ─────────────

const offerValues = (b: OfferBody) => ({
  offerDate: b.offerDate, validUntil: b.validUntil, candidateNameAr: b.candidateNameAr, candidateNameEn: b.candidateNameEn || null,
  nationality: b.nationality || null, idType: b.idType ?? null, idNumber: b.idNumber || null, mobile: b.mobile || null, email: b.email || null,
  jobTitleAr: b.jobTitleAr, jobTitleEn: b.jobTitleEn || null, department: b.department || null, reportsTo: b.reportsTo || null, workLocation: b.workLocation || null,
  contractType: b.contractType, durationMonths: b.contractType === 'fixed' ? b.durationMonths ?? null : null, employmentType: b.employmentType,
  startDate: b.startDate, probationDays: b.probationDays, weeklyHours: b.weeklyHours, workDays: b.workDays || null, annualLeaveDays: b.annualLeaveDays,
  noticeDays: b.noticeDays ?? null, basicSalary: money(b.basicSalary), housingAllowance: money(b.housingAllowance), transportAllowance: money(b.transportAllowance),
  otherAllowances: allowances(b.otherAllowances), medicalInsurance: b.medicalInsurance, annualTicket: b.annualTicket,
  otherBenefits: b.otherBenefits || null, termsAr: b.termsAr || null, notes: b.notes || null,
});

async function loadOffer(tx: Tx, id: string) {
  const [o] = await tx.select().from(jobOffer).where(eq(jobOffer.id, id));
  if (!o) throw notFound('job offer');
  return o;
}

async function offerView(tx: Tx, id: string) {
  const o = await loadOffer(tx, id);
  const [cu] = o.createdBy ? await tx.select({ nameAr: appUser.nameAr }).from(appUser).where(eq(appUser.id, o.createdBy)) : [];
  const [emp] = o.employeeId ? await tx.select({ id: employee.id, number: employee.number }).from(employee).where(eq(employee.id, o.employeeId)) : [];
  const pkg = offerPackage(o);
  return {
    ...o, status: offerStatusOn(o.status, o.validUntil, riyadhDate()), createdByName: cu?.nameAr ?? null, employee: emp ?? null,
    monthlyTotal: halalasToFixed(pkg.monthly), annualTotal: halalasToFixed(pkg.annual), issues: offerIssues(o as never),
  };
}

@Controller('hr/offers')
export class JobOffersController {
  @Get()
  @Perm('hr.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(offerList)) q: z.infer<typeof offerList>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const today = riyadhDate();
      const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = and(
        q.status === 'expired' ? and(eq(jobOffer.status, 'approved'), sql`${jobOffer.validUntil} < ${today}`)
          : q.status === 'approved' ? and(eq(jobOffer.status, 'approved'), sql`${jobOffer.validUntil} >= ${today}`)
          : q.status ? eq(jobOffer.status, q.status) : undefined,
        term ? or(ilike(jobOffer.number, term), ilike(jobOffer.candidateNameAr, term), ilike(jobOffer.candidateNameEn, term), ilike(jobOffer.jobTitleAr, term), ilike(jobOffer.department, term)) : undefined,
      );
      const rows = await tx.select({
        id: jobOffer.id, number: jobOffer.number, offerDate: jobOffer.offerDate, validUntil: jobOffer.validUntil, candidateNameAr: jobOffer.candidateNameAr,
        jobTitleAr: jobOffer.jobTitleAr, department: jobOffer.department, startDate: jobOffer.startDate, status: jobOffer.status, employeeId: jobOffer.employeeId,
        basicSalary: jobOffer.basicSalary, housingAllowance: jobOffer.housingAllowance, transportAllowance: jobOffer.transportAllowance, otherAllowances: jobOffer.otherAllowances,
      }).from(jobOffer).where(where).orderBy(desc(jobOffer.offerDate), desc(jobOffer.createdAt)).limit(q.limit).offset(q.offset);
      const [t] = await tx.select({
        total: sql<number>`count(*)::int`,
        drafts: sql<number>`count(*) filter (where ${jobOffer.status} = 'draft')::int`,
        open: sql<number>`count(*) filter (where ${jobOffer.status} = 'approved' and ${jobOffer.validUntil} >= ${today})::int`,
        toHire: sql<number>`count(*) filter (where ${jobOffer.status} = 'accepted' and ${jobOffer.employeeId} is null)::int`,
      }).from(jobOffer).where(where);
      return {
        rows: rows.map(({ basicSalary, housingAllowance, transportAllowance, otherAllowances, ...r }) => ({
          ...r, status: offerStatusOn(r.status, r.validUntil, today), monthlyTotal: halalasToFixed(offerPackage({ basicSalary, housingAllowance, transportAllowance, otherAllowances }).monthly),
        })),
        total: t!.total, summary: { drafts: t!.drafts, open: t!.open, toHire: t!.toHire },
      };
    });
  }

  @Get(':id')
  @Perm('hr.read')
  async get(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, (tx) => offerView(tx, id));
  }

  @Post()
  @Perm('hr.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(offerSchema)) b: OfferBody) {
    return tenantTx(actor.tenantId, async (tx) => {
      checkId(b.idType, b.idNumber);
      const { number } = await nextNumber(tx, 'job_offer');
      const [o] = await tx.insert(jobOffer).values({ number, ...offerValues(b), createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'job_offer', o!.id, null, { number, candidate: b.candidateNameAr, jobTitle: b.jobTitleAr });
      return offerView(tx, o!.id);
    }, actor.userId);
  }

  @Put(':id')
  @Perm('hr.write')
  async update(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(offerSchema.extend({ version: z.number().int() }))) b: OfferBody & { version: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadOffer(tx, id);
      if (before.status !== 'draft') throw conflict('only draft offers can be edited');
      if (b.version !== before.version) throw conflict('the offer was changed by someone else — reload');
      checkId(b.idType, b.idNumber);
      const next = offerValues(b);
      await tx.update(jobOffer).set({ ...next, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(jobOffer.id, id));
      const d = diff(before as Record<string, unknown>, next as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'job_offer', id, d.before, d.after);
      return offerView(tx, id);
    }, actor.userId);
  }

  /** Issue the offer: Labor Law checks must pass; the approver is not the preparer unless they are the owner. */
  @Post(':id/approve')
  @Perm('hr.approve')
  async approve(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const o = await loadOffer(tx, id);
      if (o.status !== 'draft') throw conflict(`the offer is already ${o.status}`);
      if (o.createdBy === actor.userId && !actor.roleKeys.includes('owner')) throw forbidden('you cannot issue an offer you prepared — another approver must issue it');
      if (o.validUntil < riyadhDate()) throw badRequest('the offer validity date has passed — edit it first');
      const errors = offerErrors(o as never);
      if (errors.length) throw badRequest(errors.map((e) => e.en).join('; '));
      await tx.update(jobOffer).set({ status: 'approved', approvedBy: actor.userId, approvedByName: await myName(tx, actor), approvedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId, version: o.version + 1 }).where(eq(jobOffer.id, id));
      await audit(tx, actor, 'approve', 'job_offer', id, { status: 'draft' }, { status: 'approved', number: o.number });
      return offerView(tx, id);
    }, actor.userId);
  }

  /** Record the candidate's answer on an issued offer. Acceptance must arrive before the offer expires. */
  @Post(':id/respond')
  @Perm('hr.write')
  async respond(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ accepted: z.boolean(), date: zDate, note: zText(1000).nullish() }))) b: { accepted: boolean; date: string; note?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const o = await loadOffer(tx, id);
      if (o.status !== 'approved') throw conflict(o.status === 'draft' ? 'the offer has not been issued yet' : `the offer is already ${o.status}`);
      if (b.date > riyadhDate()) throw badRequest('the answer date cannot be in the future');
      if (b.date < o.offerDate) throw badRequest('the answer date is before the offer date');
      if (b.accepted && b.date > o.validUntil) throw badRequest('the offer had expired on that date — issue a new offer');
      const status = b.accepted ? 'accepted' : 'rejected';
      await tx.update(jobOffer).set({ status, respondedAt: b.date, responseNote: b.note || null, updatedAt: new Date(), updatedBy: actor.userId, version: o.version + 1 }).where(eq(jobOffer.id, id));
      await audit(tx, actor, b.accepted ? 'accept' : 'reject', 'job_offer', id, { status: o.status }, { status, respondedAt: b.date }, b.note ?? undefined);
      return offerView(tx, id);
    }, actor.userId);
  }

  /** Withdraw a draft or an issued offer, with a reason. An answered offer stays as answered. */
  @Post(':id/cancel')
  @Perm('hr.write')
  async cancel(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ reason: zText(1000).min(1) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const o = await loadOffer(tx, id);
      if (!['draft', 'approved'].includes(o.status)) throw conflict(`a ${o.status} offer cannot be withdrawn`);
      await tx.update(jobOffer).set({ status: 'cancelled', cancelledBy: actor.userId, cancelledAt: new Date(), cancelReason: b.reason, updatedAt: new Date(), updatedBy: actor.userId, version: o.version + 1 }).where(eq(jobOffer.id, id));
      await audit(tx, actor, 'cancel', 'job_offer', id, { status: o.status }, { status: 'cancelled' }, b.reason);
      return offerView(tx, id);
    }, actor.userId);
  }

  /** Accepted offer → employee record (once). */
  @Post(':id/hire')
  @Perm('hr.write')
  async hire(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ hireDate: zDate.optional() }))) b: { hireDate?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const o = await loadOffer(tx, id);
      if (o.status !== 'accepted') throw conflict('only an accepted offer can be turned into an employee');
      if (o.employeeId) throw conflict('this offer already has an employee record');
      if (o.idNumber) {
        const [dup] = await tx.select({ number: employee.number }).from(employee).where(eq(employee.idNumber, o.idNumber));
        if (dup) throw conflict(`an employee with this ID number already exists (${dup.number})`);
      }
      const hireDate = b.hireDate ?? o.startDate;
      const { number } = await nextNumber(tx, 'employee');
      const [e] = await tx.insert(employee).values({
        number, nameAr: o.candidateNameAr, nameEn: o.candidateNameEn, nationality: o.nationality, idType: o.idType, idNumber: o.idNumber,
        mobile: o.mobile, email: o.email, jobTitleAr: o.jobTitleAr, jobTitleEn: o.jobTitleEn, department: o.department, workLocation: o.workLocation,
        hireDate, contractType: o.contractType, contractEndDate: o.contractType === 'fixed' && o.durationMonths ? addMonths(hireDate, o.durationMonths, -1) : null,
        employmentType: o.employmentType, probationEndDate: o.probationDays ? addDays(hireDate, o.probationDays - 1) : null, annualLeaveDays: o.annualLeaveDays,
        basicSalary: o.basicSalary, housingAllowance: o.housingAllowance, transportAllowance: o.transportAllowance, otherAllowances: o.otherAllowances,
        gosiEmployeePercent: defaultGosiPercent(isSaudiNationality(o.nationality)), offerId: o.id, createdBy: actor.userId, updatedBy: actor.userId,
      }).returning();
      await tx.update(jobOffer).set({ employeeId: e!.id, updatedAt: new Date(), updatedBy: actor.userId, version: o.version + 1 }).where(eq(jobOffer.id, id));
      await audit(tx, actor, 'create', 'employee', e!.id, null, { number, name: o.candidateNameAr, fromOffer: o.number });
      return employeeView(tx, e!.id);
    }, actor.userId);
  }

  @Get(':id/pdf')
  @Perm('hr.read')
  async pdf(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Res() res: Response) {
    const { pdf, number } = await tenantTx(actor.tenantId, async (tx) => {
      const o = await offerView(tx, id);
      const issued = o.status === 'approved' || o.status === 'accepted';
      const html = renderOfferHtml({ ...o, company: await companyBlock(tx, issued), approvedAt: o.approvedAt ? riyadhDate(o.approvedAt) : null });
      return { pdf: await htmlToPdf(html, config.gotenbergUrl), number: o.number };
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${number}.pdf"`);
    res.send(pdf);
  }
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Same day-of-month n months later (clamped to the month's end), plus `extraDays`. */
function addMonths(day: string, n: number, extraDays = 0): string {
  const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return addDays(new Date(Date.UTC(y, m - 1 + n, Math.min(dd, last))).toISOString().slice(0, 10), extraDays);
}

// ───────────── employees ─────────────

const employeeValues = (b: EmployeeBody) => ({
  nameAr: b.nameAr, nameEn: b.nameEn || null, nationality: b.nationality || null, idType: b.idType ?? null, idNumber: b.idNumber || null, idExpiry: b.idExpiry ?? null,
  birthDate: b.birthDate ?? null, gender: b.gender ?? null, mobile: b.mobile || null, email: b.email || null, jobTitleAr: b.jobTitleAr, jobTitleEn: b.jobTitleEn || null,
  department: b.department || null, managerId: b.managerId ?? null, userId: b.userId ?? null, workLocation: b.workLocation || null, hireDate: b.hireDate,
  contractType: b.contractType, contractEndDate: b.contractType === 'fixed' ? b.contractEndDate ?? null : null, employmentType: b.employmentType,
  probationEndDate: b.probationEndDate ?? null, annualLeaveDays: b.annualLeaveDays, basicSalary: money(b.basicSalary), housingAllowance: money(b.housingAllowance),
  transportAllowance: money(b.transportAllowance), otherAllowances: allowances(b.otherAllowances), bankName: b.bankName || null, iban: b.iban || null,
  gosiNumber: b.gosiNumber || null, notes: b.notes || null,
  gosiEmployeePercent: b.gosiEmployeePercent ?? defaultGosiPercent(isSaudiNationality(b.nationality)),
});

async function loadEmployee(tx: Tx, id: string) {
  const [e] = await tx.select().from(employee).where(eq(employee.id, id));
  if (!e) throw notFound('employee');
  return e;
}

async function employeeView(tx: Tx, id: string) {
  const e = await loadEmployee(tx, id);
  const [mgr] = e.managerId ? await tx.select({ id: employee.id, number: employee.number, nameAr: employee.nameAr }).from(employee).where(eq(employee.id, e.managerId)) : [];
  const [usr] = e.userId ? await tx.select({ id: appUser.id, email: appUser.email, nameAr: appUser.nameAr }).from(appUser).where(eq(appUser.id, e.userId)) : [];
  const [off] = e.offerId ? await tx.select({ id: jobOffer.id, number: jobOffer.number }).from(jobOffer).where(eq(jobOffer.id, e.offerId)) : [];
  return { ...e, manager: mgr ?? null, user: usr ?? null, offer: off ?? null, monthlyTotal: halalasToFixed(offerPackage(e).monthly) };
}

async function checkEmployeeLinks(tx: Tx, b: EmployeeBody, selfId?: string) {
  checkId(b.idType, b.idNumber);
  if (b.contractType === 'fixed' && !b.contractEndDate) throw badRequest('a fixed-term contract needs its end date');
  if (b.contractEndDate && b.contractEndDate < b.hireDate) throw badRequest('the contract ends before the hire date');
  if (b.managerId) {
    if (b.managerId === selfId) throw badRequest('an employee cannot be their own manager');
    await loadEmployee(tx, b.managerId);
  }
  if (b.idNumber) {
    const [dup] = await tx.select({ number: employee.number }).from(employee).where(and(eq(employee.idNumber, b.idNumber), selfId ? ne(employee.id, selfId) : undefined));
    if (dup) throw conflict(`an employee with this ID number already exists (${dup.number})`);
  }
  if (b.userId) {
    const [u] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.id, b.userId));
    if (!u) throw badRequest('unknown user');
    const [dup] = await tx.select({ number: employee.number }).from(employee).where(and(eq(employee.userId, b.userId), selfId ? ne(employee.id, selfId) : undefined));
    if (dup) throw conflict(`that login is already linked to employee ${dup.number}`);
  }
}

@Controller('hr/employees')
export class EmployeesController {
  @Get()
  @Perm('hr.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(employeeList)) q: z.infer<typeof employeeList>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = and(
        q.status ? eq(employee.status, q.status) : undefined,
        q.department ? eq(employee.department, q.department) : undefined,
        term ? or(ilike(employee.number, term), ilike(employee.nameAr, term), ilike(employee.nameEn, term), ilike(employee.jobTitleAr, term), ilike(employee.mobile, term), ilike(employee.idNumber, term)) : undefined,
      );
      const rows = await tx.select({
        id: employee.id, number: employee.number, nameAr: employee.nameAr, jobTitleAr: employee.jobTitleAr, department: employee.department, mobile: employee.mobile,
        nationality: employee.nationality, hireDate: employee.hireDate, idExpiry: employee.idExpiry, contractEndDate: employee.contractEndDate, probationEndDate: employee.probationEndDate, status: employee.status,
        basicSalary: employee.basicSalary, housingAllowance: employee.housingAllowance, transportAllowance: employee.transportAllowance, otherAllowances: employee.otherAllowances,
      }).from(employee).where(where).orderBy(asc(employee.number)).limit(q.limit).offset(q.offset);
      const soon = addDays(riyadhDate(), 60);
      const [t] = await tx.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${employee.status} = 'active')::int`,
        idExpiring: sql<number>`count(*) filter (where ${employee.status} <> 'terminated' and ${employee.idExpiry} <= ${soon})::int`,
        contractEnding: sql<number>`count(*) filter (where ${employee.status} <> 'terminated' and ${employee.contractEndDate} <= ${soon})::int`,
        payroll: sql<string>`coalesce(sum(${employee.basicSalary} + ${employee.housingAllowance} + ${employee.transportAllowance} + coalesce((select sum((a->>'amount')::numeric) from jsonb_array_elements(${employee.otherAllowances}) a), 0)) filter (where ${employee.status} = 'active'), 0)::numeric(18,2)::text`,
      }).from(employee).where(where);
      const departments = await tx.selectDistinct({ d: employee.department }).from(employee).where(sql`${employee.department} is not null`).orderBy(asc(employee.department));
      return {
        rows: rows.map(({ basicSalary, housingAllowance, transportAllowance, otherAllowances, ...r }) => ({ ...r, monthlyTotal: halalasToFixed(offerPackage({ basicSalary, housingAllowance, transportAllowance, otherAllowances }).monthly) })),
        total: t!.total, summary: { active: t!.active, idExpiring: t!.idExpiring, contractEnding: t!.contractEnding, payroll: t!.payroll },
        departments: departments.map((x) => x.d!),
      };
    });
  }

  @Get(':id')
  @Perm('hr.read')
  async get(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, (tx) => employeeView(tx, id));
  }

  @Post()
  @Perm('hr.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(employeeSchema)) b: EmployeeBody) {
    return tenantTx(actor.tenantId, async (tx) => {
      await checkEmployeeLinks(tx, b);
      const { number } = await nextNumber(tx, 'employee');
      const [e] = await tx.insert(employee).values({ number, ...employeeValues(b), createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'employee', e!.id, null, { number, name: b.nameAr, jobTitle: b.jobTitleAr });
      return employeeView(tx, e!.id);
    }, actor.userId);
  }

  @Put(':id')
  @Perm('hr.write')
  async update(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(employeeSchema.extend({ version: z.number().int() }))) b: EmployeeBody & { version: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadEmployee(tx, id);
      if (b.version !== before.version) throw conflict('the employee was changed by someone else — reload');
      if (before.status === 'terminated') throw conflict('a terminated employee is read-only — reinstate them first');
      await checkEmployeeLinks(tx, b, id);
      const next = employeeValues(b);
      await tx.update(employee).set({ ...next, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(employee.id, id));
      const d = diff(before as Record<string, unknown>, next as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'employee', id, d.before, d.after);
      return employeeView(tx, id);
    }, actor.userId);
  }

  /** active ⇄ suspended, → terminated (date + reason), and reinstating a terminated employee. */
  @Post(':id/status')
  @Perm('hr.write')
  async setStatus(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string,
    @Body(new ZodPipe(z.object({ status: z.enum(['active', 'suspended', 'terminated']), date: zDate.optional(), reason: zText(1000).optional() }))) b: { status: 'active' | 'suspended' | 'terminated'; date?: string; reason?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const e = await loadEmployee(tx, id);
      if (e.status === b.status) throw conflict(`the employee is already ${b.status}`);
      if (b.status === 'terminated' && (!b.date || !b.reason)) throw badRequest('the last working day and the reason are required');
      if (b.status === 'terminated' && b.date! < e.hireDate) throw badRequest('the last working day is before the hire date');
      if (b.status !== 'active' && !b.reason) throw badRequest('a reason is required');
      const set = b.status === 'terminated'
        ? { status: b.status, terminationDate: b.date!, terminationReason: b.reason! }
        : { status: b.status, terminationDate: null, terminationReason: null };
      await tx.update(employee).set({ ...set, updatedAt: new Date(), updatedBy: actor.userId, version: e.version + 1 }).where(eq(employee.id, id));
      await audit(tx, actor, b.status === 'terminated' ? 'terminate' : 'status', 'employee', id, { status: e.status }, { status: b.status, terminationDate: set.terminationDate }, b.reason);
      return employeeView(tx, id);
    }, actor.userId);
  }
}
