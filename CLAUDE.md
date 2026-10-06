# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Al-Mada Al-Mubarak (المدى المبارك)** — a quotation and contract platform for a Saudi trading company. It consists of two independent components:

1. **`index.html`** (repo root, served by GitHub Pages) — A self-contained single-page HTML app (no build step) for building quotations and contracts, backed by Google Sheets/Drive. Supporting folders: `apps-script/` (the hardened Apps Script backend — `Code.gs` + deployment README), `vendor/` (pinned local copies of ExcelJS, DOMPurify, qrcode), `tests/` (Playwright suite that mocks every Google/Apps Script endpoint — `cd tests && npm install && npx playwright test`).
2. **`quotation-api/`** — A Node.js/Express REST API that generates Arabic PDF quotations via Puppeteer/Chromium.

**Roadmap:** `docs/erp-plan/` holds the plan to grow this into an ERP + CRM + accounting platform (start at its `README.md`; phases in `05-roadmap.md`). Phase 0 (hardening) is done in code; the owner-only steps are in `docs/erp-plan/phase-0-owner-checklist.md`. Phases 1–3 are built as **MMC Core** (below); status in `docs/erp-plan/phase-1-3-status.md`.

## MMC Core (apps/, packages/) — the new platform

pnpm + Turborepo monorepo, TypeScript strict, ESM everywhere. See the root `README.md` for local setup (Postgres on :5433 and Gotenberg on :3300 via `pnpm db:up`).

- **`packages/domain`** — pure business rules, the single source of truth for money (integer **halalas**, `decimal.js`), quote totals and the **INS** line (`syncInstallationLine`), VAT and the not-registered mode, `tafqit`, numbering (`MMC-{YY}{WW}{DD}{n}`, `MMCT-{n}`, `MMC-INV-{nnnnn}`), the 50/40/10 schedule, 386/388 billing, ZATCA Phase-1 QR, Saudi IDs, permissions and CRM rules. `test/parity.test.ts` runs the legacy functions extracted from `index.html` against the ports, so update both if a legacy rule changes.
- **`packages/db`** — Drizzle schema per module (`src/schema/*`), SQL migrations in `migrations/` (generate with `pnpm --filter @mmc/db generate`; custom SQL for RLS lives in `0002_rls.sql`). Every tenant table has `tenant_id` + **FORCE ROW LEVEL SECURITY**. The runtime role `mmc_app` is not the owner, so always go through `withTenant(db, tenantId, fn)`. Numbers come from `nextNumber(tx, type)`, which locks a row and never reuses a number. Audit with `writeAudit` (hash-chained, append-only). `import-legacy.ts` migrates old JSON.
- **`packages/erp-connector`** — `BackOfficePort` is the **only** path to the ledger/ZATCA (ERPNext + KSA compliance app). `FakeBackOffice` is for dev/tests and must never be described as ZATCA-compliant.
- **`packages/doc-templates`** — RTL HTML for quote, contract, payment request and invoice, run through `esc()` everywhere. `htmlToPdf` posts to Gotenberg.
- **`apps/api`** — NestJS 12 (ESM, built with `tsc`; dev = `pnpm --filter @mmc/api dev`). Better Auth is mounted at `/api/auth` before the JSON parser. **Invitation-only + verified e-mail** is enforced in `auth/auth.ts`; don't loosen it. Controllers in `src/modules/*` use `@Perm(...)` and then `scopeFilter`/`assertCan` for record scope. Inject Nest providers with explicit `@Inject(...)` (vitest/esbuild emits no decorator metadata). Background jobs: `src/worker.ts` (pg-boss). E2E tests: `pnpm --filter @mmc/api test` (fresh `mmc_e2e` DB, real HTTP).
- **`apps/web`** — Next.js 16 App Router, Arabic-first RTL, Tailwind 4 tokens (`primary`, `gold`, `tint`…), shared kit in `components/ui.tsx`. `/api/*` is rewritten to the API so the session cookie stays same-site. Staff pages live under `app/(app)/`. Public customer pages (`/q/[token]`, `/p/[token]`, `/sign/[id]`, `/lead`) sit outside it and must never show cost or margin.
- **Phase 4–5 modules** (status in `docs/erp-plan/phase-4-7-status.md`): `projects.*` (cockpit, gates, delivery clock, handover), `field-service.*` (installed base, tickets, work orders, dispatch, technician app `/tech`), `inventory.*` + `purchasing.service.ts` (stock ledger — always through `postMove`; `stock_move` is append-only — POs, receipts, shipments/landed cost, counts, bills). Domain rules for them live in `packages/domain/src/{projects,fieldservice,scheduling,inventory,service}.ts`.
- Sandboxes: without the integration env vars (see `.env.example`), WhatsApp, e-mail, payments and e-signature are logged or simulated, and the back office is the fake.

## quotation-api — Commands

```bash
cd quotation-api

# Install dependencies
npm install

# Run locally
BASE_URL=http://localhost:3000 node server.js

# Dev mode (auto-reload)
BASE_URL=http://localhost:3000 npx nodemon server.js

# Test PDF generation
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{"client":"Test","items":[{"code":"X-1","desc":"Item","unitPrice":100,"qty":1}],"vat":true}'
```

Deployed to Railway via Docker. Set `BASE_URL` env var to the Railway domain. Also update the `servers[0].url` in `openapi.json` to match the deployed domain.

## quotation-api — Architecture

- **`server.js`** — Express server with three routes: `POST /generate`, `GET /download/:id`, `GET /health`. PDFs are written to `/tmp` with a UUID filename and tracked in an in-memory `Map`. A `setInterval` cleans up entries older than 1 hour.
- **`template.js`** — Exports `buildQuotationHTML(data)`. Contains a base64-encoded company logo (large file). Renders an RTL Arabic HTML quotation that Puppeteer prints to A4 PDF.
- **`openapi.json`** — OpenAPI 3.1 spec consumed by AI tools (Claude, ChatGPT) to call the API as an action. The `servers[0].url` must be updated after each deployment.

PDF generation flow: `POST /generate` → validate items → `buildQuotationHTML` → Puppeteer headless Chrome → save to `/tmp` → return `{ downloadUrl }`.

**Puppeteer on Railway:** The Dockerfile installs system Chromium (`fonts-noto` for Arabic rendering) and sets `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` and `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`.

## index.html (quotation app) — Architecture

`index.html` is the entire app — a single HTML file with embedded CSS and JavaScript. It:
- Reads product catalog from a Google Sheet via the Sheets API
- Stores quotations and contracts as JSON in Google Drive (via Apps Script URL)
- Builds quotations interactively and can export to Excel or generate a PDF via the `quotation-api`
- Has a contract generator (`contract.txt`, an old sample contract, is a local reference only — gitignored because it names a real third party; never commit it)
- **☰ خيارات (options menu)**: ZATCA tax invoice + issued-invoices list for everyone; **حساب التكلفة** (purchase-cost CSV) only for admins (`isAdminUser()` — user code in `seller.adminIds` or Google e-mail in `seller.adminEmails`, from the shared settings)
- Company identity, representative data and stamp come from shared settings (`settings.json` in Drive, published by an admin) — never hard-code them in `index.html`. All interpolated HTML goes through `escHtml()`; a CSP `<meta>` restricts scripts.

**Product sheet layout** (tab `Products`): A part number · B description · C price · D installation · E purchase price in **USD** (`COST_COL`; the sheet computes it as yuan price ÷ I2) · cell **I2** = CNY per 1 USD (`COST_RATE_CELL`). The cost CSV re-reads the sheet on click, converts USD→CNY (I2) and USD→SAR (3.75 peg), skips the `INS` row, and adds the +17% air-shipping hint/rows.

**ZATCA tax invoice (Phase 1 — generation)**: seller identity in ⚙ Settings → *بيانات المنشأة* (localStorage `gseller_info`); buyer + supply date + payment means in the invoice dialog (saved with the quote as `invoiceBuyer`). Flow: preview (draft, shows the provisional number) → issue → read-only. **Numbering works like quote numbers**: next = latest saved invoice + 1, where "latest saved" is the highest sequence (trailing digits) in the shared invoices Drive folder or this browser's forward-only reference `ginv_last` (covers Drive listing lag). The new number keeps the latest invoice's prefix/digit width (the Settings prefix/start only seed the first invoice; start can jump ahead, never back). Issuing requires `cfg.invoicesFolderId` + API key + Apps Script URL; right before saving, the sequence is re-checked (retry with the next free one), and an `action:'updated'` reply from the Apps Script (same-moment save on two PCs) raises a warning. Each invoice stores `icv` and `prevNumber`, plus a UUID and Riyadh-time timestamp, and is archived via the Apps Script endpoint (+ local copy `zinv_<number>`). Field rules and the QR TLV encoding are ported from iHotel (`~/chromium-ihotel-tb/server/lib/zatca-*.js`, `integrations/zatca/qr-tlv.js`, verified against ZATCA SDK 3.4.6): BER long-form lengths, tag 3 without `Z`, tags 1–5 only — tags 6–9 need Phase-2 onboarding (a ZATCA CSID) and a backend. Don't use native `confirm()`/`alert()` — some embedded browsers suppress them; use `appConfirm()`.

**Not VAT-registered mode** (`seller.vatRegistered === false`, the "المنشأة غير مسجلة في ضريبة القيمة المضافة" switch in Settings → بيانات المنشأة): invoices are plain *فاتورة / Invoice* (`taxInvoice:false`, `type:'plain'`) — no VAT, no VAT number, no QR, with a "seller not registered for VAT" note; only name + CR are required. `applyVatMode()` locks the quote's VAT switch off, so quotes, contracts (their "incl. VAT" wording follows `vatOn`) and the Excel export carry no VAT. Same invoice numbering as tax invoices. (The company's ZATCA certificate is a general registration; its VAT lookup by CR 7054249128 returned no VAT registration as of 2026-09-25.)

**Configuration required** — the app ships with empty data-source defaults. Go to ⚙ Settings and paste: Google API key, Sheet ID, Apps Script URL, and Drive folder IDs (the invoices folder must be shared "anyone with the link" like the others).

**Placeholders still needing real values:** the print-footer phone in `quotation-api/template.js` (`+966 50 000 0000`).

## Theme

Emerald (`#0D4A2E`) primary, gold (`#C2A04A`) accent. CSS variables: `--primary`, `--orange`, `--orng2`, `--gold-dk`. Both the HTML app and Node PDF template use this palette.
