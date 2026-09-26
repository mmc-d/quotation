# HR, Payroll, Attendance, Expenses & Commissions: Benchmark and Saudi Compliance (Motqinon Tech)

Prepared 2026-09-25. Research only; no repository files were changed.

**Summary**
1. **Jisr and ZenHR set the KSA bar.** Both automate GOSI, Mudad, Muqeem and Qiwa, calculate EOSB, and offer geofenced mobile attendance and self-service. Both now add AI; ZenHR also offers earned-wage access.
2. **2025–26 rule changes to encode:**
   - Labor Law amendments, in force since 19 Feb 2025.
   - GOSI "new system" annuity rate rises every 1 July until 2028.
   - From Apr 2026, only Saudis with Qiwa-documented contracts count for Nitaqat.
   - From 19 Apr 2026, sales professions must be 60% Saudi. This hits Motqinon's commission-driven sales team.
3. **Recommendation:** build the HR and payroll core inside the ERP, because payroll → projects and commissions is where the value is. Export the Mudad salary (WPS) file, defer government APIs, and keep Jisr, ZenHR or PalmHR as a fallback.

**Method and caveats**
- **How sources were read.** The sandbox's network proxy blocked direct page fetches on every domain tried (gosi.gov.sa, hrsd.gov.sa, jisr.net, zenhr.com, mercans.com, PwC). Findings come from search-engine excerpts of the §7 URLs, checked 2026-09-25.
- **Vendor bias.** Several "best HR software in KSA" lists are vendor-written, so their rankings are only indicative.
- **Tags:**
  - **[V]** confirmed in an official or reputable source excerpt.
  - **[S]** single secondary source.
  - **[U]** not verified in this session.
  - **†** in "Seen in": from prior product knowledge, not re-checked this session.

---

## 1. Apps benchmarked

**Popularity in KSA (2026):** no market-share data was found.
- Jisr and ZenHR are the most-cited leaders for KSA-only compliance.
- Bayzat is strongest for UAE and KSA together, PalmHR for low-cost SMBs, Menaitech for enterprises.
- Other names in 2026 KSA lists: GulfHR, Darwinbox, SAP, Oracle, Workday [S].

| App | Positioning / why a leader | Notable strengths |
|---|---|---|
| **Jisr (جسر)** | Saudi-built HR, Talent & Spend suite, Riyadh-hosted [S]. Claims 5,000+ companies (vendor). | Automates GOSI, SANED, Muqeem, Mudad, plus Qiwa (one review says Qiwa is "soon"). Automatic EOSB and violation-penalty calculation. Ramadan and holiday rules. Checks before submission. Spend: OCR expense claims, corporate cards with up to 4% cashback. AI: "Jisri" assistant and "Momtathl" labor-law AI. |
| **ZenHR** | Jordan-based MENA suite, payroll in 11 countries. | Native Mudad API (submit, track, cancel payments), Muqeem, GOSI, Qiwa. GPS geofencing. Employee and manager self-service (vendor: 88% of use is mobile). AI Saudization forecasts. ZenEWA earned-wage access. Integrations marketplace. |
| **Bayzat** | UAE-based; UAE and KSA in one account. | GOSI and Mudad. Muqeem integration. AI assistant and analytics. Health-insurance marketplace. OCR expenses flow into payroll. Nitaqat awareness. |
| **PalmHR** | Saudi SMB HR system, about SAR 19 per employee per month (third-party figure). | Arabic-first. Native Mudad, GOSI, Qiwa. Recruitment and attendance. Limited AI. |
| **Menaitech** | Jordan-based enterprise suite (MenaPay payroll, MenaME self-service). | MenaPay integrates with Mudad; GOSI and Muqeem integrations. |
| **Mudad** (government) | Mandatory salary-file (WPS) channel. | Compliance percentage. "Flexible Salary" earned-wage access with Khazna, Jul 2025 [S]. |
| **Zoho People + Payroll (KSA)** | Global SMB suite; KSA payroll launched 2025. | GOSI. Salary file in Mudad's format. EOSB by contract type and service. Attendance and leave sync from People. Mobile check-in. Links to Zoho Books/CRM. |
| **Odoo 19 (Saudi localization)** | Open-source ERP with built-in accounting. | Module `l10n_sa_hr_payroll`: "KSA Employee" salary structure (Monthly Pay; Salary Advance & Loan). GOSI driven by nationality. Mudad file and EOSB from partner apps. |
| **Rippling** | Global HR, IT and finance on one employee record. | One record drives onboarding, app and device access, and approvals, with AI on top. KSA payroll [U]. |
| **BambooHR** | US-focused SMB HR system. | "Ask BambooHR" AI Q&A; AI candidate ranking. Payroll is US-only†. |
| **Personio** | European SMB HR. | AI assistant answers questions and draws KPI charts; AI for reviews. |
| **Salesforce Spiff** | Commissions tool native to Salesforce. | Reps see earnings in real time. |
| **CaptivateIQ** | For teams that manage compensation plans. | No-code plan modeling; automated calculations. |
| **Xactly** | Enterprise sales-compensation management. | Governance, sandbox testing, forecasting. Agentic AI resolves payout disputes. |
| **Zoho CRM Commission Mgmt** | Free extension for all Zoho CRM editions. | Commission by deal value, time to close, revenue, profit margin, fixed or %, tiers. |

## 2. Feature inventory

**Legend:** J = Jisr · Z = ZenHR · B = Bayzat · P = PalmHR · M = Menaitech · ZO = Zoho People/Payroll · O = Odoo · R = Rippling · BH = BambooHR · PE = Personio · SP = Spiff · CQ = CaptivateIQ · X = Xactly · ZC = Zoho CRM. † = not re-verified.

**Priority:** P0 = MVP must-have, P1 = second wave, P2 = later.

### 2.1 Employee master and organization
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Nationality-driven profile | National ID (starts with 1) or iqama (starts with 2), border no., passport | O; J, Z, B, P (implied by GOSI/Muqeem support) | P0 | Drives GOSI branch, Nitaqat weight, Muqeem |
| Official profession vs role | Stores the iqama/Qiwa profession; flags mismatch with the job or commission plan | Z†, J† | P0 | Expat "sales" roles now clash with 60% sales Saudization |
| Hijri and Gregorian dates | Entry, display and alerts in both calendars | J†, Z† | P0 | Many government documents are Hijri-dated |
| GOSI record | GOSI no., old or new system, contributory wage | J, Z, B | P0 | Old vs new system sets the rate |
| IBAN validation | Saudi IBAN (24 characters, mod-97 check) and bank code | ZO†, J† | P0 | Required in the Mudad salary file |
| Medical insurance and dependents | Class, member no., expiry, dependents | B, J† | P0 expiry / P1 | Valid CCHI cover needed for iqama renewal† |
| Licences | Driving licence; Saudi Council of Engineers (SCE) membership | J†, Z† | P0 / P1 | SCE needed for engineering Saudization [S] |
| Org and cost structure | Entity → sites → departments → cost centers; org chart | all† | P0 | Sites mapped to ERP projects |

### 2.2 Contracts, onboarding and offboarding
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Contract register with Qiwa status | Contract type, probation, notice, Qiwa ID and authentication status | J, Z, P | P0 | Qiwa documentation decides Nitaqat credit |
| Probation tracker | Alerts; cap of 180 days in total | J†, Z† | P0 | Since 19 Feb 2025 |
| Arabic/English templates and e-signature | Offer letters, annexes, policies | Z†, PE†, BH† | P1 | The Qiwa contract remains the legal document |
| Onboarding checklist | GOSI, Qiwa, insurance, iqama transfer, devices, app access | R, BH†, J† | P1 | Rippling-style HR→IT chain |
| Offboarding and clearance | Assets, settlement, GOSI exit, Qiwa termination, final exit | J†, Z† | P1 | |
| Work regulations and discipline | Violation table, warnings, penalty deductions | J | P1 | Must follow the approved internal regulations† |

### 2.3 Documents and expiry dates
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Document vault | Versioned iqama, passport, visa, exit re-entry visa, licences, insurance | J†, Z†, B†, ZO (partner blog) | P0 | |
| Staged expiry alerts | Alerts at 90/60/30/7 days to HR, manager and employee | J†, Z†, ZO† | P0 | Lapses block government services† |
| Exit re-entry tracker | Visa validity, expected return, no-show flag | Z, B (Muqeem) | P1 | A non-return leads to an absence report on Qiwa† |
| Letters and certificates | Salary certificate, employment letter, NOC, QR-verifiable | J†, Z†, M† | P0 | The top self-service request |
| Government transaction log | Reference no., fee, date per Qiwa/Muqeem/GOSI/Mudad action | † | P0 | Audit trail without APIs |

### 2.4 Attendance, shifts and overtime
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Mobile GPS check-in | Clock in and out by phone, with location | Z, ZO, J† | P0 | |
| Project-site geofences | Radius per site; several sites per day | Z | P0 | Punch linked to ERP project |
| Selfie / face check | Photo at clock-in plus face match | B†, ZO† | P1 | Face data is sensitive under the PDPL† |
| Biometric devices (ZKTeco) | Import punches from terminals | J†, Z†, ZO†, O† | P1 | Head office |
| Offline punches | Store and sync later | [U] | P1 | Sites without signal |
| Shifts and rosters | Templates; rosters per site or project | Z†, O† | P0 / P1 | |
| Ramadan schedule | Switches Muslim staff to 6 h/day, 36 h/week | J | P0 | Art. 98† |
| Overtime request and calculation | Pre-approval; configurable formula; pay or time off in lieu | J†, Z† | P0 | Art. 107 |
| Project timesheets | Hours per project for costing | O†, R† | P1 | Feeds project profit and loss |

### 2.5 Leave and holidays
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Statutory leave presets | Annual, sick, Hajj, marriage, paternity, maternity, bereavement; eligibility rules (e.g., Hajj once, after 2 years) | J, Z, ZO, B†, P† | P0 | Reflects the 2025 amendments |
| Sick-leave tiers | 30 days full pay / 60 at 75% / 30 unpaid, per year | J†, ZO† | P0 | Art. 117 |
| Service-based accrual | 21 days, rising to 30 after 5 years; carry-over | all† | P0 | Art. 109 |
| Holiday calendar | Both Eids, Founding Day, National Day | J | P0 | Hijri-based; confirm yearly |
| Leave encashment | Pays out unused leave at exit | J†, ZO† | P0 | Art. 111 |
| Leave-salary advance and air ticket | Leave pay before the holiday; ticket accrual | Z†, J† | P1 | Set by contract |

### 2.6 Payroll
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Component-based salary | Basic, housing, transport, other; flags for GOSI, EOSB and overtime base | all† | P0 | GOSI charged on basic + housing |
| GOSI engine with dated rates | Old and new Saudi rates, 2% non-Saudi, minimum and maximum wage | J, Z, B, ZO, O | P0 | Rates step up every 1 July until 2028 |
| GOSI reconciliation | Deductions vs GOSI's bill; prompts wage updates | J† | P0 | GOSI bills on the registered wage† |
| Mudad salary-file export | Salary file in Mudad's format | ZO, P, O (partner) | P0 | Uploaded by hand at MVP |
| Mudad API submission | Submit, track, cancel | Z, J, B, M | P2 | Approved integrators only |
| Variable pay inputs | Commissions, overtime, expenses, bonuses into the run | B | P0 | |
| Loans and advances | Installments, automatic deduction, caps | O, Z†, J† | P0 | Caps under Art. 92–93 [U] |
| Absence and lateness deductions | Unpaid days, late minutes, pro-rating | J†, Z† | P0 | |
| Arabic/English payslips | PDF plus self-service | Z, ZO†, O (partner) | P0 | |
| Run approval and lock | Draft → approve → paid; retro adjustments; audit trail | all† | P0 | |
| Payroll → general ledger | Journal entry per component (incl. employer GOSI, EOSB) by cost center or project | O†, Z, J | P0 | Core ERP link |
| EOSB provision | Monthly accrual per employee | ZO†, O† | P1 | For financial statements |

### 2.7 EOSB and final settlement
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| EOSB calculator | Art. 84/85/87, including part-years | J, ZO, O (partner) | P0 | |
| Termination-reason list | Maps each reason to its EOSB fraction, notice and compensation | J† | P0 | Art. 77/80/81 mappings [U] |
| Final settlement | Salary + EOSB + leave + notice − loans | J†, Z† | P0 | |

### 2.8 Saudization and government portals
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Nitaqat dashboard | Weighted count (paid SAR 4,000+ = 1, below = 0.5) and band | Z, B, J† | P0 | Qiwa-documented contracts only |
| Quotas by profession | Sales/marketing 60%, engineering 30% | Z† | P0 | Hits the Motqinon sales team |
| What-if simulator | Effect of a hire or exit on quotas | Z | P1 | |
| Muqeem workflows | Iqama renewal, exit re-entry visa, final exit | Z, B, M, J | P1 checklist / P2 API | |

### 2.9 Self-service and approvals
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Employee and manager self-service (mobile) | Leave, punches, payslips, letters, loans, expenses; approvals inbox | Z, J, B, M | P0 (web app) | |
| Approval workflows | Multi-level, by type, amount or department | Z, J | P0 | |
| WhatsApp/SMS notifications | Alerts and approvals outside the app | [U] | P1 | WhatsApp dominates in KSA |

### 2.10 Expenses
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Expense claims | Receipt photo, category, project | J, B, Z | P0 | Paid through payroll or accounts payable |
| OCR receipt capture | Fills in amount, date and vendor | J, B | P1 | Add ZATCA QR reading (VAT no. and amount) |
| Policies and per diem | Limits by grade or city | J, Z | P1 | No statutory per diem [S] |
| Corporate cards | Cards with live spending controls | J | P2 | |

### 2.11 Sales commissions and technician incentives
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Plan builder by product | Rates per product line (intercom, locks, smart home) | CQ, ZC†, SP† | P0 | |
| Pay on collection | Earned on invoice, paid pro-rata as the customer pays | Commission tools generally (concept) | P0 | Needs payment-to-invoice allocation |
| Margin-based commission | On gross margin instead of revenue | ZC | P1 | Discourages discounting |
| Tiers, accelerators, quotas | Higher rates above targets | ZC; SP†, CQ†, X† | P1 | |
| Clawbacks and splits | Reverses on credit notes; splits deals between reps | SP†, CQ†, X† | P1 | |
| Rep earnings dashboard | Live earned and payable amounts | SP | P1 | |
| AI help with disputes | AI-assisted dispute resolution | X | P2 | |
| Technician incentives | Per-installation piece rate, callback penalty, customer sign-off | none verified | P1 | Specific to Motqinon |

### 2.12 Talent, analytics and AI
| Feature | What it does | Seen in | Priority | Notes (Saudi context) |
|---|---|---|---|---|
| Performance reviews, KPIs and OKRs | Review cycles and goals | Z†, J†, PE | P1 / P2 | |
| Training and certifications | Records and expiry of courses and brand certifications | Z†, O† | P2 | |
| Recruiting with AI ranking | Job postings, pipeline, candidate ranking | BH, Z, P | P2 | |
| HR analytics | Headcount, turnover, labor cost per project | Z, B, PE | P1 | |
| Compliance pre-checks | Flags violations before salary-file or GOSI submission | J | P1 | |
| Arabic AI HR assistant | Policy and labor-law Q&A; letter drafting | J (Saudi labor law); BH, PE (English) | P2 | |

## 3. Leading-edge 2025–2026 innovations worth copying

- **Labor-law AI assistants.** Jisr's "Momtathl" answers questions on contracts, EOSB and working hours; "Jisri" is its in-app assistant. To copy: an Arabic assistant answering from the Labor Law plus company policy, quoting its sources.
- **Compliance forecasting.** ZenHR's AI forecasts Saudization and recommends actions. To copy: a quota check on every hire and every commission-plan assignment.
- **Checks before submission.** Jisr flags violation risks before salary-file (WPS) and GOSI filings; it claims "zero WPS penalties" (vendor claim).
- **Earned-wage access (EWA): paying part of earned salary before payday.** ZenHR's ZenEWA is Shariah-compliant and Mudad/WPS-compliant. Mudad's "Flexible Salary" with Khazna was announced Jul 2025 [S]. To copy: offer it through Mudad or a partner, not Motqinon's own funds.
- **HR combined with spend.** Jisr: OCR claims, corporate cards with up to 4% cashback, policy controls. Bayzat: approved expenses flow into payroll.
- **Native government APIs.** ZenHR submits, tracks and cancels Mudad payments by API. ZenHR, Bayzat and Menaitech integrate with Muqeem.
- **Benefits marketplace.** Bayzat sells health insurance inside the HR app.
- **One employee record driving automation.** Rippling chains onboarding, app and device access, and approvals.
- **Chat-based HR.** "Ask BambooHR"; Personio's AI draws KPI charts on request; Leena AI and Moveworks work inside Teams or Slack. For KSA the channel would be WhatsApp (an idea, not a vendor-proven product).
- **Commission operations with AI.** Xactly's agentic AI resolves payout disputes; Spiff shows real-time earnings; CaptivateIQ offers no-code modeling.
- **Motqinon ideas (no vendor seen doing these):** read the ZATCA QR code on receipts to capture VAT automatically; post geofenced punches straight to project job cards.

## 4. Saudi (KSA) compliance summary (checked 2026-09-25)

| Topic | Current rule | Status / source |
|---|---|---|
| Legal basis | Labor Law (M/51) as amended by M/44: published 23 Aug 2024, in force 19 Feb 2025. Implementing Regulations updated by Ministerial Decision 115921/1446. | [V] Rödl; Morgan Lewis (2024); Addleshaw Goddard (2025) |
| Working hours | 8 h/day, 48 h/week. Ramadan: 6 h/day, 36 h/week for Muslim staff. | [U] law text not re-read |
| Overtime (Art. 107) | Per overtime hour: the hourly wage **plus 50% of the basic wage**. This equals 150% of basic only when there are no allowances. With written consent, paid time off may replace overtime pay (since 2025). | Formula [V] (Al-Othman; HRSD article). Time-off terms (1.5 h per hour, within 60 days, max 30 days a year) [S] |
| Probation | Up to 180 days in total | [V] |
| Notice (indefinite contracts) | At least 30 days from the employee; at least 60 days from the employer | [V] |
| Resignation acceptance | Amended in 2025; details not captured | [U] |
| Annual leave (Art. 109) | 21 days; 30 days after 5 years of continuous service. Unused leave paid at exit (Art. 111). | [V] |
| Sick leave (Art. 117) | Per year: 30 days full pay, 60 days at 75%, 30 days unpaid | [V] secondary |
| Maternity / paternity | 12 weeks full pay, 6 weeks after birth mandatory / 3 days within 7 days of birth | [V] |
| Marriage / bereavement | 5 days / 5 days for spouse, parent or child, 3 days for a sibling (new) | [V] |
| Hajj (Art. 114) | 10–15 days including Eid al-Adha; once during employment; after 2 consecutive years | [V] |
| Widow's (iddah) leave | Muslim widows 4 months 10 days, others 15 days | [U] |
| Public holidays | Both Eids (4 days each), Founding Day (22 Feb), National Day (23 Sep) | [U] confirm yearly |
| EOSB | **Art. 84:** half a month's last wage per year for years 1–5, one month per year after, pro-rata for part-years. **Art. 85 (resignation):** under 2 years nothing; 2–5 years one third; 5–10 years two thirds; 10+ years full. **Art. 87:** full award for force majeure, or for a woman resigning within 6 months of marriage or 3 months of childbirth. | [V] secondary. Wage basis and treatment of commission [U], ask counsel |
| Compensation for termination without valid reason (Art. 77) | Amounts not captured | [U] |
| GOSI: Saudi, old system | Annuity 9% + 9%; SANED (unemployment insurance) 0.75% + 0.75%; occupational hazards 2% employer only. Totals: employer 11.75%, employee 9.75%. | [V] Mercans 2026 |
| GOSI: Saudi, new system | For people first registered on or after 3 Jul 2024 with no earlier contributions. Annuity rises 0.5% on each side every 1 July: 9.5% (2025), 10% (2026), 10.5% (2027), 11% (2028). From 1 Jul 2026: employer 12.75%, employee 10.75%. | [V] Mercans; jehat.net; GOSI PDF (title only) |
| GOSI: non-Saudi | 2% employer only (occupational hazards) | [V] |
| GOSI contributory wage | Basic + cash housing; housing in kind counts as 2 months' basic a year. Minimum SAR 1,500 (annuities) and SAR 400 (occupational hazards); maximum SAR 45,000. | [V] GOSI FAQ excerpt (undated; re-check the new-law minimum) |
| WPS / Mudad | Applies to all private establishments; salary file uploaded to Mudad. Compliance measured per establishment (85% cited). Window cut from 60 to 30 days on 1 Mar 2025. Fines up to SAR 3,000 per employee per month, plus service suspension. | Scope [V] (HRSD service page). Other details [S]/[U] |
| Qiwa contracts | New unified contract for all new contracts and updates from 6 Oct 2025; fixed-term contracts move over from 6 Mar 2026; indefinite contracts by 6 Aug 2026. Documentation targets: 85% by 30 Apr 2026, 90% by 30 Jun 2026. Authenticated contracts can be enforced through Najiz. | [V] KPMG GMS 2026-116; Envoy; Morgan Lewis (Dec 2025) |
| Nitaqat | A Saudi paid SAR 4,000+ counts as 1, below that 0.5. New 2026–28 cycle. From 15 Apr 2026, only Saudis with Qiwa-documented contracts count. Yellow band reportedly removed. | SAR 4,000 rule [V]. Cycle and Qiwa link [S]. Yellow band [U] |
| Sales and marketing Saudization | 60% for establishments with 3+ staff in these professions, from **19 Apr 2026**. Covers sales reps and **IT and communications equipment sales specialists**. Minimum SAR 5,500 to count: confirmed for marketing, only reported for sales. | [V] HRSD news; KPMG 2026-022. Sales wage floor [S] |
| Engineering Saudization | 30% for establishments with 5+ engineers across 46 roles; minimum SAR 8,000; SCE accreditation; deadline 30 Jun 2026 | [S] EIG; Clyde & Co (Feb 2026) |
| Muqeem | Run by Elm: iqama issue and renewal, exit re-entry visas, final exit. HR systems connect through paid Elm web services. | [S] |

**Watch-outs specific to Motqinon**
1. **Sales team.** With 3+ sales staff, 60% must be Saudi, each with a Qiwa-documented contract and the minimum wage.
   - Nitaqat likely uses the GOSI-registered wage (basic + housing, no commission). If so, the fixed pay must meet the wage floor [U].
   - Expats' iqama professions must avoid the localized sales professions.
2. **Engineers.** With 5+ engineers: 30% Saudi, SCE-accredited, paid SAR 8,000+.
3. **GOSI rate changes.** Rates change every July until 2028, so store them with effective dates, not as constants.

## 5. Data entities implied

| Entity | Key fields |
|---|---|
| LegalEntity | name_ar/en, CR, VAT no., GOSI employer no., Qiwa establishment no., Mudad ID, Nitaqat activity/size |
| Site | city, type (HQ/project), lat, lng, radius_m, project_id |
| Department / CostCenter | code, parent, manager, GL analytic account |
| Position | title_ar/en, profession group (sales/marketing/engineering/technician/admin), localized flag, SCE_required |
| Employee | emp_no, name ar/en, nationality, is_saudi, gender, DOB (Gregorian/Hijri), national_id/iqama, border_no, passport, iqama_profession, hire_date, status, manager, dept, site, cost_center, IBAN |
| EmployeeDocument | type, number, issue/expiry (Gregorian/Hijri), file, alert_offsets |
| Dependent / Insurance | relation, ID, insurer, class, member_no, expiry |
| Contract | type, start/end, probation_days, notice_days, qiwa_contract_id, auth_status |
| CompensationComponent | component, amount/%, gosi/eosb/ot flags, effective_from/to |
| StatutoryRate | scheme, population (Saudi-old/Saudi-new/non-Saudi), employer %, employee %, floor, cap, effective dates |
| GosiRegistration | gosi_no, system, registered_wage, dates |
| AttendancePunch | ts, in/out, source, lat/lng/accuracy, site_id, inside_fence, selfie_ref, face_score, offline_flag |
| Shift / Roster / DailyTimesheet | shift times, Ramadan variant; date, worked/late/approved-overtime minutes, project allocations |
| LeaveType / LeaveRequest / LeaveLedger | paid tiers, entitlement and eligibility rules; dates, approvals; accruals, encashment |
| HolidayCalendar | year, name, dates |
| PayrollRun / Payslip / PayslipLine | period, status, locked_at; component, qty, rate, amount, project, GOSI employee/employer |
| Loan / Installment | principal, schedule, run_id, balance |
| WpsFile | run, file, uploaded_at, Mudad ref, status |
| FinalSettlement | reason code, service_days, wage_basis, EOSB fraction/amount, leave, notice, deductions, net |
| ExpenseClaim / Line | category, amount, VAT, supplier VAT no., receipt, QR payload, project |
| CommissionPlan / Rule / Tier | basis (revenue/margin/collected), rates by product category, tiers, quota, clawback_days, splits |
| CommissionLedger | rep, source document (quote/invoice/receipt/credit note), base, rate, earned, payable, paid_run |
| TechJob / Incentive | project, job type, units, onsite_minutes, sign-off, callback, amount |
| SaudizationSnapshot | date, weighted Saudis, Nitaqat %, band, ratios per profession group, Qiwa-documented count |
| GovTransaction | portal, type, employee, ref no., fee, status |
| ApprovalPolicy / AuditLog | document type, conditions, approver role; actor, action, before/after |

## 6. Recommended MVP scope and build vs integrate

**MVP (P0) for 10–40 staff**
1. **Master data.**
   - Employee profiles with Saudi and non-Saudi fields.
   - Documents with expiry alerts in both calendars.
   - Sites and cost centers linked to projects.
   - Contracts with the Qiwa ID and status; GOSI record.
2. **Time.**
   - Web-app clock-in geofenced per project site.
   - Corrections with approval.
   - Shift templates including Ramadan hours; overtime requests.
3. **Leave.** Statutory presets updated for 2025, accruals, holidays, approvals.
4. **Payroll.**
   - Salary components and GOSI/SANED rules with effective dates.
   - Deductions, loans and advances; commission and expense inputs.
   - Arabic/English payslips.
   - **Mudad salary-file export** and bank file.
   - GOSI reconciliation.
   - Journal entry by cost center and project.
   - Locked runs with an audit trail.
5. **EOSB and final settlement** calculator, including leave encashment.
6. **Self-service** (mobile web app). Leave, punches, payslips, salary certificate, loans and expenses, with 1–2-step approvals.
7. **Expenses v1.** Photo receipts, VAT fields, project allocation, reimbursement through payroll.
8. **Commissions v1.** Percentage by product category; earned on invoice and payable on collection; monthly statement to payroll.
9. **Saudization v1.** Nitaqat count, sales and engineering ratios, Qiwa-documented flag.
10. **Government transaction log and checklists.** No APIs.

**Deferred:**
- P1: face check, ZKTeco, rosters, tiered/margin commissions and clawbacks, technician incentives, OCR, onboarding and offboarding, performance reviews, analytics.
- P2: recruiting, training, OKRs, corporate cards, earned-wage access (via Mudad or a partner), AI assistant, government APIs.

**Non-functional requirements:** Arabic-first right-to-left interface; payroll snapshots that can't be changed after the run; role-based access to salaries; location and selfie data collected only at clock-in, with a PDPL retention policy [U]; hosting in KSA preferred.

**Build vs integrate. Recommendation: build the core in-house (Option A) and defer government APIs.**

Reasons:
- **The rules are small and fixed at this size.** About 10 salary components, 3 GOSI rate sets, the statutory leaves and one EOSB formula.
- **The Mudad step is a file upload.** A file generator covers the salary (WPS) submission.
- **The differentiation is in the ERP links.** Technician hours → project cost, and collections → commissions. HR SaaS products don't offer these.
- **Government APIs are gated.** They need approved-integrator status or paid Elm services [S]. Transaction volume at 10–40 staff is a few a month, so a guided manual process with reference numbers is enough.
- **Cost is not the deciding factor.** PalmHR would be about SAR 9k a year for 40 staff (third-party pricing).

Guardrails:
- Run payroll in parallel with the accountant's spreadsheet for 2–3 cycles.
- Write unit tests from the Art. 84/85 and GOSI examples.
- Have counsel review the overtime and EOSB wage basis.
- Review the rules every July and whenever the ministry issues a new decision.

**Option B (buy and integrate).** Use this if payroll must go live before the ERP has accounts receivable and a general ledger:
- Subscribe to Jisr, ZenHR or PalmHR for payroll and compliance.
- Build commissions, technician incentives and project costing in the ERP.
- Exchange employees, attendance by project and payroll journal entries via CSV or API. ZenHR advertises ERP and accounting APIs; the API scope and pricing of all three were not verified.
- Bring payroll in-house once accounts receivable and the ledger exist.

**When to switch from A to B:** more than about 60–75 employees; several commercial registrations or Qiwa files; high visa volume; a falling Mudad compliance percentage.

## 7. Sources

All pages below were seen through search-result excerpts on 2026-09-25. Direct fetches were blocked by the sandbox network proxy.

**GOSI**
- https://mercans.com/resources/statutory-alerts/saudi-arabia-gosi-contribution-rates-saned-unemployment-fund-2026/
- https://mercans.com/glossary/gosi-contributions/
- https://awareness.gosi.gov.sa/pdf/Contributions.pdf (title only)
- https://jehat.net/?act=artc&id=137215
- https://www.gosi.gov.sa/GOSIOnline/FAQ_Employer?locale=en_US

**Labor Law**
- https://www.roedl.com/en/insights/saudi-arabia-labor-law-amendments-impact/
- https://www.morganlewis.com/pubs/2024/08/key-amendments-to-the-kingdom-of-saudi-arabia-labour-law-announced
- https://www.addleshawgoddard.com/en/insights/insights-briefings/2025/employment/navigating-new-horizon-understanding-2025-amendments-ksa-labour-law/
- https://www.clydeco.com/en/insights/2025/04/ksa-labour-law-amendments-leave-entitlement
- https://www.clydeco.com/en/insights/2025/03/ksa-labour-law-amendments-resignations
- https://alothmanlaw.sa/en/article-107/
- https://www.hrsd.gov.sa/en/knowledge-centre/articles/313
- https://www.hrsd.gov.sa/sites/default/files/2023-02/Labor.pdf (fetch blocked)
- https://www.gloroots.com/leave-policy/saudi-arabia
- https://alothmanlaw.sa/en/article-109/
- https://saudieosbcalculator.com/entitlement/
- https://gulfnews.com/world/gulf/saudi/saudi-arabia-workers-entitled-to-wages-in-lieu-of-unused-leave-1.1734604479598
- https://tascoutsourcing.sa/en/insights/saudi-labour-law-updates-2025

**WPS / Mudad / earned-wage access**
- https://www.hrsd.gov.sa/en/ministry-services/services/%D8%B1%D9%81%D8%B9-%D9%85%D9%84%D9%81-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A3%D8%AC%D9%88%D8%B1
- https://safwahr.com/mudad-wps-compliance-2026-employer-guide/
- https://kiework.ai/compliance/wps-mudad
- https://www.middleeastbriefing.com/news/saudi-arabias-mudad-payroll-platform-salary-system-updates/
- https://www.fintechweekly.com/magazine/articles/saudi-arabia-flexible-salary-early-wage-access-fintech
- https://www.zenhr.com/en/earned-wage-access-zenewa

**Qiwa / Nitaqat / Muqeem**
- https://kpmg.com/xx/en/our-insights/gms-flash-alert/2026/flash-alert-2026-116.html
- https://www.envoyglobal.com/news-alert/saudi-arabia-qiwa-employment-contract-with-najiz-authentication/
- https://www.morganlewis.com/blogs/shiftingsandsoflaborlaw/2025/12/employment-contract-enhancements-in-the-kingdom-of-saudi-arabia
- https://www.middleeastbriefing.com/news/saudi-arabias-nitaqat-2026-update-latest-quotas-by-sector-and-what-foreign-employers-need-to-comply-now/
- https://saudigazette.com.sa/article/600456
- https://www.hrsd.gov.sa/en/media-center/news/%D8%A7%D9%84%D8%AA%D9%88%D8%B7%D9%8A%D9%86-%D9%81%D9%8A-%D9%85%D9%87%D9%86-%D8%A7%D9%84%D8%AA%D8%B3%D9%88%D9%8A%D9%82-%D9%88%D8%A7%D9%84%D9%85%D8%A8%D9%8A%D8%B9%D8%A7%D8%AA
- https://kpmg.com/xx/en/our-insights/gms-flash-alert/2026/flash-alert-2026-022.html
- https://me.peoplemattersglobal.com/news/economy-policy/60percent-saudization-mandate-for-marketing-sales-roles-takes-effect-with-sar-5500-minimum-pay-49332
- https://www.clydeco.com/en/insights/2026/02/the-first-saudisation-updates-of-2026-key-changes
- https://eiglaw.com/saudi-arabia-expands-saudization-across-engineering-procurement-marketing-and-sales-roles/
- https://motaded.com.sa/muqeem-portal-registration
- https://incorpmena.com/saudi-muqeem-portal

**Vendors**
- https://www.jisr.net/en/features
- https://www.jisr.net/en/saudi-compliance-management
- https://www.jisr.net/en/spend-management
- https://www.jisr.net/en/expense-management
- https://www.jisr.net/en/card-management-system
- https://www.jisr.net/en/hr-tools/saudi-labor-law-ai-assistant
- https://zoftwarehub.com/products/jisr-hr/overview
- https://www.zenhr.com/en/marketplace-integration/mudad
- https://www.zenhr.com/en/marketplace-integration/muqeem
- https://blog.zenhr.com/en/zenhr-integrations-apis-payroll-erp-accounting-government-bi-systems
- https://blog.zenhr.com/en/the-2026-zenhr-performance-report-hr-automation-and-compliance
- https://blog.zenhr.com/en/the-future-of-hr-has-arrived-zenhr-launches-the-new-era-of-ai-powered-hr
- https://www.bayzat.com/ksa/payroll
- https://www.bayzat.com/work-expenses
- https://www.bayzat.com/blog/best-hr-software-in-saudi-arabia/
- https://bayzathelp.zendesk.com/hc/en-gb/articles/23328332538641-Muqeem-Integration
- https://www.hono.ai/blog/hr-payroll-software-saudi-arabia
- https://themiddleeastinsider.com/2026/03/02/best-hr-software-saudi-arabia-2026-comparison/
- https://me.peoplemattersglobal.com/news/ai-and-emerging-tech/saudi-arabia-hr-tech-market-projected-to-reach-dollar71043m-by-2034-imarc-report-52279
- https://menaitech.com/en/
- https://menaitech.com/en/products/mename/
- https://www.odoo.com/documentation/19.0/applications/hr/payroll/payroll_localizations/saudi_arabia.html
- https://ecosire.com/apps/odoo/odoo-ksa-payroll-gosi-mudad
- https://zoho.com/blog/payroll/introducing-zoho-payroll-for-saudi-arabia.html
- https://www.zoho.com/en-sa/payroll/features/
- https://arabianreseller.com/2025/05/16/zoho-payroll-tailored-for-saudi-compliance-supports-vision-2030/
- https://www.zoho.com/en-sa/people/zoho-people-and-zoho-payroll-integration.html
- https://www.hibob.com/blog/best-hr-ai-software-tools/
- https://cxm.world/employee-experience/best-ai-hr-software-in-2026-eight-platforms-that-reduce-friction/

**Commissions**
- https://learn.g2.com/best-sales-compensation-software
- https://www.quotapath.com/blog/best-sales-compensation-software/
- https://www.technologyinsales.com/tools/spiff
- https://blog.salescookie.com/2026/06/01/pay-when-you-get-paid-commission-plans-2/comment-page-1/
- https://help.zoho.com/portal/en/kb/crm/extensions/sales/articles/commission-management-for-zoho-crm
- https://help.zoho.com/portal/en/community/topic/compute-your-salespeoples-incentives-using-the-commission-management-extension
