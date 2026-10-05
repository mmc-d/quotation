# Accounting, Finance & Saudi Tax (ZATCA Phase 2): Benchmark for Motqinon Tech

*25 Sep 2026. Direct fetches of zatca.gov.sa and most vendor sites were blocked here. Official ZATCA facts come from zatca.gov.sa search snippets, cross-checked against primary code on GitHub: Odoo's official Saudi modules, the ZATCA SDK validation rules mirrored in public repos, and maintained libraries. **†** = confirmed this session. Claims about QuickBooks, Xero, NetSuite and Sage Intacct come from product knowledge (2025–26), not re-checked. Uncertain items are marked (unverified).*

## 0. Headline findings
1. **Motqinon is very likely already in scope.**
   - **Wave 24** (VAT-able revenue > SAR 375k in 2022–2024) had to integrate by **30 Jun 2026**†.
   - **Wave 25** (> SAR 187.5k in 2022–2025, announced Jul 2026) must integrate by **1 Feb 2027**†.
   - SAR 10k–500k contracts almost certainly put Motqinon over 375k. Check the FATOORA portal or the ZATCA notice now.
   - Invoices made in Sheets or Excel are not compliant e-invoices (ZATCA FAQ position; unverified).
2. **Stop-gap within weeks:** issue invoices from a ZATCA-integrated product (Qoyod, Wafeq, Daftra, Zoho Books) or a middleware API while the ERP is built.
3. **50/40/10 billing needs the prepayment flow.** Each advance gets a **386** invoice. The final **388** deducts the advances via `PrepaidAmount` (BT-113) and fields KSA-26…34†.
4. **Apps Script can't host Phase 2 cryptography** (secp256k1 ECDSA, XML C14N, XAdES). You need a server service or a middleware API.
5. **Ledger must-haves:**
   - project (= contract) as a dimension on every line
   - USD/CNY purchases with import VAT and landed cost
   - post-dated cheques (PDCs)
   - an append-only ZATCA submission log

---

## 1. Apps benchmarked
| App | Positioning / why a leader | Notable strengths (KSA status) |
|---|---|---|
| **QuickBooks Online Advanced** | Largest SMB user base worldwide; top tier (about 25 users) | Custom workflows and approvals, batch transactions, revenue recognition, fixed assets, project profitability, class/location, AI agents (2025). **KSA:** no native ZATCA or Arabic UI (unverified). |
| **Xero** | Cloud SMB leader (AU/NZ/UK); biggest app and advisor ecosystem | Bank feeds and rules, Hubdoc capture, repeating invoices, tracking categories, multi-currency, short-term cash flow, JAX AI. **KSA:** ZATCA via add-ons only (unverified). |
| **Zoho Books (Saudi edition)** | Strongest global SMB suite with a real KSA edition | ZATCA Phase 1 and 2†: standard invoices pushed before sending, simplified within 24h†. Revenue recognition, fixed assets†, project hours†, margin-scheme VAT†, Arabic, Zoho CRM/Projects/Inventory, Zia AI. |
| **Odoo Accounting** (`l10n_sa`, `l10n_sa_edi`, `l10n_sa_pos`)† | Open-source modular ERP with an official Saudi localization | Journal-level onboarding with an OTP; simulation to production; auto-submit plus an end-of-day sweep of unsent invoices†; VAT and WHT reports†; VATEX codes†; analytic plans, assets, follow-ups, OCR, down payments; CRM, Field Service, Inventory and IoT in one database. |
| **Oracle NetSuite** | Mid-market cloud ERP leader (OneWorld) | Multi-subsidiary and multi-book, consolidation, billing schedules, IFRS 15 revenue (ARM), fixed assets, SuiteProjects, 3-way match, Bill Capture OCR, SuiteFlow, "NetSuite Next" AI. **KSA:** ZATCA via partners (unverified). |
| **Sage Intacct** | Best-in-class mid-market financials with a dimensional GL | Dimensions, multi-entity consolidation, contract revenue, AP automation, GL Outlier Detection, Sage Copilot, Construction edition with retainage. **KSA:** not localized (unverified). |
| **Qoyod (قيود)** | Saudi-born, Arabic-first SME cloud accounting | ZATCA Phase 1 and 2 certified†, POS with real-time multi-branch inventory†, cost centers, asset registry, projects and tasks†, bank integration and auto-reconciliation†, audit logs, API†. |
| **Wafeq (وافق)** | Saudi/GCC accounting that also sells e-invoicing as an API | ZATCA Phase 2†, **e-invoicing API**†, bank feeds from SAB, Al Rajhi, HSBC and Wio†, Stripe/Foodics/Salla†, multi-currency and projects†, payroll†, sub-accounts†. |
| **Daftra (دفترة)** | Arabic cloud ERP for MENA SMEs | ZATCA both phases†, auto-journals, cost centers, treasuries, **cheque cycle**†, assets, inventory, HR†. |
| **Others** | Rewaa, Foodics (POS), Snad, Qeemah, Azdan, Tally Prime MENA; ERPNext with open ZATCA apps (lavaloon `ksa_compliance`, ERPGulf `zatca_erpgulf`)† | Mostly vertical products. The ERPNext apps are useful open references in Python. |

---

## 2. Feature inventory
**Legend:** QBO = QuickBooks, XRO = Xero, ZB = Zoho Books, ODO = Odoo, NS = NetSuite, SI = Sage Intacct, QYD = Qoyod, WFQ = Wafeq, DFT = Daftra. **†** = confirmed this session.

**Priority:** P0 = MVP, P1 = second wave, P2 = later.

### 2.1 Ledger, structure & controls
| Feature | What it does | Seen in | Pri | Notes (Saudi) |
|---|---|---|---|---|
| Saudi chart of accounts (bilingual) | IFRS-aligned COA with tax mapping | ODO†, ZB, QYD, WFQ, DFT | P0 | IFRS for SMEs as endorsed by SOCPA. Accounts for: VAT in/out, import VAT, RCM, customer advances, retention, PDCs, WHT, Zakat, GOSI. |
| Multi-level sub-accounts | Roll-up reporting | WFQ†, all | P0 | |
| Dimensions: project and cost center | Tag every line | SI, NS, ODO, XRO, QBO, QYD†, DFT† | P0 | Project = contract/villa. |
| Periods and lock dates | Block posting to closed or filed periods | ODO, XRO, QBO, NS, SI | P0 | Lock after each VAT return. |
| Manual journals with attachments | Adjusting entries | all | P0 | |
| Recurring and auto-reversing journals | Accruals and prepaids | XRO, QBO, NS, SI, ODO | P1 | |
| Gapless numbering per document type and branch | Legal sequences | all | P0 | Kept separate from the ZATCA ICV. |
| Immutable audit trail | Who, when, before/after | QYD†, ODO, NS, SI | P0 | Correct by reversal or credit note, never by editing. |
| Branches | Branch P&L; one EGS unit per branch | ZB, ODO, QYD† | P1 | Each EGS has its own ICV/PIH chain. |
| Multi-company and consolidation | Intercompany eliminations | NS, SI, ODO | P2 | If the IoT business gets its own commercial registration. |
| Year-end close | Close P&L to retained earnings | all | P1 | |
| Roles and approvals engine | Rules by role and amount | QBO Adv, NS, SI, ZB, ODO | P1 | |
| Accountant/auditor access | Read-only advisor role | XRO, QBO, ZB, ODO | P1 | External auditor, Zakat advisor. |

### 2.2 Sales, AR & contracts
| Feature | What it does | Seen in | Pri | Notes |
|---|---|---|---|---|
| Quote → contract → invoice | Carries lines and terms forward | QBO, XRO, ZB, ODO, NS, QYD, DFT | P0 | Reuse the quotation app's data. |
| Standard tax invoice (B2B) | 388, subtype 01…, cleared before sharing | ZB†, ODO†, QYD†, WFQ†, DFT† | P0 | Needs buyer VAT number and national address. |
| Simplified tax invoice (B2C) | 388, subtype 02…, QR, reported within 24h | same | P0 | Villa owners. |
| Credit note (381) / debit note (383) | References the original, with a reason | ZB, ODO†, QYD†, WFQ, DFT | P0 | The only way to correct an issued invoice. |
| **Prepayment invoice (386) and final deduction** | VAT on the advance; `PrepaidAmount` on the final invoice | Open-source reference†; ODO/ZB down-payment features (386 mapping unverified) | **P0** | The 50/40/10 backbone. |
| Milestone / progress billing schedule | % or amount per trigger; auto-drafts invoices | QBO, NS, SI, ODO | P0 | Signing, before delivery, programming sign-off. |
| Customer deposits / unapplied cash | Holds advances as a liability | QBO, XRO, NS, ODO, ZB | P0 | Linked to the 386. |
| Retention (retainage) | Holds a % until handover | SI Construction; others via workaround (unverified) | P1 | Contractor deals. Confirm VAT timing with an advisor. |
| Bilingual PDF with QR | Arabic mandatory | ZB, QYD, WFQ, DFT, ODO | P0 | |
| PDF/A-3 with embedded XML | One file for the buyer | ZB† | P2 | Optional; the XML is authoritative. |
| Recurring invoices | Maintenance contracts, IoT subscriptions | all | P1 | |
| Customer statements; AR aging | Statement of account; age buckets | all | P0 | |
| Dunning / reminders | Email, SMS, WhatsApp | XRO, QBO, ZB, ODO, NS | P1 | WhatsApp dominates in KSA. |
| Payment link on invoice | Card, mada, Apple Pay | QBO, XRO, ZB, ODO | P1 | Moyasar, Tap, HyperPay. |
| Installment plans | Splits a receivable | ODO, DFT (unverified) | P1 | B2C. |
| Credit limits and holds | Blocks over-limit sales | NS, ODO, ZB | P2 | |
| Write-offs and ECL provision | IFRS 9 simplified approach | NS, SI, ODO | P2 | VAT bad-debt relief unverified. |

### 2.3 Purchases & AP
| Feature | What it does | Seen in | Pri | Notes |
|---|---|---|---|---|
| Vendor bills (multi-currency) | USD/CNY supplier invoices | all | P0 | Imported equipment. |
| Import VAT at customs | 15% customs VAT as input tax (box 8) | ODO†, ZB | P0 | Recoverable, not a cost. |
| Reverse charge on imported services | Self-assesses output and input VAT (box 9) | ODO†, ZB | P0 | SaaS, cloud, foreign support. |
| Landed-cost allocation | Freight, duty, clearance into item cost | ODO, NS | P1 | Import VAT excluded. |
| WHT on payments to non-residents | Withholds, posts WHT payable, monthly return | ODO† | P1 | 5%, 15% or 20% by category†. |
| Purchase orders | Committed cost per project | all | P1 | |
| Bill and payment approvals | Multi-level | QBO Adv, NS, SI, ZB, ODO | P1 | |
| Vendor credits and refunds | Applied against bills | all | P1 | |
| 3-way match | Checks PO, receipt and bill | NS, SI, ODO | P2 | |
| Bill OCR / email-in | Extracts fields from PDF or photo | XRO (Hubdoc), QBO, ZB, ODO, NS, SI | P2 | Arabic OCR quality matters. |
| Batch payments / bank files | Pays many bills at once | XRO, QBO, NS, SI, ODO | P2 | Saudi bank formats unverified. |

### 2.4 Cash, bank & payments
| Feature | What it does | Seen in | Pri | Notes |
|---|---|---|---|---|
| Bank and cash accounts (treasuries) | Balance per account | all; DFT† | P0 | |
| Receipt and payment vouchers | Printable سند قبض / سند صرف | DFT, QYD, WFQ (unverified) | P0 | Standard Saudi practice. |
| Statement import | CSV, Excel, MT940 | all | P0 | |
| **Cheque register including PDCs** | Received → under collection → cleared or bounced | DFT†; ODO via apps (unverified) | **P0** | Held in PDC receivable/payable until maturity. |
| Live bank feeds | Imports transactions automatically | WFQ† (SAB, Al Rajhi, HSBC, Wio), QYD† | P1 | Via Lean or Tarabut (coverage unverified). |
| Reconciliation rules and auto-match | Rules or ML suggestions | XRO, ODO, QBO, ZB, QYD† | P1 | |
| Petty cash / custody (عهدة) | Technician cash floats | DFT, QYD (unverified) | P1 | |
| Gateway integration and webhooks | Records gateway receipts automatically | XRO, QBO, WFQ† (Stripe) | P1 | Moyasar, Tap, HyperPay, PayTabs, Geidea. |
| Settlement reconciliation | Gross → fees → VAT on fees → net | XRO, WFQ† | P1 | Fees carry 15% input VAT. |
| Cash-flow forecast | From AR, AP, PDCs, milestones | XRO, QBO, NS | P1 | |
| BNPL clearing (Tabby, Tamara) | Provider treated as a clearing debtor | none native (unverified) | P2 | |
| SADAD biller | Bill-number collection | via gateways (unverified) | P2 | |

### 2.5 Multi-currency
| Feature | What it does | Seen in | Pri | Notes |
|---|---|---|---|---|
| Foreign-currency documents with daily rates | Rates fetched automatically | all (XRO and WFQ† on higher plans) | P0 | SAR pegged at 3.75/USD; CNY floats. |
| Realized FX gain/loss | Posted at settlement | all | P0 | |
| Unrealized FX revaluation | Month-end revaluation | XRO, NS, SI, ODO, QBO Adv | P1 | |

### 2.6 Inventory, projects & budgets
| Feature | What it does | Seen in | Pri | Notes |
|---|---|---|---|---|
| Project profitability | Margin per contract | QBO, XRO, ZB†, ODO, NS, SI, QYD† | P0 | The core KPI. |
| Perpetual inventory and COGS | Average or FIFO valuation | QBO, ZB, ODO, NS, QYD†, DFT† | P1 | In the MVP, charge bills to projects. |
| Serial-number tracking | Device serials, warranty | ODO, NS, DFT (unverified) | P1 | Panels, locks, gateways. |
| Timesheets / labor costing | Hours charged to projects | ZB†, ODO, XRO, NS, SI | P1 | |
| Budgets and variance | By account, cost center, project | XRO, QBO, ZB, ODO, NS, SI | P1 | |
| Multi-warehouse / van stock | Stock by location | ODO, NS, ZB, QYD†, DFT† | P2 | |
| IFRS 15 revenue recognition | Over time vs point in time | ZB†, NS, SI, QBO Adv | P2 | Supply, install and program may be one obligation. |

### 2.7 Fixed assets, expenses, tax & platform
| Feature | What it does | Seen in | Pri | Notes |
|---|---|---|---|---|
| Fixed assets and depreciation | Depreciation schedules, disposals | QBO Adv, XRO, ZB†, ODO, NS, SI, QYD†, DFT† | P1 | Vans, tools, demo kits. |
| Expense claims | Receipt → approval → reimbursement | XRO, QBO, ZB, ODO, NS, SI | P1 | |
| VAT codes (S/Z/E/O) with VATEX codes | Tax category per line | ODO† | P0 | 15 VATEX codes† (§5). |
| VAT return mapped to ZATCA boxes | Fills the return automatically | ODO†, ZB, QYD, WFQ, DFT | P0 | |
| E-invoice status dashboard | Cleared / reported / rejected, with messages | ZB, ODO†, QYD | P0 | |
| EGS / CSID lifecycle UI | OTP onboarding, renewal, revocation | ODO†, ZB | P0 | |
| XML archive | Signed and cleared XML | Saudi apps | P0 | Must be accessible offline†. |
| WHT report | Monthly WHT return data | ODO† | P1 | |
| Zakat-base worksheet | Computes the Zakat base from the trial balance | (unverified) | P2 | Usually done by an advisor. |
| Core statements | P&L, balance sheet, cash flow, trial balance, GL (bilingual) | all | P0 | |
| Attachments on every record | Supporting evidence | all | P0 | |
| Reports by dimension, with comparatives | By project, cost center, branch | SI, NS, ODO, QBO, XRO | P1 | |
| Open API and webhooks | Integrations | all | P1 | IoT events can trigger billing. |
| Import / migration tools | Opening balances, master data | all | P1 | |
| Dashboards / report builder | KPIs | NS, SI, QBO Adv, ZB | P2 | |

---

## 3. ZATCA Phase 2 (FATOORA) implementation guide

### 3.1 Wave status (25 Sep 2026)
| Wave | Threshold (VAT-able revenue) | Years tested | Integrate by | Evidence |
|---|---|---|---|---|
| 23 | > SAR 750k | 2022–24 | 1 Jan – 31 Mar 2026 | EY, InvoiceQ, Wafeq (secondary sources) |
| 24 | > SAR 375k | 2022–24 | **30 Jun 2026** | zatca.gov.sa†|
| 25 | > SAR 187.5k | 2022–**25** | **1 Feb 2027** | zatca.gov.sa†; announced 24 Jul 2026 |

- ZATCA notifies each wave directly at least 6 months ahead†.
- Phase 1 (generation) has applied to every VAT registrant since 4 Dec 2021.
- No wave after 25 has been announced. At 187.5k (the voluntary-registration threshold), Wave 25 covers nearly all registrants.

### 3.2 Requirements checklist
- [ ] **Format:** UBL 2.1 XML in the KSA profile. PDF/A-3 with embedded XML is optional for sharing†; the XML is the legal record.
- [ ] **Identifiers:**
  - UUID (KSA-1) and invoice number (BT-1).
  - **ICV** (KSA-16; BR-KSA-33 error)†: per EGS unit, sequential, never reset.
  - **PIH** (KSA-13; base64 SHA-256; BR-KSA-26)†. The first document uses `NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==` (base64 of the hex SHA-256 of "0"; computed here, matches common implementations).
- [ ] **Hash:** SHA-256 of the canonicalized invoice *alone*, excluding `UBLExtensions`, `cac:Signature` and the QR reference. The PIH element inside the XML is hashed with the rest; never concatenate the previous hash as a separate input.
- [ ] **Stamp:** XAdES-BES enveloped signature, ECDSA **secp256k1**, SHA256withECDSA; the certificate is the CSID†.
- [ ] **QR code:** TLV, then Base64†.
  - Tags 1–5: seller name, VAT number, timestamp, total with VAT, VAT.
  - Tags 6–8: XML hash, signature, public key.
  - Tag 9: ZATCA CA's signature over the stamp; simplified invoices only.
- [ ] **Flows:**
  - Standard: **clearance before sharing**†. Share the cleared XML that ZATCA returns.
  - Simplified: share at once, **report within 24h**†.
- [ ] **Notes:** 381/383 carry a BillingReference to the original invoice and a reason.
- [ ] **Prepayments:** 386 invoice. The final invoice carries `PrepaidAmount` and KSA-26/28/29/30/31–34, under rules BR-KSA-73/74/75/79/80†.
- [ ] **Archiving:** offline-accessible XML† for at least 6 years (secondary source).
- [ ] **Controls:** no deletion or editing after issue, tamper evidence, time sync, keys held in a KMS.
- [ ] **EGS units:** one per invoicing system instance or device, with its own key, CSID and chain.
- [ ] **CSID expiry:** monitor NotAfter and renew by `PATCH /production/csids`† before it expires.
  - Reported validity differs (1 vs 5 years; unverified).
  - An expired CSID means immediate rejection (secondary source).

### 3.3 Onboarding sequence†
1. **Master data.**
   - Arabic seller name exactly as on the VAT record.
   - VAT number: 15 digits, starting and ending in 3.
   - CRN.
   - National address: building number 4 digits, postal code 5 digits, district, city, additional number.
2. **OTP.** Generate one in the FATOORA portal ("onboard new solution"). It **expires after 1 hour**†.
3. **Key pair and CSR.**
   - Key: secp256k1.
   - Subject: `CN` (EGS name), `O`, `OU` (branch; for VAT groups the 10-digit TIN, from memory), `C=SA`, organizationIdentifier (VAT number).
   - Subject-alternative-name: `SN=1-<solution>|2-<version>|3-<serial>`, `UID`=VAT number, `title`=**"1100"** (standard + simplified), `registeredAddress`, `businessCategory`.
   - Template: `TSTZATCA-` / `PREZATCA-` / `ZATCA-Code-Signing` for sandbox / simulation / production†.
4. **Compliance CSID.** `POST /compliance` with the `OTP` header and the base64 CSR. Returns binarySecurityToken, secret and requestID.
5. **Compliance checks.** `POST /compliance/invoices`: one sample per document type. For "1100" that is six: standard and simplified invoice, credit note and debit note†.
6. **Production CSID.** `POST /production/csids` with `compliance_request_id`, using Basic auth from the compliance token and secret.
7. **Live.**
   - Clearance: `POST /invoices/clearance/single` with `Clearance-Status: 1`.
   - Reporting: `POST /invoices/reporting/single`.
   - Body: `{invoiceHash, uuid, invoice(base64)}`. Headers: `Accept-Version: V2`, `Accept-Language`†.
8. **Renew and revoke.** Renew with `PATCH /production/csids` (new OTP and CSR)†. Revoke in the portal.

**Base URL** `https://gw-fatoora.zatca.gov.sa/e-invoicing/` plus `developer-portal/` (sandbox), `simulation/` (pre-production; invoices not counted) or `core/` (production)†. Older libraries still use the retired `gw-apic-gov.gazt.gov.sa`.

### 3.4 Data on every document
*Rows without † follow the XML standard as commonly implemented (not re-verified).*

| Data | Standard (B2B) | Simplified (B2C) |
|---|---|---|
| Seller: Arabic name; VAT number (BR-KSA-39/40); other ID with scheme CRN/MOM/MLS/700/SAG/OTH (BR-KSA-08)† | Required | Required |
| Seller address: street, building number (4 digits, BR-KSA-37), postal code (5 digits, BR-KSA-66), city, district, country (these are warnings)† | Required | Required |
| Buyer name and national address | Required | Optional |
| Buyer VAT number, or another ID (TIN, CRN, MOM, MLS, 700, SAG, NAT, GCC, IQA, PAS, OTH; BR-KSA-14)† | Required | Optional |
| Number, UUID, issue date and time `hh:mm:ss` (BR-KSA-70)† | Required | Required |
| Type code 388/381/383/386 (BR-KSA-05) and subtype `NNPNESB`: 01/02, then flags for third-party, nominal, export, summary, self-billed (BR-KSA-06)† | Required | Required |
| Supply date | Required | If different from issue date |
| Currency, plus tax currency SAR (BR-KSA-68)† | Required | Required |
| Lines (quantity, price, discount, net, VAT category and rate, VAT) and VAT breakdown, with VATEX codes for Z/E/O† | Required | Required |
| Totals, prepaid amount, payable, payment-means code | Required | Required |
| ICV, PIH, signature, QR (BR-KSA-27)† | Required (ZATCA stamps the cleared copy) | Required (includes Tag 9) |
| Original reference and reason (381/383) | Required | Required |

### 3.5 Mapping the 50/40/10 contract (open-source reference†; confirm with an advisor)
| Event | Document | VAT | Journal entry |
|---|---|---|---|
| Signing, 50% received | **386** (01 for B2B, 02 for B2C) | Tax point at receipt | Dr Bank / Cr Customer advances / Cr Output VAT |
| 40% received before delivery | **386** | Tax point at receipt | Same |
| Programming complete | **388** for 100%, with `PrepaidAmount` = 90% (net + VAT), a zero-quantity prepayment line per VAT category, and a DocumentReference to each 386 | VAT on the remaining 10% | Dr AR + Dr Advances / Cr Revenue / Cr Output VAT |
| Advance refunded | **381** against the 386 (BR-KSA-56) | Reverses the VAT | Dr Output VAT / Cr Advances |

**Tip:** request each milestone with a *payment request* that is not a tax invoice. Issue the 386 when the money arrives. The reference implementation cites a deadline of the 15th of the following month (VAT IR Art. 53; unverified).

### 3.6 Architecture recommendation
**A — now.** A ZATCA-integrated SaaS (Qoyod, Wafeq, Daftra, Zoho Books) fed from the quotation/CRM app via API. Fastest to compliance, but the ledger lives outside your platform.

**B — recommended for the ERP MVP.** Your ERP owns documents and the ledger; a middleware API does XML, signing, submission and onboarding.
- Named providers: **Wafeq e-invoicing API**†, ClearTax KSA, Vertex, Invopop (GOBL), Fonoa, InvoiceQ, Flick Network, Complyance.io, Taxilla, Accqrate. Sovos, Avalara, Pagero and EDICOM also exist (KSA offering unverified).
- Evaluate: 386 support, multiple EGS units, SLA, per-invoice price, data residency, and access to the raw signed and cleared XML.

**C — native, later.** A server service (Node/TS on Cloud Run) with the **official ZATCA SDK** (Java CLI and .NET, from the Compliance & Enablement Toolbox) as a validation oracle in CI.

| Language | Library | Notes |
|---|---|---|
| TypeScript | `@pioneersoft/zatca-einvoice` | MIT; standard + simplified, renewal; new, 0 stars |
| TypeScript | `wes4m/zatca-xml-js` | 90★; experimental, **simplified invoices only** |
| PHP | `Saleh7/php-zatca-xml` | 62★; active Aug 2026 |
| Python (ERPNext) | `lavaloon-eg/ksa_compliance` | 89★ |
| Python (ERPNext) | `ERPGulf/zatca_erpgulf` | 61★ |
| Ruby / .NET / Go | `mrsool/zatca`, `aljbri/Zatca.Net`, `invopop/gobl.sa.zatca` | |
| PHP / TS | `SallaApp/ZATCA`, `axenda/zatca` | Phase 1 QR code only |

**Design regardless of option:**
- An `EInvoiceProvider` interface so providers can be swapped.
- Documents that cannot change once issued.
- A transactional outbox and a **per-EGS serialized queue**, so the chain has no races.
- Retries with backoff and a 24h B2C monitor.
- An append-only submission log.
- WORM storage for signed XML, cleared XML and the PDF.
- Keys in a KMS; alerts on certificate expiry.

### 3.7 Testing
1. **Golden files.** Hash, sign and QR sample XMLs locally. Validate with the SDK CLI in CI (flag names unverified).
2. **Sandbox.** Run the compliance endpoints for the six document types plus 386 cases.
3. **Simulation.** Use a real OTP and cover B2B, B2C, export, exempt, out-of-scope, FX, discounts and rounding. Include 386 → 388 deduction, 381 against a 386, rejections and retries, and Arabic names. Reconcile your counts with the portal's statistics (Odoo's advice†).
4. **Chaos tests.** ZATCA outage (queue, and B2C invoices still issued), expired CSID, duplicate submissions (idempotency on UUID).
5. **Production switch.** Odoo notes this is irreversible†.

### 3.8 Pitfalls and common rejections
- **Chain errors.** PIH mismatch, ICV gaps. ZATCA stores the hashes of *rejected* documents too, so the next PIH must use the rejected document's hash.
- **Wrong certificate.** Signing in production with the compliance CSID; BR-KSA-98 `invalid-signing-certificate`.
- **QR errors.** TLV length counted in characters instead of UTF-8 bytes for Arabic.
- **Seller name mismatch.** The Arabic seller name differs from the VAT record.
- **Address warnings.** BR-KSA-37 and BR-KSA-66 are *warnings*; most other rules are errors†.
- **Rounding.** Round half-up to 2 decimals and reconcile line and total VAT.
- **Outdated SDK.** The 2021 SDK rejects 386 (BR-KSA-05); use the current SDK. Set `-Dfile.encoding=UTF-8` on Windows†.
- **Editing issued invoices.** Never. Odoo lets only rejected invoices return to draft†.

### 3.9 Penalties (secondary sources; ZATCA's official schedule not fetched)
- "Warning first" since 30 Jan 2022, with a 30–60 day correction window.
- Repeats within 12 months escalate. For a missing QR code: SAR 1,000 → 5,000 → 10,000 → up to 40,000.
- Not issuing or not keeping e-invoices is reported to start at SAR 5,000.
- Reported overall range: SAR 5,000–50,000.

---

## 4. Leading-edge 2025–26 innovations worth copying
*(Vendor announcements; not re-verified this session unless marked †.)*

| Innovation | Leading app | Copy for Motqinon |
|---|---|---|
| Agentic AI bookkeeper (categorize, reconcile, flag) | QuickBooks AI agents (2025); Xero JAX | Suggest-and-approve only. AI never issues ZATCA documents. |
| AI collections and late-payer prediction | QuickBooks Payments agent | WhatsApp reminders tied to milestones. |
| Bill capture OCR | NetSuite Bill Capture, Xero Hubdoc, Zoho Autoscan, Odoo, Sage Intacct | Arabic/English OCR for supplier invoices and customs declarations. |
| ML bank reconciliation | Xero, Odoo reconciliation models, QBO | Auto-match gateway payouts and PDC deposits. |
| GL anomaly detection | Sage Intacct GL Outlier Detection | Flag duplicate bills and wrong VAT codes. |
| Cash-flow forecasting | Xero, QBO Finance agent, NetSuite | Forecast from milestones, PDCs and AP. |
| Conversational analytics | Intuit Assist, JAX, Zoho Zia | Arabic "ask your books" (P2). |
| E-invoicing sold as an API | **Wafeq**† | Buy, don't build, the ZATCA layer for the MVP. |
| **Motqinon-unique:** event-driven billing | — | An IoT commissioning event (devices online and programmed) drafts the final 10% invoice and the customer sign-off. |

---

## 5. Other Saudi specifics
- **VAT** (VAT Law; not re-verified):
  - Rate 15%. Registration is mandatory above SAR 375k, voluntary above 187.5k.
  - Returns are monthly if supplies exceed SAR 40M, otherwise quarterly, due by the end of the following month.
  - Penalties: late filing 5–25%, late payment 1% per 30 days, an incorrect return 50% of the difference.
- **VAT return lines (Odoo KSA report†):**
  - Sales: standard 15%; special sales to citizens (private health/education); zero-rated; exports; exempt.
  - Purchases: standard 15%; imports with VAT paid at customs; imports under reverse charge; zero-rated; exempt.
  - Result: total due, recoverable, net.
  - The ZATCA form also has prior-period corrections (±SAR 5k) and credit carried forward (from memory).
- **VATEX codes†:** SA-29 and 29-7 (financial services, life insurance), SA-30 (real estate), SA-32/33 (exports), SA-34-1…5 (international transport), SA-35 (medicines), SA-36 (qualifying metals), EDU/HEA (private education/healthcare to citizens), OOS (not subject).
- **Imports:** VAT on goods is paid at customs and is input tax, while duty and freight go into cost. Imported services are self-assessed under reverse charge (RCM).
- **WHT (Odoo categories†):**
  - **5%:** rent, air tickets and air/sea freight, international telecoms, dividends, consulting and technical services, loan returns, insurance.
  - **15%:** royalties, head-office or branch services, other.
  - **20%:** management fees.
  - Remit by the 10th of the following month (unverified). No WHT on goods.
  - Relevant for foreign software licenses, cloud and technical support.
- **Zakat** (unverified detail):
  - 2.5% of the Zakat base (pro-rated for a Gregorian year), for Saudi/GCC-owned entities.
  - New Implementing Regulations apply to fiscal years from 1 Jan 2024.
  - The return is due within 120 days of year-end.
  - A Zakat certificate is needed for tenders.
- **Advances:** VAT is due when payment is received, to the extent of the amount paid. An invoice issued before payment also triggers VAT, so request milestones with non-tax payment requests.
- **Cheques:** PDCs are common in B2B. Keep a register by maturity date. Under Saudi law a cheque is payable on presentation and bounced cheques carry criminal liability (unverified).
- **Open banking:** SAMA Open Banking Framework (account information first, payment initiation later; dates unverified). Aggregators include Lean Technologies and Tarabut. Wafeq already feeds SAB, Al Rajhi and HSBC†.
- **Payments:** Moyasar, HyperPay, Tap, PayTabs, Geidea. Support **mada**, Apple Pay, STC Pay, SADAD, and BNPL (Tabby, Tamara).
- **SOCPA:** IFRS as endorsed by SOCPA for listed entities; **IFRS for SMEs as endorsed by SOCPA** for non-listed SMEs such as Motqinon.
- **Retention** (VAT IR Art. 66; unverified): 6 years in general, 11 for capital assets, 15 for real estate. The Commercial Books law is commonly cited at 10 years (unverified). Keep XML offline-accessible†; 10 years is the safe default.

---

## 6. Data entities implied
- **Organization:**
  - `company` (name_ar/en, vat_no, crn, street, building_no, additional_no, district, city, postal_code)
  - `branch` (egs_unit_id)
  - `fiscal_year`, `period` (status, lock_date)
- **Ledger:**
  - `account` (code, name_ar/en, type, parent_id, ifrs_line)
  - `journal`
  - `journal_entry` (date, source_type/id, status, reversal_of)
  - `journal_line` (account, debit, credit, currency, fx_rate, amount_currency, partner, project, cost_center, tax_code, tax_base, reconcile_group)
- **Tax:**
  - `tax_code` (rate, S/Z/E/O, vatex, return_box, rcm)
  - `wht_code`
  - `vat_return` (box values, adjustments, filed_at)
  - `wht_return`, `zakat_worksheet`
- **Parties and contracts:**
  - `partner` (B2B/B2C, name_ar/en, vat_no, id_scheme/value, address)
  - `contract` (quotation_id, value, retention_pct)
  - `billing_milestone` (pct, trigger, doc_type 386/388, status, invoice_id)
- **Invoices:**
  - `invoice` (number, type, subtype7, issue date/time, supply_date, currency, totals, prepaid_amount, billing_ref_id, reason, status draft/issued/cleared/reported/rejected, uuid, icv, pih, hash, qr, egs_unit_id, xml_uri, cleared_xml_uri, pdf_uri)
  - `invoice_line`
  - `invoice_prepayment_link` (final_id, prepayment_id, net, vat)
- **ZATCA:**
  - `egs_unit` (env, serial, csr, kms_key_ref, ccsid, pcsid (encrypted), cert_not_after, icv_counter, last_hash)
  - `zatca_submission` (invoice_id, endpoint, attempt, http_status, PASS/WARNING/ERROR, clearance/reporting status, warnings, errors, response_uri, timestamps) — append-only
- **Cash:**
  - `payment` (method, amount, fx, gateway_ref, fee, fee_vat)
  - `payment_allocation`
  - `cheque` (no., bank, due_date, status history)
  - `bank_account`, `bank_txn` (provider, external_id, matched_entry)
  - `recon_rule`, `custody_advance`
- **AP and stock:** `purchase_order`, `vendor_bill`, `vendor_credit`, `customs_declaration` (import_vat, duty, freight), `landed_cost_alloc`, `item`, `stock_move`, `serial_number`, `fixed_asset`, `depreciation_line`, `expense_claim`, `budget_line`, `fx_rate`, `fx_revaluation`
- **Control:** `approval`, `audit_log` (entity, action, before/after, user, ts; hash-chained), `attachment` (sha256, retention_until), `user`, `role`

---

## 7. Recommended MVP scope and deferrals
**Phase 0 — now to 4 weeks.**
- Confirm the wave in FATOORA.
- Move tax invoicing to a ZATCA-integrated SaaS or middleware.
- Stop issuing invoices from Sheets.

**MVP (P0):**
- Bilingual COA template and GL, periods and lock dates
- Project and cost-center dimensions; audit trail, attachments, roles
- Quote → contract → milestone schedule
- 386/388/381/383, standard and simplified
- ZATCA via middleware behind a provider interface, with status dashboard, submission log and archive
- Receipts, customer advances, vouchers; AR aging and statements
- USD/CNY vendor bills with realized FX
- Import VAT and reverse charge
- Cheque/PDC register
- Bank and cash accounts with CSV reconciliation
- VAT codes and VAT-return report
- P&L, balance sheet, trial balance, GL, project profitability

**Wave 2 (P1):**
- Bank feeds (Lean/Tarabut) and gateway payment links with settlement reconciliation (Moyasar/Tap)
- WhatsApp dunning
- WHT
- Inventory with serials and landed cost
- Fixed assets, expense claims and custody
- Budgets, approvals, FX revaluation
- Recurring invoices (maintenance, IoT subscriptions)
- Retention
- Auditor access, API/webhooks
- Cash-flow forecast
- Second branch / EGS unit

**Later (P2):**
- Native ZATCA engine
- OCR, AI agents, anomaly detection
- 3-way match, batch payment files
- Consolidation
- IFRS 15 automation
- Zakat worksheet
- BNPL and SADAD
- PDF/A-3
- Custom dashboards

---

## 8. Sources
**Fetched directly:**
- https://github.com/wes4m/zatca-xml-js ; https://raw.githubusercontent.com/wes4m/zatca-xml-js/main/src/zatca/api/index.ts
- https://github.com/PioneerSoft-sa/zatca-einvoice
- https://raw.githubusercontent.com/Saleh7/php-zatca-xml/main/README.md
- https://pkg.go.dev/github.com/invopop/gobl.sa.zatca/addon
- https://raw.githubusercontent.com/odoo/documentation/18.0/content/applications/finance/fiscal_localizations/saudi_arabia.rst
- https://raw.githubusercontent.com/odoo/odoo/18.0/addons/l10n_sa_edi/models/account_journal.py ; …/certificate.py ; …/account_tax.py ; …/res_partner.py
- https://raw.githubusercontent.com/odoo/odoo/18.0/addons/l10n_sa/data/account_tax_report_data.xml
- https://raw.githubusercontent.com/mrsool/zatca/main/einvoicing-sdk/Data/Rules/schematrons/20210819_ZATCA_E-invoice_Validation_Rules.xsl
- https://github.com/Amer-Omar-Bamazrou/saudi-ledger-platform/pull/165
- GitHub repository search (stars and activity): SallaApp/ZATCA, Saleh7/php-zatca-xml, lavaloon-eg/ksa_compliance, ERPGulf/zatca_erpgulf, axenda/zatca, mrsool/zatca, aljbri/Zatca.Net

**Via search-result snippets (direct fetch blocked):**
- https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx
- https://zatca.gov.sa/en/Pages/news_1426.aspx
- https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx
- https://zatca.gov.sa/en/E-Invoicing/Introduction/LawsAndRegulations/Documents/E-Invoicing%20Implementation%20Resolution_EN.pdf
- https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf
- https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf
- https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/QRCodeCreation.pdf
- https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx
- https://zatca1.discourse.group/t/e-invoicing-api-endpoints/487
- https://www.ey.com/en_gl/technical/tax-alerts/saudi-arabia-announces-23rd-wave-of-phase-2-e-invoicing-integration
- https://invoiceq.com/en/zatca-updates/wave-23-e-invoicing-phase-2-compliance-with-zatca/
- https://www.vatupdate.com/2026/08/11/zatca-announces-wave-25-of-e-invoicing-threshold-halved-to-sar-187500-integration-deadline-1-february-2027/
- https://www.wafeq.com/en-sa/tax-and-reporting/e-invoicing-fines-in-saudi-arabia:-what-you-need-to-know-about-zatca-penalties
- https://www.jaicome.sa/en/blog/zatca-einvoicing-fines-penalties/
- https://invoicemonk.com/en/blog/zatca-phase-2-common-errors
- https://www.cleartax.com/sa/how-to-renew-existing-csid-ksa-e-invoicing
- https://qeemahcloud.com/en/blog/zatca-digital-signature-csid-certificate-guide/
- https://www.zoho.com/sa/books/help/e-invoicing/phase-2.html ; https://www.zoho.com/sa/books/e-invoicing
- https://www.qoyod.com/en/accounting-software/ ; https://www.qoyod.com/en/accounting-software/core-accounting-for-business-owners/pos-integration/ ; https://www.qoyod.com/en/learn/debit-notes-tech/
- https://www.wafeq.com/en-sa ; https://www.wafeq.com/en/business-hub/for-business/what-is-wafeq-accounting-software
- https://www.daftra.com/en/ ; https://www.daftra.com/en/hub/zatca-einvoicing-phase-2
- https://docs.cleartax.in/cleartax-docs/e-invoicing-ksa-api/e-invoicing-ksa-api-reference/resources-and-masters/e-invoice-object
- https://developer.vertexinc.com/einvoicing/docs/saudi-arabia-invoice-type-code ; https://developer.vertexinc.com/einvoicing/docs/saudi-arabia-prepayment-amounts
