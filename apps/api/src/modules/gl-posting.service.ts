import { ledgerSettings, sql, type Tx } from '@mmc/db';
import { halalasToFixed, riyadhDate } from '@mmc/domain';
import { badRequest, conflict } from '../common/errors.js';
import type { RequestActor } from '../auth/actor.js';
import { cancelSource, errorText, H, loadCtx, setState, effectiveDate } from './gl-core.js';
import { HANDLERS } from './gl-sources.js';
import { createPosted, entryLines, loadEntry, reversePosted, userName } from './ledger.service.js';

/**
 * Auto-posting engine (Phase 6B, spec §6). Runs the source handlers (gl-sources.ts) in order: each
 * unposted document becomes one posted journal entry (kind `auto`) exactly once — the unique index
 * on (source_type, source_id, source_event) is the idempotency guard — and a cancelled source gets
 * one reversal per live entry. Anything the rules cannot classify lands on the suspense account and
 * shows up on the «بانتظار التوجيه المحاسبي» screen. Nothing posts before the go-live date is set,
 * and sources dated before it are covered by the opening balances.
 */

export type SourceType = string;

export interface PostRun { live: boolean; posted: number; reversed: number; errors: number }

/** Post everything that is pending (or one source). Safe to call repeatedly. Each source runs in its own savepoint. */
export async function postPending(tx: Tx, opts: { only?: { type: SourceType; id: string } } = {}): Promise<PostRun> {
  const run: PostRun = { live: false, posted: 0, reversed: 0, errors: 0 };
  const ctx = await loadCtx(tx);
  if (!ctx) return run;
  run.live = true;
  for (const h of HANDLERS) {
    if (opts.only && opts.only.type !== h.type) continue;
    const only = opts.only?.id;
    if (h.cancelled) {
      for (const c of await h.cancelled(tx, ctx, only)) {
        try { run.reversed += await tx.transaction((sp) => cancelSource(sp, ctx, h.type, c.id, c.date)); } catch (e) { run.errors++; await setState(tx, h.type, c.id, { error: errorText(e) }); }
      }
    }
    if (h.pending && h.post) {
      for (const id of await h.pending(tx, ctx, only)) {
        try { if (await tx.transaction((sp) => h.post!(sp, ctx, id))) run.posted++; } catch (e) { run.errors++; await setState(tx, h.type, id, { error: errorText(e) }); }
      }
    }
    if (h.sweep) {
      try {
        const r = await h.sweep(tx, ctx, only);
        run.posted += r.posted; run.reversed += r.reversed;
      } catch (e) { run.errors++; console.warn(`[gl-post] ${h.type}:`, errorText(e)); }
    }
  }
  return run;
}

/** Best-effort posting right after a business action: never fails the action itself. */
export async function tryPost(tx: Tx, type: SourceType, id: string): Promise<void> {
  try {
    await tx.transaction((sp) => postPending(sp, { only: { type, id } }));
  } catch (e) {
    console.warn(`[gl-post] ${type} ${id}:`, errorText(e));
  }
}

// ─────────────────────────────── exceptions & reclassification ───────────────────────────────

export interface SuspenseItem {
  entryId: string; number: string; entryDate: string; memo: string | null; sourceType: string | null; sourceRef: string | null;
  lineId: string; amount: string; side: 'debit' | 'credit'; partyId: string | null; canReclassify: boolean;
}

export async function postingExceptions(tx: Tx) {
  const ctx = await loadCtx(tx);
  const settings = ctx?.settings ?? (await tx.select().from(ledgerSettings).limit(1))[0];
  const suspense = await tx.execute<{
    entry_id: string; number: string; entry_date: string; memo: string | null; source_type: string | null; source_ref: string | null;
    line_id: string; debit: string; credit: string; party_id: string | null;
  }>(sql`
    select e.id as entry_id, e.number, e.entry_date::text, e.memo, e.source_type, e.source_ref, l.id as line_id, l.debit::text, l.credit::text, l.party_id
    from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
    where a.posting_key = 'suspense' and e.status = 'posted' and e.reversed_by_id is null and e.kind <> 'reversal' order by e.entry_date, e.number, l.line_no`);
  const errors = await tx.execute<{ source_type: string; source_id: string; error: string; ref: string | null; updated_at: Date }>(sql`
    select s.source_type, s.source_id, s.error, s.updated_at,
      coalesce(
        (select number from invoice_mirror where id = s.source_id and s.source_type = 'invoice'),
        (select erp_name from payment_mirror where id = s.source_id and s.source_type = 'payment'),
        (select number from cash_voucher where id = s.source_id and s.source_type = 'voucher'),
        (select number from supplier_bill where id = s.source_id and s.source_type in ('bill', 'bill_payment')),
        (select number from import_shipment where id = s.source_id and s.source_type in ('import_vat', 'landed_cost')),
        (select month from payroll_run where id = s.source_id and s.source_type in ('payroll', 'payroll_paid')),
        (select i.number from commission_entry c join invoice_mirror i on i.id = c.invoice_id where c.id = s.source_id and s.source_type = 'commission'),
        (select ref_type from stock_move where id = s.source_id and s.source_type = 'stock_move')
      ) as ref
    from gl_source_state s where s.error is not null order by s.updated_at desc limit 200`);
  const changed = await tx.execute<{ source_type: string; source_id: string; ref: string; posted: string; now: string }>(sql`
    select s.source_type, s.source_id, i.number as ref, s.posted_hash as posted, (i.taxable::text || '|' || i.vat_amount::text || '|' || i.total::text) as now
      from gl_source_state s join invoice_mirror i on i.id = s.source_id where s.source_type = 'invoice' and s.posted_hash is distinct from (i.taxable::text || '|' || i.vat_amount::text || '|' || i.total::text)
    union all
    select s.source_type, s.source_id, p.erp_name, s.posted_hash, (p.amount::text || '|' || p.method || '|' || p.paid_on::text)
      from gl_source_state s join payment_mirror p on p.id = s.source_id where s.source_type = 'payment' and s.posted_hash is distinct from (p.amount::text || '|' || p.method || '|' || p.paid_on::text)
    union all
    select s.source_type, s.source_id, v.number, s.posted_hash, (v.amount::text || '|' || v.kind || '|' || v.method || '|' || coalesce(v.account_id::text, '') || '|' || coalesce(v.party_id::text, ''))
      from gl_source_state s join cash_voucher v on v.id = s.source_id where s.source_type = 'voucher' and s.posted_hash is distinct from (v.amount::text || '|' || v.kind || '|' || v.method || '|' || coalesce(v.account_id::text, '') || '|' || coalesce(v.party_id::text, ''))
    union all
    select s.source_type, s.source_id, b.number, s.posted_hash, (b.subtotal::text || '|' || b.vat::text || '|' || b.total::text || '|' || b.rate_to_sar::text)
      from gl_source_state s join supplier_bill b on b.id = s.source_id where s.source_type = 'bill' and s.posted_hash is distinct from (b.subtotal::text || '|' || b.vat::text || '|' || b.total::text || '|' || b.rate_to_sar::text)`);
  const shifted = await tx.execute<{ id: string; number: string; entry_date: string; memo: string | null }>(sql`
    select id, number, entry_date::text, memo from journal_entry where kind = 'auto' and memo like '%التاريخ الأصلي%' order by entry_date desc limit 100`);
  return {
    live: !!ctx, goLiveDate: settings?.goLiveDate ?? null,
    suspense: suspense.map((r): SuspenseItem => ({
      entryId: r.entry_id, number: r.number, entryDate: r.entry_date, memo: r.memo, sourceType: r.source_type, sourceRef: r.source_ref, lineId: r.line_id,
      amount: Number(r.debit) > 0 ? r.debit : r.credit, side: Number(r.debit) > 0 ? 'debit' : 'credit', partyId: r.party_id, canReclassify: !!r.source_type,
    })),
    errors: errors.map((r) => ({ sourceType: r.source_type, sourceId: r.source_id, ref: r.ref, error: r.error, at: r.updated_at })),
    changed: changed.map((r) => ({ sourceType: r.source_type, sourceId: r.source_id, ref: r.ref, postedAmounts: r.posted, currentAmounts: r.now })),
    shifted: shifted.map((r) => ({ entryId: r.id, number: r.number, entryDate: r.entry_date, memo: r.memo })),
  };
}

/** Move one suspense line to the chosen account: reverse the entry and post it again, both linked by memo/number. */
export async function reclassifyLine(tx: Tx, actor: RequestActor, p: { entryId: string; lineId: string; accountId: string }): Promise<{ reversal: { id: string; number: string }; entry: { id: string; number: string } }> {
  const ctx = await loadCtx(tx);
  if (!ctx) throw badRequest('set the go-live date first');
  const target = ctx.byId.get(p.accountId);
  if (!target || target.isGroup || !target.isActive) throw badRequest('choose a postable, active account');
  if (target.id === ctx.suspense.id) throw badRequest('choose an account other than the suspense account');
  const e = await loadEntry(tx, p.entryId);
  if (e.status !== 'posted' || e.reversedById || e.kind === 'reversal') throw conflict('only a live posted entry can be reclassified');
  if (!e.sourceType) throw badRequest('manual entries are corrected by reversing them and entering a new one');
  const rows = await tx.execute<{ id: string; line_no: number }>(sql`select id, line_no from journal_line where entry_id = ${p.entryId} order by line_no`);
  const idx = rows.findIndex((r) => r.id === p.lineId);
  if (idx < 0) throw badRequest('the line does not belong to this entry');
  const lines = await entryLines(tx, p.entryId);
  if (lines[idx]!.accountId !== ctx.suspense.id) throw badRequest('only lines on the suspense account can be reclassified');
  if (target.requiresParty && !lines[idx]!.partyId) throw badRequest('this account needs a customer/supplier on the line');
  const by = { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) };
  const n = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from journal_entry where source_type = ${e.sourceType} and source_id = ${e.sourceId} and source_event like 'reclass%'`))[0]?.n ?? 0;
  const when = effectiveDate(ctx, riyadhDate());
  const reversal = await reversePosted(tx, by, p.entryId, when.date, `إعادة تصنيف إلى ${target.code}`, { sourceEvent: `reclass-rev:${n + 1}` });
  const next = lines.map((l, i) => (i === idx ? { ...l, accountId: target.id } : l));
  const entry = await createPosted(tx, by, {
    entryDate: when.date, kind: 'auto', memo: `${e.memo ?? ''} — أُعيد تصنيفه من القيد ${e.number} (عكس ${reversal.number})`, lines: next,
    sourceType: e.sourceType, sourceId: e.sourceId, sourceRef: e.sourceRef, sourceEvent: `reclass:${n + 1}`,
  });
  return { reversal, entry };
}

// ─────────────────────────────── reconciliation (spec §6.2) ───────────────────────────────

export interface Check { key: string; ok: boolean; labelAr: string; ledger?: string; source?: string; diff?: string; note?: string }

/** Received-not-invoiced: per PO line, the receipt value of what was received but not yet billed. */
export async function grniReport(tx: Tx) {
  const rows = await tx.execute<{ po: string; code: string; description: string | null; supplier: string; received: string; billed: string; unit_cost: string; value: string }>(sql`
    select po.number as po, ol.code, ol.description, p.name_ar as supplier, g.q::text as received, ol.billed_qty::text as billed, (g.v / g.q)::text as unit_cost,
           ((g.v / g.q) * (g.q - ol.billed_qty))::numeric(18,2)::text as value
    from purchase_order_line ol
      join purchase_order po on po.id = ol.order_id join party p on p.id = po.supplier_id
      join (select order_line_id, sum(qty) as q, sum(qty * unit_cost_sar) as v from goods_receipt_line group by order_line_id) g on g.order_line_id = ol.id
    where g.q > ol.billed_qty and po.status <> 'cancelled' order by po.number, ol.sort`);
  const total = rows.reduce((s, r) => s + H(r.value), 0);
  return { rows: rows.map((r) => ({ order: r.po, code: r.code, description: r.description, supplier: r.supplier, received: r.received, billed: r.billed, unitCostSar: r.unit_cost, valueSar: r.value })), total: halalasToFixed(total) };
}

export async function reconciliationChecks(tx: Tx): Promise<Check[]> {
  const bal = async (key: string) => {
    const r = await tx.execute<{ net: string }>(sql`select coalesce(sum(l.debit - l.credit), 0)::text as net from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id where e.status = 'posted' and a.posting_key = ${key}`);
    return H(r[0]?.net);
  };
  const tb = await tx.execute<{ d: string; c: string }>(sql`select coalesce(sum(l.debit), 0)::text as d, coalesce(sum(l.credit), 0)::text as c from journal_line l join journal_entry e on e.id = l.entry_id where e.status = 'posted'`);
  const fx = halalasToFixed;
  const check = (key: string, labelAr: string, ledger: number, source: number, tol: number, note?: string): Check => ({ key, ok: Math.abs(ledger - source) <= tol, labelAr, ledger: fx(ledger), source: fx(source), diff: fx(ledger - source), note });

  const openAr = await tx.execute<{ s: string }>(sql`select coalesce(sum(balance_due), 0)::text as s from invoice_mirror where status not in ('legacy', 'cancelled')`);
  const openAp = await tx.execute<{ s: string; n: number }>(sql`select coalesce(sum(round((total - paid_amount) * rate_to_sar, 2)), 0)::text as s, count(*)::int as n from supplier_bill where status in ('approved', 'partially_paid')`);
  const stock = await tx.execute<{ s: string; n: number }>(sql`
    select coalesce(sum(b.qty * coalesce(p.avg_cost_sar, 0)), 0)::numeric(18,2)::text as s, count(*)::int as n from stock_balance b join product p on p.id = b.product_id where b.qty <> 0`);
  const grni = await grniReport(tx);

  const ar = await bal('ar');
  const ap = -(await bal('ap'));
  const inv = await bal('inventory');
  const g = -(await bal('grni'));
  const susp = await bal('suspense');
  return [
    { key: 'trial_balance', ok: H(tb[0]?.d) === H(tb[0]?.c), labelAr: 'ميزان المراجعة متوازن (المدين = الدائن)', ledger: tb[0]?.d, source: tb[0]?.c },
    check('ar', 'رصيد العملاء في الدفتر = مجموع أرصدة الفواتير المفتوحة', ar, H(openAr[0]?.s), 0, 'قد يظهر فرق مقبول إذا كانت الأرصدة الافتتاحية تتضمن فواتير قديمة (legacy) غير موجودة في النظام'),
    check('ap', 'رصيد الموردين في الدفتر = مجموع المستحق على فواتير الموردين المفتوحة', ap, H(openAp[0]?.s), 100 + 2 * (openAp[0]?.n ?? 0), 'فروق التقريب بين عملات الفواتير والريال مقبولة بحدود ريال + هللتين لكل فاتورة'),
    check('inventory', 'رصيد المخزون في الدفتر = تقييم المخزون (الكمية × متوسط التكلفة)', inv, H(stock[0]?.s), 500 + 10 * (stock[0]?.n ?? 0), 'فروق تقريب متوسط التكلفة مقبولة بحدود'),
    check('grni', 'بضائع مستلمة لم تُفوتر في الدفتر = تقرير «مستلم غير مفوتر»', g, H(grni.total), 500 + 10 * grni.rows.length),
    { key: 'suspense', ok: susp === 0, labelAr: 'حساب التسوية (بانتظار التوجيه) رصيده صفر', ledger: fx(susp) },
    ...(await phase6cChecks(tx, check)),
  ];
}

type CheckFn = (key: string, labelAr: string, ledger: number, source: number, tol: number, note?: string) => Check;

/** Phase 6C reconciliations: VAT coding, the fixed-asset register and the end-of-service provision. */
async function phase6cChecks(tx: Tx, check: CheckFn): Promise<Check[]> {
  const out: Check[] = [];
  // VAT: every movement on the VAT accounts carries a VAT code (settlements excluded), so the return can explain the books
  const [vat] = await tx.execute<{ coded: string; total: string }>(sql`
    select coalesce(sum(case when l.vat_code is not null then (case when a.posting_key = 'vat_output' then l.credit - l.debit else -(l.debit - l.credit) end) else 0 end), 0)::text as coded,
           coalesce(sum(case when a.posting_key = 'vat_output' then l.credit - l.debit else -(l.debit - l.credit) end), 0)::text as total
    from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
    where e.status = 'posted' and a.posting_key in ('vat_output', 'vat_input') and coalesce(e.source_type, '') <> 'vat_return'`);
  out.push(check('vat', 'حركة ضريبة القيمة المضافة في الدفتر = مجموع البنود المُرمَّزة بكود ضريبي (أساس الإقرار)', H(vat?.total), H(vat?.coded), 0, 'الفرق = قيود يدوية على حسابات الضريبة بلا كود ضريبي'));
  // fixed assets: register cost and accumulated depreciation vs the ledger balances of the accounts they use
  const [fa] = await tx.execute<{ reg_cost: string; reg_acc: string; n: number }>(sql`
    select coalesce(sum(a.cost), 0)::text as reg_cost,
           coalesce(sum(a.opening_accumulated + coalesce((select sum(d.amount) from fixed_asset_dep d where d.asset_id = a.id), 0)), 0)::text as reg_acc, count(*)::int as n
    from fixed_asset a where a.status = 'active'`);
  if ((fa?.n ?? 0) > 0) {
    const [gl] = await tx.execute<{ cost: string; acc: string }>(sql`
      select coalesce(sum(case when t.id in (select account_id from fixed_asset where status = 'active') then l.debit - l.credit else 0 end), 0)::text as cost,
             coalesce(sum(case when t.id in (select accum_account_id from fixed_asset where status = 'active') then l.credit - l.debit else 0 end), 0)::text as acc
      from journal_line l join journal_entry e on e.id = l.entry_id join account t on t.id = l.account_id where e.status = 'posted'`);
    out.push(check('fixed_assets', 'صافي الأصول الثابتة في الدفتر = صافي القيمة الدفترية في سجل الأصول', H(gl?.cost) - H(gl?.acc), H(fa?.reg_cost) - H(fa?.reg_acc), 100 * (fa?.n ?? 0), 'يظهر فرق إذا سُجلت أصول في حسابات الأصول دون إدراجها في السجل'));
  }
  return out;
}
