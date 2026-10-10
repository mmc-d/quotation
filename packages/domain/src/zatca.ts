/**
 * ZATCA Phase-1 QR (TLV, tags 1–5) — port of the legacy zatcaTlvBase64/invoiceQrBase64, which were
 * themselves verified against ZATCA SDK 3.4.6: BER long-form lengths, timestamp without `Z`.
 * Phase-2 (tags 6–9, signing, clearance) lives in `@mmc/zatca` (Node only — it needs crypto and an XML
 * canonicaliser), or in the ERPNext KSA compliance app when that back office is configured.
 */
export function zatcaTlv(fields: [number, string][]): Uint8Array {
  const enc = new TextEncoder();
  const bytes: number[] = [];
  for (const [tag, value] of fields) {
    const v = enc.encode(String(value));
    const len = v.length < 0x80 ? [v.length] : v.length <= 0xff ? [0x81, v.length] : v.length <= 0xffff ? [0x82, v.length >> 8, v.length & 0xff] : null;
    if (!len) throw new Error(`QR field too long (tag ${tag})`);
    bytes.push(tag, ...len, ...v);
  }
  return Uint8Array.from(bytes);
}

export function zatcaTlvBase64(fields: [number, string][]): string {
  return Buffer.from(zatcaTlv(fields)).toString('base64');
}

export function phase1QrPayload(inv: { sellerName: string; vatNumber: string; issueDate: string; issueTime: string; total: number; vat: number }): string {
  return zatcaTlvBase64([
    [1, inv.sellerName],
    [2, inv.vatNumber],
    [3, `${inv.issueDate}T${inv.issueTime}`],
    [4, inv.total.toFixed(2)],
    [5, inv.vat.toFixed(2)],
  ]);
}

/** UBL invoice type codes. */
export const INVOICE_TYPE = { tax: '388', prepayment: '386', credit: '381', debit: '383' } as const;
export type InvoiceTypeCode = (typeof INVOICE_TYPE)[keyof typeof INVOICE_TYPE];
