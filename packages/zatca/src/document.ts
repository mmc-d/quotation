import { createPublicKey, X509Certificate } from 'node:crypto';
import { invoiceHash } from './hash.js';
import { buildXadesBlock, insertXades } from './xades.js';
import { buildInvoiceQr, decodeTlv } from './qr.js';
import { certificateStamp, sign, verify } from './sign.js';
import { buildUbl, docTotals, type EInvoiceDoc } from './ubl.js';

export interface SigningKeys {
  privateKeyPem: string;
  /** the CSID certificate (PEM) ZATCA issued for this key */
  certificatePem: string;
}

export interface SignedDocument {
  xml: string;
  hashBase64: string;
  signatureBase64: string;
  qr: string;
  /** the totals the document carries (2 dp strings) */
  totals: ReturnType<typeof docTotals>;
}

/**
 * Produce the signed UBL document for `doc`: hash → ECDSA stamp → QR (tags 1–9) → XAdES block.
 *
 * Step 1 hashes the document WITH a placeholder QR element already in place: stripping an element
 * leaves the whitespace around it behind, so a document built without a QR would not reduce to the
 * same canonical form as the stored one with the QR removed. The QR's CONTENT is stripped from the
 * hash, so any placeholder yields the real value — which is what breaks the apparent circularity
 * of "the QR contains the hash of the document that contains the QR". Step 5 asserts it.
 */
export function buildSignedDocument(doc: EInvoiceDoc, keys: SigningKeys): SignedDocument {
  const hashable = buildUbl({ ...doc, qr: 'PLACEHOLDER' });
  const { base64: hashBase64, bytes } = invoiceHash(hashable);
  const signature = sign(bytes, keys.privateKeyPem);
  const stamp = certificateStamp(keys.certificatePem);
  if (createPublicKey(keys.privateKeyPem).export({ type: 'spki', format: 'der' }).compare(stamp.publicKeyDer) !== 0) {
    throw new Error('the private key does not belong to the certificate — refusing to sign');
  }
  const totals = docTotals(doc);
  const qr = buildInvoiceQr({
    sellerName: doc.seller.name,
    vatNumber: doc.seller.vatNumber ?? '',
    // Tag 3 carries no trailing "Z": the SDK emits a bare local (Riyadh) timestamp.
    timestamp: `${doc.issueDate}T${doc.issueTime}`,
    total: totals.taxInclusive,
    vatTotal: totals.vat,
    hashBase64,
    signatureBase64: signature.base64,
    publicKeyDer: stamp.publicKeyDer,
    certSignatureDer: stamp.certSignatureDer,
    isSimplified: doc.subtype === 'simplified',
  });
  let xml = buildUbl({ ...doc, qr });
  xml = insertXades(xml, buildXadesBlock({
    invoiceHashBase64: hashBase64,
    signatureBase64: signature.base64,
    certificateBase64: stamp.certificateBase64,
    signingTime: doc.signingTime || `${doc.issueDate}T${doc.issueTime}`,
    issuer: stamp.issuer,
    serial: stamp.serial,
  }));
  if (invoiceHash(xml).base64 !== hashBase64) {
    throw new Error('ZATCA invoice hash is not stable across QR/signature attachment — refusing to issue');
  }
  return { xml, hashBase64, signatureBase64: signature.base64, qr, totals };
}

export interface Verification { ok: boolean; problems: string[]; hashBase64: string }

const tag = (xml: string, re: RegExp) => re.exec(xml)?.[1]?.trim();

/**
 * Offline self-check of a stored document: the hash recomputes, the embedded digest and QR tag 6
 * carry it, and the ECDSA stamp verifies against the embedded certificate. Does not replace the
 * ZATCA SDK / gateway, but catches a corrupted or edited archive.
 */
export function verifySignedDocument(xml: string): Verification {
  const problems: string[] = [];
  const { base64: hashBase64, bytes } = invoiceHash(xml);
  const digest = tag(xml, /<ds:Reference Id="invoiceSignedData"[\s\S]*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>/);
  if (digest !== hashBase64) problems.push('ds:DigestValue does not match the recomputed invoice hash');
  const sig = tag(xml, /<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/);
  const certB64 = tag(xml, /<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/);
  if (!sig || !certB64) problems.push('no signature block');
  else {
    try {
      const cert = new X509Certificate(Buffer.from(certB64, 'base64'));
      if (!verify(bytes, Buffer.from(sig, 'base64'), cert.publicKey.export({ type: 'spki', format: 'pem' }).toString())) problems.push('the ECDSA stamp does not verify against the embedded certificate');
    } catch (e) {
      problems.push(`unreadable certificate: ${(e as Error).message}`);
    }
  }
  const qr = /<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</.exec(xml)?.[1];
  if (!qr) problems.push('no QR');
  else {
    const t = decodeTlv(qr);
    if (t[6]?.toString('utf8') !== hashBase64) problems.push('QR tag 6 does not carry the invoice hash');
    if (sig && t[7]?.toString('utf8') !== sig) problems.push('QR tag 7 does not carry the signature');
  }
  return { ok: problems.length === 0, problems, hashBase64 };
}

/** The base64 QR carried by a (signed or cleared) document, or null. */
export function qrOf(xml: string): string | null {
  return /<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</.exec(xml)?.[1]?.trim() ?? null;
}
