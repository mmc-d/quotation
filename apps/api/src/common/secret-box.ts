import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';

/**
 * Secrets at rest (EGS private keys, CSIDs and their secrets): AES-256-GCM, `v1:<iv>:<tag>:<ct>` in
 * base64. The key is EINVOICE_KEY (32 bytes, base64 or hex). Outside production a key is derived from
 * the auth secret so development works without setup; in production sealing refuses to run without
 * an explicit key, because a key derived from the session secret would silently tie the two together.
 */
function key(): Buffer {
  const raw = config.einvoiceKey.trim();
  if (raw) {
    const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error('EINVOICE_KEY must be 32 bytes (base64 or 64 hex characters)');
    return k;
  }
  if (config.env === 'production') throw new Error('EINVOICE_KEY is not set — it is required to store ZATCA keys and credentials in production');
  return scryptSync(config.authSecret, 'mmc-einvoice-dev', 32);
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function open(boxed: string): string {
  const [v, iv, tag, ct] = boxed.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('not a sealed secret');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
