#!/usr/bin/env node
/**
 * Conformance run against the OFFICIAL ZATCA SDK validator (Java, `fatoora -validate`).
 *
 *   ZATCA_SDK_HOME=/path/to/zatca-einvoicing-sdk-Java-… JAVA_HOME=… node scripts/sdk-validate.mjs
 *
 * Builds every document kind this engine issues — standard and simplified × tax invoice / prepayment /
 * credit note / debit note, plus discounts, fractional quantities, a zero-rated category and a final
 * invoice that deducts two advances — signs each with a throw-away test certificate and asks the SDK
 * to run the XSD, EN16931, KSA schematron, QR, signature and PIH checks. Exit code 1 on any failure.
 *
 * The SDK's Configuration/config.json holds absolute paths; point them at your copy first.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GENESIS_PIH, buildSignedDocument, makeTestIdentity } from '../dist/index.js';

const home = process.env.ZATCA_SDK_HOME;
if (!home || !existsSync(join(home, 'Apps', 'fatoora'))) {
  console.error('set ZATCA_SDK_HOME to the SDK folder (the one that contains Apps/fatoora)');
  process.exit(2);
}
const out = process.env.ZATCA_OUT || join(process.cwd(), '.sdk-out');
mkdirSync(out, { recursive: true });

// The SDK's simplified-invoice signature check compares the XAdES issuer / serial with ITS OWN test
// certificate (Data/Certificates), so sign with that pair when it is there; fall back to a generated
// one (standard documents validate either way).
function sdkIdentity() {
  const certFile = join(home, 'Data', 'Certificates', 'cert.pem');
  const keyFile = join(home, 'Data', 'Certificates', 'ec-secp256k1-priv-key.pem');
  if (!existsSync(certFile) || !existsSync(keyFile)) return null;
  const arm = (b64, label) => `-----BEGIN ${label}-----\n${b64.replace(/-----[^-]+-----|\s+/g, '').replace(/(.{64})/g, '$1\n').trim()}\n-----END ${label}-----\n`;
  return {
    certificatePem: arm(readFileSync(certFile, 'utf8'), 'CERTIFICATE'),
    privateKeyPem: arm(readFileSync(keyFile, 'utf8'), 'EC PRIVATE KEY'),
  };
}
const id = sdkIdentity() ?? makeTestIdentity();
console.log(sdkIdentity() ? 'signing with the SDK test certificate' : 'signing with a generated test certificate');

const seller = {
  name: 'شركة المدى المبارك | Al-Mada Al-Mubarak', vatNumber: '399999999900003', crn: '1010010000',
  address: { street: 'الامير سلطان | Prince Sultan', buildingNumber: '2322', additionalNumber: '9999', district: 'المربع | Al-Murabba', city: 'الرياض | Riyadh', postalCode: '23333', country: 'SA' },
};
const buyer = {
  name: 'شركة نماذج فاتورة المحدودة | Fatoora Samples LTD', vatNumber: '399999999800003',
  address: { street: 'صلاح الدين | Salah Al-Din', buildingNumber: '1111', district: 'المروج | Al-Murooj', city: 'الرياض | Riyadh', postalCode: '12222', country: 'SA' },
};
const S = (net, discount) => ({ category: 'S', rate: 15, net, vat: (Math.round(Number(net) * 15) / 100).toFixed(2), discount });
const line = (name, quantity, unitPrice, net, extra = {}) => ({ name, quantity, unitPrice, ...S(net, extra.discount), ...extra });
const now = new Date(Date.now() + 3 * 3600_000).toISOString();
const base = (over) => ({
  currency: 'SAR', issueDate: now.slice(0, 10), issueTime: now.slice(11, 19), pih: GENESIS_PIH, icv: 1,
  seller, uuid: randomUUID(), ...over,
});

const cases = [];
for (const subtype of ['standard', 'simplified']) {
  const b = subtype === 'standard' ? buyer : null;
  cases.push([`${subtype}-invoice`, base({ kind: 'invoice', subtype, number: `INV-${subtype}-1`, buyer: b, lines: [line('جهاز تحكم | Controller', '2', '500.00', '1000.00')] })]);
  cases.push([`${subtype}-invoice-discount`, base({ kind: 'invoice', subtype, number: `INV-${subtype}-2`, buyer: b, lines: [line('Panel', '3', '33.33', '90.00', { discount: '9.99' }), line('Cable', '1.5', '10.00', '15.00')] })]);
  cases.push([`${subtype}-prepayment`, base({ kind: 'prepayment', subtype, number: `ADV-${subtype}-1`, buyer: b, lines: [{ name: 'دفعة مقدمة | Advance', quantity: '1', unitPrice: '1000.00', ...S('1000.00') }] })]);
  cases.push([`${subtype}-credit`, base({ kind: 'credit', subtype, number: `CN-${subtype}-1`, buyer: b, billingReference: { number: `INV-${subtype}-1`, reason: 'إرجاع بضاعة | returned goods' }, lines: [line('Returned item', '1', '100.00', '100.00')] })]);
  cases.push([`${subtype}-debit`, base({ kind: 'debit', subtype, number: `DN-${subtype}-1`, buyer: b, billingReference: { number: `INV-${subtype}-1`, reason: 'فرق سعر | price difference' }, lines: [line('Price difference', '1', '50.00', '50.00')] })]);
}
cases.push(['standard-zero-rated', base({ kind: 'invoice', subtype: 'standard', number: 'INV-Z-1', buyer, lines: [{ name: 'Export goods', quantity: '1', unitPrice: '200.00', net: '200.00', vat: '0.00', rate: 0, category: 'Z', exemptionReasonCode: 'VATEX-SA-32', exemptionReason: 'Export of goods' }] })]);
cases.push(['standard-final-with-advances', base({
  kind: 'invoice', subtype: 'standard', number: 'INV-FIN-1', buyer,
  lines: [line('Laptop | حاسوب محمول', '1', '2000.00', '1900.00', { discount: '100.00' })],
  prepayments: [
    { number: 'ADV-1', uuid: randomUUID(), issueDate: '2026-09-01', issueTime: '10:00:00', net: '600.00', vat: '90.00', rate: 15, category: 'S' },
    { number: 'ADV-2', uuid: randomUUID(), issueDate: '2026-09-15', issueTime: '11:30:00', net: '400.00', vat: '60.00', rate: 15, category: 'S' },
  ],
})]);

let failed = 0;
const env = { ...process.env, FATOORA_HOME: join(home, 'Apps'), SDK_CONFIG: join(home, 'Configuration', 'config.json') };
for (const [name, doc] of cases) {
  const signed = buildSignedDocument(doc, { privateKeyPem: id.privateKeyPem, certificatePem: id.certificatePem });
  const file = join(out, `${name}.xml`);
  writeFileSync(file, signed.xml);
  let text = '';
  try {
    text = execFileSync(join(home, 'Apps', 'fatoora'), ['-validate', '-invoice', file], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    text = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const ok = /GLOBAL VALIDATION RESULT = PASSED/.test(text);
  const warns = [...text.matchAll(/WARN\s+\S+ - CODE : ([^,]+)/g)].map((m) => m[1]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${warns.length ? `  (warnings: ${[...new Set(warns)].join(', ')})` : ''}`);
  if (!ok) {
    failed += 1;
    console.log(text.split('\n').filter((l) => /ERROR|FAILED|CODE :/.test(l)).join('\n'));
  }
}
console.log(failed ? `\n${failed} of ${cases.length} documents FAILED SDK validation` : `\nall ${cases.length} documents passed SDK validation`);
process.exit(failed ? 1 : 0);
