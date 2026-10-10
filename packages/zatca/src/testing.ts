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
