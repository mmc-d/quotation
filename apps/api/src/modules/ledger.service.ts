import {
  account, appUser, asc, eq, journalEntry, journalLine, ledgerSettings, nextNumber, seedLedger, sql, type Tx,
} from '@mmc/db';
import {
  buildBalanceSheet, buildIncomeStatement, buildTrialBalance, fiscalYearOf, halalasToFixed, journalProblems, periodOf, reverseLines, riyadhDate, toHalalas,
  type AccountInfo, type AccountRef, type AccountSums, type AccountType, type DimSums, type EntryKind, type JournalLineIn, type JournalProblem,
} from '@mmc/domain';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import type { RequestActor } from '../auth/actor.js';

/**
 * General-ledger engine shared by the controllers (and, in 6B, by auto-posting). Entries are always
 * created as drafts, given lines, then posted — the DB triggers (migration 0032) refuse anything
 * else and make posted rows immutable. Amounts are halalas in code, NUMERIC(18,2) in the DB.
 */

export type AccountRow = typeof account.$inferSelect;
export type SettingsRow = typeof ledgerSettings.$inferSelect;

export interface LineInput {
  accountId: string;
  /** halalas */
  debit: number;
  credit: number;
  partyId?: string | null;
  employeeId?: string | null;
  projectId?: string | null;
  costCenter?: string | null;
  vatCode?: string | null;
  /** halalas */
  vatBase?: number | null;
  memo?: string | null;
}

export interface EntryInput {
  entryDate: string;
  memo?: string | null;
  kind: EntryKind;
  lines: LineInput[];
  sourceType?: string | null;
  sourceId?: string | null;
  sourceRef?: string | null;
  sourceEvent?: string | null;
  reversesId?: string | null;
}

const H = (v: string | number | null | undefined) => toHalalas(String(v ?? '0'));
const fx = halalasToFixed;

/** The starter chart and settings row exist for every tenant the first time the ledger is touched. */
export async function ensureLedger(tx: Tx): Promise<void> {
  const [s] = await tx.select({ id: ledgerSettings.id }).from(ledgerSettings).limit(1);
  if (!s) await seedLedger(tx);
}

export async function loadSettings(tx: Tx): Promise<SettingsRow> {
  await ensureLedger(tx);
  const [s] = await tx.select().from(ledgerSettings).limit(1);
  return s!;
}

export async function loadAccounts(tx: Tx): Promise<AccountRow[]> {
  await ensureLedger(tx);
  return tx.select().from(account).orderBy(asc(account.code));
}

export const accountRef = (a: AccountRow): AccountRef => ({ id: a.id, code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, type: a.type as AccountType, isGroup: a.isGroup, parentId: a.parentId, isActive: a.isActive });
const accountInfo = (a: AccountRow): AccountInfo => ({ id: a.id, code: a.code, isGroup: a.isGroup, isActive: a.isActive, requiresParty: a.requiresParty });

/** Account id for an auto-posting role (e.g. 'ar'); throws when the accountant removed the mapping. */
export async function accountByKey(tx: Tx, key: string): Promise<AccountRow> {
  const [a] = await tx.select().from(account).where(eq(account.postingKey, key));
  if (!a) throw conflict(`no account is mapped to the “${key}” role — set it in the chart of accounts`);
  return a;
}

/** Drafts may be saved while still incomplete; everything else must be fixed first. */
const DRAFT_TOLERATED: JournalProblem['code'][] = ['unbalanced', 'too_few_lines', 'party_required'];

export async function entryProblems(tx: Tx, e: Pick<EntryInput, 'entryDate' | 'lines' | 'kind'>): Promise<JournalProblem[]> {
  const [settings, accounts] = await Promise.all([loadSettings(tx), loadAccounts(tx)]);
  const ids = new Set(e.lines.map((l) => l.accountId));
  const map = new Map<string, AccountInfo>(accounts.filter((a) => ids.has(a.id)).map((a) => [a.id, accountInfo(a)]));
  const lines: JournalLineIn[] = e.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, partyId: l.partyId }));
  // a year-end closing entry may land in a locked period: closing is what locks the year
  return journalProblems({ entryDate: e.entryDate, lines, accounts: map, lockedThrough: e.kind === 'closing' ? null : settings.lockedThrough, goLiveDate: settings.goLiveDate, allowBeforeGoLive: e.kind === 'opening' || e.kind === 'closing' });
}

export function assertProblems(problems: JournalProblem[], forPost: boolean): void {
  const blocking = forPost ? problems : problems.filter((p) => !DRAFT_TOLERATED.includes(p.code));
  if (blocking.length) throw badRequest(blocking[0]!.messageAr, blocking);
}

const totalOf = (lines: readonly LineInput[]) => lines.reduce((s, l) => s + l.debit, 0);

async function insertLines(tx: Tx, entryId: string, entryDate: string, lines: readonly LineInput[]): Promise<void> {
  if (!lines.length) return;
  await tx.insert(journalLine).values(lines.map((l, i) => ({
    entryId, lineNo: i + 1, accountId: l.accountId, entryDate, debit: fx(l.debit), credit: fx(l.credit),
    partyId: l.partyId ?? null, employeeId: l.employeeId ?? null, projectId: l.projectId ?? null, costCenter: l.costCenter?.trim() || null,
    vatCode: l.vatCode ?? null, vatBase: l.vatBase == null ? null : fx(l.vatBase), memo: l.memo?.trim() || null,
  })));
}

/** Insert a draft entry with its lines. Throws 400 with the problem list unless it is storable as a draft. */
export async function insertDraft(tx: Tx, userId: string | null, e: EntryInput): Promise<{ id: string; number: string }> {
  assertProblems(await entryProblems(tx, e), false);
  const { number } = await nextNumber(tx, 'journal_entry');
  const [row] = await tx.insert(journalEntry).values({
    number, entryDate: e.entryDate, period: periodOf(e.entryDate), memo: e.memo?.trim() || null, kind: e.kind,
    sourceType: e.sourceType ?? null, sourceId: e.sourceId ?? null, sourceRef: e.sourceRef ?? null, sourceEvent: e.sourceEvent ?? null,
    reversesId: e.reversesId ?? null, total: fx(totalOf(e.lines)), createdBy: userId, updatedBy: userId,
  }).returning({ id: journalEntry.id });
  await insertLines(tx, row!.id, e.entryDate, e.lines);
  return { id: row!.id, number };
}

export async function replaceDraft(tx: Tx, userId: string, id: string, e: Pick<EntryInput, 'entryDate' | 'memo' | 'lines' | 'kind'>, version: number): Promise<void> {
  const cur = await loadEntry(tx, id);
  if (cur.status !== 'draft') throw conflict('only a draft entry can be edited — reverse a posted entry instead');
  if (cur.version !== version) throw conflict('the entry was changed by someone else — reload');
  assertProblems(await entryProblems(tx, e), false);
  await tx.delete(journalLine).where(eq(journalLine.entryId, id));
  await tx.update(journalEntry).set({ entryDate: e.entryDate, period: periodOf(e.entryDate), memo: e.memo?.trim() || null, total: fx(totalOf(e.lines)), updatedAt: new Date(), updatedBy: userId, version: cur.version + 1 }).where(eq(journalEntry.id, id));
  await insertLines(tx, id, e.entryDate, e.lines);
}

export async function loadEntry(tx: Tx, id: string) {
  const [e] = await tx.select().from(journalEntry).where(eq(journalEntry.id, id));
  if (!e) throw notFound('journal entry');
  return e;
}

export async function entryLines(tx: Tx, id: string): Promise<LineInput[]> {
  const rows = await tx.select().from(journalLine).where(eq(journalLine.entryId, id)).orderBy(asc(journalLine.lineNo));
  return rows.map((r) => ({
    accountId: r.accountId, debit: H(r.debit), credit: H(r.credit), partyId: r.partyId, employeeId: r.employeeId, projectId: r.projectId, costCenter: r.costCenter,
    vatCode: r.vatCode, vatBase: r.vatBase == null ? null : H(r.vatBase), memo: r.memo,
  }));
}

export async function userName(tx: Tx, userId: string, fallback: string): Promise<string> {
  const [u] = await tx.select({ nameAr: appUser.nameAr }).from(appUser).where(eq(appUser.id, userId));
  return u?.nameAr || fallback;
}

/** Validate in full and flip draft → posted. The DB trigger re-checks balance. */
export async function markPosted(tx: Tx, id: string, by: { userId: string | null; name: string | null }): Promise<void> {
  const e = await loadEntry(tx, id);
  if (e.status !== 'draft') throw conflict('the entry is already posted');
  const lines = await entryLines(tx, id);
  assertProblems(await entryProblems(tx, { entryDate: e.entryDate, lines, kind: e.kind as EntryKind }), true);
  await tx.update(journalEntry).set({ status: 'posted', total: fx(totalOf(lines)), postedBy: by.userId, postedByName: by.name, postedAt: new Date(), updatedAt: new Date(), updatedBy: by.userId, version: e.version + 1 }).where(eq(journalEntry.id, id));
}

/** Interactive post: the preparer cannot post their own entry unless they are the owner (decision D9). */
export async function postByActor(tx: Tx, actor: RequestActor, id: string): Promise<void> {
  const e = await loadEntry(tx, id);
  if (e.status !== 'draft') throw conflict('the entry is already posted');
  if (e.createdBy === actor.userId && !actor.roleKeys.includes('owner')) throw forbidden('you prepared this entry — another person with posting permission must post it');
  await markPosted(tx, id, { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) });
}

/** Create + post in one step for system-made entries (auto-posting, reversals). */
export async function createPosted(tx: Tx, by: { userId: string | null; name: string | null }, e: EntryInput): Promise<{ id: string; number: string }> {
  const { id, number } = await insertDraft(tx, by.userId, e);
  await markPosted(tx, id, by);
  return { id, number };
}

/** Reversing entry: same lines with the sides swapped, posted at once, linked both ways. */
export async function reversePosted(tx: Tx, by: { userId: string | null; name: string | null }, id: string, date: string, reason: string, opts: { sourceEvent?: string } = {}): Promise<{ id: string; number: string }> {
  const e = await loadEntry(tx, id);
  if (e.status !== 'posted') throw conflict('only a posted entry can be reversed — delete a draft instead');
  if (e.reversedById) throw conflict('the entry was already reversed');
  if (e.kind === 'reversal') throw conflict('a reversal cannot itself be reversed — enter a new entry instead');
  const lines = reverseLines(await entryLines(tx, id));
  const rev = await createPosted(tx, by, {
    entryDate: date, kind: 'reversal', reversesId: id, memo: `عكس القيد ${e.number}${e.memo ? ` — ${e.memo}` : ''} (${reason})`, lines,
    sourceType: e.sourceType, sourceId: e.sourceId, sourceRef: e.sourceRef, sourceEvent: opts.sourceEvent ?? null,
  });
  await tx.update(journalEntry).set({ reversedById: rev.id, updatedAt: new Date(), updatedBy: by.userId, version: e.version + 1 }).where(eq(journalEntry.id, id));
  return rev;
}

export async function reverseEntry(tx: Tx, actor: RequestActor, id: string, date: string, reason: string): Promise<{ id: string; number: string }> {
  return reversePosted(tx, { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) }, id, date, reason);
}

// ─────────────────────────────── report queries (posted entries only) ───────────────────────────────

export const BEGINNING = '0001-01-01';

/** Posted debit/credit per account, before `from` and within [from, to]. */
export async function accountSums(tx: Tx, from: string, to: string): Promise<AccountSums[]> {
  const rows = await tx.execute<{ account_id: string; od: string; oc: string; d: string; c: string }>(sql`
    select l.account_id,
      coalesce(sum(l.debit) filter (where l.entry_date < ${from}), 0)::text as od,
      coalesce(sum(l.credit) filter (where l.entry_date < ${from}), 0)::text as oc,
      coalesce(sum(l.debit) filter (where l.entry_date >= ${from}), 0)::text as d,
      coalesce(sum(l.credit) filter (where l.entry_date >= ${from}), 0)::text as c
    from journal_line l join journal_entry e on e.id = l.entry_id
    where e.status = 'posted' and l.entry_date <= ${to}
    group by l.account_id`);
  return rows.map((r) => ({ accountId: r.account_id, openDebit: H(r.od), openCredit: H(r.oc), debit: H(r.d), credit: H(r.c) }));
}

/** Net debit per account through `asOf` (and, with `since`, only from that date on), optionally excluding closing entries. */
export async function netByAccount(tx: Tx, asOf: string, since: string = BEGINNING, opts: { excludeClosing?: boolean } = {}): Promise<Map<string, number>> {
  const rows = await tx.execute<{ account_id: string; net: string }>(sql`
    select l.account_id, coalesce(sum(l.debit - l.credit), 0)::text as net
    from journal_line l join journal_entry e on e.id = l.entry_id
    where e.status = 'posted' and l.entry_date >= ${since} and l.entry_date <= ${asOf} ${opts.excludeClosing ? sql`and e.kind <> 'closing'` : sql``}
    group by l.account_id`);
  return new Map(rows.map((r) => [r.account_id, H(r.net)]));
}

export type IsDimension = 'none' | 'month' | 'project' | 'department';

export async function incomeSums(tx: Tx, from: string, to: string, by: IsDimension): Promise<DimSums[]> {
  const dim = by === 'month' ? sql`to_char(l.entry_date, 'YYYY-MM')` : by === 'project' ? sql`coalesce(pr.number, '—')` : by === 'department' ? sql`coalesce(nullif(l.cost_center, ''), '—')` : sql`''`;
  const rows = await tx.execute<{ account_id: string; dim: string; d: string; c: string }>(sql`
    select l.account_id, ${dim} as dim, coalesce(sum(l.debit), 0)::text as d, coalesce(sum(l.credit), 0)::text as c
    from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
    left join project pr on pr.id = l.project_id
    where e.status = 'posted' and e.kind <> 'closing' and a.type in ('income', 'expense') and l.entry_date >= ${from} and l.entry_date <= ${to}
    group by l.account_id${by === 'none' ? sql`` : sql`, 2`}`);
  return rows.map((r) => ({ accountId: r.account_id, dim: r.dim, debit: H(r.d), credit: H(r.c) }));
}

export async function trialBalance(tx: Tx, p: { from: string; to: string; level?: number; withZero?: boolean }) {
  const accounts = await loadAccounts(tx);
  return buildTrialBalance(accounts.map(accountRef), await accountSums(tx, p.from, p.to), { level: p.level, withZero: p.withZero });
}

export async function incomeStatement(tx: Tx, p: { from: string; to: string; by: IsDimension }) {
  const accounts = await loadAccounts(tx);
  return buildIncomeStatement(accounts.map(accountRef), await incomeSums(tx, p.from, p.to, p.by));
}

export async function balanceSheet(tx: Tx, asOf: string) {
  const [accounts, settings] = await Promise.all([loadAccounts(tx), loadSettings(tx)]);
  const fy = fiscalYearOf(asOf, settings.fiscalYearStartMonth);
  const [cumulative, currentYear] = await Promise.all([netByAccount(tx, asOf), netByAccount(tx, asOf, fy.start)]);
  return { sheet: buildBalanceSheet(accounts.map(accountRef), cumulative, currentYear), fiscalYear: fy };
}

/** Today in Riyadh unless the caller passes a date. */
export const today = () => riyadhDate();

