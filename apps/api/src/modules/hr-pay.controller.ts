import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { tryPost } from './gl-posting.service.js';
import { and, appUser, asc, cashVoucher, desc, employee, eq, gte, inArray, leaveRequest, lte, ne, nextNumber, notification, or, payAdjustment, payrollLine, payrollRun, role, sql, userRole, type Tx } from '@mmc/db';
import { accruedLeave, BALANCE_LEAVE, computePayslip, daysBetween, halalasToFixed, LEAVE_TYPES, monthRange, riyadhDate, toHalalas, type LeaveType } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { ZodPipe, zDate, zMoney, zUuid } from '../common/zod.js';
import { myName } from './hr.controller.js';

/**
 * Leave, bonuses / deductions and the monthly payroll.
 *  - An employee with a linked login requests leave at /hr/me; their direct manager or anyone with
 *    hr.approve decides. HR (hr.write) can also enter leave for an employee, approved at once.
 *  - Bonuses and deductions are entered per month by HR.
 *  - A payroll month is a draft until a second person with hr.approve approves it; approval locks
 *    that month's leave and adjustments. Then it is marked paid; the bank file is a CSV.
 */

const zText = (max = 2000) => z.string().trim().max(max);
const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const LEAVE_AR: Record<LeaveType, string> = { annual: 'سنوية', emergency: 'طارئة', sick: 'مرضية', unpaid: 'بدون أجر' };

const leaveBody = z.object({
  type: z.enum(LEAVE_TYPES),
  startDate: zDate,
  endDate: zDate,
  reason: zText(1000).nullish(),
  attachmentFileId: zUuid.nullish(),
});
type LeaveBody = z.infer<typeof leaveBody>;

const money = (h: number) => halalasToFixed(h);
const monthOf = (d: string) => d.slice(0, 7);

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split('-').map(Number) as [number, number];
  const last = monthOf(end);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push(k);
    if (k >= last) return out;
    m++; if (m > 12) { m = 1; y++; }
  }
}

async function lockedMonths(tx: Tx, months: string[]): Promise<string[]> {
  if (!months.length) return [];
  const rows = await tx.select({ month: payrollRun.month }).from(payrollRun).where(and(inArray(payrollRun.month, months), inArray(payrollRun.status, ['approved', 'paid'])));
  return rows.map((r) => r.month);
}

async function assertOpen(tx: Tx, months: string[]) {
  const locked = await lockedMonths(tx, months);
  if (locked.length) throw conflict(`the payroll for ${locked.join(', ')} is already approved — that month is locked`);
}

async function loadEmployee(tx: Tx, id: string) {
  const [e] = await tx.select().from(employee).where(eq(employee.id, id));
  if (!e) throw notFound('employee');
  return e;
}

/** The employee record linked to the signed-in user, if any. */
async function myEmployee(tx: Tx, actor: RequestActor) {
  const [e] = await tx.select().from(employee).where(eq(employee.userId, actor.userId));
  return e ?? null;
}

type Emp = typeof employee.$inferSelect;

/** Annual balance (annual + emergency leave) as of a day. */
async function leaveBalance(tx: Tx, e: Emp, asOf: string, excludeId?: string) {
  const rows = await tx.select({ days: leaveRequest.days, status: leaveRequest.status, type: leaveRequest.type }).from(leaveRequest)
    .where(and(eq(leaveRequest.employeeId, e.id), inArray(leaveRequest.type, [...BALANCE_LEAVE]), inArray(leaveRequest.status, ['approved', 'pending']), excludeId ? ne(leaveRequest.id, excludeId) : undefined));
  const taken = rows.filter((r) => r.status === 'approved').reduce((s, r) => s + r.days, 0);
  const pending = rows.filter((r) => r.status === 'pending').reduce((s, r) => s + r.days, 0);
  const accrued = asOf < e.hireDate ? 0 : accruedLeave(e.hireDate, asOf, e.annualLeaveDays);
  const sick12 = await tx.select({ s: sql<number>`coalesce(sum(least(${leaveRequest.endDate}, ${asOf}::date) - greatest(${leaveRequest.startDate}, (${asOf}::date - 364)) + 1) filter (where ${leaveRequest.endDate} >= ${asOf}::date - 364 and ${leaveRequest.startDate} <= ${asOf}::date), 0)::int` })
    .from(leaveRequest).where(and(eq(leaveRequest.employeeId, e.id), eq(leaveRequest.type, 'sick'), eq(leaveRequest.status, 'approved')));
  return { asOf, accrued, taken, pending, available: Math.floor((accrued - taken - pending) * 100) / 100, sickDaysLast12Months: sick12[0]?.s ?? 0 };
}

/** Shared checks for a new leave: dates, employment, overlap, locked months and (for annual / emergency) the balance. */
async function checkLeave(tx: Tx, e: Emp, b: LeaveBody, opts: { allowNegative: boolean }) {
  if (b.endDate < b.startDate) throw badRequest('the leave ends before it starts');
  const days = daysBetween(b.startDate, b.endDate);
  if (days > 180) throw badRequest('a single leave cannot exceed 180 days');
  if (e.status === 'terminated') throw conflict('the employee has left');
  if (b.startDate < e.hireDate) throw badRequest('the leave starts before the hire date');
  const [overlap] = await tx.select({ number: leaveRequest.number }).from(leaveRequest).where(and(
    eq(leaveRequest.employeeId, e.id), inArray(leaveRequest.status, ['pending', 'approved']), lte(leaveRequest.startDate, b.endDate), gte(leaveRequest.endDate, b.startDate)));
  if (overlap) throw conflict(`these dates overlap leave ${overlap.number}`);
  await assertOpen(tx, monthsBetween(b.startDate, b.endDate));
  if ((BALANCE_LEAVE as readonly string[]).includes(b.type) && !opts.allowNegative) {
    const bal = await leaveBalance(tx, e, b.endDate);
    if (days > bal.available) throw badRequest(`not enough annual leave balance: ${bal.available} days available by ${b.endDate}, ${days} requested`);
  }
  return days;
}

/** The direct manager (if linked to a login) and everyone holding hr.approve. */
async function approverUserIds(tx: Tx, e: Emp): Promise<string[]> {
  const ids = new Set<string>();
  if (e.managerId) {
    const [m] = await tx.select({ userId: employee.userId }).from(employee).where(eq(employee.id, e.managerId));
    if (m?.userId) ids.add(m.userId);
  }
  const rows = await tx.select({ userId: userRole.userId }).from(userRole).innerJoin(role, eq(role.id, userRole.roleId)).innerJoin(appUser, eq(appUser.id, userRole.userId))
    .where(and(sql`${role.grants} ? 'hr.approve'`, eq(appUser.status, 'active')));
  for (const r of rows) ids.add(r.userId);
  return [...ids];
}

/** hr.approve, or the employee's direct manager (their own leave never). */
async function canDecide(tx: Tx, actor: RequestActor, e: Emp): Promise<boolean> {
  if (e.userId === actor.userId && !actor.roleKeys.includes('owner')) return false;
  if (actor.grants['hr.approve']) return true;
  if (!e.managerId) return false;
  const [m] = await tx.select({ userId: employee.userId }).from(employee).where(eq(employee.id, e.managerId));
  return !!m?.userId && m.userId === actor.userId;
}

const leaveCols = {
  id: leaveRequest.id, number: leaveRequest.number, employeeId: leaveRequest.employeeId, type: leaveRequest.type, startDate: leaveRequest.startDate, endDate: leaveRequest.endDate,
  days: leaveRequest.days, reason: leaveRequest.reason, attachmentFileId: leaveRequest.attachmentFileId, source: leaveRequest.source, status: leaveRequest.status,
  decidedByName: leaveRequest.decidedByName, decidedAt: leaveRequest.decidedAt, decisionNote: leaveRequest.decisionNote, createdAt: leaveRequest.createdAt,
  employeeNumber: employee.number, employeeName: employee.nameAr, department: employee.department,
};

async function leaveView(tx: Tx, id: string) {
  const [l] = await tx.select(leaveCols).from(leaveRequest).innerJoin(employee, eq(employee.id, leaveRequest.employeeId)).where(eq(leaveRequest.id, id));
  if (!l) throw notFound('leave');
  return l;
}

async function insertLeave(tx: Tx, actor: RequestActor, e: Emp, b: LeaveBody, days: number, source: 'employee' | 'hr') {
  const { number } = await nextNumber(tx, 'leave_request');
  const approved = source === 'hr';
  const name = approved ? await myName(tx, actor) : null;
  const [l] = await tx.insert(leaveRequest).values({
    number, employeeId: e.id, type: b.type, startDate: b.startDate, endDate: b.endDate, days, reason: b.reason || null, attachmentFileId: b.attachmentFileId ?? null,
    source, status: approved ? 'approved' : 'pending', decidedBy: approved ? actor.userId : null, decidedByName: name, decidedAt: approved ? new Date() : null,
    createdBy: actor.userId, updatedBy: actor.userId,
  }).returning();
  await audit(tx, actor, 'create', 'leave_request', l!.id, null, { number, employee: e.number, type: b.type, startDate: b.startDate, endDate: b.endDate, days, status: l!.status });
  if (approved) {
    if (e.userId && e.userId !== actor.userId) await tx.insert(notification).values({ userId: e.userId, kind: 'hr', titleAr: `سُجّلت لك إجازة ${LEAVE_AR[b.type]} ${b.startDate} — ${b.endDate} (${days} يومًا)`, titleEn: `${b.type} leave recorded for you`, link: '/hr/me' });
  } else {
    for (const u of await approverUserIds(tx, e)) {
      if (u !== actor.userId) await tx.insert(notification).values({ userId: u, kind: 'hr', titleAr: `طلب إجازة ${LEAVE_AR[b.type]} من ${e.nameAr} — ${days} يومًا`, titleEn: `Leave request from ${e.nameEn || e.nameAr}`, link: '/hr/leaves' });
    }
  }
  return leaveView(tx, l!.id);
}

// ───────────── self-service ─────────────

@Controller('hr/me')
export class MyHrController {
  /** My employee card, leave balance, leave and (for managers) the team's pending requests. */
  @Get()
  async me(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const e = await myEmployee(tx, actor);
      const team = await tx.select(leaveCols).from(leaveRequest).innerJoin(employee, eq(employee.id, leaveRequest.employeeId))
        .where(and(eq(leaveRequest.status, 'pending'), e ? eq(employee.managerId, e.id) : sql`false`)).orderBy(asc(leaveRequest.startDate));
      if (!e) return { employee: null, balance: null, leaves: [], adjustments: [], teamPending: team };
      const leaves = await tx.select(leaveCols).from(leaveRequest).innerJoin(employee, eq(employee.id, leaveRequest.employeeId)).where(eq(leaveRequest.employeeId, e.id)).orderBy(desc(leaveRequest.startDate)).limit(100);
      const adjustments = await tx.select({ id: payAdjustment.id, month: payAdjustment.month, kind: payAdjustment.kind, amount: payAdjustment.amount, reason: payAdjustment.reason, payMethod: payAdjustment.payMethod })
        .from(payAdjustment).where(eq(payAdjustment.employeeId, e.id)).orderBy(desc(payAdjustment.month)).limit(24);
      return {
        employee: { id: e.id, number: e.number, nameAr: e.nameAr, jobTitleAr: e.jobTitleAr, department: e.department, hireDate: e.hireDate, annualLeaveDays: e.annualLeaveDays, status: e.status },
        balance: await leaveBalance(tx, e, riyadhDate()), leaves, adjustments, teamPending: team,
      };
    });
  }

  @Post('leaves')
  async request(@Actor() actor: RequestActor, @Body(new ZodPipe(leaveBody)) b: LeaveBody) {
    return tenantTx(actor.tenantId, async (tx) => {
      const e = await myEmployee(tx, actor);
      if (!e) throw forbidden('your login is not linked to an employee record — ask HR');
      const days = await checkLeave(tx, e, b, { allowNegative: false });
      return insertLeave(tx, actor, e, b, days, 'employee');
    }, actor.userId);
  }

  /** Withdraw my own pending request. */
  @Post('leaves/:id/cancel')
  async cancelMine(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const e = await myEmployee(tx, actor);
      const [l] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, id));
      if (!l || !e || l.employeeId !== e.id) throw notFound('leave');
      if (l.status !== 'pending') throw conflict('only a pending request can be withdrawn — ask HR to cancel approved leave');
      await tx.update(leaveRequest).set({ status: 'cancelled', updatedAt: new Date(), updatedBy: actor.userId, version: l.version + 1 }).where(eq(leaveRequest.id, id));
      await audit(tx, actor, 'cancel', 'leave_request', id, { status: 'pending' }, { status: 'cancelled' });
      return leaveView(tx, id);
    }, actor.userId);
  }
}

// ───────────── leave (HR / managers) ─────────────

const leaveList = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), type: z.enum(LEAVE_TYPES).optional(), employeeId: zUuid.optional(),
  from: zDate.optional(), to: zDate.optional(), limit: z.coerce.number().int().min(1).max(500).default(200),
});

@Controller('hr/leaves')
export class LeavesController {
  @Get()
  @Perm('hr.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(leaveList)) q: z.infer<typeof leaveList>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const where = and(
        q.status ? eq(leaveRequest.status, q.status) : undefined, q.type ? eq(leaveRequest.type, q.type) : undefined,
        q.employeeId ? eq(leaveRequest.employeeId, q.employeeId) : undefined,
        q.from ? gte(leaveRequest.endDate, q.from) : undefined, q.to ? lte(leaveRequest.startDate, q.to) : undefined,
      );
      const rows = await tx.select(leaveCols).from(leaveRequest).innerJoin(employee, eq(employee.id, leaveRequest.employeeId)).where(where)
        .orderBy(sql`case when ${leaveRequest.status} = 'pending' then 0 else 1 end`, desc(leaveRequest.startDate)).limit(q.limit);
      const today = riyadhDate();
      const [t] = await tx.select({
        pending: sql<number>`count(*) filter (where ${leaveRequest.status} = 'pending')::int`,
        onLeaveToday: sql<number>`count(distinct ${leaveRequest.employeeId}) filter (where ${leaveRequest.status} = 'approved' and ${leaveRequest.startDate} <= ${today} and ${leaveRequest.endDate} >= ${today})::int`,
      }).from(leaveRequest);
      return { rows, summary: t };
    });
  }

  /** HR / manager enters leave for an employee — approved at once. `allowNegative` lets annual leave go below zero. */
  @Post('employee/:employeeId')
  @Perm('hr.write')
  async enter(@Actor() actor: RequestActor, @Param('employeeId', new ZodPipe(zUuid)) employeeId: string,
    @Body(new ZodPipe(leaveBody.extend({ allowNegative: z.boolean().default(false) }))) b: LeaveBody & { allowNegative: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const e = await loadEmployee(tx, employeeId);
      const days = await checkLeave(tx, e, b, { allowNegative: b.allowNegative });
      return insertLeave(tx, actor, e, b, days, 'hr');
    }, actor.userId);
  }

  /** Approve or reject a pending request: hr.approve, or the employee's direct manager. */
  @Post(':id/decide')
  async decide(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string,
    @Body(new ZodPipe(z.object({ approve: z.boolean(), note: zText(1000).nullish() }))) b: { approve: boolean; note?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [l] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, id));
      if (!l) throw notFound('leave');
      const e = await loadEmployee(tx, l.employeeId);
      if (!(await canDecide(tx, actor, e))) throw forbidden('only the direct manager or HR approvers can decide this request');
      if (l.status !== 'pending') throw conflict(`the request is already ${l.status}`);
      if (!b.approve && !b.note?.trim()) throw badRequest('give the reason for rejecting');
      if (b.approve) {
        await assertOpen(tx, monthsBetween(l.startDate, l.endDate));
        if ((BALANCE_LEAVE as readonly string[]).includes(l.type)) {
          const bal = await leaveBalance(tx, e, l.endDate, l.id);
          if (l.days > bal.available + bal.pending) throw badRequest(`not enough annual leave balance (${bal.available} days available)`);
        }
      }
      const status = b.approve ? 'approved' : 'rejected';
      await tx.update(leaveRequest).set({ status, decidedBy: actor.userId, decidedByName: await myName(tx, actor), decidedAt: new Date(), decisionNote: b.note || null, updatedAt: new Date(), updatedBy: actor.userId, version: l.version + 1 }).where(eq(leaveRequest.id, id));
      await audit(tx, actor, b.approve ? 'approve' : 'reject', 'leave_request', id, { status: 'pending' }, { status }, b.note ?? undefined);
      if (e.userId) await tx.insert(notification).values({ userId: e.userId, kind: 'hr', titleAr: `${b.approve ? '✅ اعتُمد' : '❌ رُفض'} طلب الإجازة ${l.number}`, titleEn: `Leave ${l.number} ${status}`, link: '/hr/me' });
      return leaveView(tx, id);
    }, actor.userId);
  }

  /** Cancel pending or approved leave (hr.write), with a reason; not inside an approved payroll month. */
  @Post(':id/cancel')
  @Perm('hr.write')
  async cancel(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ reason: zText(1000).min(1) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [l] = await tx.select().from(leaveRequest).where(eq(leaveRequest.id, id));
      if (!l) throw notFound('leave');
      if (!['pending', 'approved'].includes(l.status)) throw conflict(`a ${l.status} leave cannot be cancelled`);
      await assertOpen(tx, monthsBetween(l.startDate, l.endDate));
      await tx.update(leaveRequest).set({ status: 'cancelled', decisionNote: b.reason, updatedAt: new Date(), updatedBy: actor.userId, version: l.version + 1 }).where(eq(leaveRequest.id, id));
      await audit(tx, actor, 'cancel', 'leave_request', id, { status: l.status }, { status: 'cancelled' }, b.reason);
      return leaveView(tx, id);
    }, actor.userId);
  }
}

// ───────────── employee time-off & adjustments ─────────────

const adjBody = z.object({
  month: zMonth, kind: z.enum(['bonus', 'deduction']), amount: zMoney.refine((v) => Number(v) > 0, 'must be positive'), reason: zText(500).min(1),
  /** payroll: with the month's salary · voucher: a bonus paid now by a payment voucher (سند صرف) */
  payBy: z.enum(['payroll', 'voucher']).default('payroll'),
  method: z.enum(['cash', 'transfer', 'cheque']).default('transfer'),
  /** deductions only: where the ledger credits it — advance (سلفة) | penalty (جزاء) | other */
  category: z.enum(['advance', 'penalty', 'other']).default('other'),
});

const adjCols = {
  id: payAdjustment.id, employeeId: payAdjustment.employeeId, month: payAdjustment.month, kind: payAdjustment.kind, amount: payAdjustment.amount, reason: payAdjustment.reason,
  payMethod: payAdjustment.payMethod, category: payAdjustment.category, voucherId: payAdjustment.voucherId, createdAt: payAdjustment.createdAt,
  voucherNumber: cashVoucher.number, voucherStatus: cashVoucher.status,
};

@Controller('hr/employees')
export class EmployeePayController {
  /** Leave balance, leave history and bonuses / deductions shown on the employee page. */
  @Get(':id/time-off')
  @Perm('hr.read')
  async timeOff(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const e = await loadEmployee(tx, id);
      const leaves = await tx.select(leaveCols).from(leaveRequest).innerJoin(employee, eq(employee.id, leaveRequest.employeeId)).where(eq(leaveRequest.employeeId, id)).orderBy(desc(leaveRequest.startDate));
      const adjustments = await tx.select(adjCols).from(payAdjustment).leftJoin(cashVoucher, eq(cashVoucher.id, payAdjustment.voucherId)).where(eq(payAdjustment.employeeId, id)).orderBy(desc(payAdjustment.month), desc(payAdjustment.createdAt));
      const locked = await lockedMonths(tx, [...new Set(adjustments.map((a) => a.month))]);
      return {
        balance: await leaveBalance(tx, e, riyadhDate()), leaves,
        adjustments: adjustments.map((a) => ({ ...a, locked: a.payMethod === 'payroll' && locked.includes(a.month) })),
      };
    });
  }

  @Post(':id/adjustments')
  @Perm('hr.write')
  async addAdjustment(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(adjBody)) b: z.infer<typeof adjBody>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const e = await loadEmployee(tx, id);
      const byVoucher = b.payBy === 'voucher';
      if (byVoucher && b.kind !== 'bonus') throw badRequest('only a bonus can be paid by voucher');
      if (byVoucher && !actor.grants['voucher.write']) throw forbidden('paying by voucher needs voucher.write — ask finance, or add it to the payroll');
      if (byVoucher && e.status === 'terminated') throw conflict('the employee has left');
      const month = byVoucher ? monthOf(riyadhDate()) : b.month;
      if (!byVoucher) await assertOpen(tx, [month]);
      if (month < monthOf(e.hireDate)) throw badRequest('that month is before the hire date');
      const amount = halalasToFixed(toHalalas(b.amount));
      let voucherId: string | null = null;
      if (byVoucher) {
        // a draft payment voucher in the normal finance flow: a second person approves and stamps it
        const { number } = await nextNumber(tx, 'payment_voucher');
        const [v] = await tx.insert(cashVoucher).values({
          kind: 'payment', number, voucherDate: riyadhDate(), counterpartyName: e.nameAr, counterpartyIdNumber: e.idNumber, counterpartyMobile: e.mobile, amount,
          purpose: `مكافأة للموظف ${e.nameAr} (${e.number}) — ${b.reason}`, method: b.method, bankName: b.method === 'transfer' ? e.bankName : null,
          methodRef: b.method === 'transfer' ? e.iban : null, costCenter: 'مكافآت الموظفين', docRef: e.number, createdBy: actor.userId, updatedBy: actor.userId,
        }).returning();
        voucherId = v!.id;
        await audit(tx, actor, 'create', 'cash_voucher', v!.id, null, { number, kind: 'payment', amount, counterparty: e.nameAr, source: 'hr_bonus' });
      }
      const [a] = await tx.insert(payAdjustment).values({ employeeId: id, month, kind: b.kind, amount, reason: b.reason, payMethod: b.payBy, voucherId, category: b.kind === 'deduction' ? b.category : 'other', createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'pay_adjustment', a!.id, null, { employee: e.number, month, kind: b.kind, amount, reason: b.reason, payBy: b.payBy });
      if (e.userId && e.userId !== actor.userId) {
        await tx.insert(notification).values({ userId: e.userId, kind: 'hr', titleAr: byVoucher ? `🎉 مكافأة ${amount} ريال — ${b.reason}` : `${b.kind === 'bonus' ? '🎉 مكافأة' : 'خصم'} ${amount} ريال على راتب ${month} — ${b.reason}`, titleEn: `${b.kind} ${amount} SAR`, link: '/hr/me' });
      }
      const [row] = await tx.select(adjCols).from(payAdjustment).leftJoin(cashVoucher, eq(cashVoucher.id, payAdjustment.voucherId)).where(eq(payAdjustment.id, a!.id));
      return { ...row!, locked: false };
    }, actor.userId);
  }

  @Delete(':id/adjustments/:adjId')
  @Perm('hr.write')
  async deleteAdjustment(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Param('adjId', new ZodPipe(zUuid)) adjId: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [a] = await tx.select().from(payAdjustment).where(and(eq(payAdjustment.id, adjId), eq(payAdjustment.employeeId, id)));
      if (!a) throw notFound('adjustment');
      if (a.voucherId) {
        // the voucher is the payment: a stamped voucher must be cancelled in Finance first; a draft is cancelled with the bonus
        const [v] = await tx.select().from(cashVoucher).where(eq(cashVoucher.id, a.voucherId));
        if (v?.status === 'approved') throw conflict(`payment voucher ${v.number} is already approved — cancel it in Finance first`);
        if (v?.status === 'draft') {
          await tx.update(cashVoucher).set({ status: 'cancelled', cancelledBy: actor.userId, cancelledAt: new Date(), cancelReason: 'أُلغيت المكافأة من الموارد البشرية', updatedAt: new Date(), updatedBy: actor.userId, version: v.version + 1 }).where(eq(cashVoucher.id, v.id));
          await audit(tx, actor, 'cancel', 'cash_voucher', v.id, { status: 'draft' }, { status: 'cancelled' }, 'bonus deleted in HR');
        }
      } else {
        await assertOpen(tx, [a.month]);
      }
      await tx.delete(payAdjustment).where(eq(payAdjustment.id, adjId));
      await audit(tx, actor, 'delete', 'pay_adjustment', adjId, { month: a.month, kind: a.kind, amount: a.amount, reason: a.reason }, null);
      return { ok: true };
    }, actor.userId);
  }
}

// ───────────── payroll ─────────────

/** (Re)build the draft lines of a month from the current employees, leave and adjustments. */
async function calculate(tx: Tx, runId: string, month: string) {
  const { start, end } = monthRange(month);
  const emps = await tx.select().from(employee).where(and(lte(employee.hireDate, end), or(sql`${employee.terminationDate} is null`, gte(employee.terminationDate, start)), or(ne(employee.status, 'terminated'), gte(employee.terminationDate, start))))
    .orderBy(asc(employee.number));
  const ids = emps.map((e) => e.id);
  const leaves = ids.length ? await tx.select().from(leaveRequest).where(and(inArray(leaveRequest.employeeId, ids), eq(leaveRequest.status, 'approved'), lte(leaveRequest.startDate, end))) : [];
  const adjs = ids.length ? await tx.select().from(payAdjustment).where(and(inArray(payAdjustment.employeeId, ids), eq(payAdjustment.month, month), eq(payAdjustment.payMethod, 'payroll'))) : [];
  await tx.delete(payrollLine).where(eq(payrollLine.runId, runId));
  let gross = 0, ded = 0, net = 0;
  for (const e of emps) {
    const myAdj = adjs.filter((a) => a.employeeId === e.id);
    const p = computePayslip({
      month, hireDate: e.hireDate, terminationDate: e.terminationDate, gosiEmployeePercent: e.gosiEmployeePercent,
      pay: { basicSalary: e.basicSalary, housingAllowance: e.housingAllowance, transportAllowance: e.transportAllowance, otherAllowances: e.otherAllowances },
      adjustments: myAdj.map((a) => ({ kind: a.kind as 'bonus' | 'deduction', amount: a.amount })),
      leaves: leaves.filter((l) => l.employeeId === e.id).map((l) => ({ type: l.type, startDate: l.startDate, endDate: l.endDate })),
    });
    const warnings = [...p.warnings];
    if (e.status === 'suspended') warnings.push('suspended');
    if (!e.iban) warnings.push('no_iban');
    await tx.insert(payrollLine).values({
      runId, employeeId: e.id, employeeNumber: e.number, nameAr: e.nameAr, jobTitleAr: e.jobTitleAr, department: e.department, iban: e.iban, bankName: e.bankName,
      workedDays: p.workedDays, basic: money(p.basic), housing: money(p.housing), transport: money(p.transport), other: money(p.other), bonuses: money(p.bonuses),
      gross: money(p.gross), unpaidLeave: money(p.unpaidLeave), sickDeduction: money(p.sickDeduction), deductions: money(p.deductions), gosi: money(p.gosi),
      totalDeductions: money(p.totalDeductions), net: money(p.net),
      details: { leaveDays: p.leaveDays, unpaidLeaveDays: p.unpaidLeaveDays, sickDays: p.sickDays, warnings, adjustments: myAdj.map((a) => ({ kind: a.kind, amount: a.amount, reason: a.reason })) },
    });
    gross += p.gross; ded += p.totalDeductions; net += p.net;
  }
  const totals = { employeeCount: emps.length, gross: money(gross), totalDeductions: money(ded), net: money(net) };
  await tx.update(payrollRun).set({ ...totals, calculatedAt: new Date() }).where(eq(payrollRun.id, runId));
  return totals;
}

async function loadRun(tx: Tx, id: string) {
  const [r] = await tx.select().from(payrollRun).where(eq(payrollRun.id, id));
  if (!r) throw notFound('payroll');
  return r;
}

async function runView(tx: Tx, id: string) {
  const r = await loadRun(tx, id);
  const lines = await tx.select().from(payrollLine).where(eq(payrollLine.runId, id)).orderBy(asc(payrollLine.employeeNumber));
  const [cu] = r.createdBy ? await tx.select({ nameAr: appUser.nameAr }).from(appUser).where(eq(appUser.id, r.createdBy)) : [];
  return { ...r, createdByName: cu?.nameAr ?? null, lines };
}

@Controller('hr/payroll')
export class PayrollController {
  @Get()
  @Perm('hr.read')
  async list(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => tx.select().from(payrollRun).orderBy(desc(payrollRun.month)).limit(60));
  }

  @Get(':id')
  @Perm('hr.read')
  async get(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, (tx) => runView(tx, id));
  }

  /** Prepare a month (or recalculate its draft). */
  @Post()
  @Perm('hr.write')
  async prepare(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ month: zMonth }))) b: { month: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (b.month > monthOf(riyadhDate()).replace(/(\d{4})-(\d{2})/, (_, y: string, m: string) => (m === '12' ? `${Number(y) + 1}-01` : `${y}-${String(Number(m) + 1).padStart(2, '0')}`))) {
        throw badRequest('payroll can be prepared up to next month');
      }
      let [r] = await tx.select().from(payrollRun).where(eq(payrollRun.month, b.month));
      if (r && r.status !== 'draft') throw conflict(`the ${b.month} payroll is already ${r.status}`);
      if (!r) {
        [r] = await tx.insert(payrollRun).values({ month: b.month, createdBy: actor.userId, updatedBy: actor.userId }).returning();
        await audit(tx, actor, 'create', 'payroll_run', r!.id, null, { month: b.month });
      }
      await calculate(tx, r!.id, b.month);
      await tx.update(payrollRun).set({ updatedAt: new Date(), updatedBy: actor.userId, version: r!.version + 1 }).where(eq(payrollRun.id, r!.id));
      return runView(tx, r!.id);
    }, actor.userId);
  }

  /**
   * Approve: recalculated first; if anything changed since the approver last saw it (`expectedNet`)
   * the new figures are saved and the approval refused so they can be reviewed. Locks the month.
   */
  @Post(':id/approve')
  @Perm('hr.approve')
  async approve(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ expectedNet: zMoney }))) b: { expectedNet: string }) {
    const result = await tenantTx(actor.tenantId, async (tx) => {
      const r = await loadRun(tx, id);
      if (r.status !== 'draft') throw conflict(`the payroll is already ${r.status}`);
      if (r.createdBy === actor.userId && !actor.roleKeys.includes('owner')) throw forbidden('you prepared this payroll — another approver must approve it');
      const totals = await calculate(tx, id, r.month);
      if (totals.net !== halalasToFixed(toHalalas(b.expectedNet))) return { changed: true as const };
      await tx.update(payrollRun).set({ status: 'approved', approvedBy: actor.userId, approvedByName: await myName(tx, actor), approvedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId, version: r.version + 1 }).where(eq(payrollRun.id, id));
      await audit(tx, actor, 'approve', 'payroll_run', id, { status: 'draft' }, { status: 'approved', month: r.month, net: totals.net, employees: totals.employeeCount });
      await tryPost(tx, 'payroll', id);
      return { changed: false as const };
    }, actor.userId);
    if (result.changed) throw conflict('leave or adjustments changed since you opened it — the payroll was recalculated; review the new figures and approve again');
    return tenantTx(actor.tenantId, (tx) => runView(tx, id));
  }

  @Post(':id/paid')
  @Perm('hr.approve')
  async paid(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ date: zDate, ref: zText(120).nullish() }))) b: { date: string; ref?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await loadRun(tx, id);
      if (r.status !== 'approved') throw conflict(r.status === 'paid' ? 'already marked paid' : 'approve the payroll first');
      if (b.date > riyadhDate()) throw badRequest('the payment date cannot be in the future');
      await tx.update(payrollRun).set({ status: 'paid', paidAt: b.date, paidRef: b.ref || null, updatedAt: new Date(), updatedBy: actor.userId, version: r.version + 1 }).where(eq(payrollRun.id, id));
      await audit(tx, actor, 'paid', 'payroll_run', id, { status: 'approved' }, { status: 'paid', paidAt: b.date, ref: b.ref ?? null });
      await tryPost(tx, 'payroll', id);
      await tryPost(tx, 'payroll_paid', id);
      const lines = await tx.select({ employeeId: payrollLine.employeeId, net: payrollLine.net }).from(payrollLine).where(eq(payrollLine.runId, id));
      const users = lines.length ? await tx.select({ id: employee.id, userId: employee.userId }).from(employee).where(inArray(employee.id, lines.map((l) => l.employeeId))) : [];
      for (const l of lines) {
        const u = users.find((x) => x.id === l.employeeId)?.userId;
        if (u) await tx.insert(notification).values({ userId: u, kind: 'hr', titleAr: `💰 صُرف راتب ${r.month}: ${l.net} ريال`, titleEn: `${r.month} salary paid: ${l.net} SAR`, link: '/hr/me' });
      }
      return runView(tx, id);
    }, actor.userId);
  }

  /** Delete a draft (e.g. prepared for the wrong month). */
  @Delete(':id')
  @Perm('hr.write')
  async remove(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await loadRun(tx, id);
      if (r.status !== 'draft') throw conflict('only a draft payroll can be deleted');
      await tx.delete(payrollRun).where(eq(payrollRun.id, id));
      await audit(tx, actor, 'delete', 'payroll_run', id, { month: r.month }, null);
      return { ok: true };
    }, actor.userId);
  }

  /** Bank transfer sheet (CSV, UTF-8 with BOM for Excel): employee, IBAN, net. */
  @Get(':id/csv')
  @Perm('hr.read')
  async csv(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Res() res: Response) {
    const r = await tenantTx(actor.tenantId, (tx) => runView(tx, id));
    // quoted, and text starting with = + - @ (or tab / CR) prefixed with ' so Excel never runs it as a formula
    const q = (v: unknown) => {
      const t = String(v ?? '');
      const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const head = ['رقم الموظف', 'الاسم', 'القسم', 'البنك', 'الآيبان', 'أيام العمل', 'الإجمالي', 'الاستقطاعات', 'التأمينات', 'الصافي'];
    const rows = r.lines.map((l) => [l.employeeNumber, l.nameAr, l.department, l.bankName, l.iban, l.workedDays, l.gross, l.totalDeductions, l.gosi, l.net]);
    const body = '﻿' + [head, ...rows].map((row) => row.map(q).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${r.month}.csv"`);
    res.send(body);
  }
}
