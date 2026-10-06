# Handoff — MMC Core (state as of 2026-10-05)

Context for the next session. Read this first, then `CLAUDE.md` (conventions), `README.md` (local setup), `docs/erp-plan/phase-1-3-status.md` (feature status) and `infra/prod/README.md` (deployment).

## Where things are

- **Branch:** `mmc-core`, pushed to `origin` (`github.com/mmc-d/quotation`). `main` on GitHub has the legacy tool plus Phase 0. MMC Core is not merged into `main` yet.
- **Repository layout:**
  - `index.html` at the root is the legacy quotation tool served by GitHub Pages. It is untouched by this work.
  - `apps/` + `packages/` + `infra/` hold MMC Core, the new platform.
  - `quotation-api/` is the old PDF service.
- **Plan:** `docs/erp-plan/`. Phases 0–3 are built; Phases 4–7 have not started.

## What MMC Core is (built and tested)

pnpm + Turborepo monorepo, TypeScript strict, ESM.

| Part | Contents |
|------|----------|
| `packages/domain` | Business rules in integer halalas: quote totals with section subtotals, the INS line, discounts and "discount from list" approvals, VAT including the not-registered mode, tafqit, legacy numbering (`MMC-{YY}{WW}{DD}{n}`, `MMCT-{n}`, `MMC-INV-{nnnnn}`, `MMC-PR-`, `MMC-CO-`), 50/40/10 schedules, 386/388 billing, ZATCA Phase-1 QR, Saudi IDs, permissions, CRM rules, company calendar. Parity tests run the legacy `index.html` functions against the ports. |
| `packages/db` | Drizzle schema, migrations `0000–0005`, row-level security on every tenant table (runtime role `mmc_app`), seed, and the legacy importer (`import-legacy`). |
| `packages/erp-connector` | `BackOfficePort`: the ERPNext adapter, plus `FakeBackOffice` for development. The fake is **not** ZATCA Phase 2. |
| `packages/doc-templates` | RTL HTML for quote (with sections), contract, payment request and invoice; PDF via Gotenberg. |
| `apps/api` | NestJS 12 + Better Auth (invitation-only + verified e-mail, Google, passkeys, TOTP). Modules: platform, parties, products and kits, price lists, quotes, contracts with template sets, change orders, CRM, public pages, finance, calendar, dashboard, jobs. pg-boss worker. |
| `apps/web` | Next.js 16, Arabic RTL with an **English switch** (shell, shared kit, login, cockpit and customers translated; other pages Arabic-only). All screens for Phases 1–3 plus the public pages `/q/[token]`, `/p/[token]`, `/sign/[id]` and `/lead`. |
| `infra/prod` | Production stack: Docker Compose with postgres, gotenberg, migrate, api, worker, web and Caddy, driven by `mmc.sh`. It ran on this PC at http://localhost:8090 and is stopped now. |

**Tests — 112 passing:**
- 37 domain
- 14 database
- 4 connector
- 3 templates
- 54 API end-to-end: three files, also passing in shuffled order

The web production build succeeds. CI is configured in `.github/workflows/mmc-core.yml`.

## Running it

```bash
pnpm install && cp .env.example .env
pnpm db:up                              # Postgres :5433 + Gotenberg :3300 (docker compose, project "mmc")
pnpm --filter @mmc/db migrate && SEED_OWNER_EMAIL=you@x pnpm --filter @mmc/db seed
pnpm --filter "./packages/*" build
pnpm --filter @mmc/api start            # :4000 — `dev` (tsc --watch + node --watch) restarts often; prefer start
pnpm --filter @mmc/web dev              # :3000
# tests
pnpm --filter @mmc/api test             # set E2E_DB=<name> to use a separate database
```

Production-style run: `cd infra/prod && ./mmc.sh init && ./mmc.sh build && ./mmc.sh up` (http://localhost:8090).

- Without SMTP, the activation link appears in the API log.
- `ALLOW_SANDBOX=true` only on a private machine. It enables the fake payment and signing pages, so it must never be set on a public server.

> **Cloud sessions:** Docker may not be available. The domain, connector and template tests need no database. The DB and API tests need Postgres on `localhost:5433` (user `mmc` / `mmc_dev_only`, db `mmc`) and, for PDFs, Gotenberg on `:3300`. The PDF tests skip themselves when Gotenberg is down.

## Gotchas learned

- **Decorator metadata:** vitest uses esbuild, which emits no decorator metadata. Inject Nest providers explicitly with `@Inject(X)`.
- **Tenant setting:** the RLS setting reverts to `''`, not NULL, on pooled connections. Always use `nullif(current_setting('app.tenant_id', true), '')::uuid`.
- **Linking sign-ins to invitations:** Better Auth may create the first session before the user's "after" hooks run, so linking happens in `session.create.before` (`ensureLinked`). Only a **verified** e-mail can claim an invitation.
- **Running the stack:**
  - A Next production build in the same `.next` folder breaks a running `next dev`, so restart dev afterwards.
  - Seed and importer scripts compare real paths, because `@mmc/db` is reached through a pnpm symlink in the image.
  - The API Docker image uses `pnpm deploy --prod`. pnpm 9 has no `--legacy` flag.
- **Machine quirk:** on this Mac, `bash` picks up an old Intel-only `/usr/local/bin/git`; `mmc.sh` falls back to a timestamp image tag.
- **Approvals** use `max(header discount %, discountFromListPercent)`, so FREE and below-list prices count as discount.
- **Change orders** are billed outside the contract schedule: a `billing_milestone` with `trigger: 'change_order'`, its own 388 when positive, a 381 when negative. The final 388 is found by `contractFinalInvoice()`, which ignores change-order 388s.

## Pending (code work, next candidates)

1. ~~**Translation**~~ — done 2026-10-06: every staff page and the public pages have English (`bi(ar, en)` inline; public pages got a language toggle). Stored data (names, clause text, amount in words) stays as entered.
2. ~~**Quote gaps**~~ — done 2026-10-06 (Excel sections, re-price on customer change, contract-type choice + link to the existing contract).
3. ~~**Credit-note netting**~~ — done 2026-10-06 (final request nets 381s on 386s; the ledger still needs the credit reconciled against the 388 in ERPNext).
4. ~~**Status label** `billed`~~ — done 2026-10-06.
5. **Integration work, blocked on accounts:**
   - Google Workspace mail/calendar sync, Wathq CR and national-address lookup;
   - direct Meta/Snapchat/TikTok adapters (a signed intake exists);
   - a real Nafath e-sign provider and payment gateway;
   - the ERPNext + KSA compliance app (configurable field names in `ErpNextBackOffice`).
6. **Phases 4, 5, 7b** — see `docs/erp-plan/phase-4-7-status.md` (Phase 4 and 5 built 2026-10-06; 7b in progress). **Phase 6** (accounting) → ERPNext later (owner decision 2026-10-06; no ledger in Core); 7a (HR) and 7c (IoT/AI) not started.

## Owner decisions / actions (deferred by the user until the app is complete)

- **Repository access:** make it private and turn off GitHub Pages. Both need the `mmc-d` account, because `mshafieee` only has write access.
- **Git history:** purge the stamp and personal data. History rewrites were blocked by the permission system; the copies in PRs #1 and #2 need GitHub Support.
- **The rest of the Phase 0 checklist** (`docs/erp-plan/phase-0-owner-checklist.md`):
  - share Drive with staff only;
  - restrict the API key;
  - deploy the Apps Script;
  - export each staff browser's data.
- **VAT:** confirm registration on FATOORA. The company is seeded as *not registered*.
- **Warranty wording:** the quote terms and contract article 7 still differ.
- **Hosting and accounts:**
  - a VPS in Saudi Arabia (guide: `infra/prod/README.md`);
  - SMTP;
  - a Google OAuth client;
  - WhatsApp Business;
  - an ERPNext implementer.
- **Legacy tool tip:** admin-only buttons, e.g. «تصفير ترقيم الفواتير», appear only after adding the user number (e.g. `6753`) to «أرقام مستخدمين مدراء» in ⚙ الإعدادات → بيانات المنشأة. Phase 0 removed the hard-coded admin.

## Working agreements with the user

- **Pace:** the user wants continuous progress ("never stop") and parallel sub-agents for big UI chunks. Give each sub-agent separate files and its own `E2E_DB`, and verify their work yourself (tests plus a browser check) before committing.
- **Commits:** commit on `mmc-core` with the co-author line. Push only when asked.
- **Credentials:** don't paste credentials in chat. The local test login is in the git-ignored `LOCAL-TEST-LOGIN.md`, which exists on the original PC only.
