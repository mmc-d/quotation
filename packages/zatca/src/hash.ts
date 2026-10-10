import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { C14nCanonicalization } from 'xml-crypto';

/**
 * Seed PIH for the FIRST invoice of an EGS unit: base64 of the 64-char HEX string of SHA-256("0")
 * (not base64 of the raw digest). This is the value in the SDK's Data/PIH/pih.txt. It is the only
 * link in the chain encoded this way — every later PIH is the previous invoice hash verbatim
 * (base64 of the raw digest, 44 chars). ZATCA genuinely mixes the two encodings.
 */
export const GENESIS_PIH = Buffer.from(createHash('sha256').update('0').digest('hex'), 'utf8').toString('base64');

const local = (n: { localName?: string | null; nodeName: string }) => n.localName || n.nodeName.replace(/^.*:/, '');

/**
 * The ZATCA invoice hash → raw digest bytes + base64.
 *
 * Not a SHA-256 of the file. The hash is of what survives three deletions, canonicalised with C14N:
 *   ext:UBLExtensions · cac:Signature · cac:AdditionalDocumentReference whose ID is QR
 * which is why the QR (that contains the hash) and the signature (that signs it) can live inside the
 * document they describe. Verified byte-for-byte against SDK 3.4.6 (`*** INVOICE HASH`).
 */
export function invoiceHash(xml: string): { base64: string; bytes: Buffer } {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const drop: Element[] = [];
  for (const el of Array.from(doc.getElementsByTagName('*')) as Element[]) {
    const name = local(el);
    if (name === 'UBLExtensions' || name === 'Signature') { drop.push(el); continue; }
    if (name === 'AdditionalDocumentReference') {
      const id = (Array.from(el.getElementsByTagName('*')) as Element[]).find((c) => local(c) === 'ID');
      if (id && String(id.textContent).trim() === 'QR') drop.push(el);
    }
  }
  for (const el of drop) el.parentNode?.removeChild(el);
  // Inclusive C14N 1.0 and 1.1 are byte-identical for a document with no xml:* attributes.
  const canonical = new C14nCanonicalization().process(doc.documentElement as never, {} as never).toString();
  const bytes = createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest();
  return { base64: bytes.toString('base64'), bytes };
}

/** base64( hex( sha256(text) ) ) — the encoding ZATCA uses for the XAdES digests. */
export function zatcaDigest(text: string): string {
  return Buffer.from(createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'), 'utf8').toString('base64');
}
