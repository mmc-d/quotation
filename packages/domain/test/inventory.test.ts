import { describe, expect, it } from 'vitest';
import {
  allocateLandedCost, canTransitionPo, complianceStatus, countAccuracy, importCharges, movingAverageCost, parseSerialList,
  planMaterials, poApproverRole, projectedQty, threeWayMatch, toSar, directBillTotals, billPaymentStatus, payableBucket, parseOpeningSheet,
} from '../src/index.js';

describe('valuation', () => {
  it('keeps a moving weighted average', () => {
    expect(movingAverageCost(10, '100', 10, '120')).toBe('110.0000');
    expect(movingAverageCost(0, '100', 5, '90')).toBe('90.0000');
    expect(movingAverageCost(-2, '100', 5, '90')).toBe('90.0000');
    expect(movingAverageCost(3, '100', 0, '90')).toBe('100.0000');
    expect(toSar('38.5', '3.75')).toBe('144.3750');
  });
});

describe('landed cost', () => {
  const lines = [{ id: 'a', qty: 10, valueSar: '1000' }, { id: 'b', qty: 5, valueSar: '2000' }, { id: 'c', qty: 1, valueSar: '0' }];
  it('allocates by value and adds up exactly', () => {
    const r = allocateLandedCost(lines, 100_001, 'value');
    expect(r.reduce((s, x) => s + x.halalas, 0)).toBe(100_001);
    expect(r.find((x) => x.id === 'c')!.halalas).toBe(0);
    expect(r.find((x) => x.id === 'b')!.halalas).toBeGreaterThan(r.find((x) => x.id === 'a')!.halalas);
    expect(r.find((x) => x.id === 'a')!.perUnitSar).toBe('33.3340');
  });
  it('allocates by quantity, and falls back to quantity when weights are missing', () => {
    expect(allocateLandedCost(lines, 1600, 'qty').map((x) => x.halalas)).toEqual([1000, 500, 100]);
    expect(allocateLandedCost(lines, 1600, 'weight').map((x) => x.halalas)).toEqual([1000, 500, 100]);
  });
  it('computes duty and recoverable import VAT', () => {
    expect(importCharges(1_000_000, 5)).toEqual({ duty: 50_000, importVat: 157_500 });
  });
});

describe('demand & availability', () => {
  it('reserves what is free and requests the rest', () => {
    const r = planMaterials([
      { productId: 'p1', code: 'IP-IN7', qty: 6 }, { productId: 'p1', code: 'IP-IN7', qty: 2 }, { productId: 'p2', code: 'DOOR', qty: 1 }, { productId: 'p3', code: 'X', qty: 0 },
    ], { p1: 5, p2: 3 });
    expect(r.reserve).toEqual([{ productId: 'p1', code: 'IP-IN7', qty: '5' }, { productId: 'p2', code: 'DOOR', qty: '1' }]);
    expect(r.shortage).toEqual([{ productId: 'p1', code: 'IP-IN7', description: null, qty: '3' }]);
    expect(projectedQty(10, 4, 6)).toBe('12');
  });
});

describe('purchasing controls', () => {
  it('routes PO approval by amount', () => {
    expect(poApproverRole(400_000)).toBe('purchaser');
    expect(poApproverRole(1_500_000)).toBe('general_manager');
    expect(poApproverRole(2_500_000)).toBe('owner');
  });
  it('follows the PO lifecycle', () => {
    expect(canTransitionPo('draft', 'pending_approval')).toBe(true);
    expect(canTransitionPo('draft', 'received')).toBe(false);
    expect(canTransitionPo('approved', 'partially_received')).toBe(true);
  });
  it('3-way matches', () => {
    expect(threeWayMatch([{ ordered: 10, received: 10, billed: 10 }]).ok).toBe(true);
    expect(threeWayMatch([{ ordered: 10, received: 8, billed: 10 }]).issues[0]!.en).toContain('exceeds received');
    expect(threeWayMatch([{ ordered: 10, received: 11, billed: 0 }], 5).ok).toBe(false);
    expect(threeWayMatch([{ ordered: 100, received: 105, billed: 0 }], 5).ok).toBe(true);
  });
  it('checks compliance certificates', () => {
    expect(complianceStatus([], false, '2026-10-06').ok).toBe(false);
    expect(complianceStatus([{ kind: 'saber_pcoc', expiresOn: '2027-06-01' }], false, '2026-10-06')).toEqual({ ok: true, issues: [] });
    const radio = complianceStatus([{ kind: 'saber_pcoc', expiresOn: '2027-06-01' }], true, '2026-10-06');
    expect(radio.ok).toBe(false);
    expect(radio.issues[0]!.key).toBe('cst');
    const soon = complianceStatus([{ kind: 'saber_pcoc', expiresOn: '2026-10-20' }], false, '2026-10-06');
    expect(soon).toMatchObject({ ok: true, issues: [{ level: 'warn' }] });
    expect(complianceStatus([{ kind: 'saber_pcoc', expiresOn: '2026-01-01' }], false, '2026-10-06').issues[0]!.en).toContain('expired');
  });
});

describe('serials & counts', () => {
  it('parses a packing list with MACs', () => {
    const r = parseSerialList('Serial,MAC\nsn001, a4-bb-6d-01-02-0f\nSN002\tA4BB6D010210;A4BB6D010211\nSN001\nSN003, zz');
    expect(r.rows).toEqual([{ serial: 'SN001', macs: ['A4:BB:6D:01:02:0F'] }, { serial: 'SN002', macs: ['A4:BB:6D:01:02:10', 'A4:BB:6D:01:02:11'] }]);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5]);
  });
  it('measures count accuracy', () => {
    expect(countAccuracy([{ expected: 5, counted: 5 }, { expected: 3, counted: 2 }])).toBe(0.5);
    expect(countAccuracy([])).toBe(1);
  });
});

describe('direct supplier bills, payments, opening stock', () => {
  it('totals a bill per line with per-line VAT', () => {
    expect(directBillTotals([{ qty: '100', unitPrice: '4.5' }, { qty: '1', unitPrice: '360' }, { qty: '3', unitPrice: '0.333', vatPercent: 0 }])).toEqual({
      lines: [{ amount: 45_000, vat: 6_750 }, { amount: 36_000, vat: 5_400 }, { amount: 100, vat: 0 }], subtotal: 81_100, vat: 12_150, total: 93_250,
    });
  });
  it('derives the payment status and the payables bucket', () => {
    expect(billPaymentStatus(1_000, 0)).toBe('approved');
    expect(billPaymentStatus(1_000, 400)).toBe('partially_paid');
    expect(billPaymentStatus(1_000, 1_000)).toBe('paid');
    expect(payableBucket('2026-10-10', '2026-09-01', '2026-10-07')).toBe('current');
    expect(payableBucket(null, '2026-09-01', '2026-10-07')).toBe('31_60');
    expect(payableBucket('2026-06-01', '2026-05-01', '2026-10-07')).toBe('90_plus');
  });
  it('parses an opening sheet pasted from Excel', () => {
    const r = parseOpeningSheet('Code\tQty\tCost\nabc-1\t10\t2.5\nCAM\t2\t300\tsn1 SN2\n\nabc-1\t1\t1\nX\t-1\t1\nY\t1\tfree');
    expect(r.rows).toEqual([{ line: 2, code: 'ABC-1', qty: '10', unitCost: '2.5', serials: [] }, { line: 3, code: 'CAM', qty: '2', unitCost: '300', serials: ['SN1', 'SN2'] }]);
    expect(r.errors.map((e) => e.line)).toEqual([5, 6, 7]);
  });
});
