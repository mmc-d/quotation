import { eq, fiscalYear, journalEntry, ledgerSettings, sql, type Tx } from '@mmc/db';
import { buildClosingLines, dayAfter, dayBefore, fiscalYearOf, riyadhDate, type FiscalYear } from '@mmc/domain';
import { conflict, notFound } from '../common/errors.js';
import type { RequestActor } from '../auth/actor.js';
import { accountByKey, createPosted, loadAccounts, loadSettings, netByAccount, reversePosted, userName } from './ledger.service.js';
import { H, fx } from './report-kit.js';

/**
 * Fiscal-year close (Phase 6C): income and expense accounts are zeroed into retained earnings by one
 * `closing` entry dated the last day of the year; the books are then locked through that day.
 * Reopening reverses that entry (owner only) and can be done only for the latest closed year.
 */

export interface YearOverview {
  label: string;
  start: string;
  end: string;
  status: 'open' | 'closed';
  closingEntryId: string | null;
  postedEntries: number;
  drafts: number;
  /** net profit of the year per the books, closing entries excluded (halalas as fixed string) */
  profit: string;
  suspense: string;
  blockers: string[];
  canClose: boolean;
}

async function yearStats(tx: Tx, y: FiscalYear) {
  const [e] = await tx.execute<{ posted: number; drafts: number }>(sql`
    select count(*) filter (where status = 'posted' and kind <> 'closing')::int as posted, count(*) filter (where status = 'draft')::int as drafts
    from journal_entry where entry_date >= ${y.start} and entry_date <= ${y.end}`);
  const nets = await netByAccount(tx, y.end, y.start, { excludeClosing: true });
  const accounts = await loadAccounts(tx);
  let profit = 0;
  for (const a of accounts) if (!a.isGroup && (a.type === 'income' || a.type === 'expense')) profit -= nets.get(a.id) ?? 0;
  const susp = accounts.find((a) => a.postingKey === 'suspense');
  const [s] = susp ? await tx.execute<{ net: string }>(sql`select coalesce(sum(l.debit - l.credit), 0)::text as net from journal_line l join journal_entry e on e.id = l.entry_id where e.status = 'posted' and l.account_id = ${susp.id} and l.entry_date <= ${y.end}`) : [];
  return { posted: e?.posted ?? 0, drafts: e?.drafts ?? 0, profit, suspense: H(s?.net) };
}

export async function yearsOverview(tx: Tx): Promise<YearOverview[]> {
  const s = await loadSettings(tx);
  const today = riyadhDate();
  const [first] = await tx.execute<{ d: string | null }>(sql`select min(entry_date)::text as d from journal_entry`);
  const anchor = s.goLiveDate ?? first?.d ?? today;
  const rows = await tx.select().from(fiscalYear);
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  const out: YearOverview[] = [];
  let y = fiscalYearOf(anchor, s.fiscalYearStartMonth);
  const last = fiscalYearOf(today, s.fiscalYearStartMonth);
  for (let i = 0; i < 60; i++) {
    const row = byLabel.get(y.label);
    const st = await yearStats(tx, y);
    const closed = row?.status === 'closed';
    const prev = out[out.length - 1];
    const blockers: string[] = [];
    if (!closed) {
      if (y.end >= today) blockers.push('السنة المالية لم تنتهِ بعد');
      if (prev && prev.status !== 'closed' && prev.postedEntries > 0) blockers.push(`أقفل السنة ${prev.label} أولًا`);
      if (st.drafts > 0) blockers.push(`يوجد ${st.drafts} قيد/قيود مسودة ضمن السنة`);
      if (st.suspense !== 0) blockers.push(`حساب التسوية (بانتظار التوجيه) رصيده ${fx(st.suspense)} — وجّه البنود أولًا`);
      if (!s.goLiveDate) blockers.push('لم يُحدد تاريخ بدء النظام المحاسبي');
    }
    out.push({
      label: y.label, start: y.start, end: y.end, status: closed ? 'closed' : 'open', closingEntryId: row?.closingEntryId ?? null,
      postedEntries: st.posted, drafts: st.drafts, profit: fx(st.profit), suspense: fx(st.suspense), blockers, canClose: !closed && blockers.length === 0,
    });
    if (y.label === last.label) break;
    y = fiscalYearOf(dayAfter(y.end), s.fiscalYearStartMonth);
  }
  return out;
}

export async function closeYear(tx: Tx, actor: RequestActor, start: string) {
  const years = await yearsOverview(tx);
  const y = years.find((x) => x.start === start);
  if (!y) throw notFound('fiscal year');
  if (y.status === 'closed') throw conflict(`السنة ${y.label} مقفلة بالفعل`);
  if (y.blockers.length) throw conflict(y.blockers.join(' · '));
  const s = await loadSettings(tx);
  const accounts = await loadAccounts(tx);
  const pl = accounts.filter((a) => !a.isGroup && (a.type === 'income' || a.type === 'expense'));
  const nets = await netByAccount(tx, y.end, y.start, { excludeClosing: true });
  const re = await accountByKey(tx, 'retained_earnings');
  const { lines, profit } = buildClosingLines(pl.map((a) => ({ accountId: a.id, net: nets.get(a.id) ?? 0 })), re.id);
  const [row] = await tx.select().from(fiscalYear).where(eq(fiscalYear.label, y.label));
  const closes = await tx.execute<{ n: number }>(sql`select count(*)::int as n from journal_entry where source_type = 'fiscal_year' and source_event like 'close:%' and source_id = ${row?.id ?? '00000000-0000-0000-0000-000000000000'}`);
  const n = (closes[0]?.n ?? 0) + 1;
  const [fy] = row
    ? [row]
    : await tx.insert(fiscalYear).values({ label: y.label, startDate: y.start, endDate: y.end, createdBy: actor.userId, updatedBy: actor.userId }).returning();
  let entry: { id: string; number: string } | null = null;
  if (lines.length) {
    entry = await createPosted(tx, { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) }, {
      entryDate: y.end, kind: 'closing', memo: `قيد إقفال السنة المالية ${y.label} — ${profit >= 0 ? 'صافي ربح' : 'صافي خسارة'} ${fx(Math.abs(profit))}`,
      lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })), sourceType: 'fiscal_year', sourceId: fy!.id, sourceRef: y.label, sourceEvent: `close:${n}`,
    });
  }
  await tx.update(fiscalYear).set({ status: 'closed', closingEntryId: entry?.id ?? null, closedBy: actor.userId, closedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId, version: (fy!.version ?? 1) + 1 }).where(eq(fiscalYear.id, fy!.id));
  if (!s.lockedThrough || s.lockedThrough < y.end) {
    await tx.update(ledgerSettings).set({ lockedThrough: y.end, updatedAt: new Date(), updatedBy: actor.userId, version: s.version + 1 }).where(eq(ledgerSettings.id, s.id));
  }
  return { label: y.label, profit, entry, lockedThrough: y.end };
}

export async function reopenYear(tx: Tx, actor: RequestActor, start: string, reason: string) {
  const years = await yearsOverview(tx);
  const idx = years.findIndex((x) => x.start === start);
  const y = years[idx];
  if (!y) throw notFound('fiscal year');
  if (y.status !== 'closed') throw conflict('السنة غير مقفلة');
  if (years.slice(idx + 1).some((x) => x.status === 'closed')) throw conflict('أعد فتح السنة اللاحقة أولًا');
  const s = await loadSettings(tx);
  const [fy] = await tx.select().from(fiscalYear).where(eq(fiscalYear.label, y.label));
  if (!fy) throw notFound('fiscal year');
  if (s.lockedThrough && s.lockedThrough > y.end) throw conflict(`الدفاتر مقفلة حتى ${s.lockedThrough} بعد نهاية السنة ${y.label} — افتح الفترات اللاحقة أولًا`);
  if (s.lockedThrough && s.lockedThrough >= y.start) {
    await tx.update(ledgerSettings).set({ lockedThrough: dayBefore(y.start) < (s.goLiveDate ?? '0000-00-00') ? null : dayBefore(y.start), updatedAt: new Date(), updatedBy: actor.userId, version: s.version + 1 }).where(eq(ledgerSettings.id, s.id));
  }
  if (fy.closingEntryId) {
    const [e] = await tx.select({ reversedById: journalEntry.reversedById, number: journalEntry.number }).from(journalEntry).where(eq(journalEntry.id, fy.closingEntryId));
    if (e && !e.reversedById) {
      await reversePosted(tx, { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) }, fy.closingEntryId, y.end, `إعادة فتح السنة ${y.label}: ${reason}`, { sourceEvent: `reopen:${fy.version}` });
    }
  }
  await tx.update(fiscalYear).set({ status: 'open', closedBy: null, closedAt: null, updatedAt: new Date(), updatedBy: actor.userId, version: fy.version + 1 }).where(eq(fiscalYear.id, fy.id));
  return { label: y.label };
}
