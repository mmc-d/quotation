# Module 08 — Accounting, Invoicing & ZATCA (المحاسبة والفوترة الإلكترونية)

| | |
|---|---|
| **Phases** | Back-office setup & compliant invoicing → Phase 1F · Core billing integration → Phase 3 · Full accounting → Phase 6 |
| **Benchmarked** | QuickBooks Online Advanced, Xero, Zoho Books (Saudi edition), Odoo Accounting (`l10n_sa`, `l10n_sa_edi`), Oracle NetSuite, Sage Intacct; Saudi SaaS Qoyod, Wafeq (incl. e-invoicing API), Daftra; ERPNext with open-source ZATCA apps (LavaLoon *KSA Compliance*, ERPGulf *zatca_erpgulf*) |
| **System of record** | **ERPNext + KSA compliance app** (ledger, tax invoices, ZATCA, payments, AR/AP, bank, assets, VAT) — MMC Core owns billing milestones, payment requests and customer-facing finance views |
| **Business owner** | Finance Manager with the external accountant |

## 1. Goals
1. **Compliant tax invoicing now** (ZATCA Phase 2) and for every future wave, without writing our own cryptographic signer.
2. Contract milestones (50/40/10) turn into payment requests, receipts and the correct **386/388** invoice sequence automatically.
3. A proper double-entry ledger with project dimensions so every contract shows its real margin.
4. Month-end close in ≤ 5 working days; VAT return prepared from the system.

## 2. ZATCA e-invoicing — what must be true (checklist)

**Status (25 Sep 2026):** Wave 23 (> SAR 750k) integrated 1 Jan–31 Mar 2026 · **Wave 24 (> SAR 375k) by 30 Jun 2026** · **Wave 25 (> SAR 187.5k, revenue years 2022–2025) by 1 Feb 2027** (announced 24 Jul 2026). ZATCA notifies each taxpayer ≥ 6 months ahead; Phase 1 has applied to all VAT registrants since 4 Dec 2021.

**Starting point in this repository:** the current tool issues Phase-1 standard/simplified tax invoices (QR tags 1–5) — or plain invoices while the company is set as not VAT-registered — for a whole quote, numbered `MMC-INV-…` from each browser ([01-current-state.md](../01-current-state.md) items 17–22). It has no XML, cryptographic stamp, clearance/reporting, credit/debit notes or 386 advance invoices. Confirm the VAT registration and wave first (D1); switch the tool's invoicing off when ERPNext goes live; keep its halala allocation as the reference for quote → invoice totals and its issued invoices as an immutable legacy archive.

| Area | Requirement | Owner in our design |
|------|-------------|---------------------|
| Format | UBL 2.1 XML (KSA profile) is the legal record; PDF/A-3 with embedded XML optional for sharing | KSA app |
| Documents | **388** tax invoice, **386** prepayment invoice, **381** credit note, **383** debit note; subtype 01 (standard/B2B) or 02 (simplified/B2C) + flags (third-party, nominal, export, summary, self-billed) | KSA app + Core requests the right type |
| Flows | Standard (B2B): **clearance before sharing** — share the cleared XML/PDF · Simplified (B2C): share immediately, **report within 24 h** | KSA app + Core waits for clearance before sending B2B PDFs |
| Identifiers & chain | UUID; **ICV** per EGS unit (sequential, never reset); **PIH** previous-invoice hash (first = base64 SHA-256 of "0"); hash of the canonicalised invoice | KSA app (per-EGS serialised queue) |
| Cryptographic stamp | XAdES-BES, ECDSA **secp256k1**, certificate = production CSID; keys protected | KSA app (keys encrypted; access restricted) |
| QR | TLV → Base64; tags 1–5 (seller, VAT no., timestamp, total, VAT), 6–8 (hash, signature, public key), 9 (ZATCA stamp signature, simplified) | KSA app |
| Seller data | Arabic legal name exactly as on the VAT record; VAT no. (15 digits, starts & ends with 3); CRN/unified number; national address (building no. 4 digits, postal code 5 digits, district, city, additional no.) | Company settings (module 01) → ERPNext |
| Buyer data (B2B) | Name, national address, VAT no. or other ID scheme (CRN, 700 unified no., NAT, IQA, PAS…) | Customer master (module 02) → ERPNext |
| Lines & totals | Qty, price, discount, net, VAT category (S/Z/E/O) & rate, VAT; **VATEX** exemption codes for Z/E/O; rounding half-up to 2 decimals with line/total reconciliation; tax currency SAR | Tax templates in ERPNext; Core previews use the same rules |
| Corrections | Never edit an issued invoice; 381/383 reference the original + reason; rejected documents still consume the chain (next PIH uses the rejected hash) | KSA app + process |
| Onboarding | Per EGS unit: OTP from FATOORA portal (expires in 1 h) → CSR (secp256k1; SN `1-solution\|2-version\|3-serial`, title `1100`) → compliance CSID → compliance samples (standard & simplified invoice, credit, debit) → production CSID → monitor expiry & renew | Implementer + accountant in Phase 1F |
| Environments | Developer portal (sandbox) → **simulation** (pre-production, not counted) → **core** (production; switch is irreversible) | Staging on simulation, production on core |
| Archive | Signed and cleared XML + PDF, offline-accessible, ≥ 6 years (10 as safe default); submission log append-only | ERPNext + Core archive mirror |
| Penalties | Warning first; escalating fines for repeats (e.g., missing QR SAR 1,000 → 5,000 → 10,000…; overall SAR 5,000–50,000 reported) | — |

**Contract billing mapping (confirm with the tax advisor):**

| Event | Document | VAT point | Journal effect |
|-------|----------|----------|----------------|
| Payment request for 50% (non-tax document) | — | none | none |
| 50% received | **386** prepayment invoice | at receipt | Dr Bank / Cr Customer advances / Cr Output VAT |
| 40% received before delivery | **386** | at receipt | same |
| Programming complete (final) | **388** for 100% with `PrepaidAmount` = advances (net + VAT) and references to each 386 | on the remaining 10% | Dr AR + Dr Advances / Cr Revenue / Cr Output VAT |
| Advance refunded | **381** against the 386 | reverses VAT | Dr Output VAT / Cr Advances |

## 3. Feature backlog

**Where:** **E** = ERPNext standard · **K** = KSA compliance app · **X** = `mmc_ksa` extension · **C** = MMC Core.

### 3.1 Ledger & controls
| ID | Feature | Where | Adopted from | P | Notes |
|----|---------|-------|-------------|---|-------|
| ACC-01 | Bilingual chart of accounts (IFRS for SMEs as endorsed by SOCPA) incl. VAT in/out, import VAT, reverse charge, customer advances, retention, PDC, WHT, Zakat, GOSI accounts | E | Odoo, Zoho Books, Qoyod, Wafeq, Daftra | P0 | Phase 1F |
| ACC-02 | Dimensions on every line: **project (= contract)**, cost center, branch | E | Sage Intacct, NetSuite, Odoo, Xero, QBO, Qoyod, Daftra | P0 | Project created from Core |
| ACC-03 | Fiscal years, accounting periods, lock dates (lock after each VAT return) | E | Odoo, Xero, QBO, NetSuite, Sage | P0 | |
| ACC-04 | Manual journals with attachments; recurring & auto-reversing journals | E | All | P0 · P1 recurring | |
| ACC-05 | Gap-free numbering per document type and branch (separate from ZATCA ICV) | E | All | P0 | |
| ACC-06 | Immutable audit trail; corrections by reversal/credit note only | E | Qoyod, Odoo, NetSuite, Sage | P0 | |
| ACC-07 | Branch P&L; one EGS unit per branch | E + K | Zoho Books, Odoo, Qoyod | P0 | D9 |
| ACC-08 | Roles & approvals (bills, payments, journals); accountant/auditor read-only access | E | QBO Advanced, NetSuite, Sage, Zoho, Odoo, Xero | P1 | |
| ACC-09 | Year-end close to retained earnings | E | All | P1 | |
| ACC-10 | Multi-company & consolidation (if the IoT business gets its own CR) | E | NetSuite, Sage, Odoo | P2 | |

### 3.2 Billing & receivables
| ID | Feature | Where | Adopted from | P | Notes |
|----|---------|-------|-------------|---|-------|
| ACC-20 | Billing milestones from contracts (% or amount, trigger: signing / before delivery / after programming / handover / date) | C | QBO, NetSuite, Sage, Odoo | P0 | Module 04 |
| ACC-21 | **Payment requests** (non-tax) with bilingual PDF, tafqit and payment link, sent by WhatsApp/e-mail | C | Saudi practice (VAT point at receipt) | P0 | Avoids triggering VAT before payment |
| ACC-22 | Standard (B2B) and simplified (B2C) tax invoices with QR; clearance before sharing B2B | E + K | Zoho Books, Odoo, Qoyod, Wafeq, Daftra | P0 | Phase 1F manual, Phase 3 automated |
| ACC-23 | **386 prepayment invoices and 388 final invoice with `PrepaidAmount` deduction** | K (+ X if gap) | Open-source reference; Odoo/Zoho down payments | P0 | Phase 1 spike verifies support |
| ACC-24 | Credit notes (381) / debit notes (383) with reference & reason | E + K | Zoho, Odoo, Qoyod, Wafeq, Daftra | P0 | |
| ACC-25 | Customer advances / unapplied cash held as liability, linked to 386 | E | QBO, Xero, NetSuite, Odoo, Zoho | P0 | |
| ACC-26 | Receipt vouchers (سند قبض), allocation to invoices | E + C mirror | Daftra, Qoyod, Wafeq | P0 | |
| ACC-27 | Customer statement of account (bilingual PDF), AR aging | E + C | All | P0 | Also in the customer portal |
| ACC-28 | E-invoice status dashboard (cleared/reported/rejected with ZATCA messages) and submission log | K + C | Zoho, Odoo, Qoyod | P0 | |
| ACC-29 | Dunning / reminders by WhatsApp & e-mail tied to milestones | C | Xero, QBO, Zoho, Odoo, NetSuite | P1 | Utility templates |
| ACC-30 | Payment links on requests/invoices (mada, Apple Pay, cards) + gateway webhooks | C + E | QBO, Xero, Zoho, Odoo | P1 | Moyasar/HyperPay/Tap/PayTabs/Geidea |
| ACC-31 | Recurring invoices (AMC, IoT monitoring subscriptions) | E + C | All | P1 | Module 06 |
| ACC-32 | Retention (held until handover) | E + X | Sage Intacct Construction | P1 | Confirm VAT timing with advisor |
| ACC-33 | Installment plans (B2C), credit limits & holds | E | Odoo, Daftra, NetSuite, Zoho | P2 | |
| ACC-34 | Event-driven billing: IoT commissioning event (devices online & programmed) drafts the final 10% invoice request and customer sign-off | C | Company-specific | P2 | Module 12 |

### 3.3 Payables & expenses
| ID | Feature | Where | Adopted from | P | Notes |
|----|---------|-------|-------------|---|-------|
| ACC-40 | Vendor bills in USD/CNY with realised FX gain/loss | E | All | P0 | |
| ACC-41 | Import VAT at customs as input tax; reverse charge on imported services (SaaS, cloud, support) | E | Odoo, Zoho | P0 | |
| ACC-42 | Payment vouchers (سند صرف), vendor credits & refunds, bill/payment approvals | E | Daftra, Qoyod, QBO, NetSuite | P0 · P1 approvals | |
| ACC-43 | Withholding tax on payments to non-residents (5% / 15% / 20% by category) and monthly WHT report | E + X | Odoo | P1 | Foreign software, cloud, technical support |
| ACC-44 | Expense claims, petty cash & technician custody (عهدة) | E + C capture | Xero, QBO, Zoho, Daftra, Qoyod | P1 | Receipt photos from the PWA; ZATCA QR read for VAT |
| ACC-45 | 3-way match, batch payments / bank files, bill OCR | E + C | NetSuite, Sage, Odoo, Xero Hubdoc | P2 | Module 07 covers supplier UBL ingestion |

### 3.4 Cash, bank & currency
| ID | Feature | Where | Adopted from | P | Notes |
|----|---------|-------|-------------|---|-------|
| ACC-50 | Bank & cash accounts (treasuries), statement import (CSV/Excel/MT940), reconciliation rules | E | All; Daftra treasuries | P0 | |
| ACC-51 | **Post-dated cheque register** (received → under collection → cleared/bounced) with maturity calendar | E + X | Daftra cheque cycle | P0 | Common in B2B |
| ACC-52 | Live bank feeds via Saudi open-banking aggregators (Lean, Tarabut) | E + X | Wafeq (SAB, Al Rajhi, HSBC), Qoyod | P1 | |
| ACC-53 | Gateway settlement reconciliation (gross → fees → VAT on fees → net) | E + C | Xero, Wafeq | P1 | |
| ACC-54 | Daily exchange rates; unrealised FX revaluation at month end | E | All | P0 · P1 revaluation | SAR pegged 3.75/USD; CNY floats |
| ACC-55 | 13-week cash-flow forecast from milestones, PDCs, AP and payroll | C | Xero, QBO, NetSuite | P1 | Module 10 |

### 3.5 Tax, assets, budgets & reporting
| ID | Feature | Where | Adopted from | P | Notes |
|----|---------|-------|-------------|---|-------|
| ACC-60 | VAT codes S/Z/E/O with VATEX codes; VAT return mapped to ZATCA boxes | E + K | Odoo, Zoho, Qoyod, Wafeq, Daftra | P0 | Quarterly filing unless supplies > SAR 40M |
| ACC-61 | Core statements: trial balance, GL, P&L, balance sheet, cash flow (bilingual), comparatives by dimension | E | All | P0 · P1 dimensions | |
| ACC-62 | **Project profitability**: contract value + change orders vs materials (landed cost), labor (timesheets × loaded rate), subcontract, expenses | E + C | QBO, Zoho, Odoo, NetSuite, Sage, Qoyod | P0 (Phase 6) | Core dashboard PR1 |
| ACC-63 | Fixed assets & depreciation (vans, tools, demo kits) | E | All | P1 | |
| ACC-64 | Budgets & variance by account/cost center/project | E | Xero, QBO, Zoho, Odoo, NetSuite, Sage | P1 | |
| ACC-65 | Zakat-base worksheet from the trial balance | X | (advisor practice) | P2 | Zakat certificate needed for tenders |
| ACC-66 | IFRS 15 revenue recognition (supply + install + programming as one obligation?) | E | Zoho, NetSuite, Sage, QBO Adv | P2 | Advisor decision |

### 3.6 AI (see module 12)
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| ACC-70 | Suggest-and-approve bookkeeping (categorise, match bank lines, flag anomalies) — AI never issues ZATCA documents | QuickBooks AI agents, Xero JAX, Sage GL Outlier Detection | P2 | |
| ACC-71 | Collections assistant (personalised WhatsApp reminders, promise-to-pay tracking) | QuickBooks, Dynamics 365 Finance Agent | P2 | |
| ACC-72 | Arabic "ask your books" questions over the finance semantic layer | Intuit Assist, JAX, Zia | P2 | |

## 4. Saudi specifics to configure
- **VAT:** 15%; registration mandatory above SAR 375k (voluntary above 187.5k); returns quarterly (monthly above SAR 40M) due by the end of the following month; penalties for late filing (5–25%), late payment (1% per 30 days) and incorrect returns.
- **Advances:** VAT is due on receipt to the extent paid; issuing an invoice before payment also triggers VAT — hence payment requests first, 386 on receipt.
- **Imports:** VAT on goods paid at customs is input tax; duty/freight go to inventory cost; imported services under reverse charge.
- **WHT:** 5% (rent, freight, telecoms, dividends, consulting/technical services, insurance…), 15% (royalties, head-office services, other), 20% (management fees); remit monthly; no WHT on goods.
- **Zakat:** 2.5% of the Zakat base for Saudi/GCC-owned entities; return within 120 days of year end.
- **Standards & records:** IFRS for SMEs as endorsed by SOCPA; keep tax records ≥ 6 years (longer for capital assets; 10 years as safe default); cheques payable on presentation.

## 5. Reports (see [module 10](10-reports-bi.md))
A1 AR aging · A2 Customer statement · A3 AP aging · A4 P&L · A5 Balance sheet · A6 Trial balance / GL · A7 VAT return · A8 E-invoice status · A9 Cash & bank position · A10 DSO & collection effectiveness · A11 Revenue by stream · A12 13-week cash forecast · A13 Budget vs actual · PR1 Project P&L · PR4 Billing milestones · PR7 Retention.

## 6. Acceptance criteria
- **Phase 1F:** the EGS unit of each branch (today the Jeddah head office — D9) onboarded in production; the accountant issues 386, 388 (with advance deduction) and 381 documents that are cleared/reported without errors; opening trial balance agreed with the accountant.
- **Phase 3:** a milestone reached in Core produces the payment request, and the receipt produces the correct ERPNext document automatically; B2B PDFs are sent only after clearance; ≥ 99% first-time clearance/reporting over one month; nightly reconciliation shows zero unexplained drift.
- **Phase 6:** month-end close ≤ 5 working days; VAT return from the system matches the filed return; project P&L available for every active contract.
