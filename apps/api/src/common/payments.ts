import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Payment gateway adapter (mada, Apple Pay, cards, payment links). Sandbox: the "hosted page" is
 * our own public page that simulates a successful mada payment and posts a signed webhook, so the
 * whole flow (link → paid → 386/receipt) runs end to end without a merchant account.
 */
export interface PaymentLink { providerId: string; url: string }

export interface PaymentsAdapter {
  createLink(p: { amount: string; description: string; reference: string; returnUrl: string; publicToken: string }): Promise<PaymentLink>;
  verifyWebhook(raw: Buffer, signature: string | undefined): boolean;
}

export const sandboxPayments: PaymentsAdapter = {
  async createLink(p) {
    const providerId = `sbx_${randomUUID()}`;
    return { providerId, url: `${config.publicBaseUrl}/p/${p.publicToken}?pay=sandbox` };
  },
  verifyWebhook(raw, signature) {
    if (!signature) return false;
    const expected = createHmac('sha256', config.payments.webhookSecret).update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  },
};

export function signSandboxWebhook(raw: string): string {
  return createHmac('sha256', config.payments.webhookSecret).update(raw).digest('hex');
}

export function payments(): PaymentsAdapter {
  // A real provider (e.g. a SAMA-licensed gateway) plugs in here behind the same interface.
  return sandboxPayments;
}
