import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { appUser, eq, inArray, role, sql, teamMember, userRole, withTenant, authPasskey } from '@mmc/db';
import { mergeGrants, type Grant, type Permission } from '@mmc/domain';
import type { Request } from 'express';
import { auth } from './auth.js';
import { getDb } from '../common/db.js';
import { forbidden } from '../common/errors.js';
import { config } from '../config.js';
import { PERM_KEY, PUBLIC_KEY, type RequestActor } from './actor.js';

const PRIVILEGED = new Set(['owner', 'general_manager', 'accountant']);

/** Resolves the Better Auth session → tenant → app user, roles, grants; enforces @Perm. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Request & { actor?: RequestActor }>();
    const actor = await resolveActor(req);
    if (!actor) throw new UnauthorizedException({ error: 'unauthenticated', message: 'sign in required' });
    req.actor = actor;
    const perms = this.reflector.getAllAndOverride<Permission[] | undefined>(PERM_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (perms?.length && !perms.some((p) => actor.grants[p])) throw forbidden(`missing permission: ${perms.join(' | ')}`);
    if (config.mfaEnforce && !actor.mfaEnabled && actor.roleKeys.some((k) => PRIVILEGED.has(k)) && !req.path.startsWith('/api/me')) {
      throw forbidden('two-factor authentication or a passkey is required for your role');
    }
    return true;
  }
}

export async function resolveActor(req: Request): Promise<RequestActor | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return null;
  const rows = await getDb().execute<{ tenant_id: string; app_user_id: string; status: string }>(sql`select * from tenant_for_auth_user(${session.user.id})`);
  const link = rows[0];
  if (!link || link.status !== 'active') return null;
  return withTenant(getDb(), link.tenant_id, async (tx) => {
    const [u] = await tx.select().from(appUser).where(eq(appUser.id, link.app_user_id));
    if (!u) return null;
    const roleRows = await tx.select({ key: role.key, grants: role.grants, maxDiscountPercent: role.maxDiscountPercent }).from(userRole).innerJoin(role, eq(role.id, userRole.roleId)).where(eq(userRole.userId, u.id));
    const teams = await tx.select({ teamId: teamMember.teamId }).from(teamMember).where(eq(teamMember.userId, u.id));
    const passkeys = await tx.select({ id: authPasskey.id }).from(authPasskey).where(inArray(authPasskey.userId, [session.user.id])).limit(1);
    return {
      tenantId: link.tenant_id,
      userId: u.id,
      authUserId: session.user.id,
      email: u.email,
      name: u.nameAr || u.nameEn || session.user.name || u.email,
      locale: u.locale,
      branchId: u.branchId,
      teamIds: teams.map((t) => t.teamId),
      roleKeys: roleRows.map((r) => r.key),
      grants: mergeGrants(roleRows.map((r) => r.grants as Grant)),
      maxDiscountPercent: Math.max(0, ...roleRows.map((r) => r.maxDiscountPercent)),
      mfaEnabled: !!(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled || passkeys.length > 0,
      ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    } satisfies RequestActor;
  });
}
