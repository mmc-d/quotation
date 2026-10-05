# Module 09 — HR, Payroll, Attendance & Commissions (الموارد البشرية والرواتب والعمولات)

| | |
|---|---|
| **Phases** | P0 → Phase 7a (site attendance & timesheets start in Phase 4) · P1 → Phase 7a (late) · P2 → later |
| **Benchmarked** | Jisr (جسر), ZenHR, Bayzat, PalmHR, Menaitech, Zoho People + Zoho Payroll (KSA), Odoo 19 (`l10n_sa_hr_payroll`), Rippling, BambooHR, Personio; commissions: Salesforce Spiff, CaptivateIQ, Xactly, Zoho CRM Commission Management |
| **System of record** | **Frappe HR** on the ERPNext back office + `mmc_ksa` extension (GOSI rates, Mudad file, Qiwa/Nitaqat, document expiry) — MMC Core owns commissions, technician site attendance and incentives |
| **Business owner** | HR Officer with Finance Manager |

> **Why not a Saudi HR SaaS first?** Jisr and ZenHR set the local bar (GOSI, Mudad, Muqeem, Qiwa automation). At the company's size (≈ 20 users planned — D10) the rules are small and stable, the Mudad step is a file upload, and the real value is in the links — technician hours → project cost, collections → commissions — which HR SaaS products don't provide. Payroll therefore runs on Frappe HR (native posting to the ERPNext ledger) with a thin KSA extension. **Fallback (D7):** Jisr, ZenHR or PalmHR if payroll must go live before the back office, or when headcount passes ≈ 60–75, multiple CRs appear, or the Mudad compliance percentage drops.

## 1. Goals
1. Never miss an iqama, passport, insurance or licence expiry; keep contracts documented in Qiwa.
2. Pay correctly and on time: salary components, GOSI/SANED at the **rates in force on the pay date**, deductions, loans, Mudad (WPS) file, payslips.
3. Know where technicians' hours go (project sites) and pay sales commissions only on money collected.
4. Stay inside Saudization rules — especially **60% Saudi sales staff** (since 19 Apr 2026, establishments with ≥ 3 sales staff).

## 2. Saudi rules to encode (verify yearly and on every ministerial decision)

| Topic | Rule in force (Sep 2026) | How the system handles it |
|-------|---------------------------|---------------------------|
| Legal basis | Labor Law amended by Royal Decree M/44, in force **19 Feb 2025** | Rule tables with effective dates |
| Working hours | 8 h/day, 48 h/week; **Ramadan: 6 h/day, 36 h/week for Muslim workers** | Ramadan shift profile (company calendar) |
| Overtime (Art. 107) | Hourly wage **+ 50% of basic** per overtime hour; paid time off in lieu possible with written consent | Configurable formula; pre-approval |
| Probation / notice | Probation ≤ 180 days total; notice ≥ 30 days (employee) / ≥ 60 days (employer) for indefinite contracts | Contract register alerts |
| Annual leave (Art. 109) | 21 days; 30 days after 5 years; unused leave paid at exit (Art. 111) | Service-based accrual; encashment in final settlement |
| Sick leave (Art. 117) | Per year: 30 days full pay, 60 days at 75%, 30 days unpaid | Tiered leave type |
| Family leave | Maternity 12 weeks full pay; paternity 3 days; marriage 5 days; bereavement 5 days (spouse/parent/child), 3 days (sibling) | Statutory leave presets |
| Hajj (Art. 114) | 10–15 days incl. Eid al-Adha, once, after 2 consecutive years | Eligibility rule |
| Holidays | Eid al-Fitr & Eid al-Adha (≈ 4 days each), Founding Day 22 Feb, National Day 23 Sep | Holiday calendar confirmed yearly |
| EOSB (Art. 84/85/87) | Half a month's wage per year for years 1–5, one month per year after (pro-rata); resignation: < 2 yrs none, 2–5 yrs ⅓, 5–10 yrs ⅔, 10+ full; Art. 87 exceptions | Gratuity rules + final settlement; wage basis reviewed by counsel |
| GOSI — Saudi, old system | Annuity 9% + 9%, SANED 0.75% + 0.75%, occupational hazards 2% employer → employer 11.75%, employee 9.75% | `statutory_rate` rows with effective dates |
| GOSI — Saudi, new system (first registered from 3 Jul 2024) | Annuity steps up 0.5% each side every 1 July: 10% in 2026 → 11% in 2028; from 1 Jul 2026 employer 12.75%, employee 10.75% | Dated rates; July rate-change reminder |
| GOSI — non-Saudi | 2% employer (occupational hazards) | Nationality-driven |
| Contributory wage | Basic + housing (in-kind housing = 2 months' basic/year); min SAR 1,500, max SAR 45,000 | Component flags |
| WPS / Mudad | Salary file uploaded to Mudad for all private establishments; compliance measured per establishment; fines per employee per month | Mudad file export (API later) |
| Qiwa contracts | Unified contract; documentation targets through 2026; authenticated contracts enforceable via Najiz | Qiwa ID + status per contract |
| Nitaqat | Saudi paid ≥ SAR 4,000 counts 1, below 0.5; only Qiwa-documented contracts count (from Apr 2026) | Saudization dashboard |
| Profession quotas | **Sales & marketing 60%** (≥ 3 staff; includes IT/communications-equipment sales specialists; min wage reported SAR 5,500); **engineering 30%** (≥ 5 engineers, SCE accreditation, SAR 8,000+) | Quota check on hiring and on commission-plan assignment |

## 3. Feature backlog

**Where:** **H** = Frappe HR standard · **X** = `mmc_ksa` extension · **C** = MMC Core.

### 3.1 People & documents
| ID | Feature | Where | Adopted from | P | Notes |
|----|---------|-------|-------------|---|-------|
| HR-01 | Employee master with Saudi/non-Saudi fields: national ID/iqama (encrypted), border no., passport, iqama profession, GOSI no. & system, IBAN (validated), insurance class & expiry, licences, Hijri + Gregorian dates | H + X | Jisr, ZenHR, Bayzat, Odoo | P0 | Iqama profession vs job/commission plan mismatch flag |
| HR-02 | Org structure: entity → branches/sites → departments → cost centers (sites mapped to projects) | H | All | P0 | |
| HR-03 | Contract register with Qiwa ID/authentication status, probation & notice tracking | X | Jisr, ZenHR, PalmHR | P0 | |
| HR-04 | Document vault with staged expiry alerts (90/60/30/7 days) to HR, manager and employee | X + C notifications | Jisr, ZenHR, Zoho | P0 | Lapses block government services |
| HR-05 | Letters & certificates (salary certificate, employment letter, NOC) with QR verification | H + C | Jisr, ZenHR, Menaitech | P0 | Top self-service request |
| HR-06 | Government transaction log (Qiwa/Muqeem/GOSI/Mudad reference, fee, date) | X | — | P0 | Audit trail without APIs |
| HR-07 | Onboarding/offboarding checklists (GOSI, Qiwa, insurance, devices, platform access, clearance) | H + C | Rippling, BambooHR, Jisr | P1 | Offboarding also revokes sessions (module 01) |
| HR-08 | Exit re-entry visa tracker, Muqeem workflows (checklists first, API later) | X | ZenHR, Bayzat, Menaitech | P1 · P2 API | |

### 3.2 Time, attendance & leave
| ID | Feature | Where | Adopted from | P | Notes |
|----|---------|-------|-------------|---|-------|
| HR-20 | **Geofenced site check-in** from the technician PWA (work-order check-in counts as attendance) | C → H | ZenHR geofencing, Odoo GPS on timer | P0 | PDPL notice; location only at clock-in |
| HR-21 | Office attendance (mobile/web; ZKTeco biometric import later) | H | Jisr, ZenHR, Zoho | P0 · P1 biometric | |
| HR-22 | Shifts incl. Ramadan profile; overtime requests with approval | H + X | Jisr, ZenHR | P0 | |
| HR-23 | Timesheets by project/work order for costing | C → E | Odoo, Rippling | P0 | Feeds project P&L |
| HR-24 | Statutory leave presets (2025 amendments), accruals, balances, approvals, holiday calendar | H + X | Jisr, ZenHR, Zoho | P0 | |
| HR-25 | Selfie/face check at clock-in | C | Bayzat, Zoho | P2 | Biometric = sensitive data under PDPL — avoid unless needed |

### 3.3 Payroll & settlement
| ID | Feature | Where | Adopted from | P | Notes |
|----|---------|-------|-------------|---|-------|
| HR-30 | Component-based salary (basic, housing, transport, other) with GOSI/EOSB/overtime base flags | H | All | P0 | |
| HR-31 | GOSI/SANED engine with **dated** rate tables (old vs new system, non-Saudi) and wage floor/cap | X | Jisr, ZenHR, Bayzat, Zoho, Odoo | P0 | |
| HR-32 | Variable inputs: commissions, overtime, technician incentives, expense reimbursements, bonuses | H (Additional Salary) ← C | Bayzat | P0 | |
| HR-33 | Loans & advances with installments and caps | H | Odoo, ZenHR, Jisr | P0 | |
| HR-34 | Absence/lateness deductions and pro-rating | H | Jisr, ZenHR | P0 | |
| HR-35 | Payroll run: draft → approve → lock; bilingual payslips; bank file | H | All | P0 | |
| HR-36 | **Mudad salary (WPS) file export** + GOSI reconciliation | X | Zoho Payroll, PalmHR, Odoo partners | P0 | Manual upload at first |
| HR-37 | Payroll journal by cost center/project (incl. employer GOSI, EOSB provision) | H → E | Odoo, ZenHR, Jisr | P0 | Native in ERPNext |
| HR-38 | EOSB calculator & final settlement (salary + EOSB + leave + notice − loans) with termination-reason mapping | H + X | Jisr, Zoho, Odoo partners | P0 | Counsel reviews wage basis |
| HR-39 | Monthly EOSB provision | H | Zoho, Odoo | P1 | |
| HR-40 | Mudad API submission, earned-wage access via Mudad/partner | X | ZenHR (Mudad API), ZenEWA, Mudad Flexible Salary | P2 | |

### 3.4 Commissions & incentives (MMC Core)
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| HR-50 | Commission plans by product line (intercom, locks, smart home, IoT, AMC) | CaptivateIQ, Zoho CRM, Spiff | P0 | |
| HR-51 | **Earned on invoice, payable on collection** (pro-rata to customer payments) | Commission tools (pay-when-paid) | P0 | Needs payment allocation from ERPNext |
| HR-52 | Margin-based commission option (discourages discounting) | Zoho CRM commissions | P1 | Uses quote cost snapshots |
| HR-53 | Tiers, accelerators, quotas; splits; clawbacks on credit notes | Spiff, CaptivateIQ, Xactly | P1 | |
| HR-54 | Rep earnings dashboard (earned vs payable vs paid) | Spiff | P1 | |
| HR-55 | Technician incentives: per-installation rate, first-time-fix bonus, callback penalty, customer sign-off | — (company-specific) | P1 | From work-order data |
| HR-56 | Partner/referrer fees (consultants, contractors) paid via AP | Odoo resellers, Salesforce PRM | P1 | Module 02 |

### 3.5 Self-service, Saudization & analytics
| ID | Feature | Where | Adopted from | P | Notes |
|----|---------|-------|-------------|---|-------|
| HR-60 | Employee & manager self-service (web/PWA): leave, punches, payslips, letters, loans, expenses; approvals inbox | H + C | ZenHR, Jisr, Bayzat, Menaitech | P0 | Arabic-first |
| HR-61 | Expense claims with receipt photo, VAT fields (ZATCA QR read), project allocation, reimbursement via payroll | H + C | Jisr, Bayzat, ZenHR | P0 · P1 OCR | |
| HR-62 | **Saudization dashboard**: Nitaqat count, sales/engineering ratios, Qiwa-documented flag; what-if on hiring | X + C | ZenHR (AI forecasts), Bayzat | P0 · P1 what-if | |
| HR-63 | Compliance pre-checks before Mudad/GOSI submissions | X | Jisr | P1 | |
| HR-64 | HR analytics: headcount, turnover, labor cost per project, technician productivity | C | ZenHR, Bayzat, Personio | P1 | |
| HR-65 | Performance reviews/KPIs, training & brand certifications with expiry, recruiting | H | ZenHR, Jisr, Personio, BambooHR | P2 | Certifications feed dispatch skills |
| HR-66 | Arabic HR/labor-law assistant citing sources (policy + Labor Law) | C (AI gateway) | Jisr "Momtathl" | P2 | Module 12 |

## 4. Acceptance criteria (Phase 7a exit)
- Two consecutive payroll runs reconciled with the accountant's parallel calculation; Mudad file accepted; GOSI deductions match the GOSI bill.
- Unit tests pass for Art. 84/85 EOSB examples, overtime formula, sick-leave tiers and each GOSI rate period.
- Every expiring iqama/passport/insurance in the next 90 days is visible on the HR dashboard with owners and alerts.
- Commission statements reconcile to collected invoices; clawbacks applied on credit notes.
- Saudization ratios for sales and engineering visible and within quota (or with an approved hiring plan).
