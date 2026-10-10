import { execFileSync } from 'node:child_process';
import { createPublicKey, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GENESIS_PIH, buildInvoiceQr, buildSignedDocument, buildUbl, certificateFromToken, createFatooraClient, decodeTlv, docTotals, egsSerial, generateCsr,
  interpret, invoiceHash, makeTestIdentity, money, qrOf, tlv, verifySignedDocument, ZatcaRejection, ZatcaTransportError, type EInvoiceDoc,
} from '../src/index.js';

const id = makeTestIdentity();
const seller = { name: 'شركة المدى المبارك', vatNumber: '399999999900003', crn: '1010010000', address: { street: 'Prince Sultan', buildingNumber: '2322', district: 'Al-Murabba', city: 'Riyadh', postalCode: '23333' } };
const buyer = { name: 'Fatoora Samples LTD', vatNumber: '399999999800003', address: { street: 'Salah Al-Din', buildingNumber: '1111', district: 'Al-Murooj', city: 'Riyadh', postalCode: '12222' } };
const doc = (over: Partial<EInvoiceDoc> = {}): EInvoiceDoc => ({
  kind: 'invoice', subtype: 'standard', number: 'MMC-INV-00001', uuid: '8e6000cf-1a98-4174-b3e7-b5d5954bc10d', issueDate: '2026-10-10', issueTime: '12:30:00', icv: 1, pih: GENESIS_PIH, seller, buyer,
  lines: [{ name: 'Controller', quantity: '2', unitPrice: '500.00', net: '1000.00', vat: '150.00', rate: 15, category: 'S' }],
  ...over,
});

describe('primitives', () => {
  it('genesis PIH is base64 of the hex string of SHA-256("0") — the value in the SDK pih.txt', () => {
    expect(GENESIS_PIH).toBe('NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==');
  });
  it('money() keeps two decimals without floats', () => {
    expect(money('10')).toBe('10.00');
    expect(money('0.1')).toBe('0.10');
    expect(money('-2.5')).toBe('-2.50');
    expect(() => money('abc')).toThrow();
  });
  it('TLV uses BER long-form lengths and round-trips (Arabic names pass 127 bytes)', () => {
    const name = 'م'.repeat(80); // 160 bytes
    const t = tlv(1, name);
    expect([...t.subarray(0, 3)]).toEqual([1, 0x81, 160]);
    const qr = buildInvoiceQr({ sellerName: name, vatNumber: '399999999900003', timestamp: '2026-10-10T12:30:00', total: '1150.00', vatTotal: '150.00' });
    expect(decodeTlv(qr)[1]?.toString('utf8')).toBe(name);
    expect(decodeTlv(qr)[5]?.toString('utf8')).toBe('150.00');
  });
});

describe('document', () => {
  it('totals come from the lines and the advances', () => {
    const t = docTotals(doc({ prepayments: [{ number: 'A', uuid: randomUUID(), issueDate: '2026-09-01', issueTime: '10:00:00', net: '400.00', vat: '60.00', rate: 15, category: 'S' }] }));
    expect(t).toMatchObject({ taxExclusive: '1000.00', vat: '150.00', taxInclusive: '1150.00', prepaid: '460.00', payable: '690.00' });
  });

  it('signs: hash recomputes, QR carries it, the stamp verifies, tags 1–8 for standard and 9 for simplified', () => {
    const s = buildSignedDocument(doc(), { privateKeyPem: id.privateKeyPem, certificatePem: id.certificatePem });
    expect(verifySignedDocument(s.xml)).toMatchObject({ ok: true, problems: [] });
    const t = decodeTlv(s.qr);
    expect(t[1]?.toString('utf8')).toBe(seller.name);
    expect(t[4]?.toString('utf8')).toBe('1150.00');
    expect(t[6]?.toString('utf8')).toBe(s.hashBase64);
    expect(t[8]?.length).toBe(88);
    expect(t[9]).toBeUndefined();
    const simple = buildSignedDocument(doc({ subtype: 'simplified', buyer: null }), { privateKeyPem: id.privateKeyPem, certificatePem: id.certificatePem });
    expect(decodeTlv(simple.qr)[9]?.length).toBeGreaterThan(60);
    expect(qrOf(simple.xml)).toBe(simple.qr);
  });

  it('the hash ignores the QR and the signature block but covers everything else', () => {
    const plain = invoiceHash(buildUbl(doc({ qr: 'AAAA' }))).base64;
    expect(invoiceHash(buildUbl(doc({ qr: 'BBBBBBBB' }))).base64).toBe(plain);
    expect(invoiceHash(buildUbl(doc({ qr: 'AAAA', icv: 2 }))).base64).not.toBe(plain);
    const s = buildSignedDocument(doc(), { privateKeyPem: id.privateKeyPem, certificatePem: id.certificatePem });
    expect(invoiceHash(s.xml).base64).toBe(s.hashBase64);
  });

  it('detects an edited archive', () => {
    const s = buildSignedDocument(doc(), { privateKeyPem: id.privateKeyPem, certificatePem: id.certificatePem });
    const tampered = s.xml.replace('<cbc:PayableAmount currencyID="SAR">1150.00', '<cbc:PayableAmount currencyID="SAR">1.00');
    const v = verifySignedDocument(tampered);
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/digest|stamp/i);
  });

  it('refuses to sign with a key that is not the certificate\'s', () => {
    const other = makeTestIdentity();
    expect(() => buildSignedDocument(doc(), { privateKeyPem: other.privateKeyPem, certificatePem: id.certificatePem })).toThrow(/does not belong/);
  });

  it('emits the prepayment reference lines the SDK sample uses and no empty elements', () => {
    const xml = buildUbl(doc({ prepayments: [{ number: 'ADV-1', uuid: 'a79760f7-2f48-4da9-85a5-40459a147c80', issueDate: '2026-09-01', issueTime: '10:00:00', net: '400.00', vat: '60.00', rate: 15, category: 'S' }] }));
    expect(xml).toContain('<cbc:DocumentTypeCode>386</cbc:DocumentTypeCode>');
    expect(xml).toContain('<cbc:PrepaidAmount currencyID="SAR">460.00</cbc:PrepaidAmount>');
    expect(xml).not.toMatch(/<cbc:\w+><\/cbc:\w+>/);
    expect(buildUbl(doc({ subtype: 'simplified', buyer: null }))).not.toMatch(/<cbc:\w+><\/cbc:\w+>/);
  });

  it('credit and debit notes are Invoice-rooted with the reason in InstructionNote', () => {
    const xml = buildUbl(doc({ kind: 'credit', billingReference: { number: 'MMC-INV-00001', reason: 'returned goods' } }));
    expect(xml).toMatch(/<Invoice /);
    expect(xml).toContain('>381</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cbc:InstructionNote>returned goods</cbc:InstructionNote>');
    expect(xml).toContain('<cac:InvoiceDocumentReference>');
  });

  it('escapes every interpolated value', () => {
    const xml = buildUbl(doc({ lines: [{ name: '<script>&"x"', quantity: '1', unitPrice: '1.00', net: '1.00', vat: '0.15', rate: 15, category: 'S' }] }));
    expect(xml).toContain('&lt;script&gt;&amp;&quot;x&quot;');
  });
});

describe('onboarding', () => {
  it('builds a CSR for each environment with its template name and the EGS identity', () => {
    for (const [environment, template] of [['sandbox', 'TSTZATCA-Code-Signing'], ['simulation', 'PREZATCA-Code-Signing'], ['production', 'ZATCA-Code-Signing']] as const) {
      const { csrPem, privateKeyPem } = generateCsr({
        environment, commonName: 'TST-1-399999999900003', serialNumber: egsSerial({ uuid: '11111111-2222-3333-4444-555555555555' }),
        organizationIdentifier: '399999999900003', organizationUnitName: 'Head office', organizationName: 'Al-Mada', locationAddress: 'Riyadh', businessCategory: 'Trading',
      });
      const raw = Buffer.from(csrPem.replace(/-----[^-]+-----|\s+/g, ''), 'base64');
      expect(raw.includes(Buffer.from(template))).toBe(true);
      expect(raw.includes(Buffer.from('1-MMCCore|2-ERP|3-11111111-2222-3333-4444-555555555555'))).toBe(true);
      expect(raw.includes(Buffer.from('399999999900003'))).toBe(true);
      // the SubjectPublicKeyInfo inside the request is the EGS key's
      const spki = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' }) as Buffer;
      expect(raw.includes(spki)).toBe(true);
    }
  });

  it('reuses an existing EGS key rather than re-keying a unit that has already signed', () => {
    const a = generateCsr({ environment: 'sandbox', commonName: 'c', serialNumber: 's', organizationIdentifier: '399999999900003', organizationUnitName: 'u', organizationName: 'o', locationAddress: 'a', businessCategory: 'b' });
    const b = generateCsr({ environment: 'simulation', commonName: 'c', serialNumber: 's', organizationIdentifier: '399999999900003', organizationUnitName: 'u', organizationName: 'o', locationAddress: 'a', businessCategory: 'b', privateKeyPem: a.privateKeyPem });
    expect(b.privateKeyPem).toBe(a.privateKeyPem);
  });
});

describe('Fatoora client', () => {
  const res = (status: number, json: unknown = {}) => async () => ({ status, json: async () => json });
  const creds = { csid: 'tok', secret: 'sec' };

  it('interprets 200 / 202 as accepted, 400 as permanent, 5xx as transport', () => {
    expect(interpret(200, { reportingStatus: 'REPORTED' })).toMatchObject({ accepted: true, withWarnings: false });
    expect(interpret(202, { validationResults: { warningMessages: [{ code: 'W1', message: 'm' }] } })).toMatchObject({ accepted: true, withWarnings: true, warnings: [{ code: 'W1' }] });
    expect(interpret(400, { validationResults: { errorMessages: [{ code: 'E1', message: 'bad' }] } })).toMatchObject({ accepted: false, permanent: true, errors: [{ code: 'E1' }] });
    expect(() => interpret(503, {})).toThrow(ZatcaTransportError);
  });

  it('sends clearance with Clearance-Status and falls back to reporting on 303', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const client = createFatooraClient({
      environment: 'sandbox',
      fetch: async (url, init) => {
        calls.push({ url, headers: init.headers });
        return url.includes('/clearance/') ? { status: 303, json: async () => ({}) } : { status: 200, json: async () => ({ reportingStatus: 'REPORTED' }) };
      },
    });
    const v = await client.submitInvoice(creds, { invoiceHash: 'h', uuid: 'u', xml: '<x/>', standard: true });
    expect(calls[0]?.url).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/clearance/single');
    expect(calls[0]?.headers['Clearance-Status']).toBe('1');
    expect(calls[0]?.headers['Accept-Version']).toBe('V2');
    expect(calls[1]?.url).toMatch(/invoices\/reporting\/single$/);
    expect(calls[1]?.headers['Clearance-Status']).toBeUndefined();
    expect(v).toMatchObject({ accepted: true, clearanceDisabled: true });
  });

  it('turns a network failure into a retryable transport error and a spent OTP into a rejection', async () => {
    const down = createFatooraClient({ environment: 'sandbox', fetch: async () => { throw new Error('ECONNRESET'); } });
    await expect(down.submitInvoice(creds, { invoiceHash: 'h', uuid: 'u', xml: '<x/>', standard: false })).rejects.toBeInstanceOf(ZatcaTransportError);
    const spent = createFatooraClient({ environment: 'sandbox', fetch: res(400, { message: 'invalid otp' }) });
    await expect(spent.requestComplianceCsid('csr', '000000')).rejects.toBeInstanceOf(ZatcaRejection);
  });

  it('decodes the double-base64 CSID token into a PEM certificate', () => {
    const body = id.certificatePem.replace(/-----[^-]+-----|\s+/g, '');
    const token = Buffer.from(body).toString('base64');
    expect(certificateFromToken(token).replace(/\s+/g, '')).toBe(id.certificatePem.replace(/\s+/g, ''));
  });
});

// The acceptance gate: every document kind validates against the OFFICIAL ZATCA SDK (Java). Runs only
// where the SDK is installed: ZATCA_SDK_HOME=…/zatca-einvoicing-sdk-Java-… (JAVA_HOME or PATH for java).
describe.skipIf(!process.env.ZATCA_SDK_HOME)('official ZATCA SDK validator', () => {
  it('passes XSD, EN16931, KSA, QR, signature and PIH for every document kind', () => {
    const out = execFileSync('node', ['scripts/sdk-validate.mjs'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', env: process.env, timeout: 600_000 });
    expect(out).toMatch(/all \d+ documents passed SDK validation/);
  }, 600_000);
});
