import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { account, bankStatement, bankStatementLine, desc, eq, sql, type Tx } from '@mmc/db';
import type { ReportTable } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { ZodPipe, zDate, zUuid } from '../common/zod.js';
import { H, fx, reportFormat, send, type ReportFormat } from './report-kit.js';

/**
 * Bank reconciliation (Phase 6C). A statement belongs to one GL bank account; its lines are matched
 * to posted ledger lines of that account (money in = debit). The statement is reconciled when
 * book balance − bank balance + unmatched bank items − unmatched book items = 0.
 */

const zText = (max = 300) => z.string().trim().max(max);
const zAmount = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'invalid amount (max 2 decimals)');
const zSigned = z.union([z.string(), z.number()]).transform(String).refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), 'invalid amount');

const lineIn = z.object({ date: zDate, description: zText().nullish(), ref: zText(100).nullish(), debit: zAmount.default('0'), credit: zAmount.default('0') })
  .refine((l) => !(H(l.debit) > 0 && H(l.credit) > 0), 'a line is either money in or money out')
  .refine((l) => H(l.debit) > 0 || H(l.credit) > 0, 'enter an amount');
const statementBody = z.object({
  accountId: zUuid, reference: zText(100).nullish(), dateFrom: zDate, dateTo: zDate, openingBalance: zSigned.default('0'), closingBalance: zSigned,
  notes: zText(1000).nullish(), lines: z.array(lineIn).max(5000).default([]),
}).refine((b) => b.dateFrom <= b.dateTo, 'dateFrom must not be after dateTo');

type StRow = typeof bankStatement.$inferSelect;
type BookLine = { id: string; entry_id: string; number: string; entry_date: string; memo: string | null; line_memo: string | null; source_ref: string | null; party_name: string | null; debit: string; credit: string };

async function bookLines(tx: Tx, st: StRow): Promise<BookLine[]> {
  return tx.execute<BookLine>(sql`
    select l.id, e.id as entry_id, e.number, l.entry_date::text as entry_date, e.memo, l.memo as line_memo, e.source_ref, pa.name_ar as party_name, l.debit::text, l.credit::text
    from journal_line l join journal_entry e on e.id = l.entry_id left join party pa on pa.id = l.party_id
    where e.status = 'posted' and e.kind <> 'opening' and l.account_id = ${st.accountId} and l.entry_date <= ${st.dateTo}
      and not exists (select 1 from bank_statement_line m where m.matched_line_id = l.id)
    order by l.entry_date, e.number, l.line_no limit 2000`);
}

async function summary(tx: Tx, st: StRow) {
  const [bal] = await tx.execute<{ net: string }>(sql`select coalesce(sum(l.debit - l.credit), 0)::text as net from journal_line l join journal_entry e on e.id = l.entry_id where e.status = 'posted' and l.account_id = ${st.accountId} and l.entry_date <= ${st.dateTo}`);
  const book = await bookLines(tx, st);
  const lines = await tx.select().from(bankStatementLine).where(eq(bankStatementLine.statementId, st.id));
  const unmatched = lines.filter((l) => !l.matchedLineId);
  const bookBalance = H(bal?.net);
  const bankBalance = H(st.closingBalance);
  const ub = book.reduce((s, l) => s + H(l.debit) - H(l.credit), 0);
  const us = unmatched.reduce((s, l) => s + H(l.debit) - H(l.credit), 0);
  const foots = H(st.openingBalance) + lines.reduce((s, l) => s + H(l.debit) - H(l.credit), 0) - bankBalance;
  return {
    book, unmatched, bookBalance, bankBalance, unmatchedBook: ub, unmatchedBank: us,
    difference: bookBalance - bankBalance + us - ub, footing: foots,
    depositsInTransit: book.reduce((s, l) => s + H(l.debit), 0), outstanding: book.reduce((s, l) => s + H(l.credit), 0),
  };
}

async function autoMatch(tx: Tx, st: StRow): Promise<number> {
  const book = await bookLines(tx, st);
  const lines = (await tx.select().from(bankStatementLine).where(eq(bankStatementLine.statementId, st.id))).filter((l) => !l.matchedLineId).sort((a, b) => (a.date < b.date ? -1 : 1));
  const used = new Set<string>();
  const day = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  let n = 0;
  for (const l of lines) {
    const inAmt = H(l.debit), outAmt = H(l.credit);
    let best: { id: string; score: number } | null = null;
    for (const b of book) {
      if (used.has(b.id)) continue;
      if (inAmt > 0 ? H(b.debit) !== inAmt : H(b.credit) !== outAmt) continue;
      const gap = Math.abs(day(b.entry_date) - day(l.date));
      if (gap > 15) continue;
      const text = `${b.number} ${b.source_ref ?? ''} ${b.memo ?? ''} ${b.line_memo ?? ''}`.toLowerCase();
      const refHit = l.ref && text.includes(l.ref.toLowerCase()) ? 1 : 0;
      const score = gap - refHit * 100;
      if (!best || score < best.score) best = { id: b.id, score };
    }
    if (best) {
      used.add(best.id);
      await tx.update(bankStatementLine).set({ matchedLineId: best.id, matchedBy: 'auto', matchedAt: new Date() }).where(eq(bankStatementLine.id, l.id));
      n++;
    }
  }
  return n;
}

async function loadStatement(tx: Tx, id: string): Promise<StRow> {
  const [st] = await tx.select().from(bankStatement).where(eq(bankStatement.id, id));
  if (!st) throw notFound('bank statement');
  return st;
}

async function detail(tx: Tx, st: StRow) {
  const sum = await summary(tx, st);
  const [acc] = await tx.select({ code: account.code, nameAr: account.nameAr }).from(account).where(eq(account.id, st.accountId));
  const lines = await tx.execute<{ id: string; line_no: number; date: string; description: string | null; ref: string | null; debit: string; credit: string; matched_line_id: string | null; matched_by: string | null; entry_id: string | null; number: string | null }>(sql`
    select s.id, s.line_no, s.date::text as date, s.description, s.ref, s.debit::text, s.credit::text, s.matched_line_id, s.matched_by, e.id as entry_id, e.number
    from bank_statement_line s left join journal_line l on l.id = s.matched_line_id left join journal_entry e on e.id = l.entry_id
    where s.statement_id = ${st.id} order by s.line_no`);
  return {
    id: st.id, account: { id: st.accountId, ...acc }, reference: st.reference, dateFrom: st.dateFrom, dateTo: st.dateTo, openingBalance: st.openingBalance, closingBalance: st.closingBalance,
    status: st.status, reconciledAt: st.reconciledAt, notes: st.notes,
    lines: lines.map((l) => ({ id: l.id, lineNo: l.line_no, date: l.date, description: l.description, ref: l.ref, debit: l.debit, credit: l.credit, matched: !!l.matched_line_id, matchedBy: l.matched_by, entryId: l.entry_id, entryNumber: l.number })),
    unmatchedBook: sum.book.map((b) => ({ id: b.id, entryId: b.entry_id, number: b.number, date: b.entry_date, memo: b.line_memo || b.memo, party: b.party_name, debit: b.debit, credit: b.credit })),
    summary: {
      bookBalance: fx(sum.bookBalance), bankBalance: fx(sum.bankBalance), depositsInTransit: fx(sum.depositsInTransit), outstanding: fx(sum.outstanding),
      unmatchedBank: fx(sum.unmatchedBank), unmatchedBook: fx(sum.unmatchedBook), difference: fx(sum.difference), footing: fx(sum.footing),
      matched: lines.filter((l) => l.matched_line_id).length, total: lines.length, reconciled: sum.difference === 0 && sum.footing === 0,
    },
  };
}

type Detail = Awaited<ReturnType<typeof detail>>;

function reconTable(d: Detail): ReportTable {
  const N = (x: string) => Math.round(Number(x) * 100);
  const s = d.summary;
  const adjBank = N(s.bankBalance) + N(s.depositsInTransit) - N(s.outstanding);
  const rows: ReportTable['rows'] = [
    { style: 'heading', cells: { item: 'رصيد كشف البنك' } },
    { cells: { item: 'رصيد كشف الحساب البنكي في نهاية الفترة', amount: N(s.bankBalance) } },
    { cells: { item: 'يضاف: إيداعات في الطريق (مسجلة بالدفاتر ولم تظهر بالكشف)', amount: N(s.depositsInTransit) } },
    { cells: { item: 'يخصم: شيكات/مدفوعات معلقة (مسجلة بالدفاتر ولم تظهر بالكشف)', amount: -N(s.outstanding) } },
    { style: 'subtotal', cells: { item: 'الرصيد البنكي المعدّل', amount: adjBank } },
    { style: 'heading', cells: { item: 'رصيد الدفاتر' } },
    { cells: { item: 'رصيد الحساب في الدفتر العام', amount: N(s.bookBalance) } },
    { cells: { item: 'يضاف/يخصم: بنود في الكشف لم تُسجل بالدفاتر (صافي)', amount: N(s.unmatchedBank) } },
    { style: 'subtotal', cells: { item: 'رصيد الدفاتر المعدّل', amount: N(s.bookBalance) + N(s.unmatchedBank) } },
    { style: 'total', cells: { item: 'الفرق (يجب أن يكون صفرًا)', amount: N(s.difference) } },
  ];
  d.unmatchedBook.forEach((b) => rows.push({ depth: 1, cells: { item: `بند دفتري معلق ${b.number} ${b.date} — ${b.memo ?? ''}`, amount: N(b.debit) - N(b.credit) } }));
  return { title: `تسوية بنكية — ${d.account.code} ${d.account.nameAr}`, titleEn: 'Bank reconciliation', subtitle: `كشف ${d.reference ?? ''} من ${d.dateFrom} إلى ${d.dateTo} — ${d.status === 'reconciled' ? 'مُسوّى' : 'قيد التسوية'}`, columns: [{ key: 'item', label: 'البند', kind: 'text', width: 70 }, { key: 'amount', label: 'المبلغ (ر.س)', kind: 'money' }], rows };
}

@Controller('accounting/bank-statements')
export class BankController {
  @Get()
  @Perm('ledger.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ account: zUuid.optional() }))) q: { account?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select().from(bankStatement).where(q.account ? eq(bankStatement.accountId, q.account) : undefined).orderBy(desc(bankStatement.dateTo));
      const out = [];
      for (const st of rows) {
        const s = await summary(tx, st);
        const [acc] = await tx.select({ code: account.code, nameAr: account.nameAr }).from(account).where(eq(account.id, st.accountId));
        out.push({
          id: st.id, account: { id: st.accountId, ...acc }, reference: st.reference, dateFrom: st.dateFrom, dateTo: st.dateTo, closingBalance: st.closingBalance, status: st.status,
          unmatchedBank: s.unmatched.length, difference: fx(s.difference),
        });
      }
      return out;
    });
  }

  @Get(':id')
  @Perm('ledger.read')
  async get(@Actor() actor: RequestActor, @Res() res: Response, @Param('id', new ZodPipe(zUuid)) id: string, @Query(new ZodPipe(z.object({ format: reportFormat }))) q: { format: ReportFormat }) {
    const d = await tenantTx(actor.tenantId, async (tx) => detail(tx, await loadStatement(tx, id)));
    return send(res, actor, q.format, d, reconTable(d), `bank-reconciliation-${d.account.code}`);
  }

  @Post()
  @Perm('ledger.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(statementBody)) b: z.infer<typeof statementBody>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [acc] = await tx.select().from(account).where(eq(account.id, b.accountId));
      if (!acc || acc.isGroup || acc.type !== 'asset') throw badRequest('اختر حساب بنك (أصل قابل للترحيل)');
      const [st] = await tx.insert(bankStatement).values({
        accountId: b.accountId, reference: b.reference || null, dateFrom: b.dateFrom, dateTo: b.dateTo, openingBalance: b.openingBalance, closingBalance: b.closingBalance,
        notes: b.notes || null, createdBy: actor.userId, updatedBy: actor.userId,
      }).returning();
      if (b.lines.length) {
        await tx.insert(bankStatementLine).values(b.lines.map((l, i) => ({ statementId: st!.id, lineNo: i + 1, date: l.date, description: l.description || null, ref: l.ref || null, debit: l.debit, credit: l.credit })));
      }
      const matched = await autoMatch(tx, st!);
      await audit(tx, actor, 'create', 'bank_statement', st!.id, null, { account: acc.code, lines: b.lines.length, matched });
      return detail(tx, st!);
    }, actor.userId);
  }

  @Post(':id/auto-match')
  @Perm('ledger.write')
  async auto(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const st = await loadStatement(tx, id);
      if (st.status === 'reconciled') throw conflict('الكشف مُسوّى ومقفل');
      const matched = await autoMatch(tx, st);
      return { matched, ...(await detail(tx, st)) };
    }, actor.userId);
  }

  @Post(':id/lines/:lineId/match')
  @Perm('ledger.write')
  async match(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Param('lineId', new ZodPipe(zUuid)) lineId: string, @Body(new ZodPipe(z.object({ journalLineId: zUuid }))) b: { journalLineId: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const st = await loadStatement(tx, id);
      if (st.status === 'reconciled') throw conflict('الكشف مُسوّى ومقفل');
      const [l] = await tx.select().from(bankStatementLine).where(eq(bankStatementLine.id, lineId));
      if (!l || l.statementId !== id) throw notFound('statement line');
      if (l.matchedLineId) throw conflict('السطر مطابق بالفعل');
      const cand = (await bookLines(tx, st)).find((x) => x.id === b.journalLineId);
      if (!cand) throw badRequest('البند الدفتري غير متاح للمطابقة (ليس على هذا الحساب أو سبقت مطابقته)');
      const same = H(l.debit) > 0 ? H(cand.debit) === H(l.debit) : H(cand.credit) === H(l.credit);
      if (!same) throw badRequest('المبلغ أو الاتجاه لا يطابق البند الدفتري');
      await tx.update(bankStatementLine).set({ matchedLineId: b.journalLineId, matchedBy: 'manual', matchedAt: new Date() }).where(eq(bankStatementLine.id, lineId));
      return detail(tx, st);
    }, actor.userId);
  }

  @Post(':id/lines/:lineId/unmatch')
  @Perm('ledger.write')
  async unmatch(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Param('lineId', new ZodPipe(zUuid)) lineId: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const st = await loadStatement(tx, id);
      if (st.status === 'reconciled') throw conflict('الكشف مُسوّى ومقفل');
      await tx.update(bankStatementLine).set({ matchedLineId: null, matchedBy: null, matchedAt: null }).where(sql`${bankStatementLine.id} = ${lineId} and ${bankStatementLine.statementId} = ${id}`);
      return detail(tx, st);
    }, actor.userId);
  }

  @Post(':id/reconcile')
  @Perm('ledger.post')
  async reconcile(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const st = await loadStatement(tx, id);
      if (st.status === 'reconciled') throw conflict('الكشف مُسوّى بالفعل');
      const s = await summary(tx, st);
      if (s.footing !== 0) throw conflict(`الكشف لا يتزن: الرصيد الافتتاحي + الحركة − الرصيد الختامي = ${fx(s.footing)}`);
      if (s.difference !== 0) throw conflict(`لا تزال التسوية غير متزنة — الفرق ${fx(s.difference)}. طابق البنود أو سجّل القيود الناقصة (رسوم بنكية…)`);
      await tx.update(bankStatement).set({ status: 'reconciled', reconciledAt: new Date(), reconciledBy: actor.userId, updatedAt: new Date(), updatedBy: actor.userId, version: st.version + 1 }).where(eq(bankStatement.id, id));
      await audit(tx, actor, 'reconcile', 'bank_statement', id, { status: 'open' }, { status: 'reconciled' });
      return detail(tx, await loadStatement(tx, id));
    }, actor.userId);
  }

  @Delete(':id')
  @Perm('ledger.write')
  async remove(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const st = await loadStatement(tx, id);
      if (st.status === 'reconciled') throw conflict('لا يُحذف كشف مُسوّى');
      await tx.delete(bankStatement).where(eq(bankStatement.id, id));
      await audit(tx, actor, 'delete', 'bank_statement', id, { reference: st.reference, dateTo: st.dateTo }, null);
      return { ok: true };
    }, actor.userId);
  }
}
