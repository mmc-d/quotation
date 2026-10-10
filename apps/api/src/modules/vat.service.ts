import { eq, journalEntry, sql, vatReturn, type Tx } from '@mmc/db';
import { buildVatReturn, dayAfter, riyadhDate, vatSettlementLines, vatThreshold, type VatFact, type VatReturnBoxes } from '@mmc/domain';
import { loadCompany } from '../common/company.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import type { RequestActor } from '../auth/actor.js';
import { accountByKey, createPosted, loadSettings, reversePosted, userName } from './ledger.service.js';
import { H, fx } from './report-kit.js';

/**
 * VAT return from the ledger (Phase 6C, spec §7): coded journal lines → boxes → settlement entry.
 * A return is prepared (a snapshot of the boxes), compared with the movement on the VAT accounts,
 * and filed — filing posts the entry that clears output/input VAT against the settlement account.
 */

export async function vatFacts(tx: Tx, from: string, to: string): Promise<VatFact[]> {
  const rows = await tx.execute<{ code: string; side: string; base: string; vat: string }>(sql`
    select l.vat_code as code,
      case when a.posting_key = 'vat_output' then 'vat_output' when a.posting_key = 'vat_input' then 'vat_input' when a.type = 'income' then 'sales' else 'purchases' end as side,
      coalesce(sum(l.vat_base), 0)::text as base,
      coalesce(sum(case when a.posting_key = 'vat_output' then l.credit - l.debit when a.posting_key = 'vat_input' then l.debit - l.credit else 0 end), 0)::text as vat
    from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
    where e.status = 'posted' and l.vat_code is not null and l.entry_date >= ${from} and l.entry_date <= ${to}
      and coalesce(e.source_type, '') <> 'vat_return'
    group by 1, 2`);
  return rows.map((r) => ({ code: r.code as VatFact['code'], side: r.side as VatFact['side'], base: H(r.base), vat: H(r.vat) }));
}

/** Output − input movement on the VAT accounts in a period, settlements excluded (what the return must explain). */
export async function vatLedgerNet(tx: Tx, from: string, to: string): Promise<number> {
  const [r] = await tx.execute<{ net: string }>(sql`
    select coalesce(sum(case when a.posting_key = 'vat_output' then l.credit - l.debit else -(l.debit - l.credit) end), 0)::text as net
    from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
    where e.status = 'posted' and a.posting_key in ('vat_output', 'vat_input') and l.entry_date >= ${from} and l.entry_date <= ${to}
      and coalesce(e.source_type, '') <> 'vat_return'`);
  return H(r?.net);
}

const money = (b: { base: number; vat: number }) => ({ base: fx(b.base), vat: fx(b.vat) });

export function boxesJson(b: VatReturnBoxes) {
  return {
    box1: money(b.box1), box3: money(b.box3), box5: money(b.box5), box6: money(b.box6), box7: money(b.box7),
    box8: money(b.box8), box9: money(b.box9), box10: money(b.box10), box11: money(b.box11), box12: money(b.box12), box13: money(b.box13),
    box14: fx(b.box14), box15: fx(b.box15), box16: fx(b.box16),
  };
}

type ReturnRow = typeof vatReturn.$inferSelect;

async function draftsIn(tx: Tx, from: string, to: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from journal_entry where status = 'draft' and entry_date >= ${from} and entry_date <= ${to}`);
  return r?.n ?? 0;
}

export async function returnView(tx: Tx, row: ReturnRow, live = false) {
  let boxes = row.boxes as ReturnType<typeof boxesJson>;
  let ledgerNet = H(row.ledgerNet);
  let out = H(row.outputVat), inp = H(row.inputVat);
  if (live && row.status === 'draft') {
    const b = buildVatReturn(await vatFacts(tx, row.periodFrom, row.periodTo));
    boxes = boxesJson(b);
    ledgerNet = await vatLedgerNet(tx, row.periodFrom, row.periodTo);
    out = b.box14; inp = b.box15;
  }
  let settlement: { id: string; number: string } | null = null;
  if (row.settlementEntryId) {
    const [e] = await tx.select({ id: journalEntry.id, number: journalEntry.number }).from(journalEntry).where(eq(journalEntry.id, row.settlementEntryId));
    settlement = e ?? null;
  }
  return {
    id: row.id, label: row.label, periodFrom: row.periodFrom, periodTo: row.periodTo, status: row.status, filedOn: row.filedOn, notes: row.notes,
    boxes, outputVat: fx(out), inputVat: fx(inp), netVat: fx(out - inp), ledgerNet: fx(ledgerNet), difference: fx(out - inp - ledgerNet),
    settlementEntry: settlement, draftsInPeriod: await draftsIn(tx, row.periodFrom, row.periodTo), version: row.version,
  };
}

async function assertRegistered(tx: Tx) {
  const co = await loadCompany(tx);
  if (!co.vatRegistered) throw conflict('المنشأة غير مسجلة في ضريبة القيمة المضافة — لا يوجد إقرار ضريبي (فعّل التسجيل من إعدادات المنشأة عند التسجيل)');
}

/** Create (or refresh) the draft return of a period. */
export async function prepareReturn(tx: Tx, actor: RequestActor, p: { from: string; to: string; label: string }) {
  await assertRegistered(tx);
  if (p.from > p.to) throw badRequest('from must not be after to');
  const [overlap] = await tx.execute<{ id: string; label: string; status: string }>(sql`
    select id, label, status from vat_return where period_from <= ${p.to} and period_to >= ${p.from} and not (period_from = ${p.from} and period_to = ${p.to}) limit 1`);
  if (overlap) throw conflict(`الفترة تتداخل مع الإقرار ${overlap.label}`);
  const [existing] = await tx.select().from(vatReturn).where(sql`${vatReturn.periodFrom} = ${p.from} and ${vatReturn.periodTo} = ${p.to}`);
  if (existing && existing.status === 'filed') throw conflict('الإقرار مُقدَّم لهذه الفترة');
  const b = buildVatReturn(await vatFacts(tx, p.from, p.to));
  const ledgerNet = await vatLedgerNet(tx, p.from, p.to);
  const values = { boxes: boxesJson(b), outputVat: fx(b.box14), inputVat: fx(b.box15), netVat: fx(b.box16), ledgerNet: fx(ledgerNet) };
  if (existing) {
    await tx.update(vatReturn).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: existing.version + 1 }).where(eq(vatReturn.id, existing.id));
    return existing.id;
  }
  const [row] = await tx.insert(vatReturn).values({ label: p.label, periodFrom: p.from, periodTo: p.to, ...values, createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: vatReturn.id });
  return row!.id;
}

/** File: refresh the boxes, require them to agree with the VAT accounts, post the settlement entry. */
export async function fileReturn(tx: Tx, actor: RequestActor, id: string, opts: { acknowledgeDifference: boolean; filedOn: string }) {
  const [r] = await tx.select().from(vatReturn).where(eq(vatReturn.id, id));
  if (!r) throw notFound('VAT return');
  if (r.status === 'filed') throw conflict('الإقرار مُقدَّم بالفعل');
  await assertRegistered(tx);
  const b = buildVatReturn(await vatFacts(tx, r.periodFrom, r.periodTo));
  const ledgerNet = await vatLedgerNet(tx, r.periodFrom, r.periodTo);
  if (b.box16 !== ledgerNet && !opts.acknowledgeDifference) {
    throw conflict(`صافي الإقرار (${fx(b.box16)}) لا يطابق حركة حسابات الضريبة في الدفتر (${fx(ledgerNet)}) — راجع القيود غير المصنّفة بكود ضريبي`);
  }
  if (r.periodTo > riyadhDate()) throw conflict('الفترة لم تنتهِ بعد — لا يُقدَّم الإقرار قبل نهايتها');
  const drafts = await draftsIn(tx, r.periodFrom, r.periodTo);
  if (drafts > 0) throw conflict(`يوجد ${drafts} قيد/قيود مسودة ضمن الفترة — رحّلها أو احذفها قبل تقديم الإقرار`);
  const settings = await loadSettings(tx);
  const lines = vatSettlementLines(b.box14, b.box15);
  let entryId: string | null = null;
  if (lines.length) {
    const resolved = [];
    for (const l of lines) resolved.push({ accountId: (await accountByKey(tx, l.key!)).id, debit: l.debit, credit: l.credit, memo: `إقرار ضريبة القيمة المضافة ${r.label}` });
    const lock = settings.lockedThrough;
    const date = lock && r.periodTo <= lock ? dayAfter(lock) : r.periodTo;
    const e = await createPosted(tx, { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) }, {
      entryDate: date, kind: 'adjustment', memo: `تسوية ضريبة القيمة المضافة عن الفترة ${r.periodFrom} إلى ${r.periodTo}${date !== r.periodTo ? ` — التاريخ الأصلي ${r.periodTo}` : ''}`,
      lines: resolved, sourceType: 'vat_return', sourceId: r.id, sourceRef: r.label, sourceEvent: `file:${r.version}`,
    });
    entryId = e.id;
  }
  await tx.update(vatReturn).set({
    boxes: boxesJson(b), outputVat: fx(b.box14), inputVat: fx(b.box15), netVat: fx(b.box16), ledgerNet: fx(ledgerNet),
    status: 'filed', filedOn: opts.filedOn, filedBy: actor.userId, settlementEntryId: entryId, updatedAt: new Date(), updatedBy: actor.userId, version: r.version + 1,
  }).where(eq(vatReturn.id, id));
  return { boxes: b, entryId };
}

/** Un-file: reverse the settlement entry and return the return to draft (needs the period open). */
export async function unfileReturn(tx: Tx, actor: RequestActor, id: string, reason: string) {
  const [r] = await tx.select().from(vatReturn).where(eq(vatReturn.id, id));
  if (!r) throw notFound('VAT return');
  if (r.status !== 'filed') throw conflict('الإقرار غير مُقدَّم');
  if (r.settlementEntryId) {
    const settings = await loadSettings(tx);
    const date = settings.lockedThrough && r.periodTo <= settings.lockedThrough ? dayAfter(settings.lockedThrough) : r.periodTo;
    await reversePosted(tx, { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) }, r.settlementEntryId, date, reason, { sourceEvent: `unfile:${r.version}` });
  }
  await tx.update(vatReturn).set({ status: 'draft', filedOn: null, filedBy: null, settlementEntryId: null, updatedAt: new Date(), updatedBy: actor.userId, version: r.version + 1 }).where(eq(vatReturn.id, id));
}

/** Rolling 12-month taxable supplies from the issued invoices (works before the ledger exists). */
export async function thresholdMonitor(tx: Tx, asOf: string) {
  const sd = new Date(`${asOf}T00:00:00Z`);
  sd.setUTCFullYear(sd.getUTCFullYear() - 1);
  sd.setUTCDate(sd.getUTCDate() + 1);
  const start = sd.toISOString().slice(0, 10);
  const rows = await tx.execute<{ month: string; taxable: string }>(sql`
    select to_char(i.issue_date, 'YYYY-MM') as month,
      coalesce(sum(case
        when i.type_code in ('388', '383', '381') then i.taxable
        when i.type_code = '386' and not exists (select 1 from invoice_mirror f where f.contract_id = i.contract_id and f.type_code = '388' and f.status not in ('cancelled', 'legacy')) then i.taxable
        else 0 end), 0)::text as taxable
    from invoice_mirror i
    where i.status not in ('cancelled', 'legacy') and i.issue_date >= ${start} and i.issue_date <= ${asOf}
    group by 1 order by 1`);
  const months = rows.map((r) => ({ month: r.month, taxable: H(r.taxable) }));
  const rolling = months.reduce((s, m) => s + m.taxable, 0);
  const t = vatThreshold(rolling);
  const co = await loadCompany(tx);
  return {
    asOf, from: start, rolling12: fx(t.rolling12), level: t.level, pctOfMandatory: t.pctOfMandatory, remainingToMandatory: fx(t.remainingToMandatory),
    mandatoryAt: '375000.00', voluntaryAt: '187500.00', registered: co.vatRegistered,
    months: months.map((m) => ({ month: m.month, taxable: fx(m.taxable) })),
    alert: !co.vatRegistered && t.level !== 'below' ? (t.level === 'mandatory' ? 'تجاوزت المنشأة حد التسجيل الإلزامي (375,000 ريال) — يجب التسجيل في ضريبة القيمة المضافة' : 'تجاوزت المنشأة حد التسجيل الاختياري (187,500 ريال) — التسجيل متاح، ويجب عند تجاوز 375,000 ريال') : null,
  };
}
