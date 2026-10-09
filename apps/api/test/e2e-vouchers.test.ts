import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { riyadhDate } from '@mmc/domain';
import { Client, gotenbergUp, signInOrUp, startServer, stopServer } from './helpers.js';

/** Cash vouchers (سند صرف / سند قبض): numbering, the second-person stamp, locking, cancelling and the PDF. */
let base = '';
let owner: Client;
let gm: Client;
let acct: Client;
let rep: Client;
let pdfs = false;
const S: Record<string, any> = {};
const today = riyadhDate();

const payment = (over: Record<string, unknown> = {}) => ({
  kind: 'payment', voucherDate: today, counterpartyName: 'محمد العامل', counterpartyMobile: '0551112222', amount: '1250.50',
  purpose: 'أجور تركيب — فيلا الرجاء', method: 'cash', ...over,
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
  gm = await invite('cv-gm@e2e.test', ['general_manager']);
  acct = await invite('cv-acct@e2e.test', ['accountant']);
  rep = await invite('cv-rep@e2e.test', ['sales_rep']);
});

afterAll(async () => { await stopServer(); });

describe('Cash vouchers', () => {
  it('lets finance enter drafts with their own number series; others are refused', async () => {
    await rep.post('/api/vouchers', payment(), { expect: 403 });
    await rep.get('/api/vouchers', { expect: 403 });
    const v = await acct.post('/api/vouchers', payment());
    expect(v).toMatchObject({ kind: 'payment', status: 'draft', amount: '1250.50', approvedBy: null });
    expect(v.number).toMatch(/^PV-\d{5}$/);
    const r = await acct.post('/api/vouchers', payment({ kind: 'receipt', counterpartyName: 'شركة درة الزمرد', amount: '5000', method: 'transfer', methodRef: 'TRX-889', bankName: 'الراجحي' }));
    expect(r.number).toMatch(/^RV-\d{5}$/);
    await acct.post('/api/vouchers', payment({ amount: '0' }), { expect: 400 });
    await acct.post('/api/vouchers', payment({ voucherDate: '2999-01-01' }), { expect: 400 });
    S.v = v;
    S.r = r;
  });

  it('edits drafts with optimistic locking', async () => {
    const e = await acct.put(`/api/vouchers/${S.v.id}`, { ...payment({ amount: '1300' }), version: S.v.version });
    expect(e).toMatchObject({ amount: '1300.00', version: S.v.version + 1 });
    await acct.put(`/api/vouchers/${S.v.id}`, { ...payment(), version: S.v.version }, { expect: 409 });
    await acct.put(`/api/vouchers/${S.v.id}`, { ...payment({ kind: 'receipt' }), version: e.version }, { expect: 400 });
    S.v = e;
  });

  it('needs a second person with voucher.approve to stamp it, then locks it', async () => {
    await acct.post(`/api/vouchers/${S.v.id}/approve`, {}, { expect: 403 });
    const a = await gm.post(`/api/vouchers/${S.v.id}/approve`, {});
    expect(a).toMatchObject({ status: 'approved', approvedByName: 'cv-gm' });
    expect(a.approvedAt).toBeTruthy();
    await gm.post(`/api/vouchers/${S.v.id}/approve`, {}, { expect: 409 });
    await acct.put(`/api/vouchers/${S.v.id}`, { ...payment(), version: a.version }, { expect: 409 });

    const own = await gm.post('/api/vouchers', payment({ amount: '75' }));
    await gm.post(`/api/vouchers/${own.id}/approve`, {}, { expect: 403 }); // not their own
    expect((await owner.post(`/api/vouchers/${own.id}/approve`, {})).status).toBe('approved');
    const ownerOwn = await owner.post('/api/vouchers', payment({ amount: '10' }));
    expect((await owner.post(`/api/vouchers/${ownerOwn.id}/approve`, {})).status).toBe('approved'); // the owner may stamp their own
  });

  it('cancels with a reason; approved vouchers only by an approver', async () => {
    await acct.post(`/api/vouchers/${S.v.id}/cancel`, { reason: 'خطأ' }, { expect: 403 });
    await gm.post(`/api/vouchers/${S.v.id}/cancel`, {}, { expect: 400 });
    const c = await gm.post(`/api/vouchers/${S.v.id}/cancel`, { reason: 'مكرر' });
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'مكرر' });
    await gm.post(`/api/vouchers/${S.v.id}/cancel`, { reason: 'x' }, { expect: 409 });
    expect((await acct.post(`/api/vouchers/${S.r.id}/cancel`, { reason: 'أُدخل بالخطأ' })).status).toBe('cancelled'); // draft: the editor may cancel
  });

  it('lists with filters and approved totals', async () => {
    const all = await acct.get('/api/vouchers?kind=payment');
    expect(all.rows.every((r: any) => r.kind === 'payment')).toBe(true);
    expect(Number(all.summary.paid)).toBeGreaterThanOrEqual(85); // 75 + 10 approved; the cancelled 1300 doesn't count
    const found = await acct.get(`/api/vouchers?q=${encodeURIComponent(S.v.number)}`);
    expect(found.rows.map((r: any) => r.id)).toEqual([S.v.id]);
    expect((await acct.get('/api/vouchers?status=cancelled')).rows.some((r: any) => r.id === S.r.id)).toBe(true);
  });

  it('prints the voucher as a PDF', async () => {
    if (!pdfs) return;
    const pdf = await acct.get(`/api/vouchers/${S.v.id}/pdf`, { raw: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('cleans an uploaded stamp: paper background made transparent, margin trimmed', async () => {
    const before = (await owner.get('/api/settings/company')).stampFileId;
    // a blue ring on off-white paper with a wide margin, as a JPEG
    const ring = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#f4f4f2"/><circle cx="200" cy="200" r="100" fill="none" stroke="#1f5fae" stroke-width="14"/></svg>');
    const jpeg = await sharp(ring).jpeg().toBuffer();
    const { fileId } = await owner.post('/api/settings/company/stamp', { filename: 'stamp.jpg', mime: 'image/jpeg', dataBase64: jpeg.toString('base64') });
    const png = await owner.get(`/api/files/${fileId}`, { raw: true });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(info.width).toBeLessThan(230); // 400 → ~214 after trimming the margin
    expect(data[3]).toBe(0); // top-left corner transparent
    const mid = (Math.floor(info.height / 2) * info.width + 3) * 4; // on the ring's left edge
    expect(data[mid + 3]).toBeGreaterThan(200);
    if (before) await owner.post('/api/settings/company/stamp', { filename: 'stamp.png', mime: 'image/png', dataBase64: (await owner.get(`/api/files/${before}`, { raw: true })).toString('base64') });
  });
});
