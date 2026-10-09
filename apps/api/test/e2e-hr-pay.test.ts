import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, signInOrUp, startServer, stopServer } from './helpers.js';

/** HR pay: leave (self-service + manager approval + direct entry), bonuses / deductions (incl. paid by voucher) and the monthly payroll. */
let base = '';
let owner: Client;
let gm: Client;
let hr: Client;
let mgr: Client;
let emp: Client;
let other: Client;
const S: Record<string, any> = {};
// a random past year so reruns on the same database never meet an already-approved month
const Y = 1990 + Math.floor(Math.random() * 30);
const M = `${Y}-03`;
const stamp = Date.now().toString(36);

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const invite = async (email: string, roleKeys: string[]) => {
    const users = await owner.get('/api/users');
    if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
    return signInOrUp(base, email);
  };
  gm = await invite('pay-gm@e2e.test', ['general_manager']);
  hr = await invite('pay-hr@e2e.test', ['hr_officer']);
  mgr = await invite(`pay-mgr-${stamp}@e2e.test`, ['sales_manager']);
  emp = await invite(`pay-emp-${stamp}@e2e.test`, ['sales_rep']);
  other = await invite('pay-other@e2e.test', ['sales_rep']);
  const users = await owner.get('/api/users');
  const uid = (email: string) => users.find((u: any) => u.email === email).id;
  const base_ = { hireDate: `${Y - 1}-01-01`, contractType: 'unlimited', employmentType: 'full_time', annualLeaveDays: 21, nationality: 'سعودي' };
  S.m = await owner.post('/api/hr/employees', { ...base_, nameAr: 'مدير القسم', jobTitleAr: 'مدير مبيعات', basicSalary: '9000', userId: uid(`pay-mgr-${stamp}@e2e.test`) });
  S.e = await owner.post('/api/hr/employees', {
    ...base_, nameAr: 'موظف الاختبار', jobTitleAr: 'مندوب', basicSalary: '6000', housingAllowance: '1500', transportAllowance: '600', managerId: S.m.id,
    userId: uid(`pay-emp-${stamp}@e2e.test`), iban: 'SA0380000000608010167519', bankName: 'الراجحي',
  });
});

afterAll(async () => { await stopServer(); });

describe('Leave', () => {
  it('shows the employee their record and accrued balance; Saudis default to 9.75 % GOSI', async () => {
    expect(S.e.gosiEmployeePercent).toBe('9.75');
    const me = await emp.get('/api/hr/me');
    expect(me.employee.id).toBe(S.e.id);
    expect(me.balance.accrued).toBeGreaterThan(20);
    expect((await other.get('/api/hr/me')).employee).toBeNull();
    await other.post('/api/hr/me/leaves', { type: 'annual', startDate: `${Y}-03-01`, endDate: `${Y}-03-02` }, { expect: 403 });
  });

  it('lets the employee request leave; balance and overlap are checked', async () => {
    await emp.post('/api/hr/me/leaves', { type: 'annual', startDate: `${Y}-02-01`, endDate: `${Y}-03-31` }, { expect: 400 }); // > balance
    const l = await emp.post('/api/hr/me/leaves', { type: 'annual', startDate: `${Y}-03-01`, endDate: `${Y}-03-05`, reason: 'سفر' });
    expect(l).toMatchObject({ status: 'pending', days: 5, source: 'employee' });
    expect(l.number).toMatch(/^LV-\d{5}$/);
    await emp.post('/api/hr/me/leaves', { type: 'sick', startDate: `${Y}-03-04`, endDate: `${Y}-03-06` }, { expect: 409 });
    S.l = l;
  });

  it('is decided by the direct manager or an HR approver — not by the employee or others', async () => {
    await emp.post(`/api/hr/leaves/${S.l.id}/decide`, { approve: true }, { expect: 403 });
    await other.post(`/api/hr/leaves/${S.l.id}/decide`, { approve: true }, { expect: 403 });
    expect((await mgr.get('/api/hr/me')).teamPending.map((x: any) => x.id)).toContain(S.l.id);
    await mgr.post(`/api/hr/leaves/${S.l.id}/decide`, { approve: false }, { expect: 400 }); // rejection needs a reason
    const a = await mgr.post(`/api/hr/leaves/${S.l.id}/decide`, { approve: true });
    expect(a).toMatchObject({ status: 'approved', decidedByName: `pay-mgr-${stamp}` });
    await mgr.post(`/api/hr/leaves/${S.l.id}/decide`, { approve: true }, { expect: 409 });
  });

  it('lets HR enter sick and unpaid leave directly (approved at once)', async () => {
    await other.post(`/api/hr/leaves/employee/${S.e.id}`, { type: 'sick', startDate: `${Y}-03-10`, endDate: `${Y}-03-12` }, { expect: 403 });
    const s = await hr.post(`/api/hr/leaves/employee/${S.e.id}`, { type: 'sick', startDate: `${Y}-03-10`, endDate: `${Y}-03-12`, reason: 'تقرير طبي' });
    expect(s).toMatchObject({ status: 'approved', source: 'hr', days: 3 });
    S.unpaid = await hr.post(`/api/hr/leaves/employee/${S.e.id}`, { type: 'unpaid', startDate: `${Y}-03-20`, endDate: `${Y}-03-21` });
    const t = await hr.get(`/api/hr/employees/${S.e.id}/time-off`);
    expect(t.balance.taken).toBe(5);
    expect(t.leaves).toHaveLength(3);
  });
});

describe('Bonuses, deductions and payroll', () => {
  it('records payroll bonuses / deductions, and a bonus paid by payment voucher', async () => {
    await hr.post(`/api/hr/employees/${S.e.id}/adjustments`, { month: M, kind: 'bonus', amount: '500', reason: 'تحقيق المستهدف' });
    await hr.post(`/api/hr/employees/${S.e.id}/adjustments`, { month: M, kind: 'deduction', amount: '200', reason: 'سلفة' });
    await hr.post(`/api/hr/employees/${S.e.id}/adjustments`, { month: M, kind: 'bonus', amount: '1000', reason: 'x', payBy: 'voucher' }, { expect: 403 }); // no voucher.write
    await gm.post(`/api/hr/employees/${S.e.id}/adjustments`, { month: M, kind: 'deduction', amount: '10', reason: 'x', payBy: 'voucher' }, { expect: 400 });
    const v = await gm.post(`/api/hr/employees/${S.e.id}/adjustments`, { month: M, kind: 'bonus', amount: '1000', reason: 'مكافأة مشروع', payBy: 'voucher', method: 'transfer' });
    expect(v).toMatchObject({ payMethod: 'voucher', voucherStatus: 'draft' });
    expect(v.voucherNumber).toMatch(/^PV-\d{5}$/);
    const voucher = await gm.get(`/api/vouchers/${v.voucherId}`);
    expect(voucher).toMatchObject({ kind: 'payment', amount: '1000.00', counterpartyName: 'موظف الاختبار', costCenter: 'مكافآت الموظفين', methodRef: 'SA0380000000608010167519' });
    S.vb = v;
  });

  it('calculates the month: prorated pay, unpaid days, sick bands, adjustments, GOSI; voucher bonus left out', async () => {
    await other.post('/api/hr/payroll', { month: M }, { expect: 403 });
    const r = await hr.post('/api/hr/payroll', { month: M });
    expect(r.status).toBe('draft');
    const line = r.lines.find((l: any) => l.employeeId === S.e.id);
    // 8100 package + 500 bonus; 2 unpaid days × 270; 200 deduction; GOSI 9.75 % × 7500
    expect(line).toMatchObject({ workedDays: 30, gross: '8600.00', bonuses: '500.00', unpaidLeave: '540.00', sickDeduction: '0.00', deductions: '200.00', gosi: '731.25', net: '7128.75' });
    expect(line.details.leaveDays).toEqual({ annual: 5, sick: 3, unpaid: 2 });
    expect(r.lines.some((l: any) => l.employeeId === S.m.id)).toBe(true);
    S.r = r;
  });

  it('needs a second person to approve; changed data is recalculated first; approval locks the month', async () => {
    await hr.post(`/api/hr/payroll/${S.r.id}/approve`, { expectedNet: S.r.net }, { expect: 403 });
    await gm.post(`/api/hr/payroll/${S.r.id}/approve`, { expectedNet: '1.00' }, { expect: 409 });
    const a = await gm.post(`/api/hr/payroll/${S.r.id}/approve`, { expectedNet: S.r.net });
    expect(a).toMatchObject({ status: 'approved', approvedByName: 'pay-gm' });
    await hr.post(`/api/hr/employees/${S.e.id}/adjustments`, { month: M, kind: 'bonus', amount: '5', reason: 'late' }, { expect: 409 });
    await hr.post(`/api/hr/leaves/${S.unpaid.id}/cancel`, { reason: 'x' }, { expect: 409 });
    await hr.post(`/api/hr/leaves/employee/${S.e.id}`, { type: 'unpaid', startDate: `${Y}-03-25`, endDate: `${Y}-03-25` }, { expect: 409 });
    await hr.post('/api/hr/payroll', { month: M }, { expect: 409 });
    await hr.req('DELETE', `/api/hr/payroll/${S.r.id}`, undefined, { expect: 409 });
  });

  it('marks it paid and exports the bank sheet', async () => {
    const p = await gm.post(`/api/hr/payroll/${S.r.id}/paid`, { date: `${Y}-04-01`, ref: 'WPS-1' });
    expect(p.status).toBe('paid');
    const csv = (await hr.get(`/api/hr/payroll/${S.r.id}/csv`, { raw: true })).toString('utf8');
    expect(csv).toContain('SA0380000000608010167519');
    expect(csv).toContain('7128.75');
  });

  it('deleting a voucher bonus cancels its draft voucher', async () => {
    await gm.req('DELETE', `/api/hr/employees/${S.e.id}/adjustments/${S.vb.id}`);
    expect((await gm.get(`/api/vouchers/${S.vb.voucherId}`)).status).toBe('cancelled');
  });
});
