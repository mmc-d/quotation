import { describe, expect, it } from 'vitest';
import {
  calculateQuote, syncInstallationLine, approvalReasons, canTransitionQuote, INS_CODE,
  buildSchedule, prepaymentInvoice, finalInvoiceWithPrepayments, computeInvoiceLines, vatOfGross, agingBucket, remindersDue,
  formatSeries, quotePrefix, trailingSequence, quoteSequence, riyadhDate,
  isValidVatNumber, isValidUnifiedNumber, normalizeSaudiMobile, normalizeArabic, nationalAddressProblems,
  mergeGrants, can, ROLE_TEMPLATES, scoreLead, followUpsDue, formatSar, formatSar2, toHalalas, halalasToFixed,
  type QuoteLineInput, DEFAULT_WORKING_DAYS, isBusinessDay, nextBusinessDay, addBusinessDays, businessDaysBetween,
} from '../src/index.js';

const line = (code: string, unitPrice: number | string, qty: number, extra: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  code, description: code, listPrice: unitPrice, unitPrice, qty, ...extra,
});

describe('quote totals', () => {
  it('computes subtotal, percent discount, VAT and total', () => {
    const r = calculateQuote({ lines: [line('A', 1000, 2), line('B', 333.33, 3)], discount: { type: 'percent', value: 10 }, vatRegistered: true });
    expect(r.totals.subtotal).toBe(299999);
    expect(r.totals.discount).toBe(30000);
    expect(r.totals.taxable).toBe(269999);
    expect(r.totals.vat).toBe(40500);
    expect(r.totals.total).toBe(310499);
    expect(r.lines.reduce((s, l) => s + l.vat, 0)).toBe(r.totals.vat);
    expect(r.lines.reduce((s, l) => s + l.discount, 0)).toBe(r.totals.discount);
  });

  it('caps an amount discount at the subtotal', () => {
    const r = calculateQuote({ lines: [line('A', 100, 1)], discount: { type: 'amount', value: 500 }, vatRegistered: true });
    expect(r.totals.discount).toBe(10000);
    expect(r.totals.total).toBe(0);
  });

  it('has no VAT when the company is not registered, even if the quote switch is on', () => {
    const r = calculateQuote({ lines: [line('A', 100, 1)], vatRegistered: false, vatOn: true });
    expect(r.totals.vat).toBe(0);
    expect(r.totals.vatApplied).toBe(false);
  });

  it('marks FREE and struck lines and excludes optional lines', () => {
    const r = calculateQuote({
      lines: [line('A', 0, 1, { listPrice: 250 }), line('B', 80, 1, { listPrice: 100 }), line('C', 999, 1, { isOptional: true })],
      vatRegistered: true,
    });
    expect(r.lines[0]?.isFree).toBe(true);
    expect(r.lines[0]?.struck).toBe(true);
    expect(r.lines[1]?.struck).toBe(true);
    expect(r.totals.subtotal).toBe(8000);
    expect(r.totals.optionalTotal).toBe(99900);
  });

  it('computes cost and margin', () => {
    const r = calculateQuote({ lines: [line('A', 100, 10, { unitCost: 60 })], vatRegistered: true });
    expect(r.totals.cost).toBe(60000);
    expect(r.totals.margin).toBe(40000);
    expect(r.totals.marginPercent).toBe(40);
  });
});

describe('INS line (legacy syncInsRow)', () => {
  it('adds INS = Σ installCost × qty as the last line', () => {
    const lines = syncInstallationLine([line('A', 100, 2, { installCost: 50 }), line('B', 10, 3, { installCost: 5 })]);
    expect(lines.at(-1)?.code).toBe(INS_CODE);
    expect(lines.at(-1)?.unitPrice).toBe('115');
  });
  it('removes INS when nothing needs installing', () => {
    const lines = syncInstallationLine([line('A', 100, 2), line(INS_CODE, 50, 1)]);
    expect(lines.some((l) => l.code === INS_CODE)).toBe(false);
  });
  it('keeps a manual INS price and description', () => {
    const lines = syncInstallationLine([line('A', 100, 2, { installCost: 50 }), { ...line(INS_CODE, 999, 1, { manualPrice: true }), description: 'تركيب خاص' }]);
    const ins = lines.at(-1)!;
    expect(ins.unitPrice).toBe('999');
    expect(ins.description).toBe('تركيب خاص');
  });
  it('does not come back after the user deleted it', () => {
    const lines = syncInstallationLine([line('A', 100, 2, { installCost: 50 })], { insDeleted: true });
    expect(lines.some((l) => l.code === INS_CODE)).toBe(false);
  });
});

describe('approvals and status', () => {
  it('flags discount and margin breaches', () => {
    const r = calculateQuote({ lines: [line('A', 100, 10, { unitCost: 90 })], discount: { type: 'percent', value: 15 }, vatRegistered: true });
    expect(approvalReasons(r.totals)).toHaveLength(2);
  });
  it('counts below-list prices and FREE lines as discount (no header discount needed)', () => {
    const r = calculateQuote({ lines: [line('A', 50, 1, { listPrice: 100 }), line('B', 0, 1, { listPrice: 100 })], vatRegistered: true });
    expect(r.totals.discountPercent).toBe(0);
    expect(r.totals.discountFromListPercent).toBe(75);
    expect(approvalReasons(r.totals)[0]).toContain('below list');
  });
  it('guards transitions', () => {
    expect(canTransitionQuote('draft', 'sent')).toBe(true);
    expect(canTransitionQuote('accepted', 'draft')).toBe(false);
  });
});

describe('billing', () => {
  it('splits 50/40/10 exactly', () => {
    const s = buildSchedule(100001);
    expect(s.map((m) => m.amount)).toEqual([50001, 40000, 10000]);
    expect(s.reduce((a, m) => a + m.amount, 0)).toBe(100001);
  });
  it('rejects schedules that do not total 100%', () => {
    expect(() => buildSchedule(100, [{ name_ar: 'x', name_en: 'x', percent: 60, trigger: 'manual' }])).toThrow();
  });
  it('386 prepayment carries VAT inside the advance', () => {
    const inv = prepaymentInvoice(115000, 'Advance');
    expect(inv.totals.vat).toBe(15000);
    expect(inv.totals.taxable).toBe(100000);
    expect(vatOfGross(115000)).toBe(15000);
  });
  it('388 final invoice deducts advances', () => {
    const full = computeInvoiceLines([{ code: 'A', name: 'A', qty: 1, unitPrice: 2000 }], 0);
    const adv = prepaymentInvoice(115000, 'Advance');
    const fin = finalInvoiceWithPrepayments(full, [{ total: adv.totals.total, vat: adv.totals.vat }]);
    expect(fin.totals.total).toBe(230000);
    expect(fin.totals.prepaid).toBe(115000);
    expect(fin.totals.payable).toBe(115000);
  });
  it('ages receivables and schedules reminders', () => {
    expect(agingBucket('2026-10-01', '2026-10-01')).toBe('current');
    expect(agingBucket('2026-09-01', '2026-10-05')).toBe('31_60');
    expect(remindersDue('2026-10-10', '2026-10-07', [])).toEqual([-3]);
    expect(remindersDue('2026-10-10', '2026-10-20', [-3, 0])).toEqual([3, 7]);
  });
});

describe('numbering', () => {
  it('formats legacy series', () => {
    const at = new Date('2026-10-05T09:00:00Z');
    expect(formatSeries('MMC-{YY}{WW}{DD}{SEQ}', 3, at)).toBe('MMC-2641053');
    expect(formatSeries('MMCT-{SEQ}', 12, at)).toBe('MMCT-12');
    expect(formatSeries('MMC-INV-{SEQ:5}', 7, at)).toBe('MMC-INV-00007');
    expect(quotePrefix(at)).toBe('MMC-264105');
  });
  it('uses the Riyadh calendar day', () => {
    expect(riyadhDate(new Date('2026-10-05T22:30:00Z'))).toBe('2026-10-06');
  });
  it('parses sequences', () => {
    expect(trailingSequence('MMC-INV-00042')).toBe(42);
    expect(quoteSequence('MMC-26410512', 'MMC-264105')).toBe(12);
  });
});

describe('saudi', () => {
  it('validates identifiers', () => {
    expect(isValidVatNumber('310122393500003')).toBe(true);
    expect(isValidVatNumber('300000000000000')).toBe(false);
    expect(isValidUnifiedNumber('7054249128')).toBe(true);
    expect(isValidUnifiedNumber('1054249128')).toBe(false);
  });
  it('normalises mobiles', () => {
    for (const v of ['0501234567', '501234567', '+966 50 123 4567', '00966501234567', '٠٥٠١٢٣٤٥٦٧']) expect(normalizeSaudiMobile(v)).toBe('+966501234567');
    expect(normalizeSaudiMobile('0123456789')).toBeNull();
  });
  it('normalises Arabic for search', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    expect(normalizeArabic('مُؤسَّسة')).toBe('موسسه');
  });
  it('checks national address', () => {
    expect(nationalAddressProblems({ street: 'x', city: 'جدة', district: 'النخيل', buildingNumber: '1234', postalCode: '23456' })).toEqual([]);
    expect(nationalAddressProblems({})).toContain('buildingNumber');
  });
});

describe('permissions', () => {
  const rep = { userId: 'u1', teamIds: ['t1'], branchId: 'b1', grants: mergeGrants([ROLE_TEMPLATES.sales_rep!.grants]) };
  const mgr = { userId: 'u2', teamIds: ['t1'], branchId: 'b1', grants: mergeGrants([ROLE_TEMPLATES.sales_manager!.grants]) };
  it('scopes own records', () => {
    expect(can(rep, 'quote.write', { ownerId: 'u1' })).toBe(true);
    expect(can(rep, 'quote.write', { ownerId: 'u9' })).toBe(false);
    expect(can(rep, 'quote.cost.read')).toBe(false);
  });
  it('scopes team records', () => {
    expect(can(mgr, 'quote.approve', { ownerId: 'u1', teamId: 't1' })).toBe(true);
    expect(can(mgr, 'quote.approve', { ownerId: 'u7', teamId: 't2' })).toBe(false);
  });
  it('merges to the widest scope', () => {
    expect(mergeGrants([{ 'quote.read': 'own' }, { 'quote.read': 'team' }])['quote.read']).toBe('team');
  });
});

describe('crm', () => {
  it('scores leads', () => {
    expect(scoreLead({ source: 'referral', estimatedUnits: 60, hasMobile: true, interest: 'intercom', city: 'جدة' })).toBe(90);
  });
  it('finds due follow-ups', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const out = followUpsDue(now, {
      quotes: [{ id: 'q', number: 'MMC-1', ownerId: 'u', status: 'sent', sentAt: new Date('2026-10-01T00:00:00Z'), viewedAt: null, validUntil: new Date('2026-10-07T00:00:00Z') }],
      opportunities: [{ id: 'o', title: 'Villa', ownerId: 'u', open: true, lastActivityAt: new Date('2026-09-01T00:00:00Z') }],
      leads: [{ id: 'l', name: 'X', ownerId: null, status: 'new', createdAt: new Date('2026-10-05T00:00:00Z'), firstContactAt: null }],
    });
    expect(out.map((o) => o.rule).sort()).toEqual(['new_lead_untouched', 'quote_expiring', 'quote_not_viewed', 'stale_opportunity']);
  });
});

describe('sections and calendar', () => {
  it('subtotals per section', () => {
    const r = calculateQuote({ lines: [line('A', 100, 1, { sectionKey: 'v1' }), line('B', 50, 2, { sectionKey: 'v2' }), line('C', 10, 1, { sectionKey: 'v1' }), line('D', 999, 1, { sectionKey: 'v1', isOptional: true })], vatRegistered: true });
    expect(r.totals.sections).toEqual([{ key: 'v1', subtotal: 11000, lines: 2 }, { key: 'v2', subtotal: 10000, lines: 1 }]);
  });
  it('counts Sunday–Thursday business days and skips holidays', () => {
    const cal = { workingDays: DEFAULT_WORKING_DAYS, holidays: ['2026-09-23'] };
    expect(isBusinessDay('2026-10-09', cal)).toBe(false); // Friday
    expect(nextBusinessDay('2026-10-09', cal)).toBe('2026-10-11'); // Sunday
    expect(nextBusinessDay('2026-09-23', cal)).toBe('2026-09-24');
    expect(addBusinessDays('2026-10-08', 1, cal)).toBe('2026-10-11');
    expect(businessDaysBetween('2026-10-04', '2026-10-11', cal)).toBe(5);
  });
});

describe('money formatting', () => {
  it('formats like the legacy tool', () => {
    expect(formatSar(123450)).toBe('1,234.5');
    expect(formatSar(123456)).toBe('1,234.56');
    expect(formatSar(123400)).toBe('1,234');
    expect(formatSar2(123400)).toBe('1,234.00');
    expect(toHalalas('19.995')).toBe(2000);
    expect(halalasToFixed(-5)).toBe('-0.05');
  });
});
