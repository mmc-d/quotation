# Phase 6 — General Ledger in MMC Core: implementation spec (handoff)

> **Status:** **built — 6A, 6B, 6C, 6D and 6E done (2026-10-10).** Approved 2026-10-08. What each phase delivered is in `phase-4-7-status.md` (Phase 6 section); the owner steps for e-invoicing are in `phase-6d-einvoicing-owner-steps.md`; the test cases are the «الحسابات» sheet of `docs/testing/MMC-test-cases-ar.xlsx`. The spec below is kept as the design record. Owner-facing Arabic version: `docs/erp-plan/phase-6-accounting-plan-ar.md` (same content, less technical).
> **Audience:** a Claude Code session (or developer) implementing it. Everything needed to start is here; read §0 first.

---

## 0. How to start (paste this into a new session)

```
Implement Phase 6 (general ledger) in MMC Core following docs/erp-plan/phase-6-accounting-implementation.md.
Read CLAUDE.md and that spec fully first. Work phase by phase (6A → 6B → 6C → 6D → 6E); start with 6A only.
Before coding, check `git status` — other work may be uncommitted in shared files (permissions.ts,
numbering.ts, nav.ts, app.module.ts, migrations journal); make surgical edits only and number new
migrations after the latest one in packages/db/migrations/meta/_journal.json.
Docker (Postgres :5433, Gotenberg :3300) may be stopped because it slows the owner's laptop — ask
before running `pnpm db:up`; domain unit tests run without it.
Stop at the end of each phase, list what was built + test results, and ask before the next phase.
```

---

## 1. Decision and goal

- **Decision (owner, 2026-10-08):** the general ledger lives **in MMC Core**, replacing the 2026-10-06 decision ("ledger in ERPNext"). Start from a ready Saudi chart of accounts that the accountant edits. Everything must be **compatible with ZATCA requirements** (VAT, e-invoicing Phase 1 now / Phase 2 when registered and notified, record keeping, Zakat).
- **Goal:** when the external auditor (المحاسب القانوني) visits, the owner exports from Core — with no re-keying — trial balance, general ledger, account statements, journal, income statement, balance sheet, cash flow, changes in equity, AR/AP aging from the books, inventory valuation reconciled to the GL, fixed-asset register, VAT return + reconciliation, payroll/GOSI/EOSB summaries, a Zakat-base working schedule, bank reconciliations and the audit trail, plus a yearly "auditor pack".
- Journal entries are **generated automatically** from the documents Core already has; the accountant adds manual entries, adjustments, and closes periods.
- When implemented, update: `docs/erp-plan/05-roadmap.md`, `docs/erp-plan/phase-4-7-status.md` (Phase 6 section says Core has no GL), `CLAUDE.md` (MMC Core section), the header comment of `apps/api/src/modules/erp-sync.service.ts:15` ("Core never keeps a general ledger"), and `packages/domain/src/intelligence.ts:3`. `packages/erp-connector` stays (ERPNext becomes optional); the GL must not depend on it.

## 2. Compliance requirements the design must meet

| Requirement | Source | Design consequence |
|---|---|---|
| Records kept ≥ 6 years (longer for capital assets / real estate), **inside KSA**, Arabic, electronic copies identical to originals, controls against tampering, producible on ZATCA request | VAT Implementing Regulations Art. 66 (summaries: cleartax.com/ksa/vat-records-books-of-accounts-saudi-arabia; ZATCA "Guideline for Tax Invoicing and Records") | Never delete or update posted rows (DB-level, like `stock_move`); reversal entries only; hash-chained audit (`writeAudit`); Arabic names everywhere; hosting stays in KSA (decision D4); full export + e-invoice XML archive |
| Commercial books in Arabic, organised | Commercial Books Law | Arabic chart, journal, ledger and reports |
| Issued invoices are never edited or deleted; corrections only by credit (381) / debit (383) notes referencing the original with a reason | ZATCA e-invoicing regulation | Ledger posts invoices as immutable; 381/383 post as their own entries |
| VAT return boxes (standard-rated sales, zero-rated, exports, exempt, standard purchases, imports via customs, reverse-charge imports, corrections) | ZATCA VAT return form | Every VAT-bearing ledger line carries a `vat_code`; return built from the ledger |
| VAT registration mandatory above SAR 375,000 taxable supplies in 12 months (voluntary from 187,500) | VAT Law | The company is currently **not registered** (`company.vat_registered=false`); add a threshold monitor |
| Phase 2 e-invoicing: UBL 2.1 XML, UUID, ICV, PIH hash chain, ECDSA cryptographic stamp, QR tags 1–9, CSID onboarding via Fatoora, clearance (B2B standard) before sharing, reporting (B2C simplified) within 24 h | ZATCA E-Invoicing Detailed Technical Guideline, XML Implementation Standard, Data Dictionary, Security Features Standard, SDK | Phase 6D builds this in Core (instead of the ERPNext KSA app); only applies once registered and notified (ZATCA notifies ≥ 6 months ahead; secondary sources report Wave 25 = SAR 187,500 threshold, integration by 2027-02-01 — verify on fatoora.zatca.gov.sa) |
| Zakat return within 120 days of year-end; Saudi-owned companies file audited financial statements; without proper books → estimated assessment | Zakat Implementing Regulations 2024 (summaries: PwC tax summaries, Grant Thornton KSA) | Financial statements + Zakat-base schedule from the GL |

## 3. Conventions to follow (from the codebase)

- Money: integer **halalas** in all arithmetic (`toHalalas`, `halalasToFixed`, `dec` from `@mmc/domain`); DB columns `amount()` = NUMERIC(18,2) read as strings (`packages/db/src/schema/_common.ts`).
- Pure rules in `packages/domain/src/ledger.ts` (+ `vat-return.ts`, `fixed-assets.ts`, `eosb.ts`) with vitest tests in `packages/domain/test/`.
- DB: Drizzle schema in a new `packages/db/src/schema/ledger.ts`, exported from `schema/index.ts`. Generate SQL with `pnpm --filter @mmc/db generate --name <x>`, then a custom RLS migration (`drizzle-kit generate --custom`) following `0002_rls.sql` / `0029_hr_leave_payroll_rls.sql`: ENABLE + FORCE RLS, `tenant_isolation` policy, GRANT to `mmc_app`. For append-only tables REVOKE UPDATE, DELETE from `mmc_app` the way `packages/db/src/migrate.ts:19` does for `stock_move`.
- Always `tenantTx(actor.tenantId, fn, actor.userId)` / `withTenant`; numbers from `nextNumber(tx, type)` (series in `DEFAULT_SERIES`, `packages/domain/src/numbering.ts`); audit with `audit(tx, actor, action, entityType, id, before, after, reason?)`.
- Controllers: `@Perm(...)`, zod via `ZodPipe`, errors from `common/errors.ts`, explicit `@Inject(...)` for providers; register in `apps/api/src/app.module.ts`.
- New permissions go in `PERMISSIONS` + `ROLE_TEMPLATES` (`packages/domain/src/permissions.ts`); existing tenants get them only after `pnpm db:seed` (prod: `./mmc.sh up` runs migrate+seed).
- Background job: copy `registerErpSyncJob` (`erp-sync.service.ts:405-429`) — pg-boss `createQueue` → `schedule(name, cron, {}, { tz: 'Asia/Riyadh' })` → `work`; per-tenant `pg_try_advisory_xact_lock(hashtext('gl-post:'||tenantId))`; one savepoint per source record (`erp-sync.service.ts:131-144`). Register in `startWorker` (`apps/api/src/worker.ts`).
- Excel: `exceljs` like `apps/api/src/modules/products-excel.ts` (RTL sheet views, frozen header); PDF via `@mmc/doc-templates` + Gotenberg (`htmlToPdf`), every value through `esc()`.
- Web: Next.js 16 App Router under `apps/web/app/(app)/accounting/**`, kit in `components/ui.tsx`, `bi('ar','en')` for text, `useMe().can(perm)`, `api.get/post/put/del`, nav entries in `components/nav.ts`. Never use native `confirm()`; use `ConfirmDialog`/`ReasonDialog` (`app/(app)/quotes/_components/common.tsx`). Read `apps/web/AGENTS.md` (Next 16 differs from training data).
- Dates: business dates are Riyadh dates (`riyadhDate()`); `stock_move.posted_at` is timestamptz → `riyadhDate(posted_at)`.
- Tests: API e2e in `apps/api/test/*.test.ts` (fresh `mmc_e2e` DB, real HTTP, helpers in `test/helpers.ts`; needs Docker). Add GL cases to `docs/testing/MMC-test-cases-ar.xlsx` (new sheet "الحسابات").

## 4. Decisions: made, and defaults for the open ones

Made: GL in Core; Saudi ready chart (Appendix A); ZATCA-compatible.

Open — implement **as configurable settings with these defaults** (stored in `ledger_settings`), and list them to the owner at the end of 6A so the accountant can confirm:

| # | Question | Default |
|---|---|---|
| D1 | VAT registered? | read `company.vat_registered` / `vat_effective_from` (currently false) |
| D2 | Fiscal year start month; GL go-live (opening) date | January; owner enters go-live date in the opening-balances wizard |
| D3 | Revenue recognition for supply+install contracts | on invoice (388/386 rules below); IFRS 15 over-time is out of scope |
| D4 | Materials issued to projects | `issue_project`/`consume_wo` → **Work in progress (1132) per project**; moved to COGS when the contract's final 388 is posted. Setting alternative: expense to COGS at issue |
| D5 | Invoice discounts | net (no separate discount account) |
| D6 | Inventory account | one account for all warehouses (quarantine stock still on the books; valuation report shows it separately) |
| D7 | Employer GOSI rates | Saudi 11.75 %, non-Saudi 2 % of (basic+housing, cap 45,000) — editable, flagged "confirm with accountant" |
| D8 | Depreciation | straight-line, monthly, per-asset useful life |
| D9 | Who posts manual entries / closes periods | `ledger.post` / `ledger.close` (preparer ≠ poster unless owner) |

## 5. Data model (new tables, all tenant + RLS)

`account` — `id, tenant_id, code (unique per tenant), name_ar, name_en, type ('asset'|'liability'|'equity'|'income'|'expense'), parent_id, is_group bool, is_active bool, posting_key (nullable, unique per tenant — the role used by auto-posting, e.g. 'ar'), requires_party bool, currency (null = SAR), description, audit cols`. Group accounts take no lines. An account with lines cannot be deleted (only deactivated) or change type.

`journal_entry` — `id, tenant_id, number ('JV-{SEQ:6}', series `journal_entry`, never reset), entry_date (date), period (YYYY-MM, generated), memo, kind ('manual'|'auto'|'opening'|'reversal'|'closing'|'adjustment'), source_type (null for manual; see §6 table), source_id, source_ref (human doc number, e.g. MMC-INV-00012), source_event ('post'|'cancel'|'delta:<n>'…), status ('draft'|'posted'), reverses_id, reversed_by_id, total (halalas as amount), posted_by, posted_by_name, posted_at, attachments jsonb (file ids), audit cols`.
  - Unique `(tenant_id, source_type, source_id, source_event)` where source_type is not null → idempotent auto-posting.
  - Posted entries: no UPDATE of amounts/lines; reversal creates a new entry. Enforce with a trigger (`BEFORE UPDATE OR DELETE` on `journal_line` → raise if parent posted) and app checks.

`journal_line` — `id, tenant_id, entry_id FK cascade-on-draft-only, line_no, account_id, debit, credit (amount, one of them 0), party_id (customer/supplier), employee_id, project_id, cost_center (text; department), vat_code (nullable, §7), vat_base (amount, nullable — taxable base for the VAT return), memo`. Index `(tenant_id, account_id, entry_date)` via join or denormalise `entry_date` + `status` onto the line for fast reports (recommended: denormalise; lines are immutable once posted).

`ledger_settings` (one row per tenant) — `fiscal_year_start_month, go_live_date, locked_through (date), wip_policy ('wip'|'expense'), employer_gosi_saudi_pct, employer_gosi_other_pct, default_cash_account_id, default_bank_account_id, method_accounts jsonb ({cash, cheque, bank_transfer, mada, credit_card, apple_pay, stc_pay, payment_link, card, other} → account_id), vat_return_frequency ('monthly'|'quarterly')`.

`gl_source_state` — per source record bookkeeping for things that change in place: `(tenant_id, source_type, source_id) unique, posted_hash (hash of the posted amounts), posted_payment_ids jsonb (supplier bill payments posted), last_posted_at, error text`. Lets the scanner detect cancellations, voided payments and commission deltas.

`fiscal_year` — `year_label, start_date, end_date, status ('open'|'closed'), closing_entry_id`.

6C tables: `bank_statement`, `bank_statement_line` (`date, description, ref, debit, credit, matched_line_id`), `fixed_asset` (`code, name_ar, account_id, accum_account_id, expense_account_id, acquired_on, cost, salvage, life_months, method, source_bill_id, disposed_on, status`), `vat_return` (`period_from, period_to, boxes jsonb, status draft|filed, filed_on, settlement_entry_id`).

6D tables: `einvoice_egs` (unit name, CSR, compliance CSID, production CSID, encrypted private key ref, status), `einvoice_document` (`invoice_id, icv (unique, sequential), uuid, pih, invoice_hash, xml (signed), qr, submission ('clearance'|'reporting'), zatca_status, zatca_response jsonb, submitted_at, cleared_xml`) — append-only.

Changes to existing tables (small, in 6B):
- `cash_voucher.account_id` (nullable — the counter account chosen by finance; UI field "الحساب المقابل"); optional `payment_request_id` / `supplier_bill_id` links to stop double recording.
- `import_shipment`: store the landed-cost split structurally (`landed_capitalised_sar`, `landed_expensed_sar`) instead of only in `stock_move.note` (`purchasing.service.ts:356-405`); add `customs_payable_party_id` (broker/customs) so duty + import VAT + charges have a credit side.
- `supplier_bill`: a `cancelled` path does not exist — add `POST payables/bills/:id/cancel` only for unpaid bills (reason, audited) so the GL can reverse; supplier debit notes are out of scope for 6B.

## 6. Auto-posting engine (6B)

`apps/api/src/modules/gl-posting.service.ts`: `postPending(tx, tenantId, opts?)` scans each source, builds lines with pure builders from `@mmc/domain/ledger` (each returns `Line[]` keyed by `posting_key`, resolved to account ids from `account.posting_key`), checks balance, inserts the entry (status posted, kind auto) and updates `gl_source_state`. Runs: (a) right after the relevant API actions (call `postPending` for that one source id at the end of the transaction where cheap), (b) pg-boss job `gl-post` every 10 min, (c) "Post now" button. Entries dated inside a locked period are posted on `locked_through + 1` with memo "original date …" and flagged in a report.

Unknown/ambiguous classification → `suspense` (9101) and listed on the **"بانتظار التوجيه المحاسبي"** screen; reclassifying reverses and re-posts with the chosen account (both entries linked).

### 6.1 Rules per source (verified against the code — file refs are where the data comes from)

**Sales invoices — `invoice_mirror`** (`packages/db/src/schema/finance.ts:35-65`; writers in `apps/api/src/modules/finance.service.ts`). Key: `invoice_mirror.id`. Date: `issue_date`. Skip `status='legacy'` (import-legacy rows → covered by opening balances). VAT rate is implicit (15 or 0); not-registered → `vat_amount=0`.
- 381 credit notes are stored **negative** (`taxable`, `vat_amount`, `total`, line amounts × −1, `packages/erp-connector/src/fake.ts:86-106`) — the builder must use absolute values and flip sides.
- No project column: project = `project.contract_id = invoice.contract_id`. AMC invoices: `contract_id` null → `payment_request.agreement_id` via `payment_request_id`.
- Revenue split: lines whose `code` is `INS` → `sales_installation`; AMC (agreement) invoices → `sales_service`; others → `sales_devices` (product type lookup by code; service products → `sales_service`).

| Type | Lines |
|---|---|
| **386** advance (issued when cash arrives, VAT-inclusive, `applyPayment` `finance.service.ts:305-321`) | Dr `ar` total (party) · Cr `customer_advances` taxable · Cr `vat_output` vat (vat_code S, base taxable) |
| **388** final for the contract (whole contract, issued when the final payment request is created, `issueFinalInvoice` `:98-125`) | Dr `ar` total · Cr revenue lines (taxable, split as above) · Cr `vat_output` vat. **Then clear advances in the same entry:** Dr `customer_advances` Σ taxable of the contract's non-cancelled 386s · Dr `vat_output` Σ vat of those 386s (vat_code S negative base — so the return doesn't double count) · Cr `ar` `prepaid_amount`. Mirror doesn't store prepaid VAT — recompute like `finance.service.ts:106`. If D4=wip: second entry Dr `cogs` / Cr `wip` for the project's WIP balance (source_event `wip_release`). |
| **388** change order (`issueChangeOrderInvoice` `:232-259`, VAT-exclusive lines, issued on first payment) and **388** AMC period (`applyAgreementPayment` `:345-382`, VAT-inclusive) | Dr `ar` · Cr revenue (`sales_devices` / `sales_service`) · Cr `vat_output` |
| **381** credit note (manual `finance.controller.ts:192-215`, or negative change order `billChangeOrder` `finance.service.ts:189-229`) | reverse of a sale: Dr revenue (or `customer_advances` when the original is a 386) · Dr `vat_output` · Cr `ar` — link `original_invoice_id` in memo |
| 383 (read-back only) | as a 388 delta |
| status → `cancelled` later (`finance.controller.ts:281, 372`) | reversal entry (source_event `cancel`) dated the cancellation day |

The row is re-upserted repeatedly (only `balance_due`, `status`, `zatca_status` change) — post once on first sight; use `gl_source_state.posted_hash` to detect an unexpected amount change and raise it on the exceptions screen instead of re-posting.

**Customer payments — `payment_mirror`** (`finance.ts:67-80`; `mirrorPayment` `finance.service.ts:49-53`). Key: `payment_mirror.id`; date `paid_on`. Dr method account (`ledger_settings.method_accounts[method]`: cash/cheque → cash or bank; bank_transfer → bank; mada, credit_card, apple_pay, stc_pay, payment_link → `gateway_clearing`) · Cr `ar` (party). For 386 flows the 386 invoice and the payment have the same amount and day → AR nets to 0, which is correct. No refunds exist (a refund today is a payment voucher with account = `ar` + party).

**Cash vouchers — `cash_voucher`** (`finance.ts:115-152`; `vouchers.controller.ts`). Post on `approved` (date `voucher_date`); approved→`cancelled` → reversal dated `cancelled_at`. Cash side by `method` (cash → cash, transfer/cheque/card → bank, other → suspense). Counter side: `account_id` if set; else receipt with `party_id` → `ar`; payment with `party_id` → `ap`; HR bonus vouchers (linked from `pay_adjustment.voucher_id`, `packages/db/src/schema/hr.ts`) → `bonuses` with `employee_id`; else `suspense`. Carry `project_id`, `cost_center`.

**Supplier bills — `supplier_bill`** (`packages/db/src/schema/inventory.ts:313-349`). Post statuses `approved | partially_paid | paid` (same as `BILL_SYNC_STATUSES`, `erp-sync.service.ts:41`); date `bill_date`; SAR = amount × `rate_to_sar`.
- PO bill (`createBill` `purchasing.service.ts:418-449`; header-level VAT only): Dr `grni` (2103) for the received value of the billed PO lines at **receipt** cost (Σ goods_receipt_line.unit_cost_sar × qty) · Dr `price_fx_variance` (new account 5105, or to inventory if still on hand — default variance account) for (bill SAR subtotal − received value) · Dr `vat_input` vat×rate (vat_code S purchases) · Cr `ap` total×rate (party = supplier).
- Direct bill (`createDirectBill` `payables.service.ts:38-119`): product lines with warehouse → Dr `inventory` (the receipt move is posted by the stock rule with `ref_type='supplier_bill'` — **don't double post**: the stock rule skips direct-bill receipts and the bill rule debits inventory); expense lines and `NON_STOCK_TYPES` products → Dr `purchase_expenses` or the bill's project WIP (D4) — or suspense if the accountant wants per-line accounts (add optional `account_id` per expense line in the UI later) · Dr `vat_input` per-line VAT · Cr `ap`. If `paidNow` → also the payment entry below.
- Supplier payments live in `supplier_bill.payments` jsonb (`payables.service.ts:137-167`); void **deletes** the element (only trace: audit `supplier_payment_void`). Rule: for each payment id not in `gl_source_state.posted_payment_ids` → Dr `ap` · Cr method account (date `paidOn`); for each posted id no longer present → reversal. No per-payment FX rate exists — use the bill rate (no realised FX in 6B; note it).

**Stock — `stock_move`** (`inventory.ts:44-69`, append-only; value = `qty × unit_cost_sar`; date `riyadhDate(posted_at)`). Group per (`ref_type`, `ref_id`, day) into one entry.

| kind | Entry |
|---|---|
| `receipt`, ref `goods_receipt` | Dr `inventory` · Cr `grni` |
| `receipt`, ref `supplier_bill` | none (bill rule) |
| `opening` (ref `stock_opening`) | Dr `inventory` · Cr `opening_balance_equity` — reconcile with the opening TB |
| `transfer` | none |
| `issue_project` | Dr `wip` (project) or `cogs` (D4) · Cr `inventory` |
| `consume_wo` | by `ticket.coverage` of the work order (`ops.ts:217`): project → `wip`/`cogs` with project; warranty/amc → `cogs` (cost of service, memo coverage); chargeable → `cogs` |
| `return` | reverse of the above |
| `count` | shortage: Dr `stock_adjustments` · Cr `inventory`; surplus: reverse |
| `adjust`, ref `landed_cost` | use the structured split on `import_shipment` (§5): Dr `inventory` capitalised · Dr `cogs` expensed · Cr `customs_payable` (2104, new) |
| `rma_out`, `scrap` | not posted by code today; if added: Dr `stock_adjustments` · Cr `inventory` |

**Import shipment declaration** (`import_shipment`, `inventory.ts:242-271`; `PUT inventory/shipments/:id/declaration`): when `import_vat_sar` is set → Dr `vat_input` (vat_code IM, base = CIF+duty) · Cr `customs_payable`. Paying customs/broker = payment voucher with account `customs_payable` (party = broker). This closes the gap that duty/charges/import VAT have no payable document today.

**Payroll — `payroll_run` / `payroll_line`** (`hr.ts`; `hr-pay.controller.ts`). On `approved` (date = last day of `month`), one entry per run; expense lines aggregated by department (cost centre), payable lines per employee:
- Dr `salaries` basic · Dr `allowances` housing + transport + other · Dr `bonuses` bonuses (these sum to `gross`).
- Cr `salaries` unpaid_leave + sick_deduction (they reduce the wage expense; they are not liabilities).
- Cr `gosi_payable` gosi (employee share).
- Cr `employee_advances` / `other_income` for `deductions` by the adjustment's category — add `category` ('advance'|'penalty'|'other') to `pay_adjustment` in 6B; 'other' → `other_income`.
- Cr `salaries_payable` net (per employee).
- Balanced because `net = gross − total_deductions` and `total_deductions = unpaid_leave + sick_deduction + deductions + gosi`, except when `computePayslip` capped deductions at gross (`packages/domain/src/payroll.ts`) — then scale the credits proportionally and raise it on the exceptions screen.
Employer GOSI (D7): Dr `gosi_expense` · Cr `gosi_payable`.
On `paid` (date `paid_at`): Dr `salaries_payable` · Cr bank.

**Commissions — `commission_entry`** (`packages/db/src/schema/intelligence.ts:96-116`; updated in place by `recomputeCommissions` and the nightly job). Post deltas: when `payable` increases vs `gl_source_state.posted_hash` → Dr `commissions` · Cr `commissions_payable` (2122) for the delta (source_event `delta:<n>`); negative delta (381 clawback) reverses. `mark-paid` has no money document — paying commissions is a payment voucher with account `commissions_payable` (or include in payroll later).

**Monthly accruals (6C):** EOSB provision per employee (Art. 84: ½ month wage per year for the first 5 years, 1 month after; wage = basic + housing + fixed allowances; provision = liability at month end − previous) → Dr EOS expense · Cr EOS provision. Depreciation per fixed asset → Dr depreciation · Cr accumulated depreciation.

### 6.2 Reconciliation checks (must be green; shown on the accounting dashboard)
- Trial balance debits = credits (always).
- `ar` balance = Σ open invoice balances (`invoice_mirror.balance_due`, excluding legacy) per party.
- `ap` balance = Σ supplier bills owed (`owedSar`, `payables.service.ts:193-195`).
- `inventory` + `wip` = stock valuation report (+ WIP by project).
- `grni` = received-not-billed report (new, 6B).
- `vat_output − vat_input` = VAT return net for the period.
- Suspense (9101) balance = 0 before closing a period.
- Duplicate guard: a receipt voucher on a party with an open payment request, or a payment voucher matching a supplier bill amount, raises a warning (double recording risk).

## 7. VAT (6C)

`vat_code` on lines: `S` standard 15 %, `Z` zero-rated, `E` exempt, `O` out of scope, `X` export, `IM` import via customs, `RC` reverse charge (imported services: Dr `vat_input` / Cr `vat_output` same amount). Return = per box sums of `vat_base` and VAT by code over the period (`packages/domain/src/vat-return.ts`), reconciled to 1140/2110 movements; filing creates the settlement entry (Dr `vat_output`, Cr `vat_input`, Cr/Dr `vat_settlement` 2111) and payment by voucher. Not registered → no VAT lines; **threshold monitor**: rolling 12-month taxable sales (Σ 388/386 taxable − 381) with alerts at 187,500 and 375,000.

## 8. API (prefix `/api/accounting`)

- `GET/POST/PUT accounts`, `POST accounts/:id/deactivate`, `POST accounts/import` (Excel, preview then apply, like products-excel), `GET accounts/tree`.
- `GET journal` (filters: date range, account, party, project, source_type, number, status), `GET journal/:id`, `POST journal` (manual draft), `PUT journal/:id` (draft only, version), `POST journal/:id/post` (ledger.post, not by preparer unless owner, balance check, period open), `POST journal/:id/reverse` (reason, date), `DELETE journal/:id` (draft only).
- `POST opening` (wizard: TB lines + AR/AP per party per invoice + reconcile stock) → one `opening` entry dated go-live.
- `GET reports/trial-balance?from&to&level&withZero`, `reports/ledger?account&party&project&from&to`, `reports/journal`, `reports/income-statement?from&to&by=month|project|department`, `reports/balance-sheet?asOf`, `reports/cash-flow`, `reports/equity-changes`, `reports/aging?side=ar|ap&asOf`, `reports/reconciliation` (§6.2) — each also `?format=xlsx|pdf`.
- `GET/PUT settings`, `POST periods/lock {through}`, `POST periods/unlock {through, reason}` (owner), `POST fiscal-years/:id/close` (closing entry: income/expense → `retained_earnings`).
- `POST posting/run` (post pending now), `GET posting/exceptions` (suspense + errors + amount-changed), `POST posting/reclassify {entryId, lineId, accountId}`.
- 6C: `vat-returns`, `bank-statements` (+ match), `fixed-assets` (+ run depreciation), `eosb/run`, `zakat/base`, `GET auditor-pack?year` (zip: all reports xlsx+pdf, document lists, e-invoice XML archive).

## 9. Web (`apps/web/app/(app)/accounting/**`, nav group «الحسابات»)

Dashboard (cash/bank balances, AR/AP, this month's P&L, reconciliation checks, exceptions count) · Chart of accounts (tree, add/edit, roles/posting keys, Excel import) · Journal (list, new manual entry with balanced-lines editor, entry view with source link, post/reverse) · Awaiting classification · Reports (trial balance with level selector and drill-down → ledger → entry → source document; income statement; balance sheet; cash flow; aging; reconciliation) · Opening balances wizard · Settings (fiscal year, go-live, lock date, method accounts, WIP policy, GOSI rates) · 6C: VAT return, bank reconciliation, fixed assets, auditor pack. Every amount via `<Money>`, Arabic first, mobile-safe tables. Add «الحساب المقابل» select to the voucher form (`app/(app)/finance/vouchers/_components/voucher-kit.tsx`).

## 10. Permissions

Add `ledger.read`, `ledger.write`, `ledger.post`, `ledger.close`, `einvoice.manage`. Grants: owner all (automatic), general_manager all non-admin (automatic), accountant `ledger.read/write/post` (company), auditor `*.read` (automatic). `ledger.close` and `einvoice.manage` = owner + GM only.

## 11. Phases, deliverables, acceptance

**6A — Ledger core.** Domain `ledger.ts` (chart Appendix A, `journalProblems`, balance/statement math, fiscal helpers) + tests; schema + migrations + RLS + immutability trigger; seed the chart (only when the tenant has no accounts) and `ledger_settings`; permissions + seed; accounts, manual journal (draft → post by second person → reverse), opening-balances wizard, period lock, trial balance / ledger / journal / income statement / balance sheet with xlsx+pdf export; web pages; e2e test. *Accept:* manual entries cannot be unbalanced, edited after posting, or dated in a locked period; TB balances; IS net profit = BS current-year profit; exports open in Excel RTL.

**6B — Auto-posting.** Posting engine + job + exceptions screen + reclassify; rules of §6.1 for invoices, payments, vouchers (+ `account_id` field), supplier bills/payments (+ cancel endpoint), stock, import declaration/landed cost (+ structured split, customs payable), payroll (+ employer GOSI, adjustment category), commissions; reconciliation checks §6.2. *Accept:* an e2e run quote→contract→386s→388→payments→PO→receipt→bill→payment→issue to project→payroll→voucher produces a balanced TB where AR, AP, inventory, GRNI and VAT reconcile; re-running the engine posts nothing new; cancelling a voucher/invoice/payment produces exactly one reversal.

**6C — VAT, closing, supporting.** vat codes on lines, VAT return + reconciliation + settlement, threshold monitor, bank reconciliation, fixed assets + depreciation, EOSB provision, cash flow + equity changes, Zakat-base schedule, fiscal year close, auditor pack. *Accept:* VAT return boxes equal the sum of invoice/bill VAT for the period; year close zeroes income/expense into retained earnings; auditor pack downloads.

**6D — ZATCA Phase 2 e-invoicing** (only when registered and notified; build behind a feature flag). UBL 2.1 XML for 388/386/381/383 standard and simplified per the XML Implementation Standard + Data Dictionary; canonicalisation + SHA-256 invoice hash; PIH chain + ICV (gapless, per EGS unit); ECDSA secp256k1 signature (XAdES) and QR tags 1–9; onboarding (CSR → compliance CSID via OTP → compliance checks → production CSID); clearance API for standard (block delivery until cleared), reporting API for simplified within 24 h; retries and rejection handling; archive of cleared XML + PDF/A-3 with embedded XML; validate every type with the official ZATCA SDK before production. Reuse the existing Phase-1 TLV QR code (`packages/domain/src/zatca.ts`) and the supplier-XML parser safety rules (`apps/api/src/modules/zatca-xml.ts`). *Accept:* SDK validation passes for all document types; sandbox clearance/reporting succeeds; the hash chain survives restart and concurrent issuance.

**6E — Cleanup & docs.** Update the docs listed in §1, the Arabic testing guide, add the "الحسابات" sheet to the test-case workbook, migrate dev data, train the accountant.

## 12. Out of scope (for now)

Multi-company consolidation; budgets; IFRS 15 over-time revenue; realised FX gains/losses on supplier payments (no per-payment rate exists); supplier debit notes; chargeable field-service invoicing (not built in Core); payslip PDF / WPS file formats (HR backlog); ERPNext sync of GL entries.

---

## Appendix A — Saudi chart of accounts (seed)

`code | name_ar | name_en | type | posting_key` (group rows have no key and take no lines). Codes are hierarchical by prefix.

```
1    | الأصول | Assets | asset | (group)
11   | الأصول المتداولة | Current assets | asset | (group)
1101 | الصندوق (النقدية) | Cash on hand | asset | cash
1102 | العهد النقدية | Petty cash & custody | asset |
1103 | البنك — الحساب الجاري | Bank — current account | asset | bank
1104 | مدفوعات بوابة الدفع تحت التسوية | Payment gateway clearing | asset | gateway_clearing
1110 | العملاء (الذمم المدينة) | Accounts receivable | asset | ar
1120 | سلف وعهد الموظفين | Employee advances | asset | employee_advances
1130 | المخزون | Inventory | asset | inventory
1131 | بضاعة في الطريق | Goods in transit | asset | goods_in_transit
1132 | أعمال تحت التنفيذ (المشاريع) | Work in progress (projects) | asset | wip
1140 | ضريبة القيمة المضافة — المدخلات | VAT input (recoverable) | asset | vat_input
1150 | دفعات مقدمة للموردين | Advances to suppliers | asset | supplier_advances
1160 | مصروفات مدفوعة مقدمًا | Prepaid expenses | asset |
12   | الأصول غير المتداولة | Non-current assets | asset | (group)
1201 | الأجهزة والمعدات | Equipment | asset |
1202 | السيارات | Vehicles | asset |
1203 | الأثاث والتجهيزات المكتبية | Furniture & fixtures | asset |
1204 | أجهزة الحاسب الآلي | Computers | asset |
1209 | مجمع الإهلاك | Accumulated depreciation | asset | accumulated_depreciation
2    | الخصوم | Liabilities | liability | (group)
21   | الخصوم المتداولة | Current liabilities | liability | (group)
2101 | الموردون (الذمم الدائنة) | Accounts payable | liability | ap
2102 | دفعات مقدمة من العملاء | Customer advances | liability | customer_advances
2103 | بضائع مستلمة لم تُفوتر | Goods received not invoiced | liability | grni
2104 | الجمارك والتخليص المستحق | Customs & clearing payable | liability | customs_payable
2110 | ضريبة القيمة المضافة — المخرجات | VAT output | liability | vat_output
2111 | ضريبة القيمة المضافة — التسوية مع الهيئة | VAT settlement (ZATCA) | liability | vat_settlement
2120 | رواتب مستحقة | Salaries payable | liability | salaries_payable
2121 | التأمينات الاجتماعية المستحقة | GOSI payable | liability | gosi_payable
2122 | عمولات مستحقة | Commissions payable | liability | commissions_payable
2130 | مصروفات مستحقة | Accrued expenses | liability | accrued_expenses
2140 | الزكاة المستحقة | Zakat payable | liability | zakat_payable
22   | الخصوم غير المتداولة | Non-current liabilities | liability | (group)
2201 | مخصص مكافأة نهاية الخدمة | End-of-service provision | liability | eos_provision
2202 | قروض طويلة الأجل | Long-term loans | liability |
3    | حقوق الملكية | Equity | equity | (group)
3101 | رأس المال | Capital | equity | capital
3102 | جاري المالك | Owner's current account | equity | owner_current
3201 | الأرباح المبقاة (المرحّلة) | Retained earnings | equity | retained_earnings
3301 | أرصدة افتتاحية — حساب وسيط | Opening balance equity | equity | opening_balance_equity
4    | الإيرادات | Revenue | income | (group)
4101 | مبيعات الأجهزة والأنظمة | Sales — devices & systems | income | sales_devices
4102 | إيرادات التركيب | Installation revenue | income | sales_installation
4103 | إيرادات الصيانة والخدمات | Maintenance & service revenue | income | sales_service
4190 | خصومات ومردودات المبيعات | Sales discounts & returns | income | sales_discounts
4201 | إيرادات أخرى | Other income | income | other_income
5    | تكلفة المبيعات | Cost of sales | expense | (group)
5101 | تكلفة البضاعة المباعة | Cost of goods sold | expense | cogs
5102 | فروقات الجرد والتسويات المخزنية | Stock adjustments | expense | stock_adjustments
5103 | مصروفات مشتريات مباشرة | Direct purchase expenses | expense | purchase_expenses
5104 | الرسوم الجمركية | Customs duty | expense | customs_duty
5105 | فروقات أسعار وعملة المشتريات | Purchase price & FX variance | expense | price_fx_variance
6    | المصروفات التشغيلية | Operating expenses | expense | (group)
6101 | الرواتب والأجور | Salaries & wages | expense | salaries
6102 | البدلات | Allowances | expense | allowances
6103 | التأمينات الاجتماعية (حصة المنشأة) | GOSI — employer share | expense | gosi_expense
6104 | المكافآت والحوافز | Bonuses & incentives | expense | bonuses
6105 | العمولات | Commissions | expense | commissions
6106 | مصروف مكافأة نهاية الخدمة | End-of-service expense | expense | eos_expense
6107 | رسوم حكومية وإقامات | Government fees & iqamas | expense |
6201 | الإيجارات | Rent | expense |
6202 | الكهرباء والمياه | Utilities | expense |
6203 | الاتصالات والإنترنت | Telecom & internet | expense |
6204 | المحروقات والنقل | Fuel & transport | expense |
6205 | الصيانة والإصلاحات | Repairs & maintenance | expense |
6206 | التسويق والإعلان | Marketing & advertising | expense |
6207 | القرطاسية واللوازم المكتبية | Office supplies | expense |
6208 | الرسوم البنكية | Bank charges | expense | bank_charges
6209 | الإهلاك | Depreciation | expense | depreciation
6210 | الاشتراكات والبرمجيات | Subscriptions & software | expense |
6211 | الأتعاب المهنية والقانونية | Professional fees | expense |
6290 | مصروفات عمومية متنوعة | General expenses | expense | general_expenses
6301 | الزكاة | Zakat | expense | zakat_expense
9    | حسابات وسيطة | Clearing accounts | asset | (group)
9101 | حساب تحت التسوية (بانتظار التوجيه) | Suspense (to classify) | asset | suspense
```

## Appendix B — Known gaps in existing modules found while mapping (fix in 6B)

1. `cash_voucher` has no account field → add `account_id`; vouchers can double-record money already recorded as `payment_mirror` or supplier-bill payments → warn.
2. `import_shipment.import_vat_sar` is never posted; duty/charges have no payable document → customs payable rule (§6.1).
3. Landed-cost capitalised vs expensed split only in `stock_move.note` (`purchasing.service.ts:356-405`) → store on the shipment.
4. Supplier payment void deletes the jsonb element (`payables.service.ts:156-167`) → track posted ids in `gl_source_state`.
5. No supplier-bill cancellation path → add (unpaid only).
6. Employer GOSI and EOSB are not computed anywhere → settings + monthly accrual.
7. Commissions `mark-paid` has no money document → pay by voucher against `commissions_payable`.
8. `invoice_mirror` has no exchange-rate/project columns (SAR only; project via contract).
9. Chargeable field-service work orders are never invoiced (out of scope, note in exceptions).
10. Legacy invoices (`status='legacy'`, `import-legacy.ts:181-193`) → exclude; covered by opening balances.
