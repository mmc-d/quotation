import { writeAudit, type Tx } from '@mmc/db';
import type { RequestActor } from '../auth/actor.js';

export function audit(tx: Tx, actor: RequestActor | null, action: string, entityType: string, entityId: string | null, before?: unknown, after?: unknown, reason?: string) {
  return writeAudit(tx, { actorId: actor?.userId ?? null, action, entityType, entityId, before, after, ip: actor?.ip ?? null, userAgent: actor?.userAgent ?? null, reason: reason ?? null });
}

/** Only the fields that changed (field history on key records). */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (k === 'updatedAt' || k === 'version') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
