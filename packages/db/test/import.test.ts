import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as s from '../src/schema/index.js';
import { nextNumber, withTenant, type Db } from '../src/index.js';
import { seed } from '../src/seed.js';
import { classify, contractTotalFromHtml, importLegacy, mapQuote } from '../src/import-legacy.js';

const ADMIN = 'postgres://mmc:mmc_dev_only@localhost:5433/mmc_test';
let client: postgres.Sql;
let db: Db;
let tenantId = '';

const legacyQuote = {
  version: 1, quoteNo: 'MMC-2639221', quoteDate: '2026-08-10', clientName: 'أحمد', clientCo: 'مؤسسة البناء الحديث', project: 'فيلا', taxCard: '300000000000003', clientPhone: '0551234567',
  items: [
    { code: 'IP-IN7', desc: 'شاشة 7"', price: 850, unitPrice: 780, qty: 4, installCost: 50 },
    { code: 'INS', desc: 'أعمال التركيب والبرمجة | Installation & Programming', price: 200, unitPrice: 200, qty: 1, installCost: 0, _isAuto: true },
  ],
  discountPercent: 5, discountValue: 0, discMode: 'pct', vatEnabled: true, techNotes: 'n', terms: 't', savedBy: 'a@legacy.test', savedAt: '2026-09-22T08:00:00Z',
};

beforeAll(async () => {
  client = postgres(ADMIN, { max: 2, onnotice: () => {} });
  db = drizzle(client, { schema: s, casing: 'snake_case' }) as unknown as Db;
  tenantId = await seed(db, { ownerEmail: 'a@legacy.test', tenantSlug: 'legacy' });
});
afterAll(async () => { await client.end(); });

describe('legacy import', () => {
  it('classifies files and browser backups', () => {
    const backup = { exportedAt: '2026-10-05', userId: '6753', keyCount: 2, data: { 'quote_MMC-2639221': JSON.stringify(legacyQuote), gseller_info: '{}' } };
    expect(classify(backup, 'b.json').map((d) => d.kind)).toEqual(['quote']);
    expect(classify({ state: { html: '<p/>', contractNo: 'MMCT-7' } }, 'c.json')[0]?.kind).toBe('contract');
    expect(classify({ number: 'MMC-INV-00003', issueDate: '2026-09-25', totals: { taxable: 1, vat: 0, total: 1 } }, 'i.json')[0]?.kind).toBe('invoice');
    expect(classify({ random: 1 }, 'x.json')).toEqual([]);
  });

  it('keeps the INS line exactly as quoted and recomputes totals', () => {
    const m = mapQuote(legacyQuote as never, false);
    expect(m.lines.at(-1)).toMatchObject({ code: 'INS', unitPrice: '200', manualPrice: true });
    expect(m.calc.totals.subtotal).toBe(332000);
    expect(m.calc.totals.discount).toBe(16600);
  });

  it('reads the grand total from a contract snapshot', () => {
    expect(contractTotalFromHtml('<span id="ctGrandText">12,345.60</span>')).toBe(1234560);
  });

  it('imports quotes, contracts and invoices once and continues numbering after them', async () => {
    const docs = [
      ...classify(legacyQuote, 'q.json'),
      ...classify({ html: '<b>x</b><span id="ctGrandText">3,154.00</span>', contractNo: 'MMCT-41', quoteNo: 'MMC-2639221', savedAt: '2026-09-23T10:00:00Z' }, 'c.json'),
      ...classify({ number: 'MMC-INV-00012', icv: 12, issueDate: '2026-09-25', type: 'plain', taxInvoice: false, quoteNo: 'MMC-2639221', totals: { taxable: 3154, vat: 0, total: 3154 }, lines: [] }, 'i.json'),
    ];
    const r1 = await importLegacy(db, tenantId, docs);
    expect(r1).toMatchObject({ quotes: 1, contracts: 1, invoices: 1, skipped: 0 });
    const r2 = await importLegacy(db, tenantId, docs);
    expect(r2).toMatchObject({ quotes: 0, contracts: 0, invoices: 0, skipped: 3 });
    await withTenant(db, tenantId, async (tx) => {
      const [q] = await tx.select().from(s.quote).where(eq(s.quote.number, 'MMC-2639221'));
      expect(q).toMatchObject({ status: 'expired', total: '3154.00', vatOn: false });
      const [c] = await tx.select().from(s.contract).where(eq(s.contract.number, 'MMCT-41'));
      expect(c?.quoteId).toBe(q!.id);
      expect((await nextNumber(tx, 'contract')).number).toBe('MMCT-42');
      expect((await nextNumber(tx, 'invoice')).number).toBe('MMC-INV-00013');
    });
  });

  it('supports a dry run that writes nothing', async () => {
    const r = await importLegacy(db, tenantId, classify({ ...legacyQuote, quoteNo: 'MMC-2639222' }, 'q2.json'), { dryRun: true });
    expect(r.quotes).toBe(1);
    const rows = await withTenant(db, tenantId, (tx) => tx.select().from(s.quote).where(eq(s.quote.number, 'MMC-2639222')));
    expect(rows).toHaveLength(0);
  });
});
