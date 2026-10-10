import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

/**
 * ZATCA PKCS#10 CSR — hand-rolled DER (the encoding is small and was byte-compared against a CSR
 * SDK 3.4.6 generated for its own sample EGS; ZATCA's sandbox issued real compliance and production
 * CSIDs against a CSR from this encoder).
 *
 *   • Key       EC secp256k1, ecdsa-with-SHA256 (not P-256)
 *   • Subject   C=<PrintableString>, OU / O / CN = <UTF8String>, in that order
 *   • Ext 1.3.6.1.4.1.311.20.2   certificate template name = the environment selector (UTF8String 0x0C)
 *   • Ext subjectAltName          directoryName {SN serial, UID VAT, title invoice types, registeredAddress, businessCategory}
 */
export type ZatcaEnvironment = 'sandbox' | 'simulation' | 'production';

export const TEMPLATE: Record<ZatcaEnvironment, string> = {
  sandbox: 'TSTZATCA-Code-Signing',
  simulation: 'PREZATCA-Code-Signing',
  production: 'ZATCA-Code-Signing',
};

const TAG = { INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04, OID: 0x06, UTF8: 0x0c, PRINTABLE: 0x13, SEQUENCE: 0x30, SET: 0x31 };

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n <= 0xff) return Buffer.from([0x81, n]);
  if (n <= 0xffff) return Buffer.from([0x82, n >> 8, n & 0xff]);
  throw new Error(`DER value too long: ${n}`);
}
export const der = (tag: number, content: Buffer) => Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
export const seq = (...parts: Buffer[]) => der(TAG.SEQUENCE, Buffer.concat(parts));
export const set = (...parts: Buffer[]) => der(TAG.SET, Buffer.concat(parts));
export const utf8 = (s: string) => der(TAG.UTF8, Buffer.from(String(s), 'utf8'));
const printable = (s: string) => der(TAG.PRINTABLE, Buffer.from(String(s), 'utf8'));

export function oid(dotted: string): Buffer {
  const p = dotted.split('.').map(Number);
  const out = [(p[0] as number) * 40 + (p[1] as number)];
  for (const n of p.slice(2)) {
    const stack = [n & 0x7f];
    let v = n >> 7;
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>= 7; }
    out.push(...stack);
  }
  return der(TAG.OID, Buffer.from(out));
}

const OID = {
  country: '2.5.4.6', orgUnit: '2.5.4.11', org: '2.5.4.10', commonName: '2.5.4.3',
  surname: '2.5.4.4', uid: '0.9.2342.19200300.100.1.1', title: '2.5.4.12',
  registeredAddress: '2.5.4.26', businessCategory: '2.5.4.15',
  certTemplate: '1.3.6.1.4.1.311.20.2', subjectAltName: '2.5.29.17', extensionRequest: '1.2.840.113549.1.9.14',
};

const rdn = (id: string, value: string, asPrintable = false) => set(seq(oid(id), asPrintable ? printable(value) : utf8(value)));

export interface CsrInput {
  environment: ZatcaEnvironment;
  /** e.g. "TST-886431145-399999999900003" */
  commonName: string;
  /** EGS serial "1-<solution>|2-<model>|3-<uuid>" */
  serialNumber: string;
  /** the 15-digit VAT number */
  organizationIdentifier: string;
  /** branch name (or the VAT-group member's 10-digit TIN) */
  organizationUnitName: string;
  organizationName: string;
  countryName?: string;
  /** "1100" = standard and simplified, "1000" standard only, "0100" simplified only */
  invoiceType?: string;
  locationAddress: string;
  businessCategory: string;
  /** reuse an existing EGS key; one is minted when absent */
  privateKeyPem?: string;
}

export function generateCsr(p: CsrInput): { csrPem: string; privateKeyPem: string } {
  const template = TEMPLATE[p.environment];
  if (!template) throw new Error(`unknown ZATCA environment: ${p.environment}`);
  const privateKeyPem = p.privateKeyPem ?? generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const privateKey = createPrivateKey(privateKeyPem);
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }) as Buffer;

  const subject = seq(
    rdn(OID.country, p.countryName || 'SA', true),
    rdn(OID.orgUnit, p.organizationUnitName),
    rdn(OID.org, p.organizationName),
    rdn(OID.commonName, p.commonName),
  );
  const altNameDir = seq(
    rdn(OID.surname, p.serialNumber),
    rdn(OID.uid, p.organizationIdentifier),
    rdn(OID.title, p.invoiceType || '1100'),
    rdn(OID.registeredAddress, p.locationAddress),
    rdn(OID.businessCategory, p.businessCategory),
  );
  const generalNames = der(0xa4, altNameDir); // [4] directoryName
  const sanValue = der(TAG.SEQUENCE, generalNames);
  const extensions = seq(
    seq(oid(OID.certTemplate), der(TAG.OCTET_STRING, utf8(template))),
    seq(oid(OID.subjectAltName), der(TAG.OCTET_STRING, sanValue)),
  );
  const attributes = der(0xa0, seq(oid(OID.extensionRequest), set(extensions)));
  const cri = seq(der(TAG.INTEGER, Buffer.from([0])), subject, spki, attributes);
  const signature = createSign('SHA256').update(cri).sign(privateKey);
  const csrDer = seq(cri, seq(oid('1.2.840.10045.4.3.2')), der(TAG.BIT_STRING, Buffer.concat([Buffer.from([0x00]), signature])));
  const b64 = csrDer.toString('base64').replace(/(.{64})/g, '$1\n').trim();
  return { csrPem: `-----BEGIN CERTIFICATE REQUEST-----\n${b64}\n-----END CERTIFICATE REQUEST-----\n`, privateKeyPem };
}

/** The EGS serial ZATCA expects. Segment 3 is what makes a unit a unit: two units must differ there. */
export function egsSerial(p: { solution?: string; model?: string; uuid?: string } = {}): string {
  return `1-${p.solution ?? 'MMCCore'}|2-${p.model ?? 'ERP'}|3-${p.uuid ?? randomUUID()}`;
}
