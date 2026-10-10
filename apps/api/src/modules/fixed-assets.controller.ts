import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { desc, eq, fixedAsset, fixedAssetDep, nextNumber, sql, type Tx } from '@mmc/db';
import { depreciationSchedule, monthOf, riyadhDate } from '@mmc/domain';
import type { ReportTable } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { ZodPipe, zDate, zUuid } from '../common/zod.js';
import { accountByKey, loadAccounts } from './ledger.service.js';
import { bookedDepreciation, disposeAsset, previewDepreciation, previewEosb, runDepreciation, runEosb, termsOf, type AssetRow } from './accruals.service.js';
import { H, fx, reportFormat, send, type ReportFormat } from './report-kit.js';

/** Fixed-asset register, depreciation, disposal and the end-of-service provision run (Phase 6C). */

const zText = (max = 500) => z.string().trim().max(max);
const zAmount = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'invalid amount (max 2 decimals)');
const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');

const assetBody = z.object({
  nameAr: zText(200).min(1),
  accountId: zUuid,
  accumAccountId: zUuid.optional(),
  expenseAccountId: zUuid.optional(),
  acquiredOn: zDate,
  startMonth: zMonth.optional(),
  cost: zAmount,
  salvage: zAmount.default('0'),
  lifeMonths: z.coerce.number().int().min(1).max(1200),
  openingAccumulated: zAmount.default('0'),
  projectId: zUuid.nullish(),
  costCenter: zText(120).nullish(),
  sourceBillId: zUuid.nullish(),
  notes: zText(1000).nullish(),
});

/** Update body: the same fields, all optional and without the create-time defaults (an absent field must stay absent). */
const assetUpdate = z.object({
  nameAr: zText(200).min(1).optional(), accountId: zUuid.optional(), accumAccountId: zUuid.optional(), expenseAccountId: zUuid.optional(), acquiredOn: zDate.optional(), startMonth: zMonth.optional(),
  cost: zAmount.optional(), salvage: zAmount.optional(), lifeMonths: z.coerce.number().int().min(1).max(1200).optional(), openingAccumulated: zAmount.optional(),
  projectId: zUuid.nullish(), costCenter: zText(120).nullish(), notes: zText(1000).nullish(),
});

async function view(tx: Tx, a: AssetRow, booked: Map<string, number>) {
  const t = termsOf(a);
  const accumulated = H(a.openingAccumulated) + (booked.get(a.id) ?? 0);
  return {
    id: a.id, code: a.code, nameAr: a.nameAr, accountId: a.accountId, accumAccountId: a.accumAccountId, expenseAccountId: a.expenseAccountId,
    acquiredOn: a.acquiredOn, startMonth: a.startMonth, cost: a.cost, salvage: a.salvage, lifeMonths: a.lifeMonths, openingAccumulated: a.openingAccumulated,
    accumulated: fx(accumulated), netBook: fx(t.cost - accumulated), monthly: fx(Math.round((Math.max(0, t.cost - t.salvage)) / a.lifeMonths)),
    status: a.status, disposedOn: a.disposedOn, disposalProceeds: a.disposalProceeds, projectId: a.projectId, costCenter: a.costCenter, notes: a.notes, version: a.version,
  };
}

async function checkAccounts(tx: Tx, ids: { cost: string; accum: string; expense: string }) {
  const rows = await loadAccounts(tx);
  const get = (id: string) => rows.find((r) => r.id === id);
  const c = get(ids.cost), a = get(ids.accum), e = get(ids.expense);
  if (!c || c.isGroup || c.type !== 'asset') throw badRequest('حساب التكلفة يجب أن يكون حساب أصل قابلاً للترحيل');
  if (!a || a.isGroup || a.type !== 'asset') throw badRequest('حساب مجمع الإهلاك يجب أن يكون حساب أصل قابلاً للترحيل');
  if (!e || e.isGroup || e.type !== 'expense') throw badRequest('حساب مصروف الإهلاك يجب أن يكون حساب مصروف قابلاً للترحيل');
}

export function registerTable(items: Awaited<ReturnType<typeof view>>[], asOf: string): ReportTable {
  const N = (x: string) => Math.round(Number(x) * 100);
  const rows: ReportTable['rows'] = items.map((i) => ({ cells: { code: i.code, name: i.nameAr, acquired: i.acquiredOn, life: i.lifeMonths, cost: N(i.cost), accum: N(i.accumulated), nbv: N(i.netBook), status: i.status === 'active' ? 'نشط' : `مستبعد ${i.disposedOn ?? ''}` } }));
  rows.push({ style: 'total', cells: { name: 'الإجمالي', cost: items.reduce((s, i) => s + N(i.cost), 0), accum: items.reduce((s, i) => s + N(i.accumulated), 0), nbv: items.reduce((s, i) => s + N(i.netBook), 0) } });
  return {
    title: 'سجل الأصول الثابتة', titleEn: 'Fixed-asset register', subtitle: `كما في ${asOf}`,
    columns: [
      { key: 'code', label: 'الرمز', kind: 'text' }, { key: 'name', label: 'الأصل', kind: 'text', width: 30 }, { key: 'acquired', label: 'تاريخ الشراء', kind: 'date' }, { key: 'life', label: 'العمر (شهر)', kind: 'number' },
      { key: 'cost', label: 'التكلفة', kind: 'money' }, { key: 'accum', label: 'مجمع الإهلاك', kind: 'money' }, { key: 'nbv', label: 'صافي القيمة الدفترية', kind: 'money' }, { key: 'status', label: 'الحالة', kind: 'text' },
    ],
    rows,
  };
}

export async function assetRegister(tx: Tx, status?: 'active' | 'disposed') {
  const rows = await tx.select().from(fixedAsset).where(status ? eq(fixedAsset.status, status) : undefined).orderBy(fixedAsset.code);
  const booked = await bookedDepreciation(tx);
  return Promise.all(rows.map((r) => view(tx, r, booked)));
}

@Controller('accounting')
export class FixedAssetsController {
  @Get('fixed-assets')
  @Perm('ledger.read')
  async list(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(z.object({ status: z.enum(['active', 'disposed']).optional(), format: reportFormat }))) q: { status?: 'active' | 'disposed'; format: ReportFormat }) {
    const items = await tenantTx(actor.tenantId, (tx) => assetRegister(tx, q.status));
    const total = (k: 'cost' | 'accumulated' | 'netBook') => fx(items.reduce((s, i) => s + H(i[k]), 0));
    return send(res, actor, q.format, { items, totals: { cost: total('cost'), accumulated: total('accumulated'), netBook: total('netBook') } }, registerTable(items, riyadhDate()), 'fixed-assets');
  }

  @Get('fixed-assets/:id')
  @Perm('ledger.read')
  async get(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [a] = await tx.select().from(fixedAsset).where(eq(fixedAsset.id, id));
      if (!a) throw notFound('fixed asset');
      const booked = await bookedDepreciation(tx);
      const deps = await tx.select().from(fixedAssetDep).where(eq(fixedAssetDep.assetId, id)).orderBy(desc(fixedAssetDep.month));
      const schedule = depreciationSchedule(termsOf(a)).map((r) => ({ month: r.month, amount: fx(r.amount), accumulated: fx(r.accumulated), netBook: fx(r.netBook) }));
      return { ...(await view(tx, a, booked)), schedule, booked: deps.map((d) => ({ month: d.month, amount: d.amount })) };
    });
  }

  @Post('fixed-assets')
  @Perm('ledger.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(assetBody)) b: z.infer<typeof assetBody>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const accum = b.accumAccountId ?? (await accountByKey(tx, 'accumulated_depreciation')).id;
      const expense = b.expenseAccountId ?? (await accountByKey(tx, 'depreciation')).id;
      await checkAccounts(tx, { cost: b.accountId, accum, expense });
      if (H(b.salvage) > H(b.cost)) throw badRequest('قيمة الخردة أكبر من التكلفة');
      if (H(b.openingAccumulated) > H(b.cost) - H(b.salvage)) throw badRequest('مجمع الإهلاك الافتتاحي أكبر من القيمة القابلة للإهلاك');
      const { number } = await nextNumber(tx, 'fixed_asset');
      const [row] = await tx.insert(fixedAsset).values({
        code: number, nameAr: b.nameAr, accountId: b.accountId, accumAccountId: accum, expenseAccountId: expense, acquiredOn: b.acquiredOn, startMonth: b.startMonth ?? monthOf(b.acquiredOn),
        cost: b.cost, salvage: b.salvage, lifeMonths: b.lifeMonths, openingAccumulated: b.openingAccumulated, projectId: b.projectId ?? null, costCenter: b.costCenter || null,
        sourceBillId: b.sourceBillId ?? null, notes: b.notes || null, createdBy: actor.userId, updatedBy: actor.userId,
      }).returning();
      await audit(tx, actor, 'create', 'fixed_asset', row!.id, null, { code: number, cost: b.cost, lifeMonths: b.lifeMonths });
      return view(tx, row!, new Map());
    }, actor.userId);
  }

  @Put('fixed-assets/:id')
  @Perm('ledger.write')
  async update(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(assetUpdate)) b: z.infer<typeof assetUpdate>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [a] = await tx.select().from(fixedAsset).where(eq(fixedAsset.id, id));
      if (!a) throw notFound('fixed asset');
      if (a.status !== 'active') throw conflict('الأصل مستبعد ولا يُعدَّل');
      const [d] = await tx.select({ n: sql<number>`count(*)::int` }).from(fixedAssetDep).where(eq(fixedAssetDep.assetId, id));
      const financial = ['accountId', 'accumAccountId', 'expenseAccountId', 'cost', 'salvage', 'lifeMonths', 'startMonth', 'openingAccumulated', 'acquiredOn'] as const;
      if (d!.n > 0 && financial.some((k) => b[k] !== undefined)) throw conflict('بدأ إهلاك هذا الأصل — لا تُعدَّل بياناته المالية (استبعده وأنشئ أصلاً جديدًا إذا لزم)');
      const next = {
        accountId: b.accountId ?? a.accountId, accumAccountId: b.accumAccountId ?? a.accumAccountId, expenseAccountId: b.expenseAccountId ?? a.expenseAccountId,
      };
      await checkAccounts(tx, { cost: next.accountId, accum: next.accumAccountId, expense: next.expenseAccountId });
      const patch: Partial<typeof fixedAsset.$inferInsert> = {
        ...next, ...(b.nameAr !== undefined ? { nameAr: b.nameAr } : {}), ...(b.acquiredOn !== undefined ? { acquiredOn: b.acquiredOn } : {}), ...(b.startMonth !== undefined ? { startMonth: b.startMonth } : {}),
        ...(b.cost !== undefined ? { cost: b.cost } : {}), ...(b.salvage !== undefined ? { salvage: b.salvage } : {}), ...(b.lifeMonths !== undefined ? { lifeMonths: b.lifeMonths } : {}),
        ...(b.openingAccumulated !== undefined ? { openingAccumulated: b.openingAccumulated } : {}), ...(b.projectId !== undefined ? { projectId: b.projectId ?? null } : {}),
        ...(b.costCenter !== undefined ? { costCenter: b.costCenter || null } : {}), ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
      };
      const [row] = await tx.update(fixedAsset).set({ ...patch, updatedAt: new Date(), updatedBy: actor.userId, version: a.version + 1 }).where(eq(fixedAsset.id, id)).returning();
      const df = diff(a as Record<string, unknown>, patch as Record<string, unknown>);
      if (df) await audit(tx, actor, 'update', 'fixed_asset', id, df.before, df.after);
      return view(tx, row!, await bookedDepreciation(tx));
    }, actor.userId);
  }

  @Post('fixed-assets/:id/dispose')
  @Perm('ledger.post')
  async dispose(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ date: zDate, proceeds: zAmount.default('0'), proceedsAccountId: zUuid.nullish() }))) b: { date: string; proceeds: string; proceedsAccountId?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await disposeAsset(tx, actor, id, { date: b.date, proceeds: H(b.proceeds), proceedsAccountId: b.proceedsAccountId ?? null });
      await audit(tx, actor, 'dispose', 'fixed_asset', id, { status: 'active' }, { status: 'disposed', entry: r.entry.number, result: fx(r.result) });
      return { entry: r.entry, gainLoss: fx(r.result), accumulated: fx(r.accumulated) };
    }, actor.userId);
  }

  // ───── monthly runs ─────

  @Get('depreciation/preview')
  @Perm('ledger.read')
  async depPreview(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ month: zMonth }))) q: { month: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await previewDepreciation(tx, q.month);
      return { month: p.month, date: p.date, total: fx(p.total), lines: p.lines.map((l) => ({ ...l, amount: fx(l.amount), accumulatedAfter: fx(l.accumulatedAfter) })) };
    });
  }

  @Post('depreciation/run')
  @Perm('ledger.post')
  async depRun(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ month: zMonth }))) b: { month: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await runDepreciation(tx, actor, b.month);
      if (r.entry) await audit(tx, actor, 'run_depreciation', 'journal_entry', r.entry.id, null, { month: b.month, total: fx(r.total), assets: r.lines });
      return { entry: r.entry, total: fx(r.total), assets: r.lines };
    }, actor.userId);
  }

  @Get('eosb/preview')
  @Perm('ledger.post')
  async eosbPreview(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ month: zMonth }))) q: { month: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await previewEosb(tx, q.month);
      return {
        month: p.month, date: p.date, target: fx(p.target), balance: fx(p.balance), toPost: fx(p.toPost), remainder: fx(p.remainder),
        rows: p.rows.map((r) => ({ ...r, wage: fx(r.wage), target: fx(r.target), booked: fx(r.booked), delta: fx(r.delta) })),
      };
    });
  }

  @Post('eosb/run')
  @Perm('ledger.post')
  async eosbRun(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ month: zMonth }))) b: { month: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await runEosb(tx, actor, b.month);
      if (r.entry) await audit(tx, actor, 'run_eosb', 'journal_entry', r.entry.id, null, { month: b.month, total: fx(r.total) });
      return { entry: r.entry, total: fx(r.total), lines: r.lines };
    }, actor.userId);
  }
}
