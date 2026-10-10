import {
  cashVoucher, eq, goodsReceiptLine, importShipment, inArray, invoiceMirror, payAdjustment, paymentMirror, paymentRequest, payrollLine, payrollRun, product, project, purchaseOrderLine, sql,
  supplierBill, employee, type Tx,
} from '@mmc/db';
import {
  buildBillPaymentLines, buildCommissionDelta, buildDirectBillLines, buildImportVatLines, buildInvoiceLines, buildLandedLines, buildPaymentLines, buildPayrollLines, buildPayrollPaidLines,
  buildPoBillLines, buildStockMoveLines, buildVoucherLines, dec, isSaudiNationality, lastDayOfMonth, mergeLines, revenueKind, riyadhDate, toHalalas,
  type Built, type PayrollEmployeeFacts, type PostLine, type RevenueKind,
} from '@mmc/domain';
import { NON_STOCK_TYPES } from './inventory.service.js';
import { SYSTEM, dateOf, effectiveDate, H, liveEntries, postEntry, setState, type Ctx, type Handler } from './gl-core.js';
import { reversePosted } from './ledger.service.js';

/**
 * One handler per source document (spec §6.1). Each knows what is still unposted, how to build its
 * lines (pure builders live in @mmc/domain) and which sources must be reversed because they were
 * cancelled. The engine (gl-posting.service.ts) runs them in order.
 */

const SAR = (halalas: number, rate: string | number) => dec(halalas).times(rate).toDecimalPlaces(0).toNumber();
const idFilter = (col: string, only?: string) => (only ? sql` and ${sql.raw(col)} = ${only}` : sql``);
const notPosted = (type: string, alias: string, event = 'post') => sql`not exists (select 1 from journal_entry je where je.source_type = ${type} and je.source_id = ${sql.raw(alias)}.id and je.source_event = ${event})`;
const liveExists = (type: string, alias: string) => sql`exists (select 1 from journal_entry je where je.source_type = ${type} and je.source_id = ${sql.raw(alias)}.id and je.kind = 'auto' and je.status = 'posted' and je.reversed_by_id is null)`;

type InvoiceRow = typeof invoiceMirror.$inferSelect;
type VoucherRow = typeof cashVoucher.$inferSelect;
type PaymentRow = typeof paymentMirror.$inferSelect;
type BillRow = typeof supplierBill.$inferSelect;

export const invoiceHash = (i: Pick<InvoiceRow, 'taxable' | 'vatAmount' | 'total'>) => `${i.taxable}|${i.vatAmount}|${i.total}`;
export const paymentHash = (p: Pick<PaymentRow, 'amount' | 'method' | 'paidOn'>) => `${p.amount}|${p.method}|${p.paidOn}`;
export const voucherHash = (v: Pick<VoucherRow, 'amount' | 'kind' | 'method' | 'accountId' | 'partyId'>) => `${v.amount}|${v.kind}|${v.method}|${v.accountId ?? ''}|${v.partyId ?? ''}`;
export const billHash = (b: Pick<BillRow, 'subtotal' | 'vat' | 'total' | 'rateToSar'>) => `${b.subtotal}|${b.vat}|${b.total}|${b.rateToSar}`;

/** Record a finished posting: hash of the posted amounts + any warnings for the exceptions screen. */
async function done(tx: Tx, type: string, id: string, hash: string, warnings: string[]) {
  await setState(tx, type, id, { hash, error: warnings.length ? warnings.join(' · ') : null, posted: true });
}

// ─────────────────────────────── sales ───────────────────────────────

const INVOICE_NAMES: Record<string, string> = { '386': 'فاتورة دفعة مقدمة', '388': 'فاتورة ضريبية', '381': 'إشعار دائن', '383': 'إشعار مدين' };

async function buildInvoice(tx: Tx, inv: InvoiceRow): Promise<Built> {
  const raw = (inv.lines as { code?: string; net?: string }[]) ?? [];
  const codes = [...new Set(raw.map((l) => l.code ?? '').filter(Boolean))];
  const services = codes.length ? await tx.select({ code: product.code }).from(product).where(sql`${product.code} in ${codes} and ${product.type} in ('service', 'labor')`) : [];
  const serviceCodes = new Set(services.map((s) => s.code));
  let isAmc = false;
  if (!inv.contractId && inv.paymentRequestId) {
    const [pr] = await tx.select({ agreementId: paymentRequest.agreementId }).from(paymentRequest).where(eq(paymentRequest.id, inv.paymentRequestId));
    isAmc = !!pr?.agreementId;
  }
  let projectId: string | null = null;
  const advances: { taxable: number; vat: number }[] = [];
  if (inv.contractId) {
    const [p] = await tx.select({ id: project.id }).from(project).where(eq(project.contractId, inv.contractId));
    projectId = p?.id ?? null;
    if (inv.typeCode === '388' && H(inv.prepaidAmount) > 0) {
      const adv = await tx.select().from(invoiceMirror).where(sql`${invoiceMirror.contractId} = ${inv.contractId} and ${invoiceMirror.typeCode} = '386' and ${invoiceMirror.status} <> 'cancelled'`);
      for (const a of adv) advances.push({ taxable: H(a.taxable), vat: H(a.vatAmount) });
    }
  }
  let creditsAdvance = false;
  if (inv.typeCode === '381' && inv.originalInvoiceId) {
    const [o] = await tx.select({ typeCode: invoiceMirror.typeCode }).from(invoiceMirror).where(eq(invoiceMirror.id, inv.originalInvoiceId));
    creditsAdvance = o?.typeCode === '386';
  }
  const built = buildInvoiceLines({
    typeCode: inv.typeCode, taxable: H(inv.taxable), vat: H(inv.vatAmount), partyId: inv.partyId, projectId,
    lines: raw.map((l) => ({ net: H(l.net), kind: revenueKind(l.code ?? '', { isAmc, serviceCodes }) as RevenueKind })),
    advances, creditsAdvance, prepaid: inv.typeCode === '388' ? H(inv.prepaidAmount) : undefined,
  });
  if (inv.typeCode === '388' && H(inv.prepaidAmount) > 0 && !advances.length) built.warnings.push('الفاتورة تخصم دفعات مقدمة لكن لا توجد فواتير 386 مرتبطة بالعقد — راجع رصيد العملاء');
  if (Math.abs(H(inv.total)) !== Math.abs(H(inv.taxable)) + Math.abs(H(inv.vatAmount))) built.warnings.push(`إجمالي الفاتورة ${inv.total} لا يساوي الخاضع + الضريبة`);
  return built;
}

export const invoiceHandler: Handler = {
  type: 'invoice',
  async pending(tx, ctx, only) {
    const r = await tx.execute<{ id: string }>(sql`select i.id from invoice_mirror i where i.status not in ('legacy', 'cancelled') and i.issue_date >= ${ctx.goLive} and ${notPosted('invoice', 'i')}${idFilter('i.id', only)} order by i.issue_date, i.type_code, i.number`);
    return r.map((x) => x.id);
  },
  async post(tx, ctx, id) {
    const [inv] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, id));
    if (!inv) return false;
    const built = await buildInvoice(tx, inv);
    const e = await postEntry(tx, ctx, { type: 'invoice', sourceId: id, event: 'post', ref: inv.number, memo: `${INVOICE_NAMES[inv.typeCode] ?? 'فاتورة'} ${inv.number}`, date: inv.issueDate, built });
    await done(tx, 'invoice', id, invoiceHash(inv), e?.warnings ?? []);
    return !!e;
  },
  async cancelled(tx, _ctx, only) {
    const r = await tx.execute<{ id: string; at: Date }>(sql`select i.id, i.synced_at as at from invoice_mirror i where i.status = 'cancelled' and ${liveExists('invoice', 'i')}${idFilter('i.id', only)}`);
    return r.map((x) => ({ id: x.id, date: dateOf(x.at) }));
  },
};

export const paymentHandler: Handler = {
  type: 'payment',
  async pending(tx, ctx, only) {
    const r = await tx.execute<{ id: string }>(sql`select p.id from payment_mirror p where p.paid_on >= ${ctx.goLive} and ${notPosted('payment', 'p')}${idFilter('p.id', only)} order by p.paid_on, p.created_at`);
    return r.map((x) => x.id);
  },
  async post(tx, ctx, id) {
    const [p] = await tx.select().from(paymentMirror).where(eq(paymentMirror.id, id));
    if (!p) return false;
    const built = buildPaymentLines({ amount: H(p.amount), method: p.method, partyId: p.partyId, memo: p.reference });
    const e = await postEntry(tx, ctx, { type: 'payment', sourceId: id, event: 'post', ref: p.erpName, memo: `دفعة عميل ${p.erpName}${p.reference ? ` — ${p.reference}` : ''}`, date: p.paidOn, built });
    await done(tx, 'payment', id, paymentHash(p), e?.warnings ?? []);
    return !!e;
  },
};

export const voucherHandler: Handler = {
  type: 'voucher',
  async pending(tx, ctx, only) {
    const r = await tx.execute<{ id: string }>(sql`select v.id from cash_voucher v where v.status = 'approved' and v.voucher_date >= ${ctx.goLive} and ${notPosted('voucher', 'v')}${idFilter('v.id', only)} order by v.voucher_date, v.created_at`);
    return r.map((x) => x.id);
  },
  async post(tx, ctx, id) {
    const [v] = await tx.select().from(cashVoucher).where(eq(cashVoucher.id, id));
    if (!v || v.status !== 'approved') return false;
    const [adj] = await tx.select({ employeeId: payAdjustment.employeeId }).from(payAdjustment).where(eq(payAdjustment.voucherId, v.id)).limit(1);
    const built = buildVoucherLines({
      kind: v.kind as 'payment' | 'receipt', amount: H(v.amount), method: v.method, partyId: v.partyId, accountId: v.accountId, projectId: v.projectId, costCenter: v.costCenter,
      bonusEmployeeId: adj?.employeeId ?? null, purpose: v.purpose,
    });
    const e = await postEntry(tx, ctx, { type: 'voucher', sourceId: id, event: 'post', ref: v.number, memo: `${v.kind === 'receipt' ? 'سند قبض' : 'سند صرف'} ${v.number} — ${v.purpose}`, date: v.voucherDate, built });
    await done(tx, 'voucher', id, voucherHash(v), e?.warnings ?? []);
    return !!e;
  },
  async cancelled(tx, _ctx, only) {
    const r = await tx.execute<{ id: string; at: Date | null }>(sql`select v.id, v.cancelled_at as at from cash_voucher v where v.status = 'cancelled' and ${liveExists('voucher', 'v')}${idFilter('v.id', only)}`);
    return r.map((x) => ({ id: x.id, date: dateOf(x.at ?? new Date()) }));
  },
};

// ─────────────────────────────── stock ───────────────────────────────

const MOVE_LABELS: Record<string, string> = {
  goods_receipt: 'استلام بضاعة', supplier_bill: 'استلام بفاتورة مورد', stock_count: 'جرد', stock_opening: 'رصيد افتتاحي للمخزون', stock_transfer: 'تحويل مخزني', project: 'صرف لمشروع', work_order: 'أمر عمل', landed_cost: 'تكلفة استيراد',
};

type MoveRow = {
  id: string; kind: string; ref_type: string | null; ref_id: string | null; qty: string; unit_cost: string; from_wh: string | null; to_wh: string | null;
  project_id: string | null; posted_at: Date; note: string | null; coverage: string | null; wo_project_id: string | null;
};

/** Stock moves post in groups of (document, day): one entry per goods receipt / issue / count, with the moves tracked one by one. */
export const stockHandler: Handler = {
  type: 'stock',
  async sweep(tx, ctx) {
    const moves = await tx.execute<MoveRow>(sql`
      select m.id, m.kind, m.ref_type, m.ref_id, m.qty::text, m.unit_cost_sar::text as unit_cost, m.from_warehouse_id as from_wh, m.to_warehouse_id as to_wh, m.project_id, m.posted_at, m.note,
             w.coverage, w.project_id as wo_project_id
      from stock_move m left join work_order w on w.id = m.work_order_id
      where (m.posted_at at time zone 'Asia/Riyadh')::date >= ${ctx.goLive}
        and not exists (select 1 from gl_source_state s where s.source_type = 'stock_move' and s.source_id = m.id and s.last_posted_at is not null)
      order by m.posted_at, m.id limit 5000`);
    const groups = new Map<string, MoveRow[]>();
    for (const m of moves) {
      const k = `${m.ref_type ?? ''}|${m.ref_id ?? m.id}|${dateOf(m.posted_at)}`;
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    let posted = 0;
    for (const g of groups.values()) {
      const first = g[0]!;
      try {
        await tx.transaction(async (sp) => {
          const lines: PostLine[] = g.flatMap((m) => buildStockMoveLines({
            kind: m.kind, refType: m.ref_type, value: dec(m.qty).times(m.unit_cost).times(100).toDecimalPlaces(0).toNumber(), hasFrom: !!m.from_wh, hasTo: !!m.to_wh,
            projectId: m.project_id ?? m.wo_project_id, coverage: m.coverage, wipPolicy: ctx.settings.wipPolicy,
          }));
          const label = MOVE_LABELS[first.ref_type ?? ''] ?? (first.ref_type ?? first.kind);
          const e = await postEntry(sp, ctx, {
            type: 'stock', sourceId: first.id, event: 'post', ref: first.note?.split(' ')[0] ?? label, memo: `حركة مخزون — ${label}${first.note ? ` — ${first.note}` : ''}`.slice(0, 300), date: dateOf(first.posted_at),
            built: { lines: mergeLines(lines), warnings: [] },
          });
          for (const m of g) await setState(sp, 'stock_move', m.id, { error: e?.warnings.length ? e.warnings.join(' · ') : null, posted: true });
          if (e) posted++;
        });
      } catch (err) {
        await setState(tx, 'stock_move', first.id, { error: err instanceof Error ? err.message.slice(0, 500) : String(err) });
      }
    }
    return { posted, reversed: 0 };
  },
};

// ─────────────────────────────── supplier bills ───────────────────────────────

async function buildBill(tx: Tx, ctx: Ctx, b: BillRow): Promise<Built> {
  const rate = b.rateToSar;
  const subtotalSar = SAR(H(b.subtotal), rate);
  const vatSar = SAR(H(b.vat), rate);
  if (b.kind === 'direct') {
    const moves = await tx.execute<{ product_id: string; v: string }>(sql`select product_id, sum(qty * unit_cost_sar)::text as v from stock_move where ref_type = 'supplier_bill' and ref_id = ${b.id} group by product_id`);
    const received = new Map(moves.map((m) => [m.product_id, dec(m.v).times(100).toDecimalPlaces(0).toNumber()]));
    const ids = [...new Set(b.lines.map((l) => l.productId).filter((x): x is string => !!x))];
    const prods = ids.length ? await tx.select({ id: product.id, type: product.type }).from(product).where(inArray(product.id, ids)) : [];
    const stock = new Set(prods.filter((p) => !NON_STOCK_TYPES.includes(p.type)).map((p) => p.id));
    const expenses: { sar: number }[] = [];
    for (const l of b.lines) {
      const amount = toHalalas(dec(l.qty).times(l.unitPrice));
      if (l.productId && stock.has(l.productId) && received.has(l.productId)) continue; // goods received by this bill → inventory
      expenses.push({ sar: SAR(amount, rate) });
    }
    const inventoryValue = [...received.values()].reduce((s, v) => s + v, 0);
    return buildDirectBillLines({ supplierId: b.supplierId, subtotalSar, vatSar, inventoryValue, wip: ctx.settings.wipPolicy === 'wip', projectId: b.projectId, expenses });
  }
  // PO bill: clear GRNI at the receipt cost of what is billed
  const olIds = [...new Set(b.lines.map((l) => l.orderLineId).filter((x): x is string => !!x))];
  const pol = olIds.length ? await tx.select().from(purchaseOrderLine).where(inArray(purchaseOrderLine.id, olIds)) : [];
  const grs = olIds.length ? await tx.select({ orderLineId: goodsReceiptLine.orderLineId, q: sql<string>`sum(${goodsReceiptLine.qty})::text`, v: sql<string>`sum(${goodsReceiptLine.qty} * ${goodsReceiptLine.unitCostSar})::text` })
    .from(goodsReceiptLine).where(inArray(goodsReceiptLine.orderLineId, olIds)).groupBy(goodsReceiptLine.orderLineId) : [];
  let grni = 0;
  for (const l of b.lines) {
    const ol = pol.find((x) => x.id === l.orderLineId);
    const g = grs.find((x) => x.orderLineId === l.orderLineId);
    if (!ol || !g || dec(g.q).lte(0)) continue;
    const billQty = dec(l.qty);
    const prevBilled = dec(ol.billedQty).minus(billQty);
    const available = dec(ol.receivedQty).minus(prevBilled.lt(0) ? 0 : prevBilled);
    const relieve = billQty.lt(available) ? billQty : available.lt(0) ? dec(0) : available;
    grni += dec(g.v).div(g.q).times(relieve).times(100).toDecimalPlaces(0).toNumber();
  }
  return buildPoBillLines({ supplierId: b.supplierId, subtotalSar, vatSar, grniValue: grni });
}

export const billHandler: Handler = {
  type: 'bill',
  async pending(tx, ctx, only) {
    const r = await tx.execute<{ id: string }>(sql`select b.id from supplier_bill b where b.status in ('approved', 'partially_paid', 'paid') and b.bill_date >= ${ctx.goLive} and ${notPosted('bill', 'b')}${idFilter('b.id', only)} order by b.bill_date, b.number`);
    return r.map((x) => x.id);
  },
  async post(tx, ctx, id) {
    const [b] = await tx.select().from(supplierBill).where(eq(supplierBill.id, id));
    if (!b) return false;
    const built = await buildBill(tx, ctx, b);
    const e = await postEntry(tx, ctx, { type: 'bill', sourceId: id, event: 'post', ref: b.number, memo: `فاتورة مورد ${b.number} (${b.supplierInvoiceNo})`, date: b.billDate, built });
    await done(tx, 'bill', id, billHash(b), e?.warnings ?? []);
    return !!e;
  },
  async cancelled(tx, _ctx, only) {
    const r = await tx.execute<{ id: string; at: Date }>(sql`select b.id, b.updated_at as at from supplier_bill b where b.status = 'cancelled' and ${liveExists('bill', 'b')}${idFilter('b.id', only)}`);
    return r.map((x) => ({ id: x.id, date: dateOf(x.at) }));
  },
};

type PayBill = { id: string; number: string; supplier_id: string; rate: string; payments: { id: string; paidOn: string; amount: string; method: string; reference?: string | null }[]; posted: string[] };

/** Payments to suppliers live in the bill's jsonb; each new payment id posts once, a voided id reverses its entry (spec §6.1, gap 4). */
export const billPaymentHandler: Handler = {
  type: 'bill_payment',
  async sweep(tx, ctx, only) {
    const bills = await tx.execute<PayBill>(sql`
      select b.id, b.number, b.supplier_id, b.rate_to_sar::text as rate, b.payments, coalesce(s.posted_payment_ids, '[]'::jsonb) as posted
      from supplier_bill b left join gl_source_state s on s.source_type = 'bill_payment' and s.source_id = b.id
      where b.status <> 'draft' and (jsonb_array_length(b.payments) > 0 or jsonb_array_length(coalesce(s.posted_payment_ids, '[]'::jsonb)) > 0)${idFilter('b.id', only)}`);
    let posted = 0;
    let reversed = 0;
    for (const b of bills) {
      const now = new Set(b.payments.map((p) => p.id));
      const fresh = b.payments.filter((p) => !b.posted.includes(p.id));
      const voided = b.posted.filter((id) => !now.has(id));
      if (!fresh.length && !voided.length) continue;
      try {
        await tx.transaction(async (sp) => {
          const keep = new Set(b.posted);
          for (const p of fresh) {
            if (p.paidOn >= ctx.goLive) {
              const built = buildBillPaymentLines({ amountSar: SAR(H(p.amount), b.rate), method: p.method, supplierId: b.supplier_id, memo: p.reference ?? null });
              if (await postEntry(sp, ctx, { type: 'bill_payment', sourceId: b.id, event: `pay:${p.id}`, ref: b.number, memo: `دفعة لمورد — فاتورة ${b.number}${p.reference ? ` — ${p.reference}` : ''}`, date: p.paidOn, built })) posted++;
            }
            keep.add(p.id);
          }
          for (const id of voided) {
            for (const e of await liveEntries(sp, 'bill_payment', b.id, `pay:${id}`)) {
              const when = effectiveDate(ctx, riyadhDate());
              await reversePosted(sp, SYSTEM, e.id, when.date, `إلغاء دفعة المورد${when.note}`, { sourceEvent: `void:${id}` });
              reversed++;
            }
            keep.delete(id);
          }
          await setState(sp, 'bill_payment', b.id, { paymentIds: [...keep], error: null, posted: true });
        });
      } catch (err) {
        await setState(tx, 'bill_payment', b.id, { error: err instanceof Error ? err.message.slice(0, 500) : String(err) });
      }
    }
    return { posted, reversed };
  },
};

// ─────────────────────────────── imports ───────────────────────────────

const CLEARED = "('clearing', 'released', 'received')";

/** Import VAT from the customs declaration (once the shipment is in clearance). */
export const importVatHandler: Handler = {
  type: 'import_vat',
  async pending(tx, ctx, only) {
    const r = await tx.execute<{ id: string }>(sql`
      select s.id from import_shipment s
      where s.import_vat_sar > 0 and (s.status in ${sql.raw(CLEARED)} or s.landed_posted_at is not null)
        and coalesce(s.fasah_date, (s.updated_at at time zone 'Asia/Riyadh')::date) >= ${ctx.goLive} and ${notPosted('import_vat', 's')}${idFilter('s.id', only)} order by s.fasah_date`);
    return r.map((x) => x.id);
  },
  async post(tx, ctx, id) {
    const [s] = await tx.select().from(importShipment).where(eq(importShipment.id, id));
    if (!s) return false;
    const built = buildImportVatLines({ vatSar: H(s.importVatSar), baseSar: H(s.cifSar) + H(s.dutySar), customsPartyId: s.customsPayablePartyId });
    const date = s.fasahDate ?? riyadhDate(s.updatedAt);
    const e = await postEntry(tx, ctx, { type: 'import_vat', sourceId: id, event: 'post', ref: s.number, memo: `ضريبة القيمة المضافة على الاستيراد — ${s.number}`, date, built });
    await done(tx, 'import_vat', id, `${s.importVatSar}|${s.cifSar}|${s.dutySar}`, e?.warnings ?? []);
    return !!e;
  },
};

/** Duty + clearing charges once allocated: capitalised onto stock on hand, the rest to cost of sales. */
export const landedHandler: Handler = {
  type: 'landed_cost',
  async pending(tx, ctx, only) {
    const r = await tx.execute<{ id: string }>(sql`
      select s.id from import_shipment s where s.landed_posted_at is not null and (s.landed_posted_at at time zone 'Asia/Riyadh')::date >= ${ctx.goLive} and ${notPosted('landed_cost', 's')}${idFilter('s.id', only)}`);
    return r.map((x) => x.id);
  },
  async post(tx, ctx, id) {
    const [s] = await tx.select().from(importShipment).where(eq(importShipment.id, id));
    if (!s?.landedPostedAt) return false;
    const charge = H(s.dutySar) + (s.charges as { amountSar: string }[]).reduce((t, c) => t + H(c.amountSar), 0);
    const warnings: string[] = [];
    let capitalised: number;
    let expensed: number;
    if (s.landedCapitalisedSar == null) {
      capitalised = charge; expensed = 0;
      warnings.push('تقسيم تكاليف الاستيراد غير محفوظ لهذه الإرسالية — حُمّلت كلها على المخزون');
    } else { capitalised = H(s.landedCapitalisedSar); expensed = H(s.landedExpensedSar); }
    const built = buildLandedLines({ capitalised, expensed, customsPartyId: s.customsPayablePartyId });
    const e = await postEntry(tx, ctx, { type: 'landed_cost', sourceId: id, event: 'post', ref: s.number, memo: `تكاليف استيراد (رسوم جمركية وتخليص) — ${s.number}`, date: riyadhDate(s.landedPostedAt), built: { lines: built.lines, warnings: [...built.warnings, ...warnings] } });
    await done(tx, 'landed_cost', id, `${s.landedCapitalisedSar}|${s.landedExpensedSar}`, e?.warnings ?? []);
    return !!e;
  },
};

// ─────────────────────────────── payroll ───────────────────────────────

async function runLines(tx: Tx, runId: string) {
  return tx.select().from(payrollLine).where(eq(payrollLine.runId, runId));
}

export const payrollHandler: Handler = {
  type: 'payroll',
  async pending(tx, ctx, only) {
    const r = await tx.execute<{ id: string; month: string }>(sql`select r.id, r.month from payroll_run r where r.status in ('approved', 'paid') and ${notPosted('payroll', 'r')}${idFilter('r.id', only)} order by r.month`);
    return r.filter((x) => {
      const [y, m] = x.month.split('-').map(Number);
      return `${x.month}-${String(lastDayOfMonth(y!, m!)).padStart(2, '0')}` >= ctx.goLive;
    }).map((x) => x.id);
  },
  async post(tx, ctx, id) {
    const [r] = await tx.select().from(payrollRun).where(eq(payrollRun.id, id));
    if (!r) return false;
    const lines = await runLines(tx, id);
    const emps = lines.length ? await tx.select({ id: employee.id, nationality: employee.nationality }).from(employee).where(inArray(employee.id, lines.map((l) => l.employeeId))) : [];
    const cats = await tx.execute<{ employee_id: string; category: string; s: string }>(sql`
      select employee_id, category, sum(amount)::text as s from pay_adjustment where month = ${r.month} and kind = 'deduction' and pay_method = 'payroll' group by employee_id, category`);
    const facts: PayrollEmployeeFacts[] = lines.map((l) => {
      const mine = cats.filter((c) => c.employee_id === l.employeeId);
      const get = (k: string) => H(mine.find((c) => c.category === k)?.s);
      return {
        employeeId: l.employeeId, department: l.department, basic: H(l.basic), housing: H(l.housing), transport: H(l.transport), other: H(l.other), bonuses: H(l.bonuses),
        unpaidLeave: H(l.unpaidLeave), sickDeduction: H(l.sickDeduction), deductions: H(l.deductions), gosi: H(l.gosi), net: H(l.net),
        deductionSplit: { advance: get('advance'), penalty: get('penalty'), other: get('other') }, saudi: isSaudiNationality(emps.find((e) => e.id === l.employeeId)?.nationality),
      };
    });
    const built = buildPayrollLines(facts, { gosiSaudiPct: Number(ctx.settings.employerGosiSaudiPct), gosiOtherPct: Number(ctx.settings.employerGosiOtherPct) });
    const [y, m] = r.month.split('-').map(Number);
    const date = `${r.month}-${String(lastDayOfMonth(y!, m!)).padStart(2, '0')}`;
    const e = await postEntry(tx, ctx, { type: 'payroll', sourceId: id, event: 'post', ref: r.month, memo: `مسير رواتب ${r.month} — حصة المنشأة من التأمينات بحسب النسب في الإعدادات (يؤكدها المحاسب)`, date, built });
    await done(tx, 'payroll', id, `${r.gross}|${r.totalDeductions}|${r.net}`, e?.warnings ?? []);
    return !!e;
  },
};

export const payrollPaidHandler: Handler = {
  type: 'payroll_paid',
  async pending(tx, ctx, only) {
    const r = await tx.execute<{ id: string }>(sql`select r.id from payroll_run r where r.status = 'paid' and r.paid_at >= ${ctx.goLive} and ${notPosted('payroll_paid', 'r')}${idFilter('r.id', only)} order by r.paid_at`);
    return r.map((x) => x.id);
  },
  async post(tx, ctx, id) {
    const [r] = await tx.select().from(payrollRun).where(eq(payrollRun.id, id));
    if (!r?.paidAt) return false;
    const lines = await runLines(tx, id);
    const built = buildPayrollPaidLines(lines.map((l) => ({ employeeId: l.employeeId, net: H(l.net) })));
    const e = await postEntry(tx, ctx, { type: 'payroll_paid', sourceId: id, event: 'post', ref: r.month, memo: `صرف رواتب ${r.month}${r.paidRef ? ` — ${r.paidRef}` : ''}`, date: r.paidAt, built });
    await done(tx, 'payroll_paid', id, `${r.net}`, e?.warnings ?? []);
    return !!e;
  },
};

// ─────────────────────────────── commissions ───────────────────────────────

/** Commission accrual by deltas of the payable amount (recomputed in place by collections and the nightly job). */
export const commissionHandler: Handler = {
  type: 'commission',
  async sweep(tx, ctx, only) {
    const rows = await tx.execute<{ id: string; payable: string; posted: string; invoice_no: string; employee_id: string | null }>(sql`
      select c.id, c.payable::text, coalesce(nullif(s.posted_hash, ''), '0') as posted, i.number as invoice_no, e.id as employee_id
      from commission_entry c join invoice_mirror i on i.id = c.invoice_id
        left join gl_source_state s on s.source_type = 'commission' and s.source_id = c.id
        left join employee e on e.user_id = c.user_id
      where i.issue_date >= ${ctx.goLive} and c.payable <> coalesce(nullif(s.posted_hash, '')::numeric, 0)${idFilter('c.id', only)}`);
    let posted = 0;
    for (const r of rows) {
      try {
        await tx.transaction(async (sp) => {
          const delta = H(r.payable) - H(r.posted);
          const n = (await sp.execute<{ n: number }>(sql`select count(*)::int as n from journal_entry where source_type = 'commission' and source_id = ${r.id}`))[0]?.n ?? 0;
          const built = buildCommissionDelta({ delta, employeeId: r.employee_id, memo: `فاتورة ${r.invoice_no}` });
          const e = await postEntry(sp, ctx, { type: 'commission', sourceId: r.id, event: `delta:${n + 1}`, ref: r.invoice_no, memo: `عمولة مندوب — فاتورة ${r.invoice_no}`, date: riyadhDate(), built });
          await setState(sp, 'commission', r.id, { hash: r.payable, error: e?.warnings.length ? e.warnings.join(' · ') : null, posted: true });
          if (e) posted++;
        });
      } catch (err) {
        await setState(tx, 'commission', r.id, { error: err instanceof Error ? err.message.slice(0, 500) : String(err) });
      }
    }
    return { posted, reversed: 0 };
  },
};

/** Order matters: stock before the bills that clear GRNI, payroll before its payment. */
export const HANDLERS: Handler[] = [
  invoiceHandler, paymentHandler, voucherHandler, stockHandler, billHandler, billPaymentHandler, importVatHandler, landedHandler, payrollHandler, payrollPaidHandler, commissionHandler,
];

