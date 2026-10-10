import { glSourceState, ledgerSettings, sql, type Tx } from '@mmc/db';
import { dayAfter, DEFAULT_METHOD_KEYS, riyadhDate, toHalalas, type Built, type PostLine } from '@mmc/domain';
import { conflict } from '../common/errors.js';
import { createPosted, loadAccounts, reversePosted, type AccountRow, type LineInput, type SettingsRow } from './ledger.service.js';

/**
 * Shared pieces of the auto-posting engine (Phase 6B): the account lookup context, line resolution
 * (posting keys → accounts, anything unusable → suspense), the locked-period date shift, the
 * per-source bookkeeping row, and the one function every source uses to post an entry.
 */

export const SYSTEM = { userId: null, name: 'النظام — ترحيل تلقائي' };
export const H = (v: string | number | null | undefined) => toHalalas(String(v ?? '0'));
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export interface Ctx {
  settings: SettingsRow;
  goLive: string;
  byId: Map<string, AccountRow>;
  byKey: Map<string, AccountRow>;
  suspense: AccountRow;
}

/** null until the go-live date is set: nothing posts before the ledger is open. */
export async function loadCtx(tx: Tx): Promise<Ctx | null> {
  const [settings] = await tx.select().from(ledgerSettings).limit(1);
  if (!settings?.goLiveDate) return null;
  const accounts = await loadAccounts(tx);
  const byKey = new Map(accounts.filter((a) => a.postingKey).map((a) => [a.postingKey!, a]));
  const suspense = byKey.get('suspense');
  if (!suspense) throw conflict('no account is mapped to the “suspense” role — set it in the chart of accounts');
  return { settings, goLive: settings.goLiveDate, byId: new Map(accounts.map((a) => [a.id, a])), byKey, suspense };
}

/** Posting keys / payment methods / chosen accounts → concrete lines; anything unusable goes to suspense. */
export function resolve(ctx: Ctx, lines: PostLine[]): { lines: LineInput[]; suspenseLines: number } {
  let suspenseLines = 0;
  const out = lines.map((l): LineInput => {
    let a: AccountRow | undefined;
    if (l.accountId) a = ctx.byId.get(l.accountId);
    else if (l.key?.startsWith('method:')) {
      const m = l.key.slice(7);
      const mapped = ctx.settings.methodAccounts[m];
      a = mapped ? ctx.byId.get(mapped) : ctx.byKey.get(DEFAULT_METHOD_KEYS[m] ?? 'suspense');
    } else if (l.key) a = ctx.byKey.get(l.key);
    if (!a || a.isGroup || !a.isActive || (a.requiresParty && !l.partyId)) { a = ctx.suspense; suspenseLines++; }
    return { accountId: a.id, debit: l.debit, credit: l.credit, partyId: l.partyId, employeeId: l.employeeId, projectId: l.projectId, costCenter: l.costCenter, vatCode: l.vatCode, vatBase: l.vatBase, memo: l.memo };
  });
  return { lines: out, suspenseLines };
}

/** A date inside a locked period posts on the first open day, noting the original date. */
export function effectiveDate(ctx: Ctx, date: string): { date: string; note: string } {
  const lock = ctx.settings.lockedThrough;
  if (lock && date <= lock) return { date: dayAfter(lock), note: ` — التاريخ الأصلي ${date}` };
  return { date, note: '' };
}

export async function getState(tx: Tx, type: string, id: string) {
  const rows = await tx.select().from(glSourceState).where(sql`${glSourceState.sourceType} = ${type} and ${glSourceState.sourceId} = ${id}`);
  return rows[0] ?? null;
}

export async function setState(tx: Tx, type: string, id: string, patch: { hash?: string; error?: string | null; posted?: boolean; paymentIds?: string[] }): Promise<void> {
  const set = {
    ...(patch.hash !== undefined ? { postedHash: patch.hash } : {}),
    ...(patch.error !== undefined ? { error: patch.error } : {}),
    ...(patch.paymentIds !== undefined ? { postedPaymentIds: patch.paymentIds } : {}),
    ...(patch.posted ? { lastPostedAt: new Date() } : {}),
    updatedAt: new Date(),
  };
  await tx.insert(glSourceState).values({
    sourceType: type, sourceId: id, postedHash: patch.hash ?? null, error: patch.error ?? null, postedPaymentIds: patch.paymentIds ?? [], lastPostedAt: patch.posted ? new Date() : null,
  }).onConflictDoUpdate({ target: [glSourceState.tenantId, glSourceState.sourceType, glSourceState.sourceId], set });
}

export interface EntrySpec {
  type: string;
  sourceId: string;
  event: string;
  ref: string;
  memo: string;
  date: string;
  built: Built;
}

/** Post one balanced auto entry for a source; returns the warnings the accountant should see. */
export async function postEntry(tx: Tx, ctx: Ctx, s: EntrySpec): Promise<{ id: string; number: string; warnings: string[] } | null> {
  if (!s.built.lines.length) return null;
  const when = effectiveDate(ctx, s.date);
  const { lines, suspenseLines } = resolve(ctx, s.built.lines);
  const warnings = [...s.built.warnings, ...(suspenseLines ? [`${suspenseLines} سطر/أسطر وُجّهت إلى حساب التسوية — يحتاج توجيهاً محاسبياً`] : [])];
  const e = await createPosted(tx, SYSTEM, { entryDate: when.date, kind: 'auto', memo: s.memo + when.note, lines, sourceType: s.type, sourceId: s.sourceId, sourceRef: s.ref, sourceEvent: s.event });
  return { ...e, warnings };
}

/** Live (posted, unreversed) auto entries of a source, oldest first. */
export async function liveEntries(tx: Tx, type: string, id: string, eventLike?: string): Promise<{ id: string; number: string; source_event: string | null }[]> {
  return tx.execute<{ id: string; number: string; source_event: string | null }>(sql`
    select id, number, source_event from journal_entry
    where source_type = ${type} and source_id = ${id} and kind = 'auto' and status = 'posted' and reversed_by_id is null
      ${eventLike ? sql`and source_event like ${eventLike}` : sql``} order by created_at`);
}

/** Reverse every live auto entry of a source (one reversal each, idempotent through the source_event). */
export async function cancelSource(tx: Tx, ctx: Ctx, type: string, id: string, date: string, reason = 'إلغاء المستند'): Promise<number> {
  const live = await liveEntries(tx, type, id);
  const when = effectiveDate(ctx, date);
  for (const e of live) await reversePosted(tx, SYSTEM, e.id, when.date, `${reason}${when.note}`, { sourceEvent: `cancel:${e.number}` });
  return live.length;
}

export const dateOf = (at: Date | string) => riyadhDate(new Date(at));

/** Source handler: what to post, what to reverse and any custom sweep. */
export interface Handler {
  type: string;
  /** ids that still need their first posting (optionally just `only`) */
  pending?: (tx: Tx, ctx: Ctx, only?: string) => Promise<string[]>;
  post?: (tx: Tx, ctx: Ctx, id: string) => Promise<boolean>;
  /** sources to reverse entirely, with the day to reverse on */
  cancelled?: (tx: Tx, ctx: Ctx, only?: string) => Promise<{ id: string; date: string }[]>;
  /** handlers that scan their own way (stock moves, payment deltas, commissions) */
  sweep?: (tx: Tx, ctx: Ctx, only?: string) => Promise<{ posted: number; reversed: number }>;
}
