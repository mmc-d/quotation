import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { quotePrefix, riyadhDate } from '@mmc/domain';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Home control room (GET /api/dashboard/home): sections follow the viewer's permissions, the action
 * inbox only lists non-zero items, cash/funnel/trend agree with a signed contract that has an overdue,
 * partly paid request, and margin stays hidden without quote.cost.read.
 *
 * Order-independent from e2e.test.ts: gives back the daily quote numbers it used.
 */
let base = '';
let owner: Client;
let rep: Client;
let store: Client;
let sm: Client;
const myQuotes: string[] = [];
const today = riyadhDate();
const monthStart = `${today.slice(0, 8)}01`;

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const invite = async (email: string, roleKeys: string[]) => {
    const users = await owner.get('/api/users');
    if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
    return signInOrUp(base, email);
  };
  rep = await invite('dash-rep@e2e.test', ['sales_rep']);
  store = await invite('dash-store@e2e.test', ['storekeeper']);
  sm = await invite('dash-sm@e2e.test', ['sales_manager']);
});

afterAll(async () => {
  try {
    if (myQuotes.length) {
      const sql = ADMIN_SQL();
      const prefix = quotePrefix();
      await sql`update quote set number = 'DB-' || number where id in ${sql(myQuotes)} and number like ${`${prefix}%`}`;
      await sql`update numbering_counter nc set last_value = coalesce((select max(substring(q.number from ${prefix.length + 1}::int)::int) from quote q where q.number like ${`${prefix}%`}), 0)
        from numbering_series s where s.id = nc.series_id and s.document_type = 'quote' and nc.period_key = ${today}`;
      await sql.end();
    }
  } finally {
    await stopServer();
  }
});

describe('GET /api/dashboard/home', () => {
  it('defaults to month-to-date and rejects an inverted period', async () => {
    const d = await owner.get('/api/dashboard/home');
    expect(d.period).toEqual({ from: monthStart, to: today });
    expect(d.previous.to).toBe(addDays(monthStart, -1));
    await owner.get(`/api/dashboard/home?from=${today}&to=${addDays(today, -1)}`, { expect: 400 });
  });

  it('reflects a signed contract with an overdue, partly paid request', async () => {
    const before = await owner.get(`/api/dashboard/home?from=${monthStart}&to=${today}`);
    const party = await owner.post('/api/parties', { nameAr: 'عميل لوحة التحكم', contacts: [{ name: 'خالد', mobile: '0559876511', isPrimary: true }] });
    const q = await owner.post('/api/quotes', { partyId: party.id, clientName: 'عميل لوحة التحكم', clientPhone: '0559876511', discountType: 'amount', discountValue: '0', vatOn: true, lines: [{ code: 'DASH', description: 'نظام انتركوم', unitPrice: '10000', qty: '1' }] });
    myQuotes.push(q.id);
    expect((await owner.post(`/api/quotes/${q.id}/submit`)).status).toBe('approved');
    const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
    await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
    const signed = await owner.get(`/api/contracts/${c.id}`);
    const pr = await owner.post(`/api/finance/milestones/${signed.milestones[0].id}/request`, { dueDate: addDays(today, -3) });
    const half = (Number(pr.amount) / 2).toFixed(2);
    await owner.post(`/api/finance/payment-requests/${pr.id}/payments`, { amount: half, paidOn: today, method: 'bank_transfer', reference: 'DASH-1' });

    const d = await owner.get(`/api/dashboard/home?from=${monthStart}&to=${today}`);
    // sales & funnel: the quote is in the period's cohort, contracted and partly collected
    expect(d.sales.count).toBe(before.sales.count + 1);
    expect(Number(d.sales.value) - Number(before.sales.value)).toBeCloseTo(Number(q.total), 2);
    const step = (k: string) => d.funnel.find((s: any) => s.key === k);
    expect(d.funnel.map((s: any) => s.key)).toEqual(['quoted', 'accepted', 'contracted', 'invoiced', 'collected']);
    expect(Number(step('contracted').value)).toBeGreaterThanOrEqual(Number(signed.total));
    expect(Number(step('collected').value) - Number(before.funnel.find((s: any) => s.key === 'collected').value)).toBeCloseTo(Number(half), 2);
    // cash
    expect(Number(d.cash.collected.value) - Number(before.cash.collected.value)).toBeCloseTo(Number(half), 2);
    expect(Number(d.cash.receivables.overdue)).toBeGreaterThanOrEqual(Number(pr.amount) - Number(half));
    // action inbox: the overdue request is a critical item; zero items are never listed
    const overdue = d.actions.find((a: any) => a.key === 'payment_requests_overdue');
    expect(overdue).toMatchObject({ severity: 'critical', href: '/finance/requests' });
    expect(overdue.count).toBeGreaterThanOrEqual(1);
    expect(d.actions.every((a: any) => a.count > 0)).toBe(true);
    const sev = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
    expect(d.actions.map((a: any) => sev[a.severity])).toEqual([...d.actions.map((a: any) => sev[a.severity])].sort());
    // trend: buckets cover the period, the three series are present and add up to the totals
    expect(d.trend.series).toEqual(['quoted', 'contracted', 'collected']);
    expect(d.trend.points[0].from).toBe(monthStart);
    expect(d.trend.points.at(-1).to).toBe(today);
    const sum = (k: string) => d.trend.points.reduce((a: number, p: any) => a + Number(p[k]), 0);
    expect(sum('quoted')).toBeCloseTo(Number(d.sales.value), 2);
    expect(sum('collected')).toBeCloseTo(Number(d.cash.collected.value), 2);
    // projects: the signed contract opened a kick-off project
    expect(d.projects.byStage.kickoff).toBeGreaterThanOrEqual(1);
    // owner sees margin and payables
    expect(d.visibility).toEqual({ margin: true, payables: true });
    expect(d.team.length).toBeGreaterThanOrEqual(1);
  });

  it('uses monthly buckets for a long period', async () => {
    const d = await owner.get(`/api/dashboard/home?from=${addDays(today, -200)}&to=${today}`);
    expect(d.trend.granularity).toBe('month');
    expect(d.trend.points.length).toBeGreaterThanOrEqual(7);
  });

  it('scopes a sales rep: own quotes only, no margin, no payables or stock', async () => {
    const d = await rep.get('/api/dashboard/home');
    expect(d.visibility).toEqual({ margin: false, payables: false });
    expect(d.sales.count).toBe(0);
    expect(d.sales.marginPercent).toBeNull();
    expect(d.cash.payables).toBeNull();
    expect(d.team).toEqual([]);
    expect(d.actions.map((a: any) => a.key)).not.toContain('payment_requests_overdue');
    for (const k of ['bills_overdue', 'stock_below_reorder', 'quotes_pending_approval', 'tickets_sla_breached']) expect(d.actions.map((a: any) => a.key)).not.toContain(k);
  });

  it('works for a role without quote access (storekeeper): no sales, funnel, team or cash', async () => {
    const d = await store.get('/api/dashboard/home');
    expect(d.sales).toBeNull();
    expect(d.funnel).toBeNull();
    expect(d.team).toBeNull();
    expect(d.cash).toEqual({ collected: null, receivables: null, expected: null, payables: null });
    expect(d.trend.series).toEqual([]);
    expect(d.projects).not.toBeNull();
  });
});

describe('Sales reports (quote register, lost reasons)', () => {
  it('scopes the quote register to the viewer (team scope must not break the aliased query)', async () => {
    const range = `?from=${monthStart}&to=${today}`;
    const all = await owner.get(`/api/dashboard/quote-register${range}`);
    expect(all.length).toBeGreaterThan(0);
    const mine = await sm.get(`/api/dashboard/quote-register${range}`); // sales_manager: report.sales = team
    expect(mine).toEqual([]); // none of the owner's quotes
    await rep.get(`/api/dashboard/quote-register${range}`, { expect: 403 });
  });

  it('scopes lost reasons to the viewer', async () => {
    const range = `?from=${monthStart}&to=${today}`;
    // an opportunity owned by the owner, lost on price
    const lead = await owner.post('/api/crm/leads', { name: 'عميل فرصة خاسرة', mobile: '0551239876' });
    const { opportunityId } = await owner.post(`/api/crm/leads/${lead.id}/convert`, { amount: '4000' });
    const lost = (await owner.get('/api/crm/pipeline')).stages.find((x: any) => x.key === 'lost');
    await owner.post(`/api/crm/opportunities/${opportunityId}/stage`, { stageId: lost.id, lostReasonKey: 'price' });
    const all = await owner.get(`/api/dashboard/lost-reasons${range}`);
    expect(all.find((r: any) => r.reason === 'price')?.count).toBeGreaterThanOrEqual(1);
    expect(await sm.get(`/api/dashboard/lost-reasons${range}`)).toEqual([]); // not in the manager's team
  });

  it('no longer serves the retired cockpit endpoint', async () => {
    await owner.get('/api/dashboard/cockpit', { expect: 404 });
  });
});
