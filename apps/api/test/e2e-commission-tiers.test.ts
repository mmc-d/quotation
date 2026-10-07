import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMultiplier, riyadhDate, splitCommission, toHalalas } from '@mmc/domain';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * HR-53/54: tiers/accelerators on monthly quota attainment, commission splits between reps, the rep
 * earnings dashboard and the leaderboard. Run on its own DB:
 *   E2E_DB=mmc_e2e_com pnpm --filter @mmc/api test e2e-commission-tiers
 */
let base = '';
let owner: Client;
const S: Record<string, any> = {};
const today = riyadhDate();
const period = today.slice(0, 7);
const myProducts: string[] = [];
const RATE = 2; // percent of revenue

async function sqlRun<T = any>(fn: (sql: ReturnType<typeof ADMIN_SQL>) => Promise<T>): Promise<T> {
  const sql = ADMIN_SQL();
  try { return await fn(sql); } finally { await sql.end(); }
}

async function invite(email: string, roleKeys: string[]) {
  let users = await owner.get('/api/users');
  if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
  users = await owner.get('/api/users');
  const c = await signInOrUp(base, email);
  return { c, id: users.find((u: any) => u.email === email).id as string };
}

/** Signed contract owned by `ownerId`, optional split set before invoicing, final 388 issued. */
async function contractWith388(ownerId: string, split?: { userId: string; sharePercent: string }[]) {
  const q = await owner.post('/api/quotes', {
    partyId: S.party.id, clientName: S.party.nameAr, clientPhone: '0557770002', discountType: 'amount', discountValue: '0', vatOn: true,
    lines: [{ code: 'CTR-CAM', description: 'كاميرا', unitPrice: '1000', qty: '3', unitCost: '600' }],
  });
  await owner.post(`/api/quotes/${q.id}/submit`);
  const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
  await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
  await sqlRun((sql) => sql`update contract set owner_id = ${ownerId} where id = ${c.id}`);
  if (split) await owner.put(`/api/commissions/splits/${c.id}`, { splits: split });
  const final = c.milestones[c.milestones.length - 1];
  await owner.post(`/api/finance/milestones/${final.id}/request`, {});
  const bill = await owner.get(`/api/finance/contracts/${c.id}`);
  const inv = bill.invoices.find((i: any) => i.typeCode === '388');
  const [m] = await sqlRun((sql) => sql`select taxable, issue_date::text as d from invoice_mirror where id = ${inv.id}`);
  return { contract: c, invoice: inv, net: toHalalas(m.taxable), issueDate: m.d as string };
}

const entriesOf = async (invoiceId: string) => (await owner.get(`/api/commissions/entries?limit=500`)).rows.filter((r: any) => r.invoiceId === invoiceId);

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const p = await owner.post('/api/parties', { nameAr: 'شركة الحوافز', phone: '0557770001', sites: [{ type: 'project', name: 'المقر', city: 'الرياض' }] });
  S.party = await owner.get(`/api/parties/${p.id}`);
  const a = await invite('tier-rep-a@e2e.test', ['sales_rep']);
  const b = await invite('tier-rep-b@e2e.test', ['sales_rep']);
  S.a = a.c; S.aId = a.id; S.b = b.c; S.bId = b.id;
  const pr = await owner.put('/api/products/new', { code: 'CTR-CAM', nameAr: 'كاميرا الحوافز', listPrice: '1000' });
  myProducts.push(pr.id);
});

afterAll(async () => {
  try {
    if (myProducts.length) await sqlRun((sql) => sql`update product set archived_at = now() where id in ${sql(myProducts)}`);
  } finally {
    await stopServer();
  }
});

describe('commission tiers on quota attainment (HR-53)', () => {
  it('stores tiers on a plan (sorted; duplicates rejected)', async () => {
    S.plan = await owner.post('/api/commissions/plans', {
      name: 'إيراد 2٪ مع مسرّعات', basis: 'revenue', ratePercent: String(RATE), userIds: [S.aId, S.bId],
      tiers: [{ fromPercent: 120, multiplier: 1.5 }, { fromPercent: 100, multiplier: 1.2 }],
    });
    expect(S.plan.tiers).toEqual([{ fromPercent: 100, multiplier: 1.2 }, { fromPercent: 120, multiplier: 1.5 }]);
    await owner.post('/api/commissions/plans', { name: 'dup', ratePercent: '1', tiers: [{ fromPercent: 100, multiplier: 1.2 }, { fromPercent: 100, multiplier: 2 }] }, { expect: 400 });
  });

  it('without a quota the base rate applies; a quota at ≥120 % re-tiers the month to ×1.5', async () => {
    S.c1 = await contractWith388(S.aId);
    expect(S.c1.issueDate.slice(0, 7)).toBe(period);
    S.base1 = Math.round((S.c1.net * RATE) / 100);
    let [e] = await entriesOf(S.c1.invoice.id);
    expect(toHalalas(e.earned)).toBe(S.base1);
    expect(e.userId).toBe(S.aId);

    // quota = revenue ÷ 1.25 → 125 % attainment
    S.quotaA = (Math.floor(S.c1.net / 1.25) / 100).toFixed(2);
    await S.a.put('/api/commissions/quotas', { period, rows: [{ userId: S.aId, amount: S.quotaA }] }, { expect: 403 });
    await owner.put('/api/commissions/quotas', { period, rows: [{ userId: S.aId, amount: S.quotaA }, { userId: '00000000-0000-4000-8000-000000000000', amount: '1' }] }, { expect: 400 });
    const r = await owner.put('/api/commissions/quotas', { period, rows: [{ userId: S.aId, amount: S.quotaA }] });
    expect(r.recomputed.invoices).toBeGreaterThanOrEqual(1);
    [e] = await entriesOf(S.c1.invoice.id);
    expect(toHalalas(e.earned)).toBe(applyMultiplier(S.base1, 1.5));

    // a much higher quota drops below every tier → back to the base rate; restore it after
    await owner.put('/api/commissions/quotas', { period, rows: [{ userId: S.aId, amount: '9999999' }] });
    [e] = await entriesOf(S.c1.invoice.id);
    expect(toHalalas(e.earned)).toBe(S.base1);
    await owner.put('/api/commissions/quotas', { period, rows: [{ userId: S.aId, amount: S.quotaA }] });
    expect(toHalalas((await entriesOf(S.c1.invoice.id))[0].earned)).toBe(applyMultiplier(S.base1, 1.5));
    // explicit recalc is idempotent
    await S.a.post('/api/commissions/recalc', { period }, { expect: 403 });
    await owner.post('/api/commissions/recalc', { period });
    expect(await entriesOf(S.c1.invoice.id)).toHaveLength(1);

    const mine = await S.a.get(`/api/commissions/quotas?period=${period}`);
    expect(mine.rows).toEqual([{ userId: S.aId, period, amount: S.quotaA }]);
    expect((await S.b.get(`/api/commissions/quotas?period=${period}`)).rows).toHaveLength(0);
  });
});

describe('commission splits (HR-53)', () => {
  it('validates splits (total 100, known users, manage only)', async () => {
    const c = S.c1.contract;
    await owner.put(`/api/commissions/splits/${c.id}`, { splits: [{ userId: S.aId, sharePercent: '60' }, { userId: S.bId, sharePercent: '30' }] }, { expect: 400 });
    await owner.put(`/api/commissions/splits/${c.id}`, { splits: [{ userId: S.aId, sharePercent: '50' }, { userId: '00000000-0000-4000-8000-000000000000', sharePercent: '50' }] }, { expect: 400 });
    await S.a.get(`/api/commissions/splits/${c.id}`, { expect: 403 });
    expect((await owner.get(`/api/commissions/splits/${c.id}`)).rows).toEqual([]);
  });

  it('a 50/50 split pays both reps exactly, each with their own tier', async () => {
    S.c2 = await contractWith388(S.aId, [{ userId: S.aId, sharePercent: '50' }, { userId: S.bId, sharePercent: '50' }]);
    const got = await owner.get(`/api/commissions/splits/${S.c2.contract.id}`);
    expect(got.rows.map((r: any) => [r.userId, r.sharePercent])).toEqual([[S.aId, '50'], [S.bId, '50']]);
    const base = Math.round((S.c2.net * RATE) / 100);
    const [sa, sb] = splitCommission(base, [{ userId: S.aId, sharePercent: 50 }, { userId: S.bId, sharePercent: 50 }]);
    expect(sa!.halalas + sb!.halalas).toBe(base);
    const rows = await entriesOf(S.c2.invoice.id);
    expect(rows).toHaveLength(2);
    // rep A is above 120 % (×1.5); rep B has no quota (×1)
    expect(toHalalas(rows.find((r: any) => r.userId === S.aId).earned)).toBe(applyMultiplier(sa!.halalas, 1.5));
    expect(toHalalas(rows.find((r: any) => r.userId === S.bId).earned)).toBe(sb!.halalas);
    S.c2base = base;
  });

  it('a 381 claws back proportionally across the split', async () => {
    const cn = await owner.post(`/api/finance/invoices/${S.c2.invoice.id}/credit-note`, { reason: 'خصم لاحق', amount: '115.00' });
    const [m] = await sqlRun((sql) => sql`select taxable from invoice_mirror where id = ${cn.id}`);
    const claw = -Math.round((Math.abs(toHalalas(m.taxable)) * RATE) / 100);
    const [ca, cb] = splitCommission(claw, [{ userId: S.aId, sharePercent: 50 }, { userId: S.bId, sharePercent: 50 }]);
    const rows = await entriesOf(cn.id);
    expect(rows).toHaveLength(2);
    expect(toHalalas(rows.find((r: any) => r.userId === S.bId).earned)).toBe(cb!.halalas);
    expect(toHalalas(rows.find((r: any) => r.userId === S.aId).earned)).toBe(applyMultiplier(ca!.halalas, 1.5));
    expect(cb!.halalas).toBeLessThan(0);
    for (const r of rows) expect(r.payable).toBe(r.earned); // claw-back due at once
  });

  it('changing the split re-attributes the contract invoices (paid amounts kept)', async () => {
    await owner.put(`/api/commissions/splits/${S.c2.contract.id}`, { splits: [{ userId: S.aId, sharePercent: '70' }, { userId: S.bId, sharePercent: '30' }] });
    const rows = await entriesOf(S.c2.invoice.id);
    const [sa, sb] = splitCommission(S.c2base, [{ userId: S.aId, sharePercent: 70 }, { userId: S.bId, sharePercent: 30 }]);
    expect(toHalalas(rows.find((r: any) => r.userId === S.bId).earned)).toBe(sb!.halalas);
    expect(toHalalas(rows.find((r: any) => r.userId === S.aId).earned)).toBe(applyMultiplier(sa!.halalas, 1.5));
    // back to 50/50 for the dashboard checks
    await owner.put(`/api/commissions/splits/${S.c2.contract.id}`, { splits: [{ userId: S.aId, sharePercent: '50' }, { userId: S.bId, sharePercent: '50' }] });
  });
});

describe('rep earnings dashboard & leaderboard (HR-54)', () => {
  it('each rep sees only their own month: revenue vs quota, tier, earned/payable/paid', async () => {
    const a = await S.a.get(`/api/commissions/me?period=${period}`);
    expect(a.userId).toBe(S.aId);
    expect(a.quota).toBe(S.quotaA);
    expect(a.attainment).toBeGreaterThanOrEqual(120);
    expect(a.currentTier).toEqual({ fromPercent: 120, multiplier: 1.5 });
    expect(a.nextTier).toBeNull();
    expect(a.multiplier).toBe(1.5);
    expect(a.entries.every((e: any) => e.userId === S.aId)).toBe(true);
    expect(toHalalas(a.month.earned)).toBe(a.entries.reduce((s: number, e: any) => s + toHalalas(e.earned), 0));
    expect(toHalalas(a.ytd.earned)).toBeGreaterThanOrEqual(toHalalas(a.month.earned));

    const b = await S.b.get(`/api/commissions/me?period=${period}`);
    expect(b.userId).toBe(S.bId);
    expect(b.quota).toBeNull();
    expect(b.attainment).toBeNull();
    expect(b.nextTier).toEqual({ fromPercent: 100, multiplier: 1.2 });
    expect(b.entries.length).toBeGreaterThan(0);
    expect(b.entries.every((e: any) => e.userId === S.bId)).toBe(true);
    // revenue: half of contract 2 net, minus half of the credit note
    expect(toHalalas(b.revenue)).toBeGreaterThan(0);
    expect(toHalalas(b.revenue)).toBeLessThan(S.c2.net);
  });

  it('ranks reps by attainment; a rep with own scope sees only themselves', async () => {
    const lb = await owner.get(`/api/commissions/leaderboard?period=${period}`);
    const ra = lb.rows.find((r: any) => r.userId === S.aId);
    const rb = lb.rows.find((r: any) => r.userId === S.bId);
    expect(ra.rank).toBeLessThan(rb.rank);
    expect(ra.attainment).toBeGreaterThanOrEqual(120);
    const own = await S.b.get(`/api/commissions/leaderboard?period=${period}`);
    expect(own.rows.map((r: any) => r.userId)).toEqual([S.bId]);
  });
});

describe('technician incentive rules (HR-55)', () => {
  it('uses the defaults until a manager saves company rules; reps cannot change them', async () => {
    const before = await owner.get('/api/commissions/technician-rules');
    expect(before.isDefault).toBe(true);
    const rules = { perDeviceHalalas: 1500, firstTimeFixHalalas: 3000, callbackPenaltyHalalas: 2000, callbackWindowDays: 21, happyCustomerHalalas: 500 };
    await S.b.put('/api/commissions/technician-rules', rules, { expect: 403 });
    await owner.put('/api/commissions/technician-rules', { ...rules, callbackWindowDays: 0 }, { expect: 400 });
    expect(await owner.put('/api/commissions/technician-rules', rules)).toEqual({ rules, isDefault: false });
    const t = await owner.get('/api/commissions/technicians');
    expect(t).toMatchObject({ rules, rulesAreDefault: false });
  });
});
