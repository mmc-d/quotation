/**
 * ZATCA QR — TLV, base64-wrapped. The encodings are NOT uniform (proven against SDK 3.4.6):
 *
 *   1 seller name · 2 VAT number · 3 timestamp "YYYY-MM-DDTHH:MM:SS" (no Z) · 4 total incl. VAT ·
 *   5 VAT total · 6 invoice hash (base64 TEXT) · 7 signature (base64 TEXT) ·
 *   8 certificate public key (RAW DER) · 9 certificate signature (RAW DER, simplified invoices only)
 *
 * Lengths are BER: a bare byte ≥ 0x80 is a long-form prefix, and Arabic names cross 127 bytes easily.
 */
export function tlv(tag: number, value: string | Buffer): Buffer {
  const val = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  let len: Buffer;
  if (val.length < 0x80) len = Buffer.from([val.length]);
  else if (val.length <= 0xff) len = Buffer.from([0x81, val.length]);
  else if (val.length <= 0xffff) len = Buffer.from([0x82, val.length >> 8, val.length & 0xff]);
  else throw new Error(`TLV value too long (${val.length} bytes, tag ${tag})`);
  return Buffer.concat([Buffer.from([tag]), len, val]);
}

export function encodeTlv(pairs: [number, string | Buffer | undefined][]): string {
  return Buffer.concat(pairs.filter(([, v]) => v !== undefined).map(([t, v]) => tlv(t, v as string | Buffer))).toString('base64');
}

export function decodeTlv(base64: string): Record<number, Buffer> {
  const buf = Buffer.from(base64, 'base64');
  const out: Record<number, Buffer> = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i++] as number;
    let len = buf[i++] as number;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | (buf[i++] as number);
    }
    out[tag] = buf.subarray(i, i + len);
    i += len;
  }
  return out;
}

export interface QrFields {
  sellerName: string;
  vatNumber: string;
  /** "YYYY-MM-DDTHH:MM:SS" */
  timestamp: string;
  total: string;
  vatTotal: string;
  hashBase64?: string;
  signatureBase64?: string;
  publicKeyDer?: Buffer;
  certSignatureDer?: Buffer;
  isSimplified?: boolean;
}

export function buildInvoiceQr(f: QrFields): string {
  return encodeTlv([
    [1, f.sellerName],
    [2, f.vatNumber],
    [3, f.timestamp],
    [4, f.total],
    [5, f.vatTotal],
    [6, f.hashBase64],
    [7, f.signatureBase64],
    [8, f.publicKeyDer],
    // The SDK gates tag 9 on invoice type "02*": a standard invoice stops at tag 8.
    [9, f.isSimplified ? f.certSignatureDer : undefined],
  ]);
}
