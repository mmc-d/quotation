/**
 * Inventory, procurement & imports (module 07). Pure rules; the API owns the ledger rows.
 *
 * Money: SAR amounts are integer halalas. Unit costs keep 4 decimals (decimal.js) because a carton
 * of 305 m cable or a landed-cost share rarely divides evenly; totals are rounded to halalas.
 */
import { Decimal } from 'decimal.js';
import { normalizeMac } from './fieldservice.js';

export const WAREHOUSE_KINDS = ['main', 'van', 'site', 'transit', 'quarantine'] as const;
export type WarehouseKind = (typeof WAREHOUSE_KINDS)[number];

export const WAREHOUSE_KIND_LABELS: Record<WarehouseKind, { ar: string; en: string }> = {
  main: { ar: 'المستودع الرئيسي', en: 'Main store' },
  van: { ar: 'سيارة فني', en: 'Technician van' },
  site: { ar: 'موقع مشروع', en: 'Project site' },
  transit: { ar: 'بضاعة في الطريق', en: 'In transit' },
  quarantine: { ar: 'حجر / مرتجعات', en: 'Quarantine / RMA' },
};

export const STOCK_MOVE_KINDS = ['receipt', 'transfer', 'issue_project', 'consume_wo', 'return', 'adjust', 'count', 'rma_out', 'scrap'] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];

/** Moving-weighted-average cost (IFRS, no LIFO — INV-73). Returns the new unit cost (4 dp, SAR). */
export function movingAverageCost(onHandQty: Decimal.Value, avgCost: Decimal.Value, inQty: Decimal.Value, inUnitCost: Decimal.Value): string {
  const q0 = new Decimal(onHandQty);
  const q1 = new Decimal(inQty);
  if (q1.lte(0)) return new Decimal(avgCost).toFixed(4);
  // negative or zero stock on hand: the incoming cost becomes the average
  if (q0.lte(0)) return new Decimal(inUnitCost).toFixed(4);
  const value = q0.times(avgCost).plus(q1.times(inUnitCost));
  return value.div(q0.plus(q1)).toFixed(4);
}

/** Convert a supplier-currency amount to SAR with a rate (SAR per 1 unit of currency). */
export function toSar(amount: Decimal.Value, sarPerUnit: Decimal.Value): string {
  return new Decimal(amount).times(sarPerUnit).toFixed(4);
}

export const USD_SAR_PEG = '3.75';

export type LandedBasis = 'value' | 'qty' | 'weight' | 'volume';

export interface LandedLine { id: string; qty: Decimal.Value; valueSar: Decimal.Value; weightKg?: Decimal.Value | null; volumeM3?: Decimal.Value | null }

/**
 * Allocate a landed charge (halalas) over receipt lines by value / qty / weight / volume (INV-72).
 * Largest-remainder rounding so the shares add up to the charge exactly. Lines with a zero basis get
 * nothing; if every basis is zero it falls back to quantity.
 */
export function allocateLandedCost(lines: LandedLine[], chargeHalalas: number, basis: LandedBasis): { id: string; halalas: number; perUnitSar: string }[] {
  const weightOf = (l: LandedLine): Decimal => {
    switch (basis) {
      case 'value': return new Decimal(l.valueSar);
      case 'qty': return new Decimal(l.qty);
      case 'weight': return new Decimal(l.weightKg ?? 0);
      case 'volume': return new Decimal(l.volumeM3 ?? 0);
    }
  };
  let weights = lines.map(weightOf);
  let total = weights.reduce((a, b) => a.plus(b), new Decimal(0));
  if (total.lte(0)) {
    weights = lines.map((l) => new Decimal(l.qty));
    total = weights.reduce((a, b) => a.plus(b), new Decimal(0));
  }
  if (total.lte(0) || chargeHalalas === 0) return lines.map((l) => ({ id: l.id, halalas: 0, perUnitSar: '0.0000' }));
  const raw = weights.map((w) => w.times(chargeHalalas).div(total));
  const floors = raw.map((r) => r.floor().toNumber());
  let left = chargeHalalas - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r.minus(r.floor()).toNumber() })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) { if (left <= 0) break; floors[o.i]! += 1; left--; }
  return lines.map((l, i) => {
    const q = new Decimal(l.qty);
    return { id: l.id, halalas: floors[i]!, perUnitSar: q.gt(0) ? new Decimal(floors[i]!).div(100).div(q).toFixed(4) : '0.0000' };
  });
}

/** Customs on an import (module 07 §4): duty on CIF; import VAT 15% on (CIF + duty) — recoverable, never a cost. */
export function importCharges(cifHalalas: number, dutyRatePercent: Decimal.Value, vatRatePercent: Decimal.Value = 15) {
  const duty = new Decimal(cifHalalas).times(dutyRatePercent).div(100).toDecimalPlaces(0).toNumber();
  const importVat = new Decimal(cifHalalas + duty).times(vatRatePercent).div(100).toDecimalPlaces(0).toNumber();
  return { duty, importVat };
}

/** Projected quantity = on hand − reserved + incoming (INV-22). */
export function projectedQty(onHand: Decimal.Value, reserved: Decimal.Value, incoming: Decimal.Value): string {
  return new Decimal(onHand).minus(reserved).plus(incoming).toString();
}

export interface DemandLine { productId: string; code: string; description?: string | null; qty: Decimal.Value }

/**
 * Material request from the contract BOQ minus what can be reserved (INV-60). `available` is free
 * stock per product (on hand − reserved by others). Returns what to reserve now and what to buy.
 */
export function planMaterials(boq: DemandLine[], available: Record<string, Decimal.Value>) {
  const merged = new Map<string, Omit<DemandLine, 'qty'> & { qty: Decimal }>();
  for (const l of boq) {
    const m = merged.get(l.productId);
    if (m) m.qty = m.qty.plus(l.qty);
    else merged.set(l.productId, { ...l, qty: new Decimal(l.qty) });
  }
  const free = new Map(Object.entries(available).map(([k, v]) => [k, new Decimal(v)]));
  const reserve: { productId: string; code: string; qty: string }[] = [];
  const shortage: { productId: string; code: string; description: string | null; qty: string }[] = [];
  for (const l of merged.values()) {
    if (l.qty.lte(0)) continue;
    const have = Decimal.max(free.get(l.productId) ?? 0, 0);
    const take = Decimal.min(have, l.qty);
    if (take.gt(0)) reserve.push({ productId: l.productId, code: l.code, qty: take.toString() });
    const missing = l.qty.minus(take);
    if (missing.gt(0)) shortage.push({ productId: l.productId, code: l.code, description: l.description ?? null, qty: missing.toString() });
    free.set(l.productId, have.minus(take));
  }
  return { reserve, shortage };
}

/** PO approval limits (INV-62): the first limit the total fits under decides who must approve. */
export interface ApprovalLimit { maxSar: number; roleKey: string }
export const DEFAULT_PO_LIMITS: ApprovalLimit[] = [
  { maxSar: 5_000, roleKey: 'purchaser' },
  { maxSar: 20_000, roleKey: 'general_manager' },
  { maxSar: Number.POSITIVE_INFINITY, roleKey: 'owner' },
];
export function poApproverRole(totalHalalas: number, limits: ApprovalLimit[] = DEFAULT_PO_LIMITS): string {
  const sar = totalHalalas / 100;
  return (limits.find((l) => sar <= l.maxSar) ?? limits[limits.length - 1]!).roleKey;
}
/** Roles that may approve at least as much as `required` (owner > general_manager > purchaser). */
export const PO_APPROVER_RANK: Record<string, number> = { purchaser: 1, general_manager: 2, owner: 3 };

export const CERT_KINDS = ['saber_pcoc', 'saber_scoc', 'cst', 'iecee', 'other'] as const;
export type CertKind = (typeof CERT_KINDS)[number];
export const CERT_LABELS: Record<CertKind, { ar: string; en: string }> = {
  saber_pcoc: { ar: 'شهادة مطابقة المنتج (سابر PCoC)', en: 'SABER product certificate (PCoC)' },
  saber_scoc: { ar: 'شهادة مطابقة الإرسالية (سابر SCoC)', en: 'SABER shipment certificate (SCoC)' },
  cst: { ar: 'اعتماد هيئة الاتصالات (CST)', en: 'CST type approval' },
  iecee: { ar: 'شهادة IECEE', en: 'IECEE certificate' },
  other: { ar: 'أخرى', en: 'Other' },
};

/**
 * Compliance status of a model for purchasing/sale (INV-08): a valid SABER PCoC is required; radio
 * devices (Wi-Fi, Zigbee, BLE, LoRa, cellular) also need CST type approval. Expiring within 30 days warns.
 */
export function complianceStatus(certs: { kind: string; expiresOn: string | null }[], radio: boolean, today: string) {
  const soon = new Date(`${today}T12:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  const soonStr = soon.toISOString().slice(0, 10);
  const issues: { key: string; level: 'block' | 'warn'; ar: string; en: string }[] = [];
  const need: CertKind[] = radio ? ['saber_pcoc', 'cst'] : ['saber_pcoc'];
  for (const kind of need) {
    const valid = certs.filter((c) => c.kind === kind && (!c.expiresOn || c.expiresOn >= today));
    const label = CERT_LABELS[kind];
    if (!valid.length) {
      const expired = certs.some((c) => c.kind === kind);
      issues.push({ key: kind, level: 'block', ar: `${label.ar}: ${expired ? 'منتهية' : 'غير موجودة'}`, en: `${label.en}: ${expired ? 'expired' : 'missing'}` });
    } else if (valid.every((c) => c.expiresOn && c.expiresOn <= soonStr)) {
      issues.push({ key: kind, level: 'warn', ar: `${label.ar}: تنتهي خلال 30 يومًا`, en: `${label.en}: expires within 30 days` });
    }
  }
  return { ok: !issues.some((i) => i.level === 'block'), issues };
}

/** 3-way match (INV-64): bill quantities must not exceed received; received within the PO tolerance. */
export function threeWayMatch(lines: { ordered: Decimal.Value; received: Decimal.Value; billed: Decimal.Value }[], tolerancePercent = 0) {
  const issues: { line: number; ar: string; en: string }[] = [];
  lines.forEach((l, i) => {
    const o = new Decimal(l.ordered); const r = new Decimal(l.received); const b = new Decimal(l.billed);
    if (b.gt(r)) issues.push({ line: i, ar: 'الكمية المفوترة أكبر من المستلمة', en: 'Billed quantity exceeds received' });
    if (r.gt(o.times(new Decimal(100).plus(tolerancePercent)).div(100))) issues.push({ line: i, ar: 'الكمية المستلمة تتجاوز أمر الشراء', en: 'Received quantity exceeds the PO' });
  });
  return { ok: issues.length === 0, issues };
}

/**
 * Parse a supplier packing list (one device per line: "serial[,mac[,mac2]]", comma/tab/semicolon) for
 * bulk serial + MAC import at receipt (INV-51). Rejects bad MACs and duplicates within the list.
 */
export function parseSerialList(text: string): { rows: { serial: string; macs: string[] }[]; errors: { line: number; ar: string; en: string }[] } {
  const rows: { serial: string; macs: string[] }[] = [];
  const errors: { line: number; ar: string; en: string }[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || /^serial/i.test(line)) return;
    const [serialRaw, ...rest] = line.split(/[,\t;]/).map((x) => x.trim());
    const serial = (serialRaw ?? '').toUpperCase();
    if (!serial) { errors.push({ line: idx + 1, ar: 'رقم تسلسلي فارغ', en: 'Empty serial' }); return; }
    if (seen.has(serial)) { errors.push({ line: idx + 1, ar: `رقم تسلسلي مكرر ${serial}`, en: `Duplicate serial ${serial}` }); return; }
    const macs: string[] = [];
    for (const m of rest.filter(Boolean)) {
      const n = normalizeMac(m);
      if (!n) { errors.push({ line: idx + 1, ar: `عنوان MAC غير صالح: ${m}`, en: `Invalid MAC: ${m}` }); return; }
      macs.push(n);
    }
    seen.add(serial);
    rows.push({ serial, macs });
  });
  return { rows, errors };
}

/** Cycle-count accuracy (exit criterion ≥ 98%): share of lines whose counted qty equals the expected qty. */
export function countAccuracy(lines: { expected: Decimal.Value; counted: Decimal.Value }[]): number {
  if (!lines.length) return 1;
  const ok = lines.filter((l) => new Decimal(l.expected).eq(l.counted)).length;
  return Math.round((ok / lines.length) * 1000) / 1000;
}

export const PO_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
const PO_FLOW: Record<PoStatus, PoStatus[]> = {
  draft: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['sent', 'partially_received', 'received', 'cancelled'],
  sent: ['partially_received', 'received', 'cancelled'],
  partially_received: ['received', 'closed'],
  received: ['closed'],
  closed: [],
  cancelled: [],
};
export function canTransitionPo(from: PoStatus, to: PoStatus): boolean {
  return PO_FLOW[from]?.includes(to) ?? false;
}

export const SHIPMENT_STATUSES = ['ordered', 'shipped', 'arrived', 'clearing', 'released', 'received'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const INCOTERMS = ['EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'] as const;

/** Import document checklist per shipment (INV-74). */
export const SHIPMENT_DOCS: { key: string; ar: string; en: string }[] = [
  { key: 'ci', ar: 'الفاتورة التجارية', en: 'Commercial invoice' },
  { key: 'pl', ar: 'قائمة التعبئة (الأرقام التسلسلية و MAC)', en: 'Packing list (serials & MACs)' },
  { key: 'bl', ar: 'بوليصة الشحن / AWB', en: 'Bill of lading / AWB' },
  { key: 'coo', ar: 'شهادة المنشأ', en: 'Certificate of origin' },
  { key: 'scoc', ar: 'شهادة سابر للإرسالية (SCoC)', en: 'SABER shipment certificate (SCoC)' },
  { key: 'cst', ar: 'شهادة هيئة الاتصالات', en: 'CST certificate' },
  { key: 'insurance', ar: 'وثيقة التأمين', en: 'Insurance' },
  { key: 'declaration', ar: 'البيان الجمركي (فسح)', en: 'Customs declaration (FASAH)' },
  { key: 'delivery_order', ar: 'إذن التسليم', en: 'Delivery order' },
  { key: 'broker_invoice', ar: 'فاتورة المخلص الجمركي', en: 'Broker invoice' },
];
