# المدى المبارك — MMC Platform

This repository holds two generations of the company's sales tooling:

| Path | What it is |
|------|-----------|
| `index.html` (+ `apps-script/`, `tests/`, `vendor/`) | The **legacy** single-page quotation tool served by GitHub Pages. Kept running until MMC Core cuts over, then read-only. |
| `apps/`, `packages/`, `infra/` | **MMC Core** — the new platform (CRM + quotations + contracts + billing), built per [`docs/erp-plan/`](docs/erp-plan/README.md). |
| `quotation-api/` | The old Node/Puppeteer PDF service used by the legacy tool. |

## MMC Core at a glance

```
apps/api            NestJS REST API + Better Auth (/api/auth) + pg-boss worker
apps/web            Next.js staff app (Arabic RTL) + public pages: /q/<token> quote, /p/<token> payment, /sign/<id>, /lead
packages/domain     Pure business rules (money, INS line, VAT, tafqit, numbering, 386/388 billing, ZATCA QR, permissions, CRM)
packages/db         Drizzle schema, SQL migrations with row-level security, seed, legacy import
packages/erp-connector  BackOfficePort: ERPNext + KSA compliance app adapter, and a fake for development
packages/doc-templates  RTL HTML templates (quote, contract, payment request, invoice) → PDF via Gotenberg
infra/              docker-compose for local Postgres + Gotenberg
```

The ledger, ZATCA Phase-2 e-invoicing, purchasing, stock and payroll live in the **ERPNext back office** (decision D11). Core only talks to it through `BackOfficePort`. Without `ERPNEXT_URL`, Core uses an in-process fake. That is fine for development, but it does **not** submit anything to ZATCA.

## Run it locally

Prerequisites: Node 22, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env            # local defaults
pnpm db:up                      # Postgres on :5433, Gotenberg on :3300
pnpm --filter @mmc/db migrate   # schema + row-level security
SEED_OWNER_EMAIL=you@example.com pnpm --filter @mmc/db seed
pnpm --filter "./packages/*" build
pnpm --filter @mmc/api dev      # API on :4000 (also runs the background jobs)
pnpm --filter @mmc/web dev      # web on :3000 (proxies /api to :4000)
```

Open http://localhost:3000 and choose **فعّل حسابك** (activate your account) with the invited e-mail. Without SMTP configured, the verification link is printed in the API log.

Access is invitation-only. An owner invites staff in **الإعدادات ← المستخدمون والصلاحيات** (Settings → Users & roles). Invited staff then sign in with Google (once `GOOGLE_CLIENT_ID` is set), a passkey, or e-mail plus password (verified by link). TOTP two-factor sign-in can be enabled per user. Set `MFA_ENFORCE=true` to require it for owner, general-manager and accountant roles.

### Import the legacy data

Put every JSON the old tool produced into one folder: Drive quote, contract and invoice files, plus each browser's `mmc-local-backup-*.json`. Then run:

```bash
pnpm --filter @mmc/db import:legacy -- --dir ./legacy-archive --dry-run
pnpm --filter @mmc/db import:legacy -- --dir ./legacy-archive
```

The import is idempotent. Numbering continues after the highest imported `MMC-…`, `MMCT-…` and `MMC-INV-…` numbers.

### Tests

```bash
pnpm --filter @mmc/domain test        # business rules + parity with the legacy index.html
pnpm --filter @mmc/db test            # migrations, RLS isolation, numbering, audit chain, legacy import
pnpm --filter @mmc/erp-connector test
pnpm --filter @mmc/api test           # end-to-end, Phases 1–3, over HTTP against a fresh database
```

CI runs all of them (`.github/workflows/mmc-core.yml`).

## Integrations (sandbox until configured)

| Integration | Setting | Without it |
|-------------|---------|------------|
| ERPNext + KSA compliance app | `ERPNEXT_URL`, `ERPNEXT_API_KEY/SECRET`, `ERPNEXT_WEBHOOK_SECRET` | Fake back office: invoices are computed and numbered, but nothing is sent to ZATCA |
| Google sign-in | `GOOGLE_CLIENT_ID/SECRET` | Passkey and e-mail sign-in only |
| WhatsApp Cloud API | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Messages are logged as sent, not delivered |
| E-mail | `SMTP_URL`, `MAIL_FROM` | Logged |
| E-signature (Nafath via a licensed provider) | `ESIGN_PROVIDER`, `ESIGN_API_KEY` | Sandbox signing page at `/sign/<id>` |
| Payment gateway | `PAYMENTS_PROVIDER`, `PAYMENTS_SECRET_KEY`, `PAYMENTS_WEBHOOK_SECRET` | Sandbox "pay now" button on `/p/<token>` |
