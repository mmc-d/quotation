import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { APIError } from 'better-auth/api';
import { and, authAccount, authPasskey, authSession, authTwoFactor, authUser, authVerification, appUser, eq, loginEvent, sql, withTenant } from '@mmc/db';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { getDb } from '../common/db.js';

/**
 * Login (module 01 §3.1): invitation-only. Google sign-in for staff, passkeys, TOTP (mandatory for
 * privileged roles when MFA_ENFORCE=true), e-mail + password as fallback. Identity data stays in
 * our Postgres (PDPL). A sign-up succeeds only for an e-mail an admin invited (app_user row);
 * the new identity is then linked to that app_user.
 */
async function invitationFor(email: string) {
  const rows = await getDb().execute<{ tenant_id: string; app_user_id: string; status: string; auth_user_id: string | null }>(sql`select * from app_user_by_email(${email})`);
  return rows[0] ?? null;
}

let mailer: nodemailer.Transporter | null = null;
/** Auth e-mails (verification, password reset). Without SMTP (development) the link is logged. */
async function sendAuthMail(to: string, subject: string, text: string) {
  if (!config.smtpUrl) {
    console.log(`[auth-mail:sandbox] to=${to} subject=${subject}\n${text}`);
    return;
  }
  mailer ??= nodemailer.createTransport(config.smtpUrl);
  await mailer.sendMail({ from: config.mailFrom, to, subject, text });
}

function domainAllowed(email: string): boolean {
  if (!config.allowedEmailDomains.length) return true;
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  return config.allowedEmailDomains.includes(d);
}

/**
 * Link an identity to its invitation (idempotent). Runs at user creation and again at every session
 * creation, because Better Auth may create the first session before user "after" hooks complete.
 */
async function ensureLinked(authUserId: string, email?: string, name?: string | null) {
  const linked = await getDb().execute<{ tenant_id: string; app_user_id: string; status: string }>(sql`select * from tenant_for_auth_user(${authUserId})`);
  if (linked[0]) return linked[0];
  const [u] = await getDb().select({ email: authUser.email, name: authUser.name, emailVerified: authUser.emailVerified }).from(authUser).where(eq(authUser.id, authUserId));
  // Only a verified e-mail can claim an invitation.
  if (!u?.emailVerified) return null;
  const addr = email ?? u.email;
  const display = name ?? u.name ?? null;
  const inv = await invitationFor(addr);
  if (!inv || inv.status === 'suspended' || (inv.auth_user_id && inv.auth_user_id !== authUserId)) return null;
  await withTenant(getDb(), inv.tenant_id, (tx) =>
    tx.update(appUser).set({ authUserId, status: 'active', ...(display ? { nameAr: display } : {}), updatedAt: new Date() }).where(eq(appUser.id, inv.app_user_id)),
  );
  return { tenant_id: inv.tenant_id, app_user_id: inv.app_user_id, status: 'active' };
}

const webUrl = new URL(config.webOrigin);

export const auth = betterAuth({
  appName: 'MMC Core',
  baseURL: config.publicBaseUrl,
  basePath: '/api/auth',
  secret: config.authSecret,
  trustedOrigins: [config.webOrigin, config.publicBaseUrl],
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: { user: authUser, session: authSession, account: authAccount, verification: authVerification, twoFactor: authTwoFactor, passkey: authPasskey },
  }),
  // Invitation-only means the e-mail must be proven: password sign-ups verify by link first.
  emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: false, requireEmailVerification: true },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthMail(user.email, 'تأكيد البريد الإلكتروني — MMC Core', `لإكمال تفعيل حسابك افتح الرابط التالي:\n${url}\n\nإذا لم تطلب ذلك فتجاهل هذه الرسالة.`);
    },
  },
  socialProviders: config.google.clientId ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret, prompt: 'select_account' } } : {},
  account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
  session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60, cookieCache: { enabled: false } },
  rateLimit: { enabled: true, window: 60, max: 100, customRules: { '/sign-in/email': { window: 60, max: 5 }, '/two-factor/verify-totp': { window: 60, max: 5 } } },
  advanced: { cookiePrefix: 'mmc', useSecureCookies: webUrl.protocol === 'https:' },
  plugins: [
    twoFactor({ issuer: 'MMC Core' }),
    passkey({ rpID: webUrl.hostname, rpName: 'MMC Core', origin: config.webOrigin }),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const email = user.email.toLowerCase();
          const inv = await invitationFor(email);
          if (!inv || inv.status === 'suspended' || !domainAllowed(email)) {
            throw new APIError('FORBIDDEN', { message: 'هذا البريد غير مدعو إلى النظام — اطلب دعوة من المسؤول / This e-mail has not been invited' });
          }
          return { data: { ...user, email } };
        },
      },
    },
    account: {
      create: {
        // A social identity proves the e-mail. If it lands on an existing, never-verified account,
        // drop any password set on it — otherwise whoever registered first could keep a way in.
        before: async (account) => {
          if (account.providerId !== 'credential') {
            const [u] = await getDb().select({ emailVerified: authUser.emailVerified }).from(authUser).where(eq(authUser.id, account.userId));
            if (u && !u.emailVerified) await getDb().delete(authAccount).where(and(eq(authAccount.userId, account.userId), eq(authAccount.providerId, 'credential')));
          }
          return { data: account };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const u = await ensureLinked(session.userId);
          if (!u || u.status !== 'active') throw new APIError('FORBIDDEN', { message: 'الحساب غير مفعل / Account is not active' });
          return { data: session };
        },
        after: async (session) => {
          const rows = await getDb().execute<{ tenant_id: string; app_user_id: string }>(sql`select * from tenant_for_auth_user(${session.userId})`);
          const u = rows[0];
          if (!u) return;
          await getDb().insert(loginEvent).values({ tenantId: u.tenant_id, userId: u.app_user_id, result: 'success', ip: session.ipAddress ?? null, userAgent: session.userAgent ?? null });
          await withTenant(getDb(), u.tenant_id, (tx) => tx.update(appUser).set({ lastLoginAt: new Date() }).where(eq(appUser.id, u.app_user_id)));
        },
      },
    },
  },
});

export type Auth = typeof auth;
