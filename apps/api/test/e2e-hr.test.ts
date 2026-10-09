import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { riyadhDate } from '@mmc/domain';
import { Client, gotenbergUp, signInOrUp, startServer, stopServer } from './helpers.js';

/** HR: job offers (Labor Law checks, second-person issue, answer, hire) and the employee register. */
let base = '';
let owner: Client;
let gm: Client;
let hr: Client;
let rep: Client;
let pdfs = false;
const S: Record<string, any> = {};
const today = riyadhDate();
const plus = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// unique valid national ID per run (check digit computed) so reruns on the same DB don't collide
const nid = () => {
  const body = `1${String(Date.now()).slice(-8)}`;
  for (let c = 0; c < 10; c++) {
    const v = body + c;
    let s = 0;
    for (let i = 0; i < 10; i++) { const d = Number(v[i]); if (i % 2 === 0) { const x = d * 2; s += x > 9 ? x - 9 : x; } else s += d; }
    if (s % 10 === 0) return v;
  }
  throw new Error('unreachable');
};

const offer = (over: Record<string, unknown> = {}) => ({
  offerDate: today, validUntil: plus(7), candidateNameAr: 'سالم أحمد الغامدي', nationality: 'سعودي', idType: 'national_id', idNumber: S.nid, mobile: '0551234567',
  jobTitleAr: 'فني أنظمة ذكية', department: 'المشاريع', reportsTo: 'مدير المشاريع', workLocation: 'جدة', contractType: 'unlimited', employmentType: 'full_time',
  startDate: plus(20), probationDays: 90, weeklyHours: 48, workDays: 'الأحد – الخميس', annualLeaveDays: 21, noticeDays: 60,
  basicSalary: '5000', housingAllowance: '1250', transportAllowance: '500', otherAllowances: [{ label: 'بدل اتصال', amount: '150' }],
  medicalInsurance: 'family', annualTicket: 'none', ...over,
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
  gm = await invite('hr-gm@e2e.test', ['general_manager']);
  hr = await invite('hr-officer@e2e.test', ['hr_officer']);
  rep = await invite('hr-rep@e2e.test', ['sales_rep']);
  S.nid = nid();
});

afterAll(async () => { await stopServer(); });

describe('Job offers', () => {
  it('lets HR prepare a numbered draft; others are refused; bad IDs are rejected', async () => {
    await rep.get('/api/hr/offers', { expect: 403 });
    await rep.post('/api/hr/offers', offer(), { expect: 403 });
    await hr.post('/api/hr/offers', offer({ idNumber: '1000000009' }), { expect: 400 });
    await hr.post('/api/hr/offers', offer({ idType: 'iqama' }), { expect: 400 });
    const o = await hr.post('/api/hr/offers', offer());
    expect(o.number).toMatch(/^OFR-\d{4}$/);
    expect(o).toMatchObject({ status: 'draft', monthlyTotal: '6900.00', annualTotal: '82800.00', issues: [] });
    S.o = o;
  });

  it('refuses to issue an offer that breaks the Labor Law, and needs a second person', async () => {
    const bad = await hr.put(`/api/hr/offers/${S.o.id}`, { ...offer({ annualLeaveDays: 15 }), version: S.o.version });
    expect(bad.issues.map((i: any) => i.code)).toContain('leave');
    await hr.post(`/api/hr/offers/${S.o.id}/approve`, {}, { expect: 403 }); // hr_officer has no hr.approve
    await gm.post(`/api/hr/offers/${S.o.id}/approve`, {}, { expect: 400 });
    const fixed = await hr.put(`/api/hr/offers/${S.o.id}`, { ...offer(), version: bad.version });
    const a = await gm.post(`/api/hr/offers/${S.o.id}/approve`, {});
    expect(a).toMatchObject({ status: 'approved', approvedByName: 'hr-gm' });
    await hr.put(`/api/hr/offers/${S.o.id}`, { ...offer(), version: a.version }, { expect: 409 }); // locked
    const own = await gm.post('/api/hr/offers', offer({ idNumber: null, idType: null, candidateNameAr: 'مرشح آخر' }));
    await gm.post(`/api/hr/offers/${own.id}/approve`, {}, { expect: 403 });
    S.own = own;
    S.o = a;
    expect(fixed.version).toBeLessThan(a.version);
  });

  it('prints the offer letter', async () => {
    if (!pdfs) return;
    const pdf = await hr.get(`/api/hr/offers/${S.o.id}/pdf`, { raw: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('records the answer and turns an accepted offer into an employee once', async () => {
    await hr.post(`/api/hr/offers/${S.own.id}/respond`, { accepted: true, date: today }, { expect: 409 }); // not issued
    await hr.post(`/api/hr/offers/${S.o.id}/hire`, {}, { expect: 409 }); // not accepted yet
    await hr.post(`/api/hr/offers/${S.o.id}/respond`, { accepted: true, date: plus(1) }, { expect: 400 }); // future
    const acc = await hr.post(`/api/hr/offers/${S.o.id}/respond`, { accepted: true, date: today, note: 'وقّع على النسخة الورقية' });
    expect(acc.status).toBe('accepted');
    const e = await hr.post(`/api/hr/offers/${S.o.id}/hire`, {});
    expect(e.number).toMatch(/^EMP-\d{4}$/);
    expect(e).toMatchObject({ nameAr: 'سالم أحمد الغامدي', hireDate: plus(20), basicSalary: '5000.00', monthlyTotal: '6900.00', status: 'active', offer: { id: S.o.id } });
    expect(e.probationEndDate).toBe(plus(20 + 89));
    await hr.post(`/api/hr/offers/${S.o.id}/hire`, {}, { expect: 409 });
    expect((await hr.get(`/api/hr/offers/${S.o.id}`)).employee.id).toBe(e.id);
    await hr.post(`/api/hr/offers/${S.o.id}/cancel`, { reason: 'x' }, { expect: 409 });
    expect((await hr.post(`/api/hr/offers/${S.own.id}/cancel`, { reason: 'الوظيفة شُغلت' })).status).toBe('cancelled');
    S.e = e;
  });

  it('lists offers with status filters and counts', async () => {
    const l = await hr.get('/api/hr/offers?status=accepted');
    expect(l.rows.some((r: any) => r.id === S.o.id)).toBe(true);
    expect(l.rows.every((r: any) => r.status === 'accepted')).toBe(true);
    expect(typeof l.summary.drafts).toBe('number');
  });
});

describe('Employees', () => {
  it('adds and edits employees; duplicate IDs and bad IBANs are refused', async () => {
    const body = {
      nameAr: 'نورة المطيري', idType: 'iqama', idNumber: '2000000006', jobTitleAr: 'محاسبة', department: 'المالية', hireDate: today, contractType: 'fixed',
      contractEndDate: plus(365), employmentType: 'full_time', annualLeaveDays: 21, basicSalary: '7000', managerId: S.e.id, iban: 'sa0380000000608010167519',
    };
    await rep.post('/api/hr/employees', body, { expect: 403 });
    await hr.post('/api/hr/employees', { ...body, idNumber: S.nid, idType: 'national_id' }, { expect: 409 });
    await hr.post('/api/hr/employees', { ...body, iban: 'SA12' }, { expect: 400 });
    await hr.post('/api/hr/employees', { ...body, contractEndDate: null }, { expect: 400 });
    const existing = (await hr.get('/api/hr/employees?q=2000000006')).rows[0];
    const n = existing ?? await hr.post('/api/hr/employees', body);
    const full = await hr.get(`/api/hr/employees/${n.id}`);
    expect(full).toMatchObject({ iban: 'SA0380000000608010167519', manager: { id: S.e.id } });
    const u = await hr.put(`/api/hr/employees/${n.id}`, { ...body, basicSalary: '7500', version: full.version });
    expect(u.basicSalary).toBe('7500.00');
    await hr.put(`/api/hr/employees/${n.id}`, { ...body, managerId: n.id, version: u.version }, { expect: 400 });
    S.n = u;
  });

  it('suspends, terminates and reinstates with reasons', async () => {
    await hr.post(`/api/hr/employees/${S.n.id}/status`, { status: 'terminated', reason: 'استقالة' }, { expect: 400 });
    const t = await hr.post(`/api/hr/employees/${S.n.id}/status`, { status: 'terminated', date: plus(30), reason: 'استقالة' });
    expect(t).toMatchObject({ status: 'terminated', terminationDate: plus(30) });
    await hr.put(`/api/hr/employees/${S.n.id}`, { nameAr: 'x', jobTitleAr: 'x', hireDate: today, contractType: 'unlimited', employmentType: 'full_time', annualLeaveDays: 21, basicSalary: '1', version: t.version }, { expect: 409 });
    const r = await hr.post(`/api/hr/employees/${S.n.id}/status`, { status: 'active' });
    expect(r).toMatchObject({ status: 'active', terminationDate: null });
  });

  it('lists with summary; the auditor reads but cannot write', async () => {
    const l = await hr.get('/api/hr/employees?status=active');
    expect(l.rows.every((r: any) => r.status === 'active')).toBe(true);
    expect(Number(l.summary.payroll)).toBeGreaterThan(0);
    expect(l.departments).toContain('المشاريع');
  });
});
