# Phases 1–3 — build status (as of 2026-10-05, branch `mmc-core`)

MMC Core is built and tested locally: API, web app, database, worker and document templates. Everything in the table below runs end to end on a developer machine. Production use is blocked by the items under **Blocked on owner / external services**. Those need accounts, contracts or decisions, not code.

**Verification**
- 35 domain tests, including parity with the legacy `index.html`.
- 14 database tests: row-level security, concurrent numbering, audit chain, legacy import.
- 4 connector tests and 3 template tests.
- **27 end-to-end API tests** over real HTTP covering all three phases.
- Production web build of all 35 routes.
- A browser walkthrough of the main screens.
- CI runs all of the above (`.github/workflows/mmc-core.yml`).

## Phase 1 — Foundation + sales core

| Workstream | Built | Not yet |
|-----------|-------|---------|
| Platform | Monorepo, CI, Dockerfiles, Postgres + Drizzle migrations, **row-level security** on every tenant table (runtime role cannot bypass it), **login page**: invitation-only, verified e-mail, Google sign-in (when the OAuth client is set), passkeys, TOTP, password fallback, optional `MFA_ENFORCE` for privileged roles. Roles × permissions × record scope (own/team/branch/company/all) with a matrix editor; hash-chained, append-only audit log with verification; company/branch settings incl. VAT mode, national address, bank, representative, logo, stamp; numbering series continuing `MMC-…`/`MMCT-…`/`MMC-INV-…` (forward-only); file storage; Gotenberg PDFs; WhatsApp/e-mail sending (sandbox until configured); notifications; Origin check on state-changing requests | Staging/production on Google Cloud Dammam (needs the GCP project, D4); GCS bucket instead of local disk; company calendar (Sun–Thu, holidays) for SLAs; full English UI (the UI is Arabic-first with English labels in places) |
| Master data | Customers with contacts, national-address sites, PDPL consent, B2B/B2C flag; products with the legacy sheet CSV import (A code · B description · C price · D installation · E USD cost), categories, **packages/kits API**; customers/items pushed to the back office at first invoice | Price lists per segment (schema only); kit expansion inside the quote editor's catalog panel (API exists) |
| Quotations v2 | Full parity: INS auto line (manual override, delete/restore), FREE and struck lines, % or amount discount, VAT and the not-registered mode, notes/terms defaults, A4 PDF, Excel, internal cost and margin by permission. Plus optional lines, statuses, **revisions (R0, R1…)**, validity, **approvals** (header discount *and* below-list/FREE pricing, margin floor, per-role limits, creator ≠ approver), send by WhatsApp/e-mail/link with archived PDF, lists and filters | Sections with subtotals in the editor (API supports sections); per-line discount % (unit-price edits cover it today); good/better/best alternatives (P1) |
| Contracts v2 | Generated from the accepted quote; verbatim legacy articles as an editable clause library; payment-schedule builder (default 50/40/10, must total 100%, exact halala split); tafqit; company data and stamp from settings (stamp only on an approved contract, by `contract.stamp`, archived and audited); issued-PDF archive | Several contract templates (one clause set today); change orders (schema only) |
| Reporting v1 | Cockpit (quotes, win rate, pending approvals, average discount, margin, AR, leads, tasks, daily value, pipeline, team performance), quote register with CSV, lost reasons | Further reports from the 77-report catalogue |
| Migration | `import-legacy` for Drive quote/contract/invoice JSON and every browser's "export all local data" backup; idempotent, dry-run, numbering continuity | Running it on the real archive (owner checklist item 9 first) |
| Spikes | Gotenberg Arabic shaping verified | ERPNext KSA-app capability spike (386 + PrepaidAmount, EGS per branch, webhooks); Cloud Run availability in `me-central2` |

## Phase 2 — CRM & engagement

| Built | Not yet |
|-------|---------|
| Leads from the website form (honeypot, rate limit), **WhatsApp inbound** (unknown senders become leads), **signed lead-ads intake** for Meta/Snapchat/TikTok forms or a connector, and manual entry. Explainable score, duplicate guard by mobile, assignment, conversion to customer + opportunity. Kanban pipeline with weighted values and mandatory lost reasons; activities and tasks; follow-up automation (unviewed quote, expiring quote, stale opportunity, untouched lead). **Shared WhatsApp inbox** that enforces the 24-hour window, sends approved templates outside it and tracks delivery statuses. Targets and campaigns. **Online quote view and WhatsApp-OTP acceptance**, recording signer, IP and the archived PDF hash. **E-signature flow** with a sandbox Nafath page | Google Workspace e-mail/calendar sync; Wathq CR and national-address lookup (needs a Wathq subscription); direct Meta/Snapchat/TikTok API adapters (the signed intake covers connectors today); a real Nafath signing provider (D8) |

## Phase 3 — Invoicing & collections

| Built | Not yet |
|-------|---------|
| Billing milestones → **payment requests** with payment links and PDFs → each advance received issues a **VAT-inclusive 386 prepayment invoice** through the back-office port. The final milestone issues the **388** for the whole contract, deducting every 386, and requests its balance. Manual receipts (bank transfer, cash, cheque, mada…) and **signed, idempotent gateway webhooks**; **381 credit notes** (issued invoices are never edited). Invoice mirrors with ZATCA status/QR/PDF; **AR aging**; **customer statements**; WhatsApp payment reminders on a schedule; nightly reconciliation with drift report; ERPNext webhook | Talking to a real ERPNext + KSA compliance app (the in-process fake is used until `ERPNEXT_URL` is set; it is **not** ZATCA Phase 2); a real payment gateway (sandbox until a merchant account exists) |

## Blocked on owner / external services

1. **Phase 0 owner checklist**: still open (repository private, history purge, Drive sharing, API key, OAuth client, Apps Script deployment, settings publish, VAT/ZATCA confirmation, warranty wording, browser exports). See `phase-0-owner-checklist.md`.
2. **ERPNext + KSA compliance app** (decision D11): contract the implementer, install it in Dammam, onboard the EGS unit (simulation → production), then set `ERPNEXT_*`. Confirm the KSA app's field names in the spike; they are configurable in `ErpNextBackOffice`.
3. **Google Cloud project in Dammam** (D4) for staging and production; a Cloud SQL database with the `mmc_app` runtime role; a GCS bucket.
4. **Google OAuth client** for staff sign-in (`GOOGLE_CLIENT_ID/SECRET`).
5. **WhatsApp Business**: Cloud API number, access token, app secret, and the message templates (names in Settings → المستندات → قوالب الرسائل) approved in Meta Business Manager.
6. **E-signature provider** with Nafath (Signit / emdha / Sadq, D8) and a **payment gateway** merchant account.
7. **VAT registration**: the company is seeded as *not registered*, matching the 2026-09-25 lookup. Switch it in Settings once FATOORA confirms registration.
8. **Warranty wording**: the quote terms and contract article 7 still differ, carried over verbatim until you decide (checklist item 8).

## Known limitations

- `FakeBackOffice` numbers and computes invoices exactly as the ERPNext integration will. It does not submit anything to ZATCA, and the UI shows a banner saying so.
- Legacy contracts were stored as HTML snapshots. They are imported as signed contracts with their total and the original file attached (download only), but without structured lines.
- The old tool never recorded whether legacy invoices were paid. They are imported as settled (`status: legacy`) so they don't distort AR aging.
