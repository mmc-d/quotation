import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { der, oid, seq, set, utf8 } from './csr.js';

/**
 * A self-signed secp256k1 certificate for tests and for rehearsing the pipeline without ZATCA.
 * It is NOT a CSID: ZATCA never issued it, so a QR built from it is not a legal stamp.
 */
export function makeTestIdentity(cn = 'MMC-TEST-EGS'): { privateKeyPem: string; certificatePem: string } {
  const privateKeyPem = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const key = createPrivateKey(privateKeyPem);
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer;
  const name = seq(set(seq(oid('2.5.4.3'), utf8(cn))));
  const utc = (d: Date) => der(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`));
  const now = new Date();
  const serial = randomBytes(8);
  serial[0] = (serial[0] as number) & 0x7f;
  const sigAlg = seq(oid('1.2.840.10045.4.3.2'));
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    sigAlg,
    name,
    seq(utc(now), utc(new Date(now.getTime() + 5 * 365 * 86_400_000))),
    name,
    spki,
  );
  const sig = createSign('SHA256').update(tbs).sign(key);
  const certDer = seq(tbs, sigAlg, der(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const b64 = certDer.toString('base64').replace(/(.{64})/g, '$1\n').trim();
  return { privateKeyPem, certificatePem: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n` };
}

function derAt(buf: Buffer, off: number): { tag: number; start: number; end: number } {
  const tag = buf[off] ?? 0;
  let i = off + 1;
  let len = buf[i++] ?? 0;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | (buf[i++] ?? 0);
  }
  return { tag, start: i, end: i + len };
}

/** The SubjectPublicKeyInfo (DER) inside a PKCS#10 request — what a CA would certify. */
export function publicKeyFromCsr(csrPem: string): Buffer {
  const der = Buffer.from(csrPem.replace(/-----[^-]+-----|\s+/g, ''), 'base64');
  const outer = derAt(der, 0);
  const cri = derAt(der, outer.start);
  const version = derAt(der, cri.start);
  const subject = derAt(der, version.end);
  const spki = derAt(der, subject.end);
  return der.subarray(subject.end, spki.end);
}

/**
 * Plays ZATCA's CA in tests: certifies the key found in a CSR, signed by `ca` (a makeTestIdentity()).
 * The result is a perfectly ordinary X.509 certificate — and not a CSID.
 */
export function issueTestCertificate(csrPem: string, ca: { privateKeyPem: string }, cn = 'MMC-TEST-CA'): string {
  const caKey = createPrivateKey(ca.privateKeyPem);
  const name = (v: string) => seq(set(seq(oid('2.5.4.3'), utf8(v))));
  const utc = (d: Date) => der(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`));
  const now = new Date();
  const serial = randomBytes(8);
  serial[0] = (serial[0] as number) & 0x7f;
  const sigAlg = seq(oid('1.2.840.10045.4.3.2'));
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    sigAlg,
    name(cn),
    seq(utc(now), utc(new Date(now.getTime() + 5 * 365 * 86_400_000))),
    name('MMC-EGS-UNIT'),
    publicKeyFromCsr(csrPem),
  );
  const sig = createSign('SHA256').update(tbs).sign(caKey);
  const certDer = seq(tbs, sigAlg, der(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const b64 = certDer.toString('base64').replace(/(.{64})/g, '$1\n').trim();
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}
