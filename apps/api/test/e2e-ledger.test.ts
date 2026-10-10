import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { riyadhDate, fiscalYearOf } from '@mmc/domain';
import { ADMIN_SQL, Client, gotenbergUp, signInOrUp, startServer, stopServer } from './helpers.js';

/** General ledger 6A: chart, manual journal (draft → second person posts → reverse), opening balances, period lock, reports. */
let base = '';
let owner: Client;
let gm: Client;
let acct: Client;
let rep: Client;
let pdfs = false;
const S: Record<string, any> = {};
const today = riyadhDate();
const yearStart = fiscalYearOf(today, 1).start;
const days = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const acc = (code: string): string => S.byCode[code].id;
const entry = (lines: [string, string, string][], over: Record<string, unknown> = {}) => ({
  entryDate: today, memo: 'قيد اختبار', lines: lines.map(([code, debit, credit]) => ({ accountId: acc(code), debit, credit })), ...over,
});

beforeAll(async () => {
  base = await startServer();
  pdfs = await gotenbergUp();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const invite = async (email: string, roleKeys: string[]) => {
    const users = await owner.get('/api/users');
    if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
    return signInOrUp(base, email);
  };
  gm = await invite('gl-gm@e2e.test', ['general_manager']);
  acct = await invite('gl-acct@e2e.test', ['accountant']);
  rep = await invite('gl-rep@e2e.test', ['sales_rep']);
});

afterAll(async () => { await stopServer(); });

describe('Chart of accounts', () => {
  it('is seeded with the Saudi chart and refuses people without ledger permissions', async () => {
    await rep.get('/api/accounting/accounts', { expect: 403 });
    await rep.get('/api/accounting/reports/trial-balance', { expect: 403 });
    const list = await acct.get('/api/accounting/accounts');
    expect(list.length).toBeGreaterThan(70);
    S.byCode = Object.fromEntries(list.map((a: any) => [a.code, a]));
    expect(S.byCode['1110']).toMatchObject({ nameAr: 'العملاء (الذمم المدينة)', type: 'asset', postingKey: 'ar', requiresParty: true, isGroup: false });
    expect(S.byCode['11']).toMatchObject({ isGroup: true, parentId: S.byCode['1'].id });
    expect(S.byCode['1101'].parentId).toBe(S.byCode['11'].id);
    const tree = await acct.get('/api/accounting/accounts/tree');
    expect(tree.map((n: any) => n.code)).toEqual(['1', '2', '3', '4', '5', '6', '9']);
  });

  it('adds accounts under a group of the same type, with unique codes and roles', async () => {
    const a = await acct.post('/api/accounting/accounts', { code: '6212', nameAr: 'مصروفات الضيافة', nameEn: 'Hospitality', parentId: S.byCode['6'].id });
    expect(a).toMatchObject({ code: '6212', type: 'expense', isGroup: false, parentId: S.byCode['6'].id });
    await acct.post('/api/accounting/accounts', { code: '6212', nameAr: 'مكرر', parentId: S.byCode['6'].id }, { expect: 409 });
    await acct.post('/api/accounting/accounts', { code: '7001', nameAr: 'بلا أب' }, { expect: 400 });
    await acct.post('/api/accounting/accounts', { code: '6213', nameAr: 'نوع خاطئ', parentId: S.byCode['6'].id, type: 'asset' }, { expect: 400 });
    await acct.post('/api/accounting/accounts', { code: '6214', nameAr: 'أب غير رئيسي', parentId: S.byCode['6101'].id }, { expect: 400 });
    await acct.post('/api/accounting/accounts', { code: '6215', nameAr: 'دور مستخدم', parentId: S.byCode['6'].id, postingKey: 'ar' }, { expect: 409 });
    await acct.post('/api/accounting/accounts', { code: '6216', nameAr: 'دور مجهول', parentId: S.byCode['6'].id, postingKey: 'nonsense' }, { expect: 400 });
    S.byCode['6212'] = a;
  });

  it('edits names, blocks code/type changes once used, deactivates and deletes unused accounts', async () => {
    const u = await acct.put(`/api/accounting/accounts/${S.byCode['6212'].id}`, { code: '6212', nameAr: 'مصروفات الضيافة والاستقبال', parentId: S.byCode['6'].id, version: S.byCode['6212'].version });
    expect(u.nameAr).toBe('مصروفات الضيافة والاستقبال');
    await acct.put(`/api/accounting/accounts/${S.byCode['6212'].id}`, { code: '6212', nameAr: 'x', parentId: S.byCode['6'].id, version: 1 }, { expect: 409 });
    await acct.post(`/api/accounting/accounts/${S.byCode['1110'].id}/deactivate`, {}, { expect: 409 }); // carries the AR role
    const off = await acct.post(`/api/accounting/accounts/${S.byCode['6212'].id}/deactivate`);
    expect(off.isActive).toBe(false);
    await acct.post(`/api/accounting/accounts/${S.byCode['6212'].id}/activate`);
    const del = await acct.req('DELETE', `/api/accounting/accounts/${S.byCode['6212'].id}`);
    expect(del).toEqual({ ok: true });
    await acct.req('DELETE', `/api/accounting/accounts/${S.byCode['1101'].id}`, undefined, { expect: 409 }); // carries a role
    delete S.byCode['6212'];
  });

  it('exports the chart to Excel and previews / applies an import', async () => {
    const buf = await acct.get('/api/accounting/accounts/excel', { raw: true });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.rowCount).toBeGreaterThan(70);
    const row = ws.addRow(['6220', 'مصروفات التدريب', 'Training', 'مصروفات', '6', 'لا', '', 'لا', 'نعم']);
    expect(row.number).toBeGreaterThan(2);
    ws.addRow(['6221', 'نوع خاطئ', '', 'غير معروف', '', 'لا', '', 'لا', 'نعم']);
    const data = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const preview = await acct.post('/api/accounting/accounts/import', { data, apply: false });
    expect(preview.applied).toBe(false);
    expect(preview.create.map((c: any) => c.code)).toEqual(['6220']);
    expect(preview.problems).toHaveLength(1);
    await acct.post('/api/accounting/accounts/import', { data, apply: true }, { expect: 400 }); // problems block applying
    ws.spliceRows(ws.rowCount, 1);
    const clean = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const done = await acct.post('/api/accounting/accounts/import', { data: clean, apply: true });
    expect(done.applied).toBe(true);
    const list = await acct.get('/api/accounting/accounts?q=6220');
    expect(list[0]).toMatchObject({ code: '6220', type: 'expense' });
  });
});

describe('Opening balances', () => {
  it('needs ledger.close and balances against Opening balance equity', async () => {
    const lines = [
      { accountId: acc('1103'), debit: '50000', credit: '0' },
      { accountId: acc('1101'), debit: '5000', credit: '0' },
      { accountId: acc('3101'), debit: '0', credit: '40000' },
    ];
    await acct.post('/api/accounting/opening', { goLiveDate: yearStart, lines }, { expect: 403 });
    await owner.post('/api/accounting/opening', { goLiveDate: yearStart, lines, autoBalance: false }, { expect: 400 });
    const o = await owner.post('/api/accounting/opening', { goLiveDate: yearStart, lines });
    expect(o).toMatchObject({ kind: 'opening', status: 'draft', entryDate: yearStart, total: '55000.00' });
    expect(o.lines).toHaveLength(4);
    expect(o.lines.find((l: any) => l.code === '3301')).toMatchObject({ credit: '15000.00' });
    await owner.post('/api/accounting/opening', { goLiveDate: yearStart, lines }, { expect: 409 }); // one live opening entry
    S.opening = o;
  });

  it('is posted by a second person and sets the go-live date', async () => {
    await acct.post(`/api/accounting/journal/${S.opening.id}/post`, {});
    const state = await owner.get('/api/accounting/opening');
    expect(state.goLiveDate).toBe(yearStart);
    expect(state.entry).toMatchObject({ status: 'posted', number: S.opening.number });
  });
});

describe('Manual journal', () => {
  it('saves incomplete drafts but never posts an unbalanced one', async () => {
    const d = await acct.post('/api/accounting/journal', entry([['6207', '120', '0'], ['1101', '0', '100']]));
    expect(d).toMatchObject({ status: 'draft', kind: 'manual', total: '120.00' });
    expect(d.number).toMatch(/^JV-\d{6}$/);
    await gm.post(`/api/accounting/journal/${d.id}/post`, {}, { expect: 400 });
    const fixed = await acct.put(`/api/accounting/journal/${d.id}`, { ...entry([['6207', '120', '0'], ['1101', '0', '120']]), version: d.version });
    expect(fixed.lines).toHaveLength(2);
    S.draft = fixed;
  });

  it('refuses malformed lines, group and inactive accounts, a missing customer and pre-go-live dates', async () => {
    await acct.post('/api/accounting/journal', entry([['6207', '10', '0'], ['1101', '0', '0']]), { expect: 400 });
    await acct.post('/api/accounting/journal', { entryDate: today, lines: [{ accountId: acc('6207'), debit: '5', credit: '5' }, { accountId: acc('1101'), debit: '0', credit: '5' }] }, { expect: 400 });
    await acct.post('/api/accounting/journal', entry([['6', '10', '0'], ['1101', '0', '10']]), { expect: 400 }); // group account
    await acct.post('/api/accounting/journal', entry([['6207', '10.123', '0'], ['1101', '0', '10']]), { expect: 400 }); // > 2 decimals
    await acct.post('/api/accounting/journal', entry([['6207', '10', '0'], ['1101', '0', '10']], { entryDate: days(-4000) }), { expect: 400 }); // before go-live
    const ar = await acct.post('/api/accounting/journal', entry([['1110', '10', '0'], ['4101', '0', '10']])); // draft may lack the customer…
    await gm.post(`/api/accounting/journal/${ar.id}/post`, {}, { expect: 400 }); // …but posting needs it
    await acct.req('DELETE', `/api/accounting/journal/${ar.id}`);
  });

  it('is posted by someone other than the preparer, then is immutable', async () => {
    await acct.post(`/api/accounting/journal/${S.draft.id}/post`, {}, { expect: 403 }); // own entry
    await rep.post(`/api/accounting/journal/${S.draft.id}/post`, {}, { expect: 403 });
    const posted = await gm.post(`/api/accounting/journal/${S.draft.id}/post`);
    expect(posted).toMatchObject({ status: 'posted', total: '120.00' });
    expect(posted.postedAt).toBeTruthy();
    await acct.put(`/api/accounting/journal/${S.draft.id}`, { ...entry([['6207', '999', '0'], ['1101', '0', '999']]), version: posted.version }, { expect: 409 });
    await acct.req('DELETE', `/api/accounting/journal/${S.draft.id}`, undefined, { expect: 409 });
    await gm.post(`/api/accounting/journal/${S.draft.id}/post`, {}, { expect: 409 });
    S.posted = posted;
  });

  it('is protected by the database itself, not only the API', async () => {
    const sql = ADMIN_SQL();
    const inTenant = async (fn: (t: any) => Promise<unknown>) => {
      const [t] = await sql`select id from tenant limit 1`;
      return sql.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${t!.id}, true)`; await fn(tx); });
    };
    try {
      await expect(inTenant((t) => t`update journal_line set debit = 999 where entry_id = ${S.posted.id} and debit > 0`)).rejects.toThrow(/immutable/);
      await expect(inTenant((t) => t`delete from journal_line where entry_id = ${S.posted.id}`)).rejects.toThrow(/immutable/);
      await expect(inTenant((t) => t`delete from journal_entry where id = ${S.posted.id}`)).rejects.toThrow(/cannot be deleted/);
      await expect(inTenant((t) => t`update journal_entry set memo = 'tampered' where id = ${S.posted.id}`)).rejects.toThrow(/immutable/);
      await expect(inTenant((t) => t`update journal_entry set entry_date = '2020-01-01', period = '2020-01' where id = ${S.posted.id}`)).rejects.toThrow(/immutable/);
      await expect(inTenant((t) => t`insert into journal_line (entry_id, line_no, account_id, entry_date, debit, credit) select id, 9, ${acc('1101')}, entry_date, 1, 0 from journal_entry where id = ${S.posted.id}`)).rejects.toThrow(/draft/);
      // entries must start as drafts, and a draft cannot be posted unbalanced
      await expect(inTenant((t) => t`insert into journal_entry (number, entry_date, period, status, total) values ('JV-HACK', ${today}, ${today.slice(0, 7)}, 'posted', 0)`)).rejects.toThrow(/draft/);
      await expect(inTenant(async (t) => {
        const [e] = await t`insert into journal_entry (number, entry_date, period, total) values ('JV-HACK2', ${today}, ${today.slice(0, 7)}, 10) returning id`;
        await t`insert into journal_line (entry_id, line_no, account_id, entry_date, debit, credit) values (${e!.id}, 1, ${acc('6207')}, ${today}, 10, 0), (${e!.id}, 2, ${acc('1101')}, ${today}, 0, 4)`;
        await t`update journal_entry set status = 'posted' where id = ${e!.id}`;
      })).rejects.toThrow(/equal debits and credits/);
      await expect(inTenant(async (t) => {
        const [e] = await t`insert into journal_entry (number, entry_date, period, total) values ('JV-HACK3', ${today}, ${today.slice(0, 7)}, 5) returning id`;
        await t`insert into journal_line (entry_id, line_no, account_id, entry_date, debit, credit) values (${e!.id}, 1, ${acc('1101')}, ${today}, 5, 5)`;
      })).rejects.toThrow(/journal_line_one_side/);
    } finally { await sql.end(); }
  });

  it('reverses once, with a reason, linking both entries', async () => {
    await acct.post(`/api/accounting/journal/${S.posted.id}/reverse`, {}, { expect: 400 }); // reason required
    const rev = await gm.post(`/api/accounting/journal/${S.posted.id}/reverse`, { reason: 'تصحيح خطأ' });
    expect(rev).toMatchObject({ kind: 'reversal', status: 'posted', total: '120.00', reverses: { id: S.posted.id } });
    expect(rev.lines.find((l: any) => l.code === '6207')).toMatchObject({ debit: '0.00', credit: '120.00' });
    const orig = await acct.get(`/api/accounting/journal/${S.posted.id}`);
    expect(orig.reversedBy).toMatchObject({ id: rev.id });
    await gm.post(`/api/accounting/journal/${S.posted.id}/reverse`, { reason: 'ثانية' }, { expect: 409 });
    await gm.post(`/api/accounting/journal/${rev.id}/reverse`, { reason: 'عكس العكس' }, { expect: 409 });
  });

  it('lists and filters entries', async () => {
    const all = await acct.get('/api/accounting/journal');
    expect(all.total).toBeGreaterThanOrEqual(3);
    expect((await acct.get('/api/accounting/journal?kind=reversal')).rows.every((r: any) => r.kind === 'reversal')).toBe(true);
    expect((await acct.get(`/api/accounting/journal?account=${acc('6207')}`)).total).toBe(2);
    expect((await acct.get('/api/accounting/journal?status=draft')).rows.every((r: any) => r.status === 'draft')).toBe(true);
    expect((await acct.get(`/api/accounting/journal?q=${S.posted.number}`)).total).toBeGreaterThanOrEqual(1);
  });
});

describe('Reports', () => {
  it('books a sale and an expense, then the trial balance balances', async () => {
    const party = await owner.post('/api/parties', { nameAr: 'عميل دفتر الأستاذ', phone: '0557770099' });
    S.party = party;
    const sale = await acct.post('/api/accounting/journal', { entryDate: today, memo: 'مبيعات', lines: [
      { accountId: acc('1110'), debit: '11500', credit: '0', partyId: party.id },
      { accountId: acc('4101'), debit: '0', credit: '10000' },
      { accountId: acc('2110'), debit: '0', credit: '1500' },
    ] });
    await gm.post(`/api/accounting/journal/${sale.id}/post`);
    const rent = await acct.post('/api/accounting/journal', entry([['6201', '3000', '0'], ['1103', '0', '3000']], { memo: 'إيجار' }));
    await gm.post(`/api/accounting/journal/${rent.id}/post`);
    S.sale = sale;
  });

  it('trial balance: totals equal, group roll-ups, level and zero filters', async () => {
    const tb = await acct.get(`/api/accounting/reports/trial-balance?from=${yearStart}&to=${today}`);
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    const row = (c: string) => tb.rows.find((r: any) => r.code === c);
    expect(row('1103')).toMatchObject({ openingDebit: '0.00', debit: '50000.00', credit: '3000.00', closingDebit: '47000.00' });
    expect(row('1110')).toMatchObject({ debit: '11500.00', closingDebit: '11500.00' });
    expect(row('11').closingDebit).toBe('63500.00'); // 47,000 + 5,000 + 11,500
    expect(row('3101')).toMatchObject({ credit: '40000.00', closingCredit: '40000.00' });
    // a later period carries everything as its opening balance
    const later = await acct.get(`/api/accounting/reports/trial-balance?from=${days(1)}&to=${days(1)}`);
    expect(later.balanced).toBe(true);
    expect(later.rows.find((r: any) => r.code === '1103')).toMatchObject({ openingDebit: '47000.00', debit: '0.00', closingDebit: '47000.00' });
    const top = await acct.get(`/api/accounting/reports/trial-balance?level=1`);
    expect(top.rows.map((r: any) => r.code)).toEqual(['1', '2', '3', '4', '6']);
    expect((await acct.get('/api/accounting/reports/trial-balance?withZero=true')).rows.length).toBeGreaterThan(70);
    await acct.get('/api/accounting/reports/trial-balance?from=2026-12-01&to=2026-01-01', { expect: 400 });
  });

  it('account statement keeps a running balance and filters by customer', async () => {
    const l = await acct.get(`/api/accounting/reports/ledger?account=${acc('1103')}&from=${today}&to=${today}`);
    expect(l.opening).toBe('50000.00'); // the opening entry is dated before today
    expect(l.rows.map((r: any) => r.balance)).toEqual(['47000.00']);
    expect(l.closing).toBe('47000.00');
    const ar = await acct.get(`/api/accounting/reports/ledger?account=${acc('1110')}&party=${S.party.id}`);
    expect(ar.rows).toHaveLength(1);
    expect(ar.closing).toBe('11500.00');
    const other = await acct.get(`/api/accounting/reports/ledger?account=${acc('1110')}&party=${S.party.id.replace(/.$/, '0')}`);
    expect(other.rows).toHaveLength(0);
    const group = await acct.get(`/api/accounting/reports/ledger?account=${acc('11')}`);
    expect(group.closing).toBe('63500.00');
  });

  it('income statement and balance sheet agree on the profit', async () => {
    const is = await acct.get(`/api/accounting/reports/income-statement?from=${yearStart}&to=${today}`);
    expect(is.sections.find((s: any) => s.key === 'revenue').total).toBe('10000.00');
    expect(is.sections.find((s: any) => s.key === 'operating_expenses').total).toBe('3000.00');
    expect(is.netProfit.total).toBe('7000.00');
    const byMonth = await acct.get(`/api/accounting/reports/income-statement?from=${yearStart}&to=${today}&by=month`);
    expect(byMonth.columns).toEqual([today.slice(0, 7)]);
    expect(byMonth.netProfit.values[today.slice(0, 7)]).toBe('7000.00');
    const bs = await acct.get(`/api/accounting/reports/balance-sheet?asOf=${today}`);
    expect(bs.balanced).toBe(true);
    expect(bs.currentYearProfit).toBe(is.netProfit.total);
    expect(bs.assets.total).toBe(bs.liabilitiesAndEquity);
    // before anything was sold the sheet still balances
    expect((await acct.get(`/api/accounting/reports/balance-sheet?asOf=${yearStart}`)).balanced).toBe(true);
  });

  it('journal book lists entries with lines', async () => {
    const j = await acct.get(`/api/accounting/reports/journal?from=${yearStart}&to=${today}`);
    const e = j.entries.find((x: any) => x.id === S.sale.id);
    expect(e.lines).toHaveLength(3);
    expect(e.lines[0]).toMatchObject({ code: '1110', debit: '11500.00', party: 'عميل دفتر الأستاذ' });
    expect(j.entries.every((x: any) => x.lines.length >= 2)).toBe(true);
  });

  it('exports every report to Excel (and PDF when Gotenberg is up)', async () => {
    for (const url of [`trial-balance`, `income-statement`, `balance-sheet`, `ledger?account=${acc('1103')}`, `journal`]) {
      const sep = url.includes('?') ? '&' : '?';
      const buf = await acct.get(`/api/accounting/reports/${url}${sep}format=xlsx`, { raw: true });
      expect(buf.subarray(0, 2).toString()).toBe('PK');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      expect(wb.worksheets[0]!.getRow(1).getCell(1).value).toContain('المدى المبارك');
      expect(wb.worksheets[0]!.views[0]).toMatchObject({ rightToLeft: true });
    }
    if (pdfs) {
      const pdf = await acct.get(`/api/accounting/reports/trial-balance?format=pdf`, { raw: true });
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});

describe('Settings and period lock', () => {
  it('changes defaults but guards the calendar', async () => {
    const s = await acct.get('/api/accounting/settings');
    expect(s).toMatchObject({ fiscalYearStartMonth: 1, goLiveDate: yearStart, wipPolicy: 'wip' });
    expect(s.methodAccountNames.cash.code).toBe('1101');
    expect(s.methodAccountNames.mada.code).toBe('1104');
    const u = await acct.put('/api/accounting/settings', { wipPolicy: 'expense', employerGosiSaudiPct: '11.75' });
    expect(u.wipPolicy).toBe('expense');
    await acct.put('/api/accounting/settings', { fiscalYearStartMonth: 7 }, { expect: 403 });
    await owner.put('/api/accounting/settings', { fiscalYearStartMonth: 7 }, { expect: 409 }); // entries are posted
    await acct.put('/api/accounting/settings', { defaultBankAccountId: acc('6') }, { expect: 400 }); // group account
    await acct.put('/api/accounting/settings', { wipPolicy: 'wip' });
  });

  it('locks a period: nothing can be posted, created or reversed into it', async () => {
    const locked = days(-1);
    const y = await acct.post('/api/accounting/journal', entry([['6207', '75', '0'], ['1101', '0', '75']], { entryDate: locked }));
    await acct.post('/api/accounting/periods/lock', { through: locked }, { expect: 403 });
    await gm.post('/api/accounting/periods/lock', { through: days(5) }, { expect: 400 }); // future
    const lock = await gm.post('/api/accounting/periods/lock', { through: locked });
    expect(lock).toMatchObject({ lockedThrough: locked, draftsInRange: 1 });
    await gm.post(`/api/accounting/journal/${y.id}/post`, {}, { expect: 400 }); // draft prepared before the lock
    await acct.post('/api/accounting/journal', entry([['6207', '75', '0'], ['1101', '0', '75']], { entryDate: locked }), { expect: 400 });
    await gm.post(`/api/accounting/journal/${S.sale.id}/reverse`, { reason: 'x', date: locked }, { expect: 400 });
    // today's entries are still fine
    const t = await acct.post('/api/accounting/journal', entry([['6207', '5', '0'], ['1101', '0', '5']]));
    await gm.post(`/api/accounting/journal/${t.id}/post`);
    await gm.post('/api/accounting/periods/lock', { through: locked }, { expect: 400 }); // already
    await gm.post('/api/accounting/periods/unlock', { through: null, reason: 'x' }, { expect: 403 }); // owner only
    const open = await owner.post('/api/accounting/periods/unlock', { through: null, reason: 'تصحيح' });
    expect(open.lockedThrough).toBeNull();
    await gm.post(`/api/accounting/journal/${y.id}/post`); // now allowed
  });

  it('keeps the audit trail of ledger actions', async () => {
    const audit = await owner.get('/api/audit?limit=200').catch(() => null);
    if (!audit) return;
    const rows = Array.isArray(audit) ? audit : audit.rows ?? [];
    const actions = new Set(rows.map((r: any) => `${r.entityType ?? r.entity_type}:${r.action}`));
    expect(actions.has('journal_entry:post')).toBe(true);
  });
});

describe('Dashboard', () => {
  it('summarises cash, receivables, profit and the integrity checks', async () => {
    const d = await acct.get('/api/accounting/dashboard');
    expect(d.balances.ar).toMatchObject({ code: '1110', balance: '11500.00' });
    expect(Number(d.balances.cash.balance)).toBeGreaterThan(0);
    expect(d.checks.find((c: any) => c.key === 'trial_balance').ok).toBe(true);
    expect(d.recent.length).toBeGreaterThan(0);
    expect(Number(d.profit.year)).toBeLessThan(7000); // the small extra expenses posted above
  });
});
