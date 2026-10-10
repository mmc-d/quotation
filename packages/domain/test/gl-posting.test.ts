import { describe, expect, it } from 'vitest';
import { allocateProportional, buildInvoiceLines, buildPaymentLines, buildVoucherLines, revenueKind, type PostLine } from '../src/index.js';

const sum = (lines: PostLine[]) => ({ d: lines.reduce((s, l) => s + l.debit, 0), c: lines.reduce((s, l) => s + l.credit, 0) });
const balanced = (lines: PostLine[]) => { const t = sum(lines); return t.d === t.c && t.d > 0; };
const by = (lines: PostLine[], key: string) => lines.filter((l) => l.key === key);

describe('allocateProportional', () => {
  it('always sums to the total', () => {
    for (const [t, w] of [[100, [1, 1, 1]], [1, [3, 3]], [10001, [7, 13, 29]], [5, [0, 0]]] as [number, number[]][]) {
      expect(allocateProportional(t, w).reduce((s, v) => s + v, 0)).toBe(t);
    }
  });
  it('puts everything on the first part when all weights are zero', () => expect(allocateProportional(500, [0, 0, 0])).toEqual([500, 0, 0]));
});

describe('revenueKind', () => {
  it('maps INS, AMC and service products', () => {
    expect(revenueKind('INS')).toBe('installation');
    expect(revenueKind('AMC')).toBe('service');
    expect(revenueKind('X1', { serviceCodes: new Set(['X1']) })).toBe('service');
    expect(revenueKind('X1', { isAmc: true })).toBe('service');
    expect(revenueKind('X1')).toBe('devices');
  });
});

describe('buildInvoiceLines', () => {
  const base = { partyId: 'p1', projectId: 'pr1' };
  it('386 advance: Dr AR, Cr customer advances + output VAT', () => {
    const { lines } = buildInvoiceLines({ ...base, typeCode: '386', taxable: 10000, vat: 1500, lines: [] });
    expect(balanced(lines)).toBe(true);
    expect(by(lines, 'ar')[0]).toMatchObject({ debit: 11500, partyId: 'p1' });
    expect(by(lines, 'customer_advances')[0]!.credit).toBe(10000);
    expect(by(lines, 'vat_output')[0]).toMatchObject({ credit: 1500, vatCode: 'S', vatBase: 10000 });
  });
  it('386 without VAT has no VAT line', () => {
    const { lines } = buildInvoiceLines({ ...base, typeCode: '386', taxable: 10000, vat: 0, lines: [] });
    expect(by(lines, 'vat_output')).toHaveLength(0);
    expect(balanced(lines)).toBe(true);
  });
  it('388 splits revenue by kind and ties to taxable even with a discount', () => {
    const { lines } = buildInvoiceLines({ ...base, typeCode: '388', taxable: 90000, vat: 13500, lines: [{ net: 80000, kind: 'devices' }, { net: 20000, kind: 'installation' }] });
    expect(balanced(lines)).toBe(true);
    expect(by(lines, 'sales_devices')[0]!.credit).toBe(72000);
    expect(by(lines, 'sales_installation')[0]!.credit).toBe(18000);
    expect(by(lines, 'sales_devices')[0]!.projectId).toBe('pr1');
  });
  it('388 clears the advances in the same entry', () => {
    const { lines, warnings } = buildInvoiceLines({
      ...base, typeCode: '388', taxable: 100000, vat: 15000, lines: [{ net: 100000, kind: 'devices' }],
      advances: [{ taxable: 50000, vat: 7500 }, { taxable: 40000, vat: 6000 }], prepaid: 103500,
    });
    expect(warnings).toEqual([]);
    expect(balanced(lines)).toBe(true);
    // AR nets to the balance due: 115000 − 103500
    const arNet = by(lines, 'ar').reduce((s, l) => s + l.debit - l.credit, 0);
    expect(arNet).toBe(11500);
    expect(by(lines, 'customer_advances')[0]!.debit).toBe(90000);
    expect(by(lines, 'vat_output').find((l) => l.debit)!).toMatchObject({ debit: 13500, vatBase: -90000 });
  });
  it('warns when prepaid differs from the advances', () => {
    const r = buildInvoiceLines({ ...base, typeCode: '388', taxable: 1000, vat: 150, lines: [{ net: 1000, kind: 'devices' }], advances: [{ taxable: 500, vat: 75 }], prepaid: 999 });
    expect(r.warnings).toHaveLength(1);
    expect(balanced(r.lines)).toBe(true);
  });
  it('381 credit note (stored negative) flips the sides and uses absolute values', () => {
    const { lines } = buildInvoiceLines({ ...base, typeCode: '381', taxable: -10000, vat: -1500, lines: [{ net: -10000, kind: 'devices' }] });
    expect(balanced(lines)).toBe(true);
    expect(by(lines, 'sales_devices')[0]).toMatchObject({ debit: 10000, credit: 0 });
    expect(by(lines, 'vat_output')[0]).toMatchObject({ debit: 1500, vatBase: -10000 });
    expect(by(lines, 'ar')[0]).toMatchObject({ credit: 11500 });
  });
  it('381 against an advance goes back to customer advances', () => {
    const { lines } = buildInvoiceLines({ ...base, typeCode: '381', taxable: -10000, vat: -1500, lines: [], creditsAdvance: true });
    expect(by(lines, 'customer_advances')[0]).toMatchObject({ debit: 10000 });
    expect(balanced(lines)).toBe(true);
  });
  it('an empty invoice makes no lines', () => expect(buildInvoiceLines({ ...base, typeCode: '388', taxable: 0, vat: 0, lines: [] }).lines).toEqual([]));
});

describe('buildPaymentLines', () => {
  it('Dr method account, Cr AR (party)', () => {
    const { lines } = buildPaymentLines({ amount: 11500, method: 'mada', partyId: 'p1' });
    expect(balanced(lines)).toBe(true);
    expect(lines[0]).toMatchObject({ key: 'method:mada', debit: 11500 });
    expect(lines[1]).toMatchObject({ key: 'ar', credit: 11500, partyId: 'p1' });
  });
});

describe('buildVoucherLines', () => {
  const v = { amount: 5000, method: 'cash', partyId: null, accountId: null, projectId: 'pr1', costCenter: 'ops' };
  it('payment with a chosen account: Dr account, Cr cash side', () => {
    const { lines } = buildVoucherLines({ ...v, kind: 'payment', accountId: 'acc1' });
    expect(balanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountId === 'acc1')).toMatchObject({ debit: 5000, projectId: 'pr1', costCenter: 'ops' });
    expect(lines.find((l) => l.key === 'method:cash')!.credit).toBe(5000);
  });
  it('receipt from a party goes against AR, payment to a party against AP', () => {
    expect(by(buildVoucherLines({ ...v, kind: 'receipt', partyId: 'p1' }).lines, 'ar')[0]).toMatchObject({ credit: 5000, partyId: 'p1' });
    expect(by(buildVoucherLines({ ...v, kind: 'payment', partyId: 'p1' }).lines, 'ap')[0]).toMatchObject({ debit: 5000 });
  });
  it('HR bonus voucher: Dr bonuses with the employee', () => {
    const { lines } = buildVoucherLines({ ...v, kind: 'payment', bonusEmployeeId: 'e1' });
    expect(by(lines, 'bonuses')[0]).toMatchObject({ debit: 5000, employeeId: 'e1' });
  });
  it('no account and no party → suspense', () => {
    const { lines } = buildVoucherLines({ ...v, kind: 'payment' });
    expect(by(lines, 'suspense')).toHaveLength(1);
    expect(balanced(lines)).toBe(true);
  });
});

import {
  buildBillPaymentLines, buildCommissionDelta, buildDirectBillLines, buildImportVatLines, buildLandedLines, buildPayrollLines, buildPayrollPaidLines, buildPoBillLines, buildStockMoveLines,
  employerGosi, mergeLines,
} from '../src/index.js';

describe('supplier bills', () => {
  it('PO bill clears GRNI at receipt cost and books the price variance', () => {
    const { lines } = buildPoBillLines({ supplierId: 's1', subtotalSar: 21000, vatSar: 3150, grniValue: 20000 });
    expect(balanced(lines)).toBe(true);
    expect(by(lines, 'grni')[0]!.debit).toBe(20000);
    expect(by(lines, 'price_fx_variance')[0]).toMatchObject({ debit: 1000, credit: 0 });
    expect(by(lines, 'vat_input')[0]).toMatchObject({ debit: 3150, vatCode: 'S', vatBase: 21000 });
    expect(by(lines, 'ap')[0]).toMatchObject({ credit: 24150, partyId: 's1' });
  });
  it('a bill cheaper than the receipt gives a favourable (credit) variance', () => {
    const { lines } = buildPoBillLines({ supplierId: 's1', subtotalSar: 19000, vatSar: 0, grniValue: 20000 });
    expect(by(lines, 'price_fx_variance')[0]).toMatchObject({ debit: 0, credit: 1000 });
    expect(balanced(lines)).toBe(true);
  });
  it('direct bill: inventory at move cost, expenses, WIP when the project policy says so, rounding to variance', () => {
    const a = buildDirectBillLines({ supplierId: 's1', subtotalSar: 7000, vatSar: 1050, inventoryValue: 4999, wip: false, projectId: null, expenses: [{ sar: 2000 }] });
    expect(balanced(a.lines)).toBe(true);
    expect(by(a.lines, 'inventory')[0]!.debit).toBe(4999);
    expect(by(a.lines, 'purchase_expenses')[0]!.debit).toBe(2000);
    expect(by(a.lines, 'price_fx_variance')[0]!.debit).toBe(1);
    const b = buildDirectBillLines({ supplierId: 's1', subtotalSar: 2000, vatSar: 0, inventoryValue: 0, wip: true, projectId: 'pr1', expenses: [{ sar: 2000 }] });
    expect(by(b.lines, 'wip')[0]).toMatchObject({ debit: 2000, projectId: 'pr1' });
    expect(by(b.lines, 'purchase_expenses')).toHaveLength(0);
  });
  it('supplier payment: Dr AP (supplier), Cr method account', () => {
    const { lines } = buildBillPaymentLines({ amountSar: 10000, method: 'bank_transfer', supplierId: 's1' });
    expect(balanced(lines)).toBe(true);
    expect(lines[0]).toMatchObject({ key: 'ap', debit: 10000, partyId: 's1' });
    expect(lines[1]).toMatchObject({ key: 'method:bank_transfer', credit: 10000 });
  });
});

describe('buildStockMoveLines', () => {
  const m = { refType: null, value: 1000, hasFrom: false, hasTo: false, projectId: 'pr1', wipPolicy: 'wip' };
  it('goods receipt → inventory / GRNI; bill-received goods and transfers post nothing', () => {
    expect(buildStockMoveLines({ ...m, kind: 'receipt', refType: 'goods_receipt', hasTo: true }).map((l) => l.key)).toEqual(['inventory', 'grni']);
    expect(buildStockMoveLines({ ...m, kind: 'receipt', refType: 'supplier_bill', hasTo: true })).toEqual([]);
    expect(buildStockMoveLines({ ...m, kind: 'transfer', hasFrom: true, hasTo: true })).toEqual([]);
    expect(buildStockMoveLines({ ...m, kind: 'adjust', value: 0, hasTo: true })).toEqual([]);
  });
  it('opening stock → opening balance equity', () => {
    const l = buildStockMoveLines({ ...m, kind: 'opening', hasTo: true });
    expect(l.map((x) => x.key)).toEqual(['inventory', 'opening_balance_equity']);
    expect(balanced(l)).toBe(true);
  });
  it('issue to a project goes to WIP, or to COGS when the policy is expense', () => {
    expect(buildStockMoveLines({ ...m, kind: 'issue_project', hasFrom: true })[0]).toMatchObject({ key: 'wip', projectId: 'pr1', debit: 1000 });
    expect(buildStockMoveLines({ ...m, kind: 'issue_project', hasFrom: true, wipPolicy: 'expense' })[0]).toMatchObject({ key: 'cogs', debit: 1000 });
  });
  it('work-order consumption follows coverage: project → WIP, warranty/AMC/chargeable → COGS', () => {
    expect(buildStockMoveLines({ ...m, kind: 'consume_wo', hasFrom: true, coverage: 'project' })[0]!.key).toBe('wip');
    for (const c of ['warranty', 'amc', 'chargeable']) expect(buildStockMoveLines({ ...m, kind: 'consume_wo', hasFrom: true, coverage: c })[0]!.key).toBe('cogs');
  });
  it('a return is the reverse; count shortage and surplus go to stock adjustments', () => {
    const r = buildStockMoveLines({ ...m, kind: 'return', hasTo: true });
    expect(r[0]).toMatchObject({ key: 'inventory', debit: 1000 });
    expect(r[1]).toMatchObject({ key: 'wip', credit: 1000 });
    expect(buildStockMoveLines({ ...m, kind: 'count', hasFrom: true }).map((l) => l.key)).toEqual(['stock_adjustments', 'inventory']);
    expect(buildStockMoveLines({ ...m, kind: 'count', hasTo: true }).map((l) => l.key)).toEqual(['inventory', 'stock_adjustments']);
    for (const k of ['issue_project', 'consume_wo', 'return', 'count', 'rma_out', 'scrap', 'opening', 'receipt']) {
      expect(balanced(buildStockMoveLines({ ...m, kind: k, hasFrom: k !== 'receipt' && k !== 'return' && k !== 'opening', hasTo: k === 'receipt' || k === 'return' || k === 'opening', refType: 'goods_receipt' }))).toBe(true);
    }
  });
});

describe('import lines', () => {
  it('import VAT and landed cost credit customs payable (with the broker)', () => {
    const v = buildImportVatLines({ vatSar: 15750, baseSar: 105000, customsPartyId: 'b1' });
    expect(balanced(v.lines)).toBe(true);
    expect(by(v.lines, 'vat_input')[0]).toMatchObject({ vatCode: 'IM', vatBase: 105000 });
    expect(by(v.lines, 'customs_payable')[0]!.partyId).toBe('b1');
    const l = buildLandedLines({ capitalised: 10000, expensed: 5000, customsPartyId: null });
    expect(balanced(l.lines)).toBe(true);
    expect(by(l.lines, 'customs_payable')[0]!.credit).toBe(15000);
    expect(buildLandedLines({ capitalised: 0, expensed: 0, customsPartyId: null }).lines).toEqual([]);
  });
});

describe('payroll', () => {
  const emp = (over: Record<string, unknown> = {}) => ({
    employeeId: 'e1', department: 'المبيعات', basic: 600000, housing: 150000, transport: 60000, other: 0, bonuses: 30000, unpaidLeave: 54000, sickDeduction: 0, deductions: 25000, gosi: 73125, net: 687875,
    deductionSplit: { advance: 20000, penalty: 5000, other: 0 }, saudi: true, ...over,
  });
  it('is balanced and splits expense, deductions, GOSI and the net payable', () => {
    const { lines, warnings } = buildPayrollLines([emp()], { gosiSaudiPct: 11.75, gosiOtherPct: 2 });
    expect(warnings).toEqual([]);
    expect(balanced(lines)).toBe(true);
    expect(by(lines, 'salaries').reduce((s, l) => s + l.debit - l.credit, 0)).toBe(600000 - 54000);
    expect(by(lines, 'allowances')[0]!.debit).toBe(210000);
    expect(by(lines, 'bonuses')[0]!.debit).toBe(30000);
    expect(by(lines, 'employee_advances')[0]).toMatchObject({ credit: 20000, employeeId: 'e1' });
    expect(by(lines, 'other_income')[0]!.credit).toBe(5000);
    expect(by(lines, 'salaries_payable')[0]).toMatchObject({ credit: 687875, employeeId: 'e1' });
    // employer share: 11.75 % of basic + housing (750,000) = 88,125, on top of the employee's 73,125
    expect(by(lines, 'gosi_expense')[0]!.debit).toBe(88125);
    expect(by(lines, 'gosi_payable').reduce((s, l) => s + l.credit, 0)).toBe(73125 + 88125);
  });
  it('scales the credits when deductions were capped so the entry still balances, and says so', () => {
    const { lines, warnings } = buildPayrollLines([emp({ net: 700000 })], { gosiSaudiPct: 11.75, gosiOtherPct: 2 });
    expect(warnings.length).toBeGreaterThan(0);
    expect(balanced(lines)).toBe(true);
  });
  it('non-Saudis use the lower employer rate and the 45,000 wage cap applies', () => {
    expect(employerGosi(750000, false, 11.75, 2)).toBe(15000);
    expect(employerGosi(9_000_000, true, 11.75, 2)).toBe(Math.round((4_500_000 * 11.75) / 100));
  });
  it('paying the run settles each employee payable against the bank', () => {
    const { lines } = buildPayrollPaidLines([{ employeeId: 'e1', net: 100 }, { employeeId: 'e2', net: 250 }]);
    expect(balanced(lines)).toBe(true);
    expect(by(lines, 'salaries_payable')).toHaveLength(2);
    expect(by(lines, 'method:bank_transfer')[0]!.credit).toBe(350);
  });
});

describe('commissions and mergeLines', () => {
  it('accrues a positive delta and reverses a negative one', () => {
    expect(buildCommissionDelta({ delta: 5000, employeeId: 'e1' }).lines.map((l) => [l.key, l.debit, l.credit])).toEqual([['commissions', 5000, 0], ['commissions_payable', 0, 5000]]);
    expect(buildCommissionDelta({ delta: -3000, employeeId: 'e1' }).lines.map((l) => [l.key, l.debit, l.credit])).toEqual([['commissions_payable', 3000, 0], ['commissions', 0, 3000]]);
    expect(buildCommissionDelta({ delta: 0, employeeId: null }).lines).toEqual([]);
  });
  it('merges same-account same-side lines and keeps different dimensions apart', () => {
    const merged = mergeLines([
      { key: 'wip', projectId: 'a', debit: 100, credit: 0 }, { key: 'wip', projectId: 'a', debit: 50, credit: 0 }, { key: 'wip', projectId: 'b', debit: 10, credit: 0 }, { key: 'inventory', debit: 0, credit: 160 },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.find((l) => l.projectId === 'a')!.debit).toBe(150);
  });
});
