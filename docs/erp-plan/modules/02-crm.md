# Module 02 — CRM: Customers, Leads & Pipeline (إدارة علاقات العملاء)

| | |
|---|---|
| **Phases** | Customer master → Phase 1 · Leads/pipeline/WhatsApp inbox → Phase 2 · P1 → Phases 2–4 · P2 → Phase 7 |
| **Benchmarked** | Salesforce Agentforce Sales, HubSpot Sales Hub, Zoho CRM (KSA data centres, Arabic RTL), Microsoft Dynamics 365 Sales, Pipedrive, Odoo CRM 19, Freshsales; WhatsApp-first CRMs Kommo, respond.io, Bitrix24 |
| **Business owner** | Sales Manager |

> Benchmark notes that shaped this module: **HubSpot has no Arabic/RTL CRM interface**, so it is a feature reference only; **Odoo's single data model** (CRM → quote → project → invoice) is the closest structural match; **Zoho** is the strongest Saudi-localised competitor (Jeddah/Riyadh data centres, Arabic RTL).

## 1. Goals
1. One customer master with Saudi identifiers (unified number, VAT, national address) that feeds quotes, contracts and ZATCA invoices without retyping.
2. Capture every lead — especially **WhatsApp**, Snapchat/Instagram/TikTok ads, referrals from consultants/contractors — and never lose a follow-up.
3. Run the sales team from a pipeline: stages, next steps, win/loss reasons, forecast and targets.
4. Respect PDPL marketing consent and WhatsApp/CST messaging rules by design.

## 2. Pipelines & stages (initial configuration)

| Pipeline | Stages | Stage gates |
|----------|--------|-------------|
| **B2B projects** (buildings, compounds, developers, contractors) | New → Qualified → Site survey → BOQ/Design → Quote sent → Negotiation → Contract → Won / Lost | *Quote sent* needs an approved quote; *Contract* needs unified number, VAT and national address |
| **B2C villas & smart home** | New → Contacted → Visit booked → Quote sent → Follow-up → Won / Lost | *Quote sent* needs a site survey or explicit waiver |
| **IoT solutions** (LoRaWAN sensors, monitoring) | New → Discovery → Pilot/PoC → Proposal → Won / Lost | PoC result recorded before *Proposal* |
| **Service & renewals** (AMC, warranty expiry) | Due → Offer sent → Renewed / Lapsed | Auto-created 60 days before warranty/AMC end |

Deals idle beyond the stage's "rotting" days are flagged (Pipedrive/Freshsales pattern).

## 3. Feature backlog

### 3.1 Accounts, contacts & customer 360
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| CRM-01 | Company and individual accounts in one model (party) | All (Salesforce person accounts) | P0 | Contractors, developers, owners, villa owners, consultants |
| CRM-02 | Saudi identity fields with validation: **unified number** (10 digits starting with 7), legacy CRs, VAT (15 digits, starts & ends with 3), national address (building no., street, district, city, postal code, additional no., short address), geo-pin | Odoo Saudi localisation, Daftra, Qoyod | P0 | Needed for B2B ZATCA invoices |
| CRM-03 | Registry lookup & auto-fill via **Wathq** (CR/unified number) and **SPL National Address** | None natively — differentiator | P1 | |
| CRM-04 | Contacts with multiple roles across accounts (decision-maker, consultant, site engineer, specifier) | Salesforce, HubSpot associations, Dynamics, Zoho | P1 | Same consultants recur across projects |
| CRM-05 | 360° timeline: calls, WhatsApp, e-mails, visits, quotes, contracts, invoices, projects, tickets | All | P0 | ERP events included |
| CRM-06 | Installed base on the account (sites, devices, warranty & spare-parts dates) | Salesforce Assets, Dynamics, Odoo | P1 | Drives renewals/upsell |
| CRM-07 | Duplicate detection & merge: phone (E.164), e-mail, unified number/VAT, normalised Arabic names (أ/إ/ا, ة/ه, ى/ي) | Salesforce, Dynamics, HubSpot, Pipedrive, Odoo, Zoho | P0 | Critical during migration |

### 3.2 Lead capture
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| CRM-10 | Web forms & e-mail-to-lead with UTM tags and a PDPL consent checkbox | All | P0 | Bilingual |
| CRM-11 | **WhatsApp-to-lead**: first inbound message creates a lead + conversation; match by phone **or BSUID** | Kommo, respond.io, Bitrix24, Pipedrive, Odoo | P0 | #1 channel in KSA; usernames/BSUIDs since 2026 |
| CRM-12 | Meta lead ads (Instagram/Facebook) real-time sync | HubSpot, Zoho, Kommo | P0 | |
| CRM-13 | Snapchat & TikTok lead ads connectors; Click-to-WhatsApp ad attribution | HubSpot (Snapchat native), Kommo (TikTok, CTWA) | P1 | Snapchat is very strong in KSA |
| CRM-14 | Walk-in / exhibition quick-add with QR form | Zoho, HubSpot | P0 | |
| CRM-15 | Arabic business-card scanning (OCR) | Zoho, HubSpot (Latin only) | P1 | Differentiator — no good Arabic OCR on the market |
| CRM-16 | Referral capture (referrer, code) for consultants, architects, contractors | Odoo "Referred by", Salesforce PRM | P0 | |
| CRM-17 | Website chat with Arabic bot scripts and hand-off to WhatsApp | Pipedrive LeadBooster, Zoho SalesIQ, Freshsales | P2 | |

### 3.3 Qualification, routing & scoring
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| CRM-20 | Qualify & convert lead → account + contact + opportunity; disqualify/recycle with reason | Salesforce, Dynamics, Zoho, Odoo | P0 | |
| CRM-21 | Qualification fields: project type, units/doors/floors, budget band, timeline, decision role, consultant | Salesforce Path, Dynamics BPF | P0 | Feeds the BOQ/quote |
| CRM-22 | Assignment rules (round-robin, by city/product) + response SLA on the Sun–Thu calendar | Odoo, Salesforce, Zoho, HubSpot | P0 rules · P1 SLA | Lead response time KPI |
| CRM-23 | Rule-based lead scoring (fit + engagement) | HubSpot, Zoho, Freshsales | P1 | |
| CRM-24 | Explainable predictive win probability | Odoo 19, Salesforce Einstein, Zia | P2 | Needs history |

### 3.4 Opportunities & pipeline
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| CRM-30 | Multiple pipelines with RTL kanban, totals and rotting flags | All; Pipedrive rotting | P0 | §2 |
| CRM-31 | Stage gates with required fields/checks | Zoho Blueprint, Salesforce Path, Dynamics BPF | P0 | |
| CRM-32 | Opportunity: value (SAR net/gross), probability, expected close, products, site, consultant, main contractor, tender dates | All | P0 | |
| CRM-33 | Quotes created from the opportunity (module 03), quote-view alerts trigger follow-ups | HubSpot (Sep 2025), Pipedrive, Odoo | P0 · P1 alerts | |
| CRM-34 | Competitors per deal; win/loss against each | Salesforce, Dynamics | P1 | |
| CRM-35 | Mandatory lost reasons (price, consultant specified another brand, tender lost, timing…) | Odoo, Pipedrive, HubSpot | P0 | |
| CRM-36 | Deal teams & splits (rep, pre-sales engineer, partner) | Salesforce, Dynamics, HubSpot | P2 | |
| CRM-37 | Tender tracking (government tenders via Etimad tracked manually) | None integrates Etimad | P2 | |

### 3.5 Activities & communication
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| CRM-40 | Activities: call, meeting, **site survey**, demo, task, follow-up; reminders | All | P0 | |
| CRM-41 | Gmail/Google Calendar two-way sync, e-mail templates | All | P0 | Google Workspace first |
| CRM-42 | **Shared WhatsApp inbox** (official Cloud API): assignment, 24-h window indicator, approved ar/en templates, linked to records | Kommo, respond.io, Bitrix24, Pipedrive, Odoo | P0 | Module 11 |
| CRM-43 | Public booking links for site surveys (engineer calendars) | HubSpot, Pipedrive Scheduler, Odoo Appointments, Zoho Bookings | P1 | |
| CRM-44 | Click-to-call & call logging via a MENA telephony provider (e.g., Maqsam) | Freshsales, Bitrix24; Maqsam integrations | P1 | |
| CRM-45 | GPS check-in for sales visits (mobile PWA) | Salesforce Maps, Zoho | P1 | |
| CRM-46 | Call/meeting transcription & summaries (Gulf-dialect Arabic) | Bitrix24 CoPilot, HubSpot Call Recap, Maqsam | P2 | |

### 3.6 Sequences, campaigns & consent
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| CRM-50 | Saved segments (static/dynamic) | All | P0 | |
| CRM-51 | Consent registry per contact/channel/purpose with evidence; one-click opt-out honoured everywhere | Salesforce, HubSpot, Dynamics, Zoho | P0 | **PDPL Art. 25** — prior consent for marketing |
| CRM-52 | Follow-up sequences that stop on reply (WhatsApp steps use approved templates) | HubSpot, Salesforce, Zoho, Freshsales, Odoo activity plans | P1 | |
| CRM-53 | WhatsApp/SMS broadcasts to opted-in segments (CST "-AD" sender, 08:00–22:00 only) | respond.io, Kommo, Bitrix24, Odoo | P1 | |
| CRM-54 | Warranty-expiry / AMC renewal campaigns | HubSpot, Dynamics | P1 | Recurring revenue |
| CRM-55 | E-mail marketing, landing pages, journeys | HubSpot, Pipedrive, Dynamics | P2 | |

### 3.7 Forecast, targets, partners & commissions
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| CRM-60 | Weighted forecast by close month | All | P0 | |
| CRM-61 | Forecast categories (commit / best case) with manager roll-up | Salesforce, HubSpot, Dynamics, Zoho | P1 | |
| CRM-62 | Targets/quotas per rep, team and period | Salesforce, HubSpot, Zoho, Pipedrive, Odoo | P1 | |
| CRM-63 | Partner/referrer management: levels, lead forwarding, deal registration, referral fees | Odoo resellers, Salesforce PRM | P1 | Consultants & contractors |
| CRM-64 | Commission plans (rates by product line, paid on collection) — computed in Core, paid through payroll | Odoo, Salesforce Spiff, Zoho | P1 | Module 09 |
| CRM-65 | Territories & visibility by region | Salesforce, Dynamics, Zoho | P1 | |

### 3.8 AI (see module 12)
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| CRM-70 | Reply drafting (MSA vs Saudi dialect toggle) and AR↔EN translation | HubSpot, Salesforce, Zoho, Dynamics, Pipedrive, Freshsales | P1 | |
| CRM-71 | Deal insights / next-best-action / pipeline-hygiene suggestions ("suggested updates") | Freshsales, Pipedrive, Salesforce Pipeline Management, Bitrix24 CoPilot | P1 | |
| CRM-72 | AI form-fill from CR/VAT certificates, e-mails and transcripts | Dynamics (2025 wave 2), Salesforce, Bitrix24 | P1 | |
| CRM-73 | WhatsApp qualification agent that books site surveys (business-specific bot — Meta bans general-purpose bots since 15 Jan 2026) | Salesforce Agentforce SDR/Engagement, HubSpot Prospecting Agent, respond.io, Kommo | P2 | Human hand-off; audit |

## 4. Screens
Accounts & contacts (list, 360 page with timeline) · Leads inbox · Pipeline kanban (per pipeline) · Opportunity page (stage path, quotes, activities, documents, site) · Activities calendar · WhatsApp inbox (module 11) · Partners · Targets & forecast · CRM dashboards.

## 5. Reports (see [module 10](10-reports-bi.md))
S1 Pipeline by stage · S2 Won/lost analysis · S3 Stale deals · S4 Top customers (ABC) · S5 Lead-source performance · S6 Lead response time · S7 Sales vs target · S8 Forecast · S9 Activity report · S10 Sales-cycle length · S11 Segment mix.

## 6. Acceptance criteria (Phase 2 exit)
- Every inbound WhatsApp conversation and web/ad lead appears as a lead within one minute and is assigned by rule.
- Duplicate detection prevents creating a second account with the same unified number, VAT number or phone.
- No marketing message can be sent to a contact without recorded consent; opt-outs stop all marketing immediately.
- Pipeline dashboard, lost-reason analysis and weighted forecast are used in the weekly sales meeting.
