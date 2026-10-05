import { eq, inArray, isNull, or, sql, type AnyPgColumn, type SQL } from '@mmc/db';
import type { Permission } from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { forbidden } from './errors.js';

/** WHERE clause restricting rows to what the actor's scope for `perm` allows (RLS already limits the tenant). */
export function scopeFilter(actor: RequestActor, perm: Permission, cols: { owner?: AnyPgColumn; team?: AnyPgColumn; branch?: AnyPgColumn }): SQL | undefined {
  const scope = actor.grants[perm];
  if (!scope) throw forbidden(`missing permission: ${perm}`);
  if (scope === 'all' || scope === 'company') return undefined;
  if (scope === 'branch') return cols.branch ? (actor.branchId ? or(eq(cols.branch, actor.branchId), isNull(cols.branch)) : undefined) : undefined;
  const own = cols.owner ? eq(cols.owner, actor.userId) : sql`false`;
  if (scope === 'team' && cols.team && actor.teamIds.length) return or(own, inArray(cols.team, actor.teamIds));
  return own;
}

export function assertCan(actor: RequestActor, perm: Permission, rec: { ownerId?: string | null; teamId?: string | null; branchId?: string | null }) {
  const scope = actor.grants[perm];
  const ok = !!scope && (scope === 'all' || scope === 'company'
    || (scope === 'branch' && (!rec.branchId || rec.branchId === actor.branchId))
    || (scope === 'team' && (rec.ownerId === actor.userId || (!!rec.teamId && actor.teamIds.includes(rec.teamId))))
    || (scope === 'own' && rec.ownerId === actor.userId));
  if (!ok) throw forbidden(`not allowed: ${perm}`);
}
