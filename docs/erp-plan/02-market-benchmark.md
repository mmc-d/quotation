# 02 — Market Benchmark: What the Leading ("Edge") Apps Implement (مقارنة بأفضل التطبيقات)

> Research date **25 Sep 2026**. Eight parallel research streams benchmarked **≈ 100 products** and recorded **≈ 670 features/options** with priorities. The full inventories (with sources and verification notes) are in [`research/`](research/README.md); the curated, prioritised backlogs live in the [module specs](README.md#documents).
>
> **Verification note:** direct fetches of many vendor and government sites were blocked in the research environment, so most facts come from search-indexed extracts of official pages, cross-checked against primary sources on GitHub where possible (NIST, OWASP, Odoo/ERPNext code, ZATCA SDK rules). Items that could not be confirmed are marked *(unverified)* in the research notes — re-check them before contractual or legal use.

## 1. Leaders per field and what we adopt

### 1.1 CRM & sales pipeline → [module 02](modules/02-crm.md)
| Leader | Why it leads (2025–2026) | We adopt |
|--------|--------------------------|----------|
| Salesforce Agentforce Sales | Deepest customisation; SDR/engagement, pipeline-management and coaching agents (Agentforce 360 GA Oct 2025); Saudi HQ (Nov 2025) | Stage paths, field-level security, pipeline-hygiene suggestions, partner management |
| HubSpot Sales Hub | Easiest adoption; 20+ Breeze agents (Sep 2025); native Snapchat lead ads — **but no Arabic/RTL CRM UI** | Quote-view alerts, lead-ads sync, deal-specialist agent ideas |
| Zoho CRM | Jeddah & Riyadh data centres (2024), Arabic RTL, Blueprint process enforcement, Zia agents | Stage gates with required fields, business-card scanning, KSA hosting benchmark |
| Dynamics 365 Sales | Business process flows, Copilot form-fill from files/e-mails | AI form-fill from CR/VAT certificates |
| Pipedrive | Kanban UX benchmark, deal "rotting" | Rotting flags, activity-based selling |
| Odoo CRM 19 | CRM → quote → project → invoice on one data model; explainable predictive scoring | Referral tracking, activity plans, single-flow design |
| Kommo / respond.io / Bitrix24 | WhatsApp-first pipelines, Click-to-WhatsApp attribution, multimodal AI agents | Shared WhatsApp inbox, CTWA attribution, voice-note handling |

### 1.2 Quotations, CPQ, contracts & e-signature → [module 03](modules/03-quotations-cpq.md), [module 04](modules/04-contracts-esign.md)
| Leader | Why it leads | We adopt |
|--------|--------------|----------|
| **D-Tools Cloud & SI** (AV/security/smart-home integrators) | Catalog with cost/margin, packages, alternates, per-item labor, customer portal with deposits, change orders; **Quote Assist AI & MCP server (Sep 2026)** | Integrator CPQ model, labor per item (our INS line), alternates, change orders, AI quote drafting |
| Portal.io | Proposal-first; areas & optional upgrades; payment schedules; "Highlight Changes" change orders; AI Proposal Builder | Sections, optional lines, payment schedule on quote, change-order overlay |
| Jetbuilt | Versions, labor by crew-days, project P&L, Jetbot (schematics, QR service desk) | Revisions, crew-day breakdown, QR stickers |
| simPRO | Prebuilds (kits), take-offs, quote → job → invoice for security/electrical | Kits, BOQ import, job costing |
| ServiceTitan Pricebook Pro | Good/Better/Best in one click, cost-driven repricing | Alternatives, supplier price-list import with FX |
| Salesforce Revenue Mgmt, HubSpot CPQ, Zoho CPQ, DealHub, PandaDoc, Proposify, Qwilr | Approval orchestration, constraint rules, interactive web proposals with view tracking, accept-sign-pay | Discount/margin approvals, web proposal + OTP acceptance, view alerts |
| DocuSign IAM · **Signit / emdha / Sadq (KSA)** | Repository, obligations, Iris agents (May 2026) · DGA-licensed TSPs with **Nafath** identity | Clause library, obligations calendar; **Nafath e-signature** for contracts |

### 1.3 Accounting & ZATCA → [module 08](modules/08-accounting-zatca.md)
| Leader | Why it leads | We adopt |
|--------|--------------|----------|
| Zoho Books (Saudi edition) | ZATCA Phase 1 & 2, Arabic, fixed assets, project hours | E-invoice status dashboard, KSA VAT workflows |
| Odoo Accounting (`l10n_sa_edi`, LGPL-3 in Community 19) | Journal-level OTP onboarding, simulation → production, VAT/WHT reports, VATEX codes | Onboarding flow, VAT report mapping (reference) |
| **ERPNext + KSA compliance apps** (LavaLoon, ERPGulf) | Complete open-source ledger + ZATCA Phase 2 | **Chosen back-office engine** |
| Qoyod, Wafeq, Daftra | Saudi SME leaders; Wafeq sells an **e-invoicing API**; Daftra cheque cycle | Cheque/PDC register, middleware fallback |
| QuickBooks, Xero, NetSuite, Sage Intacct | AI bookkeeping agents, bank-rule automation, dimensional GL, GL outlier detection | Suggest-and-approve AI, project/cost-center dimensions |

### 1.4 Inventory, procurement & imports → [module 07](modules/07-inventory-procurement.md)
| Leader | Why it leads | We adopt |
|--------|--------------|----------|
| ERPNext v15/16 | Material Request → RFQ → Supplier Quotation → PO → Receipt → Invoice; Serial No with warranty; Landed Cost Voucher; stock reservation | **System of record** for purchasing & stock |
| Odoo 19 | Kits, five landed-cost split methods, GS1 barcode app, AI bill digitisation | Kit handling, scanning UX |
| NetSuite 2026.1 | Inbound shipments, supply allocation/ATP, native vendor consignment, Intelligent Bill Capture | Import-shipment record, ETA-driven readiness |
| Dynamics 365 Business Central | Item charges, service items, **Payables Agent** | AI "bills inbox" with approval |
| SAP Business One, Zoho Inventory, Cin7 | Customs groups, multi-bill landed cost, ForesightAI forecasting | Dated duty table, pipeline-weighted demand |

### 1.5 Projects, field service, helpdesk & IoT → [module 05](modules/05-projects.md), [module 06](modules/06-field-service-assets.md), [module 12](modules/12-iot-ai.md)
| Leader | Why it leads | We adopt |
|--------|--------------|----------|
| Procore | Submittals, RFIs, punch list, daily logs; **Helix** agents with human approval | Punch/snag list, submittal (MAR) register, AI daily logs later |
| monday · Asana · ClickUp · Planner Premium · Smartsheet | Views, dependencies, baselines, no-code agents | Kanban/timeline, automation rules, "project watchdog" |
| Odoo Project/FS 19 | **Milestone invoicing**, GPS stamp on timer, worksheets with signature | Milestone billing, GPS check-in, worksheets |
| ServiceTitan · Jobber · Housecall Pro | Dispatch Pro AI, memberships, "on my way" texts, AI Receptionist | Dispatch board, AMC memberships, WhatsApp ETA, caller matching |
| Salesforce FS · **Dynamics 365 FS + Connected Field Service** · Zoho FSM | Functional locations, agreements, entitlements, **IoT alert → case → work order**, offline mobile | Location/asset hierarchy, entitlement checks, IoT alarm → ticket |
| simPRO · D-Tools | Asset test readings & defects, Maintenance Planner, service plans | Commissioning tests, AMC planning |
| Zendesk · Freshdesk · Zoho Desk | SLAs, WhatsApp tickets, AI agents, Arabic (Zia) | Helpdesk-lite → full helpdesk, Arabic KB |
| **ThingsBoard 4.2/4.3** | Alarm rules 2.0, REST API call node, AI Request node, API keys, customer dashboards | IoT integration platform (reuse, don't build) |

### 1.6 HR, payroll & commissions → [module 09](modules/09-hr-payroll.md)
| Leader | Why it leads | We adopt |
|--------|--------------|----------|
| **Jisr**, **ZenHR** | Saudi compliance automation (GOSI, Mudad, Muqeem, Qiwa), EOSB, geofenced attendance, labor-law AI, earned-wage access | Rule coverage checklist; fallback SaaS |
| Bayzat, PalmHR, Menaitech | KSA+UAE, low-cost SMB, enterprise payroll | Benchmarks for pricing and features |
| Zoho People/Payroll (KSA), Odoo `l10n_sa_hr_payroll` | Mudad-format files, GOSI by nationality | Mudad file, nationality-driven GOSI |
| Rippling, BambooHR, Personio | One employee record driving automation; AI HR assistants | Onboarding/offboarding chains |
| Spiff, CaptivateIQ, Xactly, Zoho commissions | Pay-when-paid plans, tiers, clawbacks, real-time earnings | Commissions on collection, clawbacks |

### 1.7 Platform: login, security, hosting → [module 01](modules/01-platform-login-security.md), [03-target-architecture.md](03-target-architecture.md)
| Leader | Why it leads | We adopt |
|--------|--------------|----------|
| Better Auth · Keycloak 26.7 · Auth0 · Clerk · Entra · WorkOS · Supabase Auth | Passkeys, MFA, organisations, impersonation, SCIM/SSO | **Better Auth** (self-hosted, data in KSA); Keycloak later if enterprise SSO needed |
| Salesforce · Dynamics · Odoo · ERPNext · Zoho (authorisation) | Permission sets, privilege × scope, record rules, perm levels | Permission × record scope + field groups + approval limits |
| NIST SP 800-63B-4 · OWASP ASVS 5.0 · OWASP Top 10:2025 | Current identity & web-security baselines | Acceptance bar for the platform |
| Google Cloud Dammam · Oracle Jeddah/Riyadh · Azure (Nov 2026) · AWS (Dec 2026) | In-Kingdom hosting options | Google Cloud Dammam (Cloud SQL / AlloyDB available) |

### 1.8 Reports, workflow, messaging, documents, AI → [module 10](modules/10-reports-bi.md), [module 11](modules/11-portal-messaging.md), [module 12](modules/12-iot-ai.md)
| Leader | Why it leads | We adopt |
|--------|--------------|----------|
| Tableau Next · Zoho Analytics · Odoo Spreadsheet · Power BI · Metabase · Superset | Semantic layers, NLQ, AI insights — **but weak Arabic RTL in Power BI/Metabase/Superset** | In-app RTL dashboards on SQL views; Metabase optional |
| Salesforce Flow Approval Orchestration · Zoho Blueprint · Odoo automation · n8n · Temporal | Staged approvals, process enforcement with SLAs, MCP-callable workflows | Stage gates, SLA escalations, approvals from WhatsApp |
| WhatsApp Business Platform · Unifonic/Taqnyat/Msegat | Per-message pricing, Flows, Calling, BSUID/usernames | Utility templates, BSUID identity, cost ledger |
| Gotenberg · Typst · Carbone | PDF/A-3 + attachments, RTL typesetting | Gotenberg for Arabic PDFs |
| Agentforce · Breeze · Zia · Odoo 19 AI · Dynamics 365 agents · NetSuite AI Connector | Agents with human approval; MCP servers | AI gateway, BOQ→quote agent, read-only MCP server |

## 2. Innovations (2025–2026) worth copying first

1. **AI quote from real-world inputs** — D-Tools Quote Assist (Sep 2026), Portal.io AI Proposal Builder → our BOQ/WhatsApp-voice-note → draft quote.
2. **MCP servers over business data** — D-Tools, HubSpot, Salesforce (GA Apr 2026), NetSuite, Zoho, Business Central → our role-scoped read-only MCP server.
3. **Agents that prepare, humans approve** — BC Sales Order/Payables agents, Procore Helix, DocuSign Iris → every AI action stops at an approval.
4. **IoT alert → case → work order** — Dynamics 365 Connected Field Service; ThingsBoard REST/AI nodes → automatic tickets and uptime-based AMC.
5. **Process enforcement with SLAs** — Zoho Blueprint → no "Installed" without serials, photos and signature.
6. **Milestone invoicing + GPS timers** — Odoo 19 → 50/40/10 gates and technician check-ins.
7. **Change orders overlaid on the original** — Portal.io "Highlight Changes".
8. **Web proposals with accept-sign-pay** — Qwilr, PandaDoc, D-Tools.
9. **Explainable scoring and scheduling suggestions** — Odoo 19 scoring, ServiceTitan Dispatch Pro, Agentforce scheduling.
10. **Knowledge from tickets** — Zendesk Knowledge Builder → Arabic KB.
11. **Earned-wage access & labor-law AI** — ZenHR ZenEWA, Jisr "Momtathl".
12. **E-invoicing as an API** — Wafeq → middleware fallback behind our port.

## 3. Gaps no benchmarked product fills (our differentiators)

| Differentiator | Why it matters |
|----------------|----------------|
| **Contractual delivery clock** (45–60 working days from advance + approvals, Saudi calendar, pause log) | Evidence in delay disputes; drives procurement urgency |
| **Handover package generator** (bilingual device schedule per unit, as-builts, warranty certificate) | Professional closeout; starts warranty automatically |
| **Credentials vault** for device/admin passwords with audited reveal | Security gap in every FSM benchmarked |
| **Scan-to-commission** (serial/MAC → building/unit → warranty) | Installed base built as a by-product of installation |
| **Compliance-certificate gate** (SABER PCoC/SCoC, CST type approval) on POs and sales | Avoids blocked shipments and illegal sales of radio devices |
| **10-year spare-parts obligation planning** | Contract clause turned into last-time-buy alerts |
| **Prayer-time, Ramadan and midday-heat-ban aware scheduling** | Realistic ETAs and legal outdoor work windows |
| **Wathq + Saudi Post national-address lookup; Arabic business-card OCR** | Clean B2B data for ZATCA invoices |
| **BOQ-preserving import/export + submittal packs** | How consultant-led projects are actually priced in KSA |
| **IoT event-driven billing and monitoring AMC tiers** | Recurring revenue for an IoT company |

## 4. Saudi regulatory & market digest (dated)

| Topic | Fact (as researched on 25 Sep 2026) | Where it lands |
|-------|-------------------------------------|----------------|
| ZATCA e-invoicing | Wave 24 (> SAR 375k) integrate by 30 Jun 2026; **Wave 25 (> SAR 187.5k) by 1 Feb 2027**; standard invoices cleared before sharing, simplified reported within 24 h; 386 prepayment invoices + `PrepaidAmount` on the final 388 | Module 08, roadmap §1 |
| E-signature | Electronic Transactions Law; DGA licenses trust service providers; Nafath identity; providers Signit (licensed Dec 2024), emdha, Sadq; Zoho Sign via emdha in KSA DC | Module 04 |
| Commercial Register Law | In force 3 Apr 2025: **10-digit unified number starting with 7**, CRs no longer expire (annual confirmation), branch CRs phased out by Apr 2030 | Module 02, data model |
| PDPL | Fully enforced since Sep 2024; **Art. 25 prior consent** for marketing; breach notice to SDAIA within 72 h; transfer regulation (Sep 2024) | Modules 01, 02, 11 |
| WhatsApp | Per-message pricing (Jul 2025); general-purpose AI bots banned (15 Jan 2026); BSUID/usernames (2026); **service messages billable from 1 Oct 2026** | Module 11 |
| SMS (CST) | Registered sender IDs; promotional "-AD" suffix; promotional sends 08:00–22:00 | Module 11 |
| Labor Law | Amendments in force 19 Feb 2025 (probation ≤ 180 days, leave changes); Ramadan 6 h/day for Muslim workers; **midday outdoor-work ban 12:00–15:00, 15 Jun–15 Sep** | Modules 05, 09 |
| GOSI | New-system annuity rate rises 0.5% per side every 1 July to 2028; non-Saudi 2% employer | Module 09 |
| Saudization | **Sales & marketing 60%** from 19 Apr 2026 (≥ 3 staff); engineering 30% (≥ 5 engineers); Nitaqat counts Qiwa-documented contracts only | Module 09, risk register |
| Imports | SABER PCoC per model + SCoC per shipment; CST type approval for radio/IoT devices; FASAH declarations; CIF duty (mostly 5%; some electrical lines 15% since Jul 2024) | Module 07 |
| Surveillance cameras | Ministry of Interior approval needed to import/sell/install/operate security cameras (not inside private residential units) | Module 05 (site flag) |
| Fire code (SBC 801) | Electrically locked egress doors must release on fire alarm/power loss (exact clause to verify) | Modules 04, 05 (commissioning test, clause) |
| Hosting | Google Cloud Dammam available (Cloud SQL, AlloyDB); Oracle Jeddah/Riyadh; Azure Saudi East Nov 2026; AWS Dec 2026; no Supabase Saudi region | Architecture §11 |
| Local supply base | Akuvox, Hikvision and lock distributors present in KSA (e.g., national distributors in Riyadh/Jeddah) | Module 07 |
