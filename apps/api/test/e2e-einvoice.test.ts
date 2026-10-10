import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { decodeTlv, issueTestCertificate, makeTestIdentity, qrOf, verifySignedDocument, type FetchLike } from '@mmc/zatca';
import { riyadhDate } from '@mmc/domain';
import { ADMIN_SQL, Client, gotenbergUp, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Phase 6D — ZATCA Phase-2 e-invoicing inside Core. The gateway is played by an in-process fake that
 * issues certificates for the CSR it receives, verifies every document it is sent (hash, stamp, QR)
 * and refuses a repeated ICV / UUID / invoice number the way Fatoora does. The real engine is checked
 * against the official SDK separately (packages/zatca: scripts/sdk-validate.mjs).
 */
let base = '';
let owner: Client;
let acct: Client;
let rep: Client;
let pdfs = false;
const S: Record<string, any> = {};
const today = riyadhDate();

async function db<T>(fn: (t: any) => Promise<T>): Promise<T> {
  const sql = ADMIN_SQL();
  try {
    const [t] = await sql`select id from tenant limit 1`;
    let out!: T;
    await sql.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${t!.id}, true)`; out = await fn(tx); });
    return out;
  } finally { await sql.end(); }
}

// ───────────── the fake Fatoora gateway ─────────────
const ca = makeTestIdentity('E2E-ZATCA-CA');
const gw = {
  mode: 'ok' as 'ok' | 'down' | 'reject',
  calls: [] as { path: string; headers: Record<string, string>; body: any }[],
  csr: '',
  prodTokens: new Set<string>(),
  seen: { icv: new Set<string>(), uuid: new Set<string>(), number: new Set<string>() },
  accepted: [] as { path: string; xml: string }[],
};
const b64 = (s: string) => Buffer.from(s).toString('base64');
const certToken = (pem: string) => b64(pem.replace(/-----[^-]+-----|\s+/g, ''));
const reply = (status: number, json: unknown) => ({ status, json: async () => json });
const icvOf = (xml: string) => /<cbc:ID>ICV<\/cbc:ID>\s*<cbc:UUID>(\d+)</.exec(xml)?.[1] ?? '';

const gateway: FetchLike = async (url, init) => {
  const path = new URL(url).pathname.replace(/^.*\/e-invoicing\/(developer-portal|simulation|core)/, '');
  const body = init.body ? JSON.parse(init.body) : {};
  gw.calls.push({ path, headers: init.headers, body });
  if (gw.mode === 'down' && path.startsWith('/invoices/')) throw new Error('ECONNRESET');
  if (path === '/compliance') {
    gw.csr = Buffer.from(body.csr, 'base64').toString('utf8');
    return reply(200, { requestID: 1001, binarySecurityToken: certToken(issueTestCertificate(gw.csr, ca, 'E2E-COMPLIANCE')), secret: 'compliance-secret', dispositionMessage: 'ISSUED' });
  }
  if (path === '/compliance/invoices') {
    const v = verifySignedDocument(Buffer.from(body.invoice, 'base64').toString('utf8'));
    return v.ok ? reply(200, { reportingStatus: 'REPORTED', clearanceStatus: 'CLEARED', validationResults: { warningMessages: [], errorMessages: [] } })
      : reply(400, { validationResults: { errorMessages: v.problems.map((m) => ({ code: 'E2E-INVALID', message: m })) } });
  }
  if (path === '/production/csids') {
    const token = certToken(issueTestCertificate(gw.csr, ca, 'E2E-PRODUCTION'));
    gw.prodTokens.add(token);
    return reply(200, { requestID: 2002, binarySecurityToken: token, secret: 'production-secret' });
  }
  if (path.startsWith('/invoices/')) {
    const auth = init.headers.Authorization ?? '';
    if (![...gw.prodTokens].some((t) => auth === `Basic ${b64(`${t}:production-secret`)}`)) return reply(401, {});
    const xml = Buffer.from(body.invoice, 'base64').toString('utf8');
    const v = verifySignedDocument(xml);
    const dup = gw.seen.icv.has(icvOf(xml)) || gw.seen.uuid.has(body.uuid);
    if (gw.mode === 'reject' || !v.ok || dup || body.invoiceHash !== v.hashBase64) {
      return reply(400, { validationResults: { errorMessages: [{ code: dup ? 'KSA-DUPLICATE' : 'E2E-REJECTED', message: gw.mode === 'reject' ? 'rejected by the test gateway' : (v.problems.join('; ') || 'duplicate document') }] } });
    }
    gw.seen.icv.add(icvOf(xml));
    gw.seen.uuid.add(body.uuid);
    gw.accepted.push({ path, xml });
    if (path.endsWith('/clearance/single')) {
      if (init.headers['Clearance-Status'] !== '1') return reply(400, { validationResults: { errorMessages: [{ code: 'NO-CLEARANCE-HEADER', message: 'Clearance-Status header missing' }] } });
      return reply(200, { clearanceStatus: 'CLEARED', clearedInvoice: b64(xml.replace('</Invoice>', '<!-- ZATCA clearance stamp --></Invoice>')), validationResults: { warningMessages: [{ code: 'WARN-1', message: 'demo warning' }], errorMessages: [] } });
    }
    return reply(200, { reportingStatus: 'REPORTED', validationResults: { warningMessages: [], errorMessages: [] } });
  }
  return reply(404, {});
};

beforeAll(async () => {
  base = await startServer();
  pdfs = await gotenbergUp();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const invite = async (email: string, roleKeys: string[]) => {
    const users = await owner.get('/api/users');
    if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
    return signInOrUp(base, email);
  };
  acct = await invite('ei-acct@e2e.test', ['accountant']);
  rep = await invite('ei-rep@e2e.test', ['sales_rep']);
  S.company = await owner.get('/api/settings/company');
  const svc = await import('../src/modules/einvoice.service.js');
  svc.__setGatewayFetch(gateway);
  S.svc = svc;
});

afterAll(async () => {
  try {
    S.svc?.__setGatewayFetch(undefined);
    await owner.put('/api/einvoice/settings', { enabled: false, zeroRatedReason: null, zeroRatedReasonText: null, paymentMeansCode: null }, { expect: undefined }).catch(() => undefined);
    const c = S.company;
    if (c) await owner.put('/api/settings/company', { ...c, address: c.address, quoteDefaults: c.quoteDefaults, approvalPolicy: c.approvalPolicy });
    await db((t) => t`update einvoice_egs set status = 'revoked' where status <> 'revoked'`);
  } finally { await stopServer(); }
});

/** A VAT contract taken through the first advance (386) — returns the invoice mirror row. */
async function firstAdvance(partyId: string, label: string) {
  const q = await owner.post('/api/quotes', { partyId, clientName: label, clientPhone: '0551112233', discountType: 'amount', discountValue: '0', vatOn: true, lines: [{ code: 'SYS', description: 'نظام انتركوم', unitPrice: '2000', qty: '1' }] });
  await owner.post(`/api/quotes/${q.id}/submit`);
  const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
  await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
  const pr = await owner.post(`/api/finance/milestones/${c.milestones[0].id}/request`, { send: 'whatsapp' });
  await new Client(base).post(`/api/public/pay/${pr.publicToken}/sandbox`, {}, { expect: 200 });
  const bill = await owner.get(`/api/finance/contracts/${c.id}`);
  return { contract: c, invoice: bill.invoices.find((i: any) => i.typeCode === '386') };
}

describe('Readiness and onboarding', () => {
  it('is behind permissions and refuses to switch on before the company and an EGS unit are ready', async () => {
    await rep.get('/api/einvoice/status', { expect: 403 });
    await acct.get('/api/einvoice/status');
    await acct.post('/api/einvoice/units', { name: 'x', environment: 'simulation' }, { expect: 403 });
    const st = await owner.get('/api/einvoice/status');
    expect(st).toMatchObject({ enabled: false, ready: false });
    expect(st.checks.find((c: any) => c.key === 'unit').ok).toBe(false);
    await owner.put('/api/einvoice/settings', { enabled: true }, { expect: 400 });
  });

  it('completes the company identity, then runs unit → CSR + OTP → compliance → production', async () => {
    const co = S.company;
    await owner.put('/api/settings/company', {
      ...co, vatRegistered: true, vatNumber: '399999999900003', crNumber: '1010010000', bankName: 'مصرف الراجحي', iban: 'SA0380000000608010167519',
      address: { buildingNumber: '2322', street: 'الأمير سلطان', district: 'المربع', city: 'الرياض', postalCode: '23333', additionalNumber: '9999', country: 'SA' },
      quoteDefaults: co.quoteDefaults, approvalPolicy: co.approvalPolicy,
    });
    const u = await owner.post('/api/einvoice/units', { name: 'المركز الرئيسي', environment: 'simulation' });
    S.unit = u;
    expect(u).toMatchObject({ status: 'draft', icvCounter: 0, hasKey: false });
    expect(u.serial).toMatch(/^1-MMCCore\|2-ERP\|3-/);
    // compliance cannot be skipped
    await owner.post(`/api/einvoice/units/${u.id}/production`, {}, { expect: 400 });
    await owner.post(`/api/einvoice/units/${u.id}/compliance`, {}, { expect: 400 });

    await owner.post(`/api/einvoice/units/${u.id}/otp`, { otp: 'abc' }, { expect: 400 });
    const o = await owner.post(`/api/einvoice/units/${u.id}/otp`, { otp: '123456' });
    expect(o).toMatchObject({ status: 'compliance_csid', requestId: '1001' });
    expect(gw.calls.find((c) => c.path === '/compliance')!.headers.OTP).toBe('123456');

    const comp = await owner.post(`/api/einvoice/units/${u.id}/compliance`, {});
    expect(comp.passed).toBe(true);
    expect(comp.results).toHaveLength(6);
    expect(comp.results.map((r: any) => `${r.subtype}/${r.kind}`).sort()).toEqual(['simplified/credit', 'simplified/debit', 'simplified/invoice', 'standard/credit', 'standard/debit', 'standard/invoice']);

    const live = await owner.post(`/api/einvoice/units/${u.id}/production`, {});
    expect(live.requestId).toBe('2002');
    const st = await owner.get('/api/einvoice/status');
    const unit = st.units.find((x: any) => x.id === u.id);
    expect(unit).toMatchObject({ status: 'production', icvCounter: 0, hasProductionCsid: true });
    expect(JSON.stringify(st)).not.toMatch(/production-secret|compliance-secret|BEGIN EC|PRIVATE KEY/);
    // the key and the credentials are sealed at rest
    const raw = await db((t) => t`select private_key_enc, csid_enc, csid_secret_enc from einvoice_egs where id = ${u.id}`);
    for (const v of Object.values(raw[0]) as string[]) expect(v.startsWith('v1:')).toBe(true);
    expect(raw[0].private_key_enc).not.toContain('PRIVATE KEY');
  });

  it('only one unit can be live at a time and the flag needs zero-rating details only when used', async () => {
    const u2 = await owner.post('/api/einvoice/units', { name: 'فرع ثانٍ', environment: 'simulation' });
    await owner.post(`/api/einvoice/units/${u2.id}/otp`, { otp: '654321' });
    await owner.post(`/api/einvoice/units/${u2.id}/compliance`, {});
    await owner.post(`/api/einvoice/units/${u2.id}/production`, {}, { expect: 409 });
    await owner.post(`/api/einvoice/units/${u2.id}/revoke`, { reason: 'اختبار — وحدة غير مطلوبة' });
    const on = await owner.put('/api/einvoice/settings', { enabled: true, paymentMeansCode: '30' });
    expect(on).toMatchObject({ enabled: true });
    // the sandbox rehearsal needs no unit and writes nothing
    const t = await owner.post('/api/einvoice/self-test', {});
    expect(t).toMatchObject({ environment: 'sandbox', passed: true, productionCsid: true });
  });
});

describe('Issuing, chain and clearance', () => {
  it('signs a document for every invoice, in a gapless ICV / PIH chain', async () => {
    if (!pdfs) return;
    const p = await owner.post('/api/parties', {
      nameAr: 'شركة الفوترة الإلكترونية', vatNumber: '311222333400003', b2b: true, contacts: [{ name: 'سالم', mobile: '0551112233', isPrimary: true }],
      sites: [{ type: 'billing', name: 'المقر', buildingNumber: '1111', street: 'صلاح الدين', district: 'المروج', city: 'الرياض', postalCode: '12222', additionalNumber: '1234' }],
    });
    S.party = p;
    const q = await owner.post('/api/quotes', { partyId: p.id, clientName: p.nameAr, clientPhone: '0551112233', discountType: 'amount', discountValue: '0', vatOn: true, lines: [{ code: 'SYS', description: 'نظام انتركوم', unitPrice: '10000', qty: '1' }] });
    await owner.post(`/api/quotes/${q.id}/submit`);
    const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
    await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
    const [m1, m2, m3] = c.milestones;
    const pr1 = await owner.post(`/api/finance/milestones/${m1.id}/request`, { send: 'whatsapp' });
    await new Client(base).post(`/api/public/pay/${pr1.publicToken}/sandbox`, {}, { expect: 200 });
    const pr2 = await owner.post(`/api/finance/milestones/${m2.id}/request`, {});
    await owner.post(`/api/finance/payment-requests/${pr2.id}/payments`, { amount: '4600.00', paidOn: today, method: 'bank_transfer', reference: 'EI-TRX-2' });
    const pr3 = await owner.post(`/api/finance/milestones/${m3.id}/request`, {});
    await owner.post(`/api/finance/payment-requests/${pr3.id}/payments`, { amount: '1150.00', paidOn: today, method: 'mada', reference: 'EI-POS-9' });

    const bill = await owner.get(`/api/finance/contracts/${c.id}`);
    S.inv386 = bill.invoices.filter((i: any) => i.typeCode === '386');
    S.inv388 = bill.invoices.find((i: any) => i.typeCode === '388');
    expect(S.inv386).toHaveLength(2);
    // the mirror carries the Phase-2 identity right away
    for (const i of [...S.inv386, S.inv388]) expect(i.zatcaStatus).toBe('pending');

    const docs = await owner.get('/api/einvoice/documents?limit=50');
    const mine = docs.rows.filter((d: any) => [...S.inv386, S.inv388].some((i: any) => i.id === d.invoiceId)).sort((a: any, b: any) => a.icv - b.icv);
    expect(mine.map((d: any) => d.typeCode)).toEqual(['386', '386', '388']);
    expect(mine.map((d: any) => d.icv)).toEqual([1, 2, 3]);
    expect(mine.every((d: any) => d.status === 'pending' && d.submission === 'clearance' && d.subtype === 'standard')).toBe(true);
    S.docs = mine;

    const verify = await owner.get('/api/einvoice/verify');
    expect(verify).toMatchObject({ ok: true, checked: 3 });
  });

  it('carries the advances on the final invoice exactly as ZATCA expects', async () => {
    if (!pdfs) return;
    const xml = (await owner.get(`/api/einvoice/documents/${S.docs[2].id}/xml`, { raw: true })).toString('utf8');
    expect(xml.match(/<cbc:DocumentTypeCode>386<\/cbc:DocumentTypeCode>/g)).toHaveLength(2);
    expect(xml).toContain('<cbc:PrepaidAmount currencyID="SAR">10350.00</cbc:PrepaidAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">11500.00</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">1150.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>');
    // each advance is referenced by its own number and its own UUID
    for (const a of S.inv386) expect(xml).toContain(`<cbc:ID>${a.number}</cbc:ID>`);
    const adv = await owner.get(`/api/einvoice/documents/${S.docs[0].id}`);
    expect(xml).toContain(`<cbc:UUID>${adv.uuid}</cbc:UUID>`);
    // the QR printed on the invoice is the signed document's QR, tags 1–8 for a standard invoice
    const mirror = (await owner.get(`/api/finance/invoices?q=${S.inv388.number}`))[0];
    expect(mirror.qrPayload).toBe(qrOf(xml));
    const tags = decodeTlv(mirror.qrPayload);
    expect(tags[1]!.toString('utf8')).toBeTruthy();
    expect(tags[2]!.toString('utf8')).toBe('399999999900003');
    expect(tags[4]!.toString('utf8')).toBe('11500.00');
    expect(tags[5]!.toString('utf8')).toBe('1500.00');
    expect(Object.keys(tags).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('does not let a standard invoice be shared until ZATCA has cleared it', async () => {
    if (!pdfs) return;
    await owner.get(`/api/finance/invoices/${S.inv388.id}/pdf`, { expect: 409 });
    // the office archive copy is still available
    const pdf = await owner.get(`/api/einvoice/documents/${S.docs[2].id}/pdf`, { raw: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.includes(Buffer.from('EmbeddedFile'))).toBe(true);
    expect(pdf.includes(Buffer.from('pdfaid'))).toBe(true);
  });

  it('clears the documents in ICV order and replaces the printed QR with the stamped one', async () => {
    if (!pdfs) return;
    const r = await owner.post('/api/einvoice/submit', {});
    expect(r).toMatchObject({ attempted: 3, cleared: 3, rejected: 0, failed: 0 });
    const order = gw.accepted.slice(-3).map((a) => icvOf(a.xml));
    expect(order).toEqual(['1', '2', '3']);
    const d = await owner.get(`/api/einvoice/documents/${S.docs[2].id}`);
    expect(d).toMatchObject({ status: 'cleared', attempts: 1, hasClearedXml: true });
    expect(d.zatcaResponse.warnings[0].code).toBe('WARN-1');
    const cleared = (await owner.get(`/api/einvoice/documents/${S.docs[2].id}/xml`, { raw: true })).toString('utf8');
    expect(cleared).toContain('ZATCA clearance stamp');
    const signed = (await owner.get(`/api/einvoice/documents/${S.docs[2].id}/xml?version=signed`, { raw: true })).toString('utf8');
    expect(signed).not.toContain('ZATCA clearance stamp');
    const mirror = (await owner.get(`/api/finance/invoices?q=${S.inv388.number}`))[0];
    expect(mirror.zatcaStatus).toBe('cleared');
    // cleared → it may be shared
    const pdf = await owner.get(`/api/finance/invoices/${S.inv388.id}/pdf`, { raw: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    // nothing left to send
    expect(await owner.post('/api/einvoice/submit', {})).toMatchObject({ attempted: 0 });
  });

  it('credit notes reference the invoice and carry the reason; reporting vs clearance follows the subtype', async () => {
    if (!pdfs) return;
    const cn = await owner.post(`/api/finance/invoices/${S.inv388.id}/credit-note`, { reason: 'خصم لاحق متفق عليه', amount: '115.00' });
    S.cn = cn;
    const doc = (await owner.get('/api/einvoice/documents?limit=50')).rows.find((d: any) => d.invoiceId === cn.id);
    expect(doc).toMatchObject({ typeCode: '381', icv: 4, status: 'pending', submission: 'clearance' });
    const xml = (await owner.get(`/api/einvoice/documents/${doc.id}/xml`, { raw: true })).toString('utf8');
    expect(xml).toContain('>381</cbc:InvoiceTypeCode>');
    expect(xml).toMatch(new RegExp(`<cac:InvoiceDocumentReference>\\s*<cbc:ID>${S.inv388.number}</cbc:ID>`));
    expect(xml).toContain('<cbc:InstructionNote>خصم لاحق متفق عليه</cbc:InstructionNote>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">115.00</cbc:PayableAmount>'); // amounts are positive on a credit note
    expect(await owner.post('/api/einvoice/submit', {})).toMatchObject({ cleared: 1 });
  });

  it('keeps the chain when ZATCA is unreachable and when a document is rejected', async () => {
    if (!pdfs) return;
    gw.mode = 'down';
    const a = await owner.post(`/api/finance/invoices/${S.inv388.id}/credit-note`, { reason: 'تصحيح كمية 1', amount: '23.00' });
    const b = await owner.post(`/api/finance/invoices/${S.inv388.id}/credit-note`, { reason: 'تصحيح كمية 2', amount: '34.50' });
    const down = await owner.post('/api/einvoice/submit', {});
    expect(down).toMatchObject({ attempted: 1, failed: 1, cleared: 0 });
    expect(down.stoppedBy).toMatch(/unreachable/);
    let list = (await owner.get('/api/einvoice/documents?limit=50')).rows;
    expect(list.find((d: any) => d.invoiceId === a.id)).toMatchObject({ status: 'error', attempts: 1 });
    expect(list.find((d: any) => d.invoiceId === b.id)).toMatchObject({ status: 'pending' });

    gw.mode = 'reject';
    const rej = await owner.post('/api/einvoice/submit', {});
    expect(rej).toMatchObject({ rejected: 2, cleared: 0 });
    list = (await owner.get('/api/einvoice/documents?limit=50')).rows;
    const dA = list.find((d: any) => d.invoiceId === a.id);
    expect(dA).toMatchObject({ status: 'rejected' });
    expect(dA.lastError).toMatch(/rejected by the test gateway/);
    expect((await owner.get(`/api/finance/invoices?q=${a.number}`))[0].zatcaStatus).toBe('rejected');

    // fixed → re-issued as a NEW document (next ICV, new UUID) and cleared; the rejected one stays in the chain
    gw.mode = 'ok';
    const re = await owner.post(`/api/einvoice/documents/${dA.id}/reissue`, {});
    expect(re).toMatchObject({ status: 'issued', icv: 7 });
    await owner.post(`/api/einvoice/documents/${list.find((d: any) => d.invoiceId === b.id).id}/reissue`, {});
    expect(await owner.post('/api/einvoice/submit', {})).toMatchObject({ cleared: 2, rejected: 0 });
    const fresh = (await owner.get('/api/einvoice/documents?limit=50')).rows.filter((d: any) => d.invoiceId === a.id);
    expect(fresh).toHaveLength(1); // superseded rows are hidden from the register …
    expect(fresh[0]).toMatchObject({ status: 'cleared', icv: 7 });
    expect(await owner.get('/api/einvoice/verify')).toMatchObject({ ok: true, checked: 8, problems: [] }); // … but still in the chain
  });

  it('issues ICVs without gaps under concurrency', async () => {
    if (!pdfs) return;
    const before = (await owner.get('/api/einvoice/status')).units.find((u: any) => u.status === 'production').icvCounter;
    await Promise.all([1, 2, 3, 4].map((n) => owner.post(`/api/finance/invoices/${S.inv388.id}/credit-note`, { reason: `تصحيح متزامن ${n}`, amount: `${10 + n}.00` })));
    const after = (await owner.get('/api/einvoice/status')).units.find((u: any) => u.status === 'production').icvCounter;
    expect(after).toBe(before + 4);
    expect(await owner.get('/api/einvoice/verify')).toMatchObject({ ok: true, checked: after });
    expect(await owner.post('/api/einvoice/submit', {})).toMatchObject({ cleared: 4, failed: 0 });
  });
});

describe('Blocked invoices and simplified invoices', () => {
  it('holds an invoice whose customer data ZATCA would refuse, then issues it once fixed', async () => {
    if (!pdfs) return;
    const p = await owner.post('/api/parties', {
      nameAr: 'عميل بعنوان ناقص', vatNumber: '322222222200003', b2b: true, contacts: [{ name: 'خالد', mobile: '0552223344', isPrimary: true }],
      sites: [{ type: 'billing', name: 'الفوترة', city: 'جدة' }],
    });
    const { invoice } = await firstAdvance(p.id, p.nameAr);
    // the back office's Phase-1 "cleared" and QR must not survive on an invoice that has no signed document
    expect(invoice.zatcaStatus).toBe('error');
    expect(invoice.qrPayload).toBeNull();
    await owner.get(`/api/finance/invoices/${invoice.id}/pdf`, { expect: 409 });
    const blocked = await owner.get('/api/einvoice/blocked');
    const mine = blocked.find((b: any) => b.id === invoice.id);
    expect(mine.error).toMatch(/billing street is missing/);
    expect(mine.error).toMatch(/building number must be 4 digits/);
    expect(mine.error).toMatch(/postal code must be 5 digits/);
    const none = (await owner.get('/api/einvoice/documents?limit=200')).rows.find((d: any) => d.invoiceId === invoice.id);
    expect(none).toBeUndefined();
    // still blocked while the data is incomplete
    expect((await owner.post('/api/einvoice/issue-missing', {})).issued).toBe(0);
    // fix the billing address
    const [site] = await db((t) => t`select id from site where party_id = ${p.id} and type = 'billing'`);
    await owner.put(`/api/parties/${p.id}/sites/${site.id}`, { type: 'billing', name: 'الفوترة', buildingNumber: '2222', street: 'التحلية', district: 'الروضة', city: 'جدة', postalCode: '23434', additionalNumber: '4321' });
    const r = await owner.post('/api/einvoice/issue-missing', {});
    expect(r.issued).toBeGreaterThanOrEqual(1);
    const doc = (await owner.get('/api/einvoice/documents?limit=200')).rows.find((d: any) => d.invoiceId === invoice.id);
    expect(doc).toMatchObject({ typeCode: '386', status: 'pending' });
    expect((await owner.get('/api/einvoice/blocked')).find((b: any) => b.id === invoice.id)).toBeUndefined();
  });

  it('reports a simplified (B2C) invoice and carries tag 9 in its QR', async () => {
    if (!pdfs) return;
    const p = await owner.post('/api/parties', { nameAr: 'عميل فرد', b2b: false, kind: 'individual', contacts: [{ name: 'عميل فرد', mobile: '0553334455', isPrimary: true }] });
    const { invoice } = await firstAdvance(p.id, p.nameAr);
    const doc = (await owner.get('/api/einvoice/documents?limit=200')).rows.find((d: any) => d.invoiceId === invoice.id);
    expect(doc).toMatchObject({ subtype: 'simplified', submission: 'reporting' });
    const r = await owner.post('/api/einvoice/submit', {});
    expect(r.reported).toBeGreaterThanOrEqual(1);
    const d = await owner.get(`/api/einvoice/documents/${doc.id}`);
    expect(d.status).toBe('reported');
    expect(Object.keys(decodeTlv(d.qr)).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // a simplified invoice is not held back from the customer
    expect((await owner.get(`/api/finance/invoices?q=${invoice.number}`))[0].zatcaStatus).toBe('reported');
  });
});

describe('Integrity', () => {
  it('makes signed documents immutable at the database level and the counter monotonic', async () => {
    if (!pdfs) return;
    const unit = (await owner.get('/api/einvoice/status')).units.find((u: any) => u.status === 'production');
    await expect(db((t) => t`update einvoice_document set xml = 'tampered' where icv = 1`)).rejects.toThrow(/immutable/);
    await expect(db((t) => t`update einvoice_document set invoice_hash = 'x' where icv = 1`)).rejects.toThrow(/immutable/);
    await expect(db((t) => t`delete from einvoice_document where icv = 1`)).rejects.toThrow(/cannot be deleted/);
    await expect(db((t) => t`update einvoice_egs set icv_counter = 0 where id = ${unit.id}`)).rejects.toThrow(/backwards/);
    await expect(db((t) => t`delete from einvoice_egs where id = ${unit.id}`)).rejects.toThrow(/cannot be deleted/);
    // the submission outcome is the only thing that moves
    await db((t) => t`update einvoice_document set last_error = null where icv = 1`);
  });

  it('puts the register and the XML documents in the auditor pack', async () => {
    if (!pdfs) return;
    const buf = await owner.get(`/api/accounting/auditor-pack?start=${today.slice(0, 4)}-01-01`, { raw: true });
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    expect(names).toContain('19-einvoice-register.xlsx');
    const xmls = names.filter((n) => n.startsWith('einvoice-xml/'));
    expect(xmls.length).toBeGreaterThanOrEqual(10);
    expect(xmls.some((n) => n.endsWith('-cleared.xml'))).toBe(true);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.files.filter((f: any) => f.file.startsWith('einvoice-xml/')).every((f: any) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
  });

  it('switches off cleanly: nothing new is signed while the flag is down', async () => {
    if (!pdfs) return;
    await owner.put('/api/einvoice/settings', { enabled: false });
    const before = (await owner.get('/api/einvoice/status')).units.find((u: any) => u.status === 'production').icvCounter;
    const cn = await owner.post(`/api/finance/invoices/${S.inv388.id}/credit-note`, { reason: 'بعد إيقاف الفوترة الإلكترونية', amount: '10.00' });
    const after = (await owner.get('/api/einvoice/status')).units.find((u: any) => u.status === 'production').icvCounter;
    expect(after).toBe(before);
    expect((await owner.get('/api/einvoice/documents?limit=200')).rows.find((d: any) => d.invoiceId === cn.id)).toBeUndefined();
  });
});
