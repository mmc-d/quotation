import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Grant, Permission, Scope } from '@mmc/domain';

export interface RequestActor {
  tenantId: string;
  userId: string;
  authUserId: string;
  email: string;
  name: string;
  locale: string;
  branchId: string | null;
  teamIds: string[];
  roleKeys: string[];
  grants: Grant;
  maxDiscountPercent: number;
  mfaEnabled: boolean;
  ip: string | null;
  userAgent: string | null;
}

export const PERM_KEY = 'mmc:perm';
export const PUBLIC_KEY = 'mmc:public';

/** Require a permission (any scope) to reach the handler; record-level scope is checked in services. */
export const Perm = (...perms: Permission[]) => SetMetadata(PERM_KEY, perms);
/** No session needed (public quote/payment pages, webhooks, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestActor => {
  const req = ctx.switchToHttp().getRequest<{ actor?: RequestActor }>();
  if (!req.actor) throw new Error('actor missing — route is not behind AuthGuard');
  return req.actor;
});

/** SQL-friendly description of which records the actor may see for a permission. */
export function visibility(actor: RequestActor, perm: Permission): { scope: Scope; userId: string; teamIds: string[]; branchId: string | null } | null {
  const scope = actor.grants[perm];
  if (!scope) return null;
  return { scope, userId: actor.userId, teamIds: actor.teamIds, branchId: actor.branchId };
}
