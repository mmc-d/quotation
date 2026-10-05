/** Typed environment. Empty integration settings select the sandbox/fake adapters. */
function list(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.API_PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mmc_app:mmc_app_dev_only@localhost:5433/mmc',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  authSecret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-secret-change-me-dev-only-secret',
  google: { clientId: process.env.GOOGLE_CLIENT_ID ?? '', clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '' },
  allowedEmailDomains: list(process.env.ALLOWED_EMAIL_DOMAINS),
  mfaEnforce: process.env.MFA_ENFORCE === 'true',
  gotenbergUrl: process.env.GOTENBERG_URL ?? 'http://localhost:3300',
  filesDir: process.env.FILES_DIR ?? './.data/files',
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? 'dev-verify-token',
    appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  },
  smtpUrl: process.env.SMTP_URL ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'MMC <no-reply@localhost>',
  esign: { provider: process.env.ESIGN_PROVIDER ?? 'sandbox', apiKey: process.env.ESIGN_API_KEY ?? '', webhookSecret: process.env.ESIGN_WEBHOOK_SECRET ?? 'dev-esign-secret' },
  erpnext: {
    url: process.env.ERPNEXT_URL ?? '',
    apiKey: process.env.ERPNEXT_API_KEY ?? '',
    apiSecret: process.env.ERPNEXT_API_SECRET ?? '',
    company: process.env.ERPNEXT_COMPANY ?? 'Al-Mada Al-Mubarak',
    webhookSecret: process.env.ERPNEXT_WEBHOOK_SECRET ?? '',
  },
  payments: { provider: process.env.PAYMENTS_PROVIDER ?? 'sandbox', secretKey: process.env.PAYMENTS_SECRET_KEY ?? '', webhookSecret: process.env.PAYMENTS_WEBHOOK_SECRET ?? 'dev-payments-secret' },
  leadsWebhookSecret: process.env.LEADS_WEBHOOK_SECRET ?? '',
  /** Sandbox payment/e-sign pages and OTP logging. Never true on a public server. */
  allowSandbox: process.env.ALLOW_SANDBOX === 'true' || (process.env.NODE_ENV ?? 'development') !== 'production',
  runWorkerInProcess: process.env.WORKER_IN_PROCESS !== 'false',
};
export type Config = typeof config;
