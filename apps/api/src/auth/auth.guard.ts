import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { appUser, authUser, eq, inArray, role, sql, teamMember, userRole, withTenant, authPasskey } from '@mmc/db';
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
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

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
  return loadActor(link.tenant_id, link.app_user_id, req, {
    authUserId: session.user.id,
    sessionName: session.user.name,
    twoFactorEnabled: !!(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled,
  });
}

/**
 * The RequestActor of an app user (roles, merged grants, teams). Shared by the session guard and
 * the MCP personal-token auth, so both see exactly the same permissions. Only active users.
 */
export async function loadActor(tenantId: string, appUserId: string, req: Request, s: { authUserId?: string | null; sessionName?: string | null; twoFactorEnabled?: boolean } = {}): Promise<RequestActor | null> {
  return withTenant(getDb(), tenantId, async (tx) => {
    const [u] = await tx.select().from(appUser).where(eq(appUser.id, appUserId));
    if (!u || u.status !== 'active') return null;
    const authUserId = s.authUserId ?? u.authUserId;
    if (!authUserId) return null;
    const roleRows = await tx.select({ key: role.key, grants: role.grants, maxDiscountPercent: role.maxDiscountPercent }).from(userRole).innerJoin(role, eq(role.id, userRole.roleId)).where(eq(userRole.userId, u.id));
    const teams = await tx.select({ teamId: teamMember.teamId }).from(teamMember).where(eq(teamMember.userId, u.id));
    const passkeys = await tx.select({ id: authPasskey.id }).from(authPasskey).where(inArray(authPasskey.userId, [authUserId])).limit(1);
    const twoFactor = s.twoFactorEnabled ?? !!(await tx.select({ on: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, authUserId)))[0]?.on;
    return {
      tenantId,
      userId: u.id,
      authUserId,
      email: u.email,
      name: u.nameAr || u.nameEn || s.sessionName || u.email,
      locale: u.locale,
      branchId: u.branchId,
      teamIds: teams.map((t) => t.teamId),
      roleKeys: roleRows.map((r) => r.key),
      grants: mergeGrants(roleRows.map((r) => r.grants as Grant)),
      maxDiscountPercent: Math.max(0, ...roleRows.map((r) => r.maxDiscountPercent)),
      mfaEnabled: twoFactor || passkeys.length > 0,
      ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    } satisfies RequestActor;
  });
}

/** Privileged roles must have 2FA or a passkey when MFA_ENFORCE is on. */
export function mfaBlocked(actor: RequestActor): boolean {
  return config.mfaEnforce && !actor.mfaEnabled && actor.roleKeys.some((k) => PRIVILEGED.has(k));
}
