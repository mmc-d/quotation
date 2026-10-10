import { X509Certificate, createSign, createVerify, generateKeyPairSync } from 'node:crypto';

/** EC secp256k1 key pair for an EGS unit (ZATCA rejects any other curve). */
export function generateKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/**
 * ECDSA stamp over the RAW 32-byte invoice hash (SHA256withECDSA, i.e. a hash of the hash). That is
 * what ZATCA's SDK does (DigitalSignatureServiceImpl): it does NOT sign the canonicalised
 * ds:SignedInfo as plain XMLDSig would. Passing anything but the raw invoice-hash bytes gives a
 * signature ZATCA rejects. Do not "correct" this.
 */
export function sign(hashBytes: Buffer, privateKeyPem: string): { bytes: Buffer; base64: string } {
  const s = createSign('SHA256');
  s.update(hashBytes);
  s.end();
  const bytes = s.sign(privateKeyPem);
  return { bytes, base64: bytes.toString('base64') };
}

/** Verify a stamp (round-trip helper for tests and the pre-submission self-check). */
export function verify(hashBytes: Buffer, signature: Buffer, publicKeyOrCertPem: string): boolean {
  const v = createVerify('SHA256');
  v.update(hashBytes);
  v.end();
  return v.verify(publicKeyOrCertPem, signature);
}

function derRead(buf: Buffer, off: number): { tag: number; contentStart: number; end: number } {
  const tag = buf[off] ?? 0;
  let i = off + 1;
  let len = buf[i++] ?? 0;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | (buf[i++] ?? 0);
  }
  return { tag, contentStart: i, end: i + len };
}

export interface CertificateStamp {
  /** QR tag 8 — the certificate's SubjectPublicKeyInfo, DER */
  publicKeyDer: Buffer;
  /** QR tag 9 — the certificate's OWN signature (ZATCA's stamp over it), DER */
  certSignatureDer: Buffer;
  /** base64 DER, no PEM armour — goes into ds:X509Certificate and is what CertDigest hashes */
  certificateBase64: string;
  /** X509IssuerName as ZATCA writes it: most-specific RDN first, comma-space separated */
  issuer: string;
  /** decimal serial */
  serial: string;
}

/**
 * Tags 8 and 9 belong to the certificate, not to our key pair; tag 9 is ZATCA's signature over the
 * CSID, so there is no honest value for it before onboarding. X.509 is
 * SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }.
 */
export function certificateStamp(certPem: string | Buffer): CertificateStamp {
  const x509 = new X509Certificate(certPem);
  const publicKeyDer = x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const der = x509.raw;
  const outer = derRead(der, 0);
  const tbs = derRead(der, outer.contentStart);
  const alg = derRead(der, tbs.end);
  const sig = derRead(der, alg.end);
  if (sig.tag !== 0x03) throw new Error('malformed certificate: signatureValue is not a BIT STRING');
  return {
    publicKeyDer,
    certSignatureDer: der.subarray(sig.contentStart + 1, sig.end),
    certificateBase64: der.toString('base64'),
    issuer: String(x509.issuer).split('\n').map((s) => s.trim()).filter(Boolean).reverse().join(', '),
    serial: BigInt(`0x${x509.serialNumber}`).toString(10),
  };
}
