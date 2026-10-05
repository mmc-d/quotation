import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { and, asc, businessHoliday, company, eq, gte, lte, ne, type Tx } from '@mmc/db';
import { DEFAULT_WORKING_DAYS, fixedSaudiHolidays, riyadhDate, type CompanyCalendar } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { loadCompany } from '../common/company.js';
import { conflict, notFound } from '../common/errors.js';
import { ZodPipe, zDate } from '../common/zod.js';

/**
 * Company calendar (PLT-74) for business-day rules: payment due dates and reminder sending. Working
 * weekdays come from `company.workingDays` (0 = Sunday … 6 = Saturday); holidays from `business_holiday`.
 */
export async function loadCalendar(tx: Tx): Promise<CompanyCalendar> {
  const co = await loadCompany(tx);
  const rows = await tx.select({ date: businessHoliday.date }).from(businessHoliday);
  return { workingDays: co.workingDays?.length ? co.workingDays : DEFAULT_WORKING_DAYS, holidays: new Set(rows.map((r) => r.date)) };
}

/** YYYY-MM-DD + n calendar days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const holidaySchema = z.object({ date: zDate, nameAr: z.string().trim().min(1).max(120), nameEn: z.string().trim().max(120).nullish() });

@Controller('calendar')
export class CalendarController {
  /** Working days and the holidays of this year and next (any signed-in user — due dates depend on it). */
  @Get()
  async get(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const co = await loadCompany(tx);
      const year = Number(riyadhDate().slice(0, 4));
      const holidays = await tx.select().from(businessHoliday).where(and(gte(businessHoliday.date, `${year}-01-01`), lte(businessHoliday.date, `${year + 1}-12-31`))).orderBy(asc(businessHoliday.date));
      return { workingDays: co.workingDays?.length ? co.workingDays : DEFAULT_WORKING_DAYS, holidays, years: [year, year + 1] };
    });
  }

  @Put('working-days')
  @Perm('admin.settings')
  async workingDays(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'at least one working day').max(7) }))) b: { workingDays: number[] }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const co = await loadCompany(tx);
      const days = [...new Set(b.workingDays)].sort((x, y) => x - y);
      await tx.update(company).set({ workingDays: days, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(company.id, co.id));
      await audit(tx, actor, 'update_working_days', 'company', co.id, { workingDays: co.workingDays }, { workingDays: days });
      return { workingDays: days };
    }, actor.userId);
  }

  /** Create (`id` = `new`) or update a holiday — one per date. */
  @Put('holidays/:id')
  @Perm('admin.settings')
  async putHoliday(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(holidaySchema)) b: z.infer<typeof holidaySchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const values = { date: b.date, nameAr: b.nameAr, nameEn: b.nameEn || null };
      const [clash] = await tx.select({ id: businessHoliday.id }).from(businessHoliday).where(and(eq(businessHoliday.date, b.date), id === 'new' ? undefined : ne(businessHoliday.id, id)));
      if (clash) throw conflict(`a holiday is already recorded on ${b.date}`);
      if (id === 'new') {
        const [h] = await tx.insert(businessHoliday).values({ ...values, createdBy: actor.userId }).returning();
        await audit(tx, actor, 'create', 'business_holiday', h!.id, null, values);
        return h;
      }
      const [before] = await tx.select().from(businessHoliday).where(eq(businessHoliday.id, id));
      if (!before) throw notFound('holiday');
      const [h] = await tx.update(businessHoliday).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(businessHoliday.id, id)).returning();
      await audit(tx, actor, 'update', 'business_holiday', id, { date: before.date, nameAr: before.nameAr, nameEn: before.nameEn }, values);
      return h;
    }, actor.userId);
  }

  @Delete('holidays/:id')
  @Perm('admin.settings')
  async deleteHoliday(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(businessHoliday).where(eq(businessHoliday.id, id));
      if (!before) throw notFound('holiday');
      await tx.delete(businessHoliday).where(eq(businessHoliday.id, id));
      await audit(tx, actor, 'delete', 'business_holiday', id, { date: before.date, nameAr: before.nameAr }, null);
      return { ok: true };
    }, actor.userId);
  }

  /** Founding Day and National Day for a year (idempotent — dates already recorded are kept). */
  @Post('holidays/seed-fixed')
  @Perm('admin.settings')
  async seedFixed(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ year: z.number().int().min(2000).max(2100) }))) b: { year: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const added: string[] = [];
      for (const h of fixedSaudiHolidays(b.year)) {
        const [row] = await tx.insert(businessHoliday).values({ date: h.date, nameAr: h.name_ar, nameEn: h.name_en, createdBy: actor.userId }).onConflictDoNothing().returning();
        if (row) added.push(row.date);
      }
      if (added.length) await audit(tx, actor, 'seed_fixed', 'business_holiday', null, null, { year: b.year, added });
      return { year: b.year, added };
    }, actor.userId);
  }
}
