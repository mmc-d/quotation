import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  and, appUser, asc, auditLog, branch, clauseTemplate, company, desc, eq, ilike, inArray, messageTemplate, numberingSeries, or, role, team, teamMember, userRole, notification, isNull, sql,
} from '@mmc/db';
import { PERMISSIONS, isValidUnifiedNumber, isValidVatNumber, normalizeSaudiMobile, ROLE_TEMPLATES } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { readStoredFile, storeFile } from '../common/files.js';
import { ZodPipe, zPage } from '../common/zod.js';

const addressSchema = z.object({ buildingNumber: z.string().optional(), street: z.string().optional(), district: z.string().optional(), city: z.string().optional(), postalCode: z.string().optional(), additionalNumber: z.string().optional(), country: z.string().optional() }).partial();

const companySchema = z.object({
  legalNameAr: z.string().min(2),
  legalNameEn: z.string().nullish(),
  tradeNameAr: z.string().nullish(),
  unifiedNumber: z.string().nullish().refine((v) => !v || isValidUnifiedNumber(v), 'unified number: 10 digits starting with 7'),
  crNumber: z.string().nullish(),
  vatRegistered: z.boolean(),
  vatEffectiveFrom: z.string().nullish(),
  vatNumber: z.string().nullish().refine((v) => !v || isValidVatNumber(v), 'VAT number: 15 digits, starts and ends with 3'),
  address: addressSchema.default({}),
  phone: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  website: z.string().nullish(),
  bankName: z.string().nullish(),
  iban: z.string().nullish().refine((v) => !v || /^SA\d{22}$/.test(v.replace(/\s+/g, '')), 'IBAN: SA + 22 digits'),
  representativeName: z.string().nullish(),
  representativeTitle: z.string().nullish(),
  representativeMobile: z.string().nullish(),
  quoteDefaults: z.object({ validityDays: z.number().int().min(1).max(365).optional(), notesAr: z.string().optional(), termsAr: z.string().optional(), termsEn: z.string().optional(), warrantyText: z.string().optional() }).default({}),
  approvalPolicy: z.object({ maxDiscountPercent: z.number().min(0).max(100), minMarginPercent: z.number().min(-100).max(100) }),
}).refine((c) => !c.vatRegistered || !!c.vatNumber, { message: 'VAT number is required when VAT-registered', path: ['vatNumber'] });

@Controller('me')
export class MeController {
  @Get()
  async me(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [co] = await tx.select({ legalNameAr: company.legalNameAr, legalNameEn: company.legalNameEn, vatRegistered: company.vatRegistered, approvalPolicy: company.approvalPolicy, quoteDefaults: company.quoteDefaults }).from(company).limit(1);
      const unread = await tx.select({ n: sql<number>`count(*)::int` }).from(notification).where(and(eq(notification.userId, actor.userId), isNull(notification.readAt)));
      return {
        user: { id: actor.userId, email: actor.email, name: actor.name, locale: actor.locale, roles: actor.roleKeys, mfaEnabled: actor.mfaEnabled },
        grants: actor.grants,
        maxDiscountPercent: actor.maxDiscountPercent,
        company: co,
        unreadNotifications: unread[0]?.n ?? 0,
      };
    });
  }

  @Patch()
  async update(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ locale: z.enum(['ar', 'en']).optional(), nameAr: z.string().optional(), mobile: z.string().optional() }))) body: { locale?: string; nameAr?: string; mobile?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [u] = await tx.update(appUser).set({ ...body, mobile: body.mobile ? normalizeSaudiMobile(body.mobile) ?? body.mobile : undefined, updatedAt: new Date() }).where(eq(appUser.id, actor.userId)).returning();
      return u;
    });
  }

  @Get('notifications')
  async notifications(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => tx.select().from(notification).where(eq(notification.userId, actor.userId)).orderBy(desc(notification.createdAt)).limit(50));
  }

  @Post('notifications/read')
  async readAll(@Actor() actor: RequestActor) {
    await tenantTx(actor.tenantId, (tx) => tx.update(notification).set({ readAt: new Date() }).where(and(eq(notification.userId, actor.userId), isNull(notification.readAt))));
    return { ok: true };
  }
}

/** Contract template sets (clause libraries) — supply & install, supply only, annual maintenance. */
const TEMPLATE_SETS = ['supply_install', 'supply_only', 'maintenance'] as const;

@Controller('settings')
export class SettingsController {
  @Get('company')
  @Perm('admin.settings', 'quote.read')
  async getCompany(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [co] = await tx.select().from(company).limit(1);
      const branches = await tx.select().from(branch).orderBy(asc(branch.code));
      return { ...co, branches };
    });
  }

  @Put('company')
  @Perm('admin.settings')
  async putCompany(@Actor() actor: RequestActor, @Body(new ZodPipe(companySchema)) body: z.infer<typeof companySchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(company).limit(1);
      if (!before) throw notFound('company');
      const values = { ...body, iban: body.iban?.replace(/\s+/g, '') ?? null, email: body.email || null, representativeMobile: body.representativeMobile ? normalizeSaudiMobile(body.representativeMobile) ?? body.representativeMobile : null };
      const [after] = await tx.update(company).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(company.id, before.id)).returning();
      const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'company', before.id, d.before, d.after);
      return after;
    }, actor.userId);
  }

  /** Logo/stamp upload (base64 JSON body, PNG/JPEG ≤ 2 MB). The stamp is only ever applied explicitly. */
  @Post('company/:kind')
  @Perm('admin.settings')
  async uploadImage(@Actor() actor: RequestActor, @Param('kind') kind: 'logo' | 'stamp', @Body(new ZodPipe(z.object({ filename: z.string(), mime: z.enum(['image/png', 'image/jpeg']), dataBase64: z.string().max(3_000_000) }))) body: { filename: string; mime: string; dataBase64: string }) {
    if (kind !== 'logo' && kind !== 'stamp') throw notFound('upload target');
    return tenantTx(actor.tenantId, async (tx) => {
      const data = Buffer.from(body.dataBase64, 'base64');
      if (data.length > 2_000_000) throw badRequest('image larger than 2 MB');
      const f = await storeFile(tx, actor.tenantId, data, body.filename, body.mime, actor.userId);
      const [co] = await tx.select().from(company).limit(1);
      await tx.update(company).set(kind === 'logo' ? { logoFileId: f.id } : { stampFileId: f.id }).where(eq(company.id, co!.id));
      await audit(tx, actor, `upload_${kind}`, 'company', co!.id, null, { fileId: f.id, sha256: f.sha256 });
      return { fileId: f.id };
    });
  }

  @Put('branches/:id')
  @Perm('admin.settings')
  async putBranch(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ code: z.string().min(1), nameAr: z.string().min(1), nameEn: z.string().nullish(), isHeadOffice: z.boolean().default(false), address: z.record(z.string(), z.string()).default({}), zatcaEgsUnit: z.string().nullish() }))) body: { code: string; nameAr: string; nameEn?: string | null; isHeadOffice: boolean; address: Record<string, string>; zatcaEgsUnit?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [co] = await tx.select().from(company).limit(1);
      if (id === 'new') {
        const [b] = await tx.insert(branch).values({ ...body, companyId: co!.id }).returning();
        await audit(tx, actor, 'create', 'branch', b!.id, null, body);
        return b;
      }
      const [b] = await tx.update(branch).set({ ...body, updatedAt: new Date() }).where(eq(branch.id, id)).returning();
      if (!b) throw notFound('branch');
      await audit(tx, actor, 'update', 'branch', id, null, body);
      return b;
    });
  }

  @Get('numbering')
  @Perm('admin.settings')
  async numbering(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => tx.execute(sql`
      select s.id, s.document_type, s.pattern, s.reset, s.start_at, coalesce(max(c.last_value), 0) as last_value
      from numbering_series s left join numbering_counter c on c.series_id = s.id group by s.id order by s.document_type`));
  }

  @Put('numbering/:id')
  @Perm('admin.settings')
  async putNumbering(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ pattern: z.string().regex(/\{SEQ(:\d+)?\}/, 'pattern must contain {SEQ}'), startAt: z.number().int().min(1) }))) body: { pattern: string; startAt: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(numberingSeries).where(eq(numberingSeries.id, id));
      if (!before) throw notFound('series');
      // start can jump ahead, never back (numbers are never reused).
      await tx.execute(sql`update numbering_counter set last_value = greatest(last_value, ${body.startAt - 1}) where series_id = ${id}`);
      const [s] = await tx.update(numberingSeries).set({ pattern: body.pattern, startAt: Math.max(before.startAt, body.startAt), updatedAt: new Date() }).where(eq(numberingSeries.id, id)).returning();
      await audit(tx, actor, 'update', 'numbering_series', id, { pattern: before.pattern, startAt: before.startAt }, body);
      return s;
    });
  }

  @Get('clauses')
  @Perm('contract.read')
  async clauses(@Actor() actor: RequestActor, @Query('templateSet') templateSet?: string) {
    if (templateSet && !TEMPLATE_SETS.includes(templateSet as (typeof TEMPLATE_SETS)[number])) throw badRequest('unknown template set');
    return tenantTx(actor.tenantId, (tx) => tx.select().from(clauseTemplate).where(templateSet ? eq(clauseTemplate.templateSet, templateSet) : undefined).orderBy(asc(clauseTemplate.templateSet), asc(clauseTemplate.sort)));
  }

  @Put('clauses/:id')
  @Perm('admin.settings')
  async putClause(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ key: z.string().min(1), category: z.string().min(1), titleAr: z.string().min(1), bodyAr: z.string().min(1), titleEn: z.string().nullish(), bodyEn: z.string().nullish(), sort: z.number().int().default(0), active: z.boolean().default(true), templateSet: z.enum(TEMPLATE_SETS).optional() }))) b: { key: string; category: string; titleAr: string; bodyAr: string; titleEn?: string | null; bodyEn?: string | null; sort: number; active: boolean; templateSet?: (typeof TEMPLATE_SETS)[number] }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = id === 'new' ? [] : await tx.select().from(clauseTemplate).where(eq(clauseTemplate.id, id));
      if (id !== 'new' && !before) throw notFound('clause');
      const body = { ...b, templateSet: b.templateSet ?? before?.templateSet ?? 'supply_install' };
      if (id === 'new') {
        const [dup] = await tx.select({ id: clauseTemplate.id }).from(clauseTemplate).where(and(eq(clauseTemplate.templateSet, body.templateSet), eq(clauseTemplate.key, body.key)));
        if (dup) throw conflict(`clause key ${body.key} already exists in this template set`);
        const [c] = await tx.insert(clauseTemplate).values(body).returning();
        await audit(tx, actor, 'create', 'clause_template', c!.id, null, body);
        return c;
      }
      if (!before) throw notFound('clause');
      const [c] = await tx.update(clauseTemplate).set({ ...body, clauseVersion: before.bodyAr !== body.bodyAr ? before.clauseVersion + 1 : before.clauseVersion, updatedAt: new Date() }).where(eq(clauseTemplate.id, id)).returning();
      await audit(tx, actor, 'update', 'clause_template', id, { bodyAr: before.bodyAr, titleAr: before.titleAr, templateSet: before.templateSet }, { bodyAr: body.bodyAr, titleAr: body.titleAr, templateSet: body.templateSet });
      return c;
    });
  }

  @Get('message-templates')
  @Perm('message.read', 'admin.settings')
  async templates(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => tx.select().from(messageTemplate).orderBy(asc(messageTemplate.key)));
  }

  @Put('message-templates/:id')
  @Perm('admin.settings')
  async putTemplate(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ body: z.string().min(1), providerTemplateName: z.string().nullish(), active: z.boolean().default(true) }))) body: { body: string; providerTemplateName?: string | null; active: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [t] = await tx.update(messageTemplate).set({ ...body, updatedAt: new Date() }).where(eq(messageTemplate.id, id)).returning();
      if (!t) throw notFound('template');
      await audit(tx, actor, 'update', 'message_template', id, null, body);
      return t;
    });
  }
}

const inviteSchema = z.object({ email: z.string().email(), nameAr: z.string().min(1), nameEn: z.string().nullish(), mobile: z.string().nullish(), roleKeys: z.array(z.string()).min(1), branchId: z.string().uuid().nullish(), userCode: z.string().nullish() });

@Controller('users')
export class UsersController {
  @Get()
  @Perm('admin.users', 'quote.approve')
  async list(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const users = await tx.select().from(appUser).orderBy(asc(appUser.email));
      const ur = await tx.select({ userId: userRole.userId, key: role.key }).from(userRole).innerJoin(role, eq(role.id, userRole.roleId));
      const tm = await tx.select().from(teamMember);
      return users.map((u) => ({ ...u, authUserId: undefined, roles: ur.filter((r) => r.userId === u.id).map((r) => r.key), teamIds: tm.filter((t) => t.userId === u.id).map((t) => t.teamId) }));
    });
  }

  @Get('roles')
  @Perm('admin.users', 'admin.roles')
  async roles(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => ({ roles: await tx.select().from(role).orderBy(asc(role.key)), permissions: PERMISSIONS, templates: Object.keys(ROLE_TEMPLATES) }));
  }

  @Put('roles/:id')
  @Perm('admin.roles')
  async putRole(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ nameAr: z.string(), nameEn: z.string(), grants: z.record(z.string(), z.enum(['own', 'team', 'branch', 'company', 'all'])), maxDiscountPercent: z.number().int().min(0).max(100) }))) body: { nameAr: string; nameEn: string; grants: Record<string, string>; maxDiscountPercent: number }) {
    const unknown = Object.keys(body.grants).filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
    if (unknown.length) throw badRequest(`unknown permissions: ${unknown.join(', ')}`);
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(role).where(eq(role.id, id));
      if (!before) throw notFound('role');
      const [r] = await tx.update(role).set({ ...body, updatedAt: new Date() }).where(eq(role.id, id)).returning();
      await audit(tx, actor, 'update', 'role', id, { grants: before.grants, maxDiscountPercent: before.maxDiscountPercent }, { grants: body.grants, maxDiscountPercent: body.maxDiscountPercent });
      return r;
    });
  }

  /** Invite (never self-sign-up): the person signs in with Google/passkey/password using this e-mail. */
  @Post('invite')
  @Perm('admin.users')
  async invite(@Actor() actor: RequestActor, @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const email = body.email.toLowerCase();
      const [exists] = await tx.select().from(appUser).where(eq(appUser.email, email));
      if (exists) throw conflict('user already exists');
      const roles = await tx.select().from(role).where(inArray(role.key, body.roleKeys));
      if (roles.length !== body.roleKeys.length) throw badRequest('unknown role');
      const [u] = await tx.insert(appUser).values({ email, nameAr: body.nameAr, nameEn: body.nameEn ?? null, mobile: body.mobile ? normalizeSaudiMobile(body.mobile) ?? body.mobile : null, branchId: body.branchId ?? null, userCode: body.userCode ?? null, status: 'invited', invitedBy: actor.userId, invitedAt: new Date() }).returning();
      if (roles.length) await tx.insert(userRole).values(roles.map((r) => ({ userId: u!.id, roleId: r.id, grantedBy: actor.userId })));
      await audit(tx, actor, 'invite', 'app_user', u!.id, null, { email, roles: body.roleKeys });
      return u;
    }, actor.userId);
  }

  @Put(':id')
  @Perm('admin.users')
  async update(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ nameAr: z.string().optional(), nameEn: z.string().nullish(), mobile: z.string().nullish(), branchId: z.string().uuid().nullish(), managerId: z.string().uuid().nullish(), roleKeys: z.array(z.string()).optional(), teamIds: z.array(z.string().uuid()).optional(), status: z.enum(['invited', 'active', 'suspended']).optional(), userCode: z.string().nullish() }))) body: { nameAr?: string; nameEn?: string | null; mobile?: string | null; branchId?: string | null; managerId?: string | null; roleKeys?: string[]; teamIds?: string[]; status?: 'invited' | 'active' | 'suspended'; userCode?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(appUser).where(eq(appUser.id, id));
      if (!before) throw notFound('user');
      if (id === actor.userId && body.status === 'suspended') throw badRequest('you cannot suspend yourself');
      const { roleKeys, teamIds, ...fields } = body;
      if (body.status === 'active' && !before.authUserId) fields.status = 'invited';
      const [u] = await tx.update(appUser).set({ ...fields, updatedAt: new Date() }).where(eq(appUser.id, id)).returning();
      if (roleKeys) {
        const roles = await tx.select().from(role).where(inArray(role.key, roleKeys));
        const prev = await tx.select({ key: role.key }).from(userRole).innerJoin(role, eq(role.id, userRole.roleId)).where(eq(userRole.userId, id));
        if (prev.some((p) => p.key === 'owner') && !roleKeys.includes('owner')) {
          const owners = await tx.select({ n: sql<number>`count(*)::int` }).from(userRole).innerJoin(role, eq(role.id, userRole.roleId)).where(eq(role.key, 'owner'));
          if ((owners[0]?.n ?? 0) <= 1) throw badRequest('at least one owner must remain');
        }
        await tx.delete(userRole).where(eq(userRole.userId, id));
        if (roles.length) await tx.insert(userRole).values(roles.map((r) => ({ userId: id, roleId: r.id, grantedBy: actor.userId })));
        await audit(tx, actor, 'roles', 'app_user', id, { roles: prev.map((p) => p.key) }, { roles: roleKeys });
      }
      if (teamIds) {
        await tx.delete(teamMember).where(eq(teamMember.userId, id));
        if (teamIds.length) await tx.insert(teamMember).values(teamIds.map((teamId) => ({ teamId, userId: id })));
      }
      if (body.status && body.status !== before.status) {
        await audit(tx, actor, body.status === 'suspended' ? 'suspend' : 'reactivate', 'app_user', id, { status: before.status }, { status: body.status });
        // Suspension also ends live sessions (Google SSO alone would not).
        if (body.status === 'suspended' && before.authUserId) await tx.execute(sql`delete from auth_session where user_id = ${before.authUserId}`);
      }
      return u;
    }, actor.userId);
  }

  @Get('teams')
  @Perm('admin.users', 'quote.read')
  async teams(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => tx.select().from(team).orderBy(asc(team.nameAr)));
  }

  @Put('teams/:id')
  @Perm('admin.users')
  async putTeam(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ nameAr: z.string().min(1), nameEn: z.string().nullish(), kind: z.string().default('sales'), managerId: z.string().uuid().nullish() }))) body: { nameAr: string; nameEn?: string | null; kind: string; managerId?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (id === 'new') return (await tx.insert(team).values(body).returning())[0];
      const [t] = await tx.update(team).set({ ...body, updatedAt: new Date() }).where(eq(team.id, id)).returning();
      if (!t) throw notFound('team');
      return t;
    });
  }
}

@Controller('audit')
export class AuditController {
  @Get()
  @Perm('admin.audit')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ entityType: z.string().optional(), entityId: z.string().optional() }))) q: { q?: string; limit: number; offset: number; entityType?: string; entityId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const where = and(q.entityType ? eq(auditLog.entityType, q.entityType) : undefined, q.entityId ? eq(auditLog.entityId, q.entityId) : undefined, q.q ? or(ilike(auditLog.action, `%${q.q}%`), ilike(auditLog.entityType, `%${q.q}%`)) : undefined);
      const rows = await tx.select().from(auditLog).where(where).orderBy(desc(auditLog.id)).limit(q.limit).offset(q.offset);
      const users = await tx.select({ id: appUser.id, email: appUser.email, nameAr: appUser.nameAr }).from(appUser);
      return rows.map((r) => ({ ...r, actor: users.find((u) => u.id === r.actorId) ?? null }));
    });
  }

  /** Verify the hash chain end to end (tamper evidence). */
  @Get('verify')
  @Perm('admin.audit')
  async verify(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({ id: auditLog.id, hash: auditLog.hash, prevHash: auditLog.prevHash }).from(auditLog).orderBy(asc(auditLog.id));
      const broken = rows.filter((r, i) => i > 0 && r.prevHash !== rows[i - 1]!.hash).map((r) => r.id);
      return { entries: rows.length, intact: broken.length === 0, brokenAt: broken };
    });
  }
}

/** Staff uploads (POST /api/files): photos and PDFs, ≤ 8 MB. */
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
const uploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contentType: z.enum(UPLOAD_TYPES),
  data: z.string().min(1).max(Math.ceil((UPLOAD_MAX_BYTES * 4) / 3) + 16),
});

/** The first bytes must match the declared type (a renamed .exe is refused). */
function sniffOk(mime: (typeof UPLOAD_TYPES)[number], b: Buffer): boolean {
  const ascii = (from: number, to: number) => b.subarray(from, to).toString('latin1');
  switch (mime) {
    case 'image/jpeg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png': return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/heic': return ascii(4, 8) === 'ftyp';
    case 'application/pdf': return ascii(0, 5) === '%PDF-';
  }
}

@Controller('files')
export class FilesController {
  /** Any signed-in staff user (no specific permission): the file is only reachable by its id inside the tenant. */
  @Post()
  async upload(@Actor() actor: RequestActor, @Body(new ZodPipe(uploadSchema)) b: z.infer<typeof uploadSchema>) {
    const data = Buffer.from(b.data, 'base64');
    if (!data.length) throw badRequest('empty file');
    if (data.length > UPLOAD_MAX_BYTES) throw badRequest('file larger than 8 MB');
    if (!sniffOk(b.contentType, data)) throw badRequest(`the file content is not ${b.contentType}`);
    return tenantTx(actor.tenantId, async (tx) => {
      const f = await storeFile(tx, actor.tenantId, data, b.name, b.contentType, actor.userId);
      await audit(tx, actor, 'upload', 'file', f.id, null, { filename: f.filename, mime: f.mime, size: f.size, sha256: f.sha256 });
      return { id: f.id, url: `/api/files/${f.id}`, filename: f.filename, mime: f.mime, size: f.size };
    }, actor.userId);
  }

  @Get(':id')
  async download(@Actor() actor: RequestActor, @Param('id') id: string, @Res() res: Response) {
    const f = await tenantTx(actor.tenantId, (tx) => readStoredFile(tx, id));
    if (!f) throw notFound('file');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(f.data);
  }
}
