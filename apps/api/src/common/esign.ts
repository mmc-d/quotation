import { createHmac, randomUUID } from 'node:crypto';
import { config } from '../config.js';

/**
 * E-signature adapter (Nafath-backed signing via a DGA-licensed provider — Signit / emdha / Sadq,
 * decision D8). Sandbox: a public page that simulates the Nafath approval and calls back.
 */
export interface EsignAdapter {
  readonly name: string;
  create(p: { requestId: string; contractNumber: string; signerName: string; signerNationalId?: string | null; signerMobile?: string | null; pdf: Buffer; sha256: string }): Promise<{ providerRequestId: string; signingUrl: string }>;
  sign(payload: string): string;
}

export const sandboxEsign: EsignAdapter = {
  name: 'sandbox',
  async create(p) {
    const providerRequestId = `esg_${randomUUID()}`;
    return { providerRequestId, signingUrl: `${config.publicBaseUrl}/sign/${p.requestId}` };
  },
  sign(payload) {
    return createHmac('sha256', config.esign.webhookSecret).update(payload).digest('hex');
  },
};

export function esign(): EsignAdapter {
  return sandboxEsign;
}
