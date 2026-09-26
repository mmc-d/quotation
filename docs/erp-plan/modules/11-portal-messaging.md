# Module 11 — Customer Portal, WhatsApp & Notifications (بوابة العملاء والمراسلات)

| | |
|---|---|
| **Phases** | WhatsApp/e-mail sending → Phase 1 · Shared inbox & online acceptance → Phase 2 · Payment links → Phase 3 · Full customer portal → Phase 7b |
| **Benchmarked** | WhatsApp Business Platform (Cloud API, Flows, Calling), Saudi CPaaS (Unifonic, Taqnyat, Msegat), Amazon SES / Postmark / Resend, HubSpot/Zoho/Odoo inboxes, respond.io, Kommo, Jobber Client Hub, simPRO portal, D-Tools customer portal, Odoo portal |
| **Business owner** | Customer Service lead |

## 1. Goals
1. Reach customers where they are — **WhatsApp first** — with approved, bilingual, cost-controlled messages linked to the right record.
2. Let customers self-serve: view/accept quotes, sign contracts, pay, follow project progress, see devices & warranty, open tickets.
3. Respect PDPL consent, Meta template rules and CST SMS rules automatically.

## 2. WhatsApp rules & costs that shape the design

| Date | Change | Design consequence |
|------|--------|-------------------|
| 1 Jul 2025 | Billing per delivered **template** message by category (marketing / utility / authentication) and country; utility templates inside an open 24-h window were free | Classify templates carefully; operations use **utility** only |
| 15 Jan 2026 | Meta bans **general-purpose AI chatbots** on the platform; business-specific bots allowed | Our WhatsApp assistant stays scoped to the company's sales/support |
| 1 Apr 2026 | Saudi marketing rate raised (≈ SAR 0.19 marketing vs ≈ SAR 0.04 utility/authentication, third-party figures — verify on Meta's rate card) | Marketing ≈ 4–5× utility; campaigns budgeted |
| Apr–Jun 2026 | **BSUID** (business-scoped user ID) in webhooks; **usernames** — users can message without revealing a phone number | Contact identity = phone **or** BSUID |
| **1 Oct 2026** | **Service messages become billable** after 1,000 free per business phone number per month; utility templates inside the window charged again; 72-h free-entry window from Click-to-WhatsApp ads stays free | Message **cost ledger** per record; volume monitoring per number |

SMS (CST): licensed provider only; sender IDs pre-registered; promotional sender IDs end with **"-AD"**; promotional SMS only **08:00–22:00**; opt-out honoured within 24 h. Marketing on any personal channel needs **prior consent** (PDPL Art. 25).

## 3. Feature backlog

### 3.1 Messaging hub
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| MSG-01 | WhatsApp template sends from records: quote sent (PDF), payment request, visit booked, technician on the way, job done + service report, invoice issued, payment reminder, payment received | Odoo WhatsApp, Zoho, Unifonic/Taqnyat | P0 | 6–8 **utility** templates in ar/en |
| MSG-02 | Template library synced with Meta (category, status, variables, languages) | WhatsApp Manager/API, BSP consoles | P0 | Meta may re-categorise — keep utility templates purely transactional |
| MSG-03 | Inbound webhook → match contact by phone **or BSUID** → create lead/ticket or attach to conversation | Odoo, HubSpot, respond.io | P0 | |
| MSG-04 | Every message logged on the record timeline | Odoo chatter, Salesforce activity timeline | P0 | |
| MSG-05 | Consent registry & opt-out handling across channels | HubSpot subscription types, Meta policy | P0 | PDPL |
| MSG-06 | Transactional e-mail with SPF/DKIM/DMARC, bounce handling, Arabic UTF-8 subjects | SES, Postmark, Resend | P0 | |
| MSG-07 | **Shared team inbox** with assignment, 24-h window indicator, internal notes, canned replies | HubSpot Inbox, Zoho, respond.io, Kommo | P1 | Phase 2 |
| MSG-08 | Interactive messages & **WhatsApp Flows** (confirm visit slot, accept quote, CSAT) | Meta Flows | P1 | |
| MSG-09 | CST-licensed SMS for OTP fallback & notifications; promotional "-AD" sender only for opted-in campaigns | Unifonic, Taqnyat, Msegat | P1 | |
| MSG-10 | In-app notification centre + web push for installed PWAs | All; FCM/Web Push | P1 | iOS 16.4+ home-screen apps only |
| MSG-11 | Channel preferences & quiet hours per contact | HubSpot | P1 | |
| MSG-12 | **Messaging cost ledger** (cost per message by category, per record, per number) and budgets | Gap in most products | P1 | Critical after 1 Oct 2026 |
| MSG-13 | WhatsApp Calling API; business-specific AI auto-reply with human hand-off | Meta Calling, HubSpot Customer Agent, Zia, Odoo AI | P2 | Test Hijazi dialect |

### 3.2 Customer & partner portal
| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| POR-01 | Passwordless portal login (e-mail OTP / magic link / WhatsApp OTP) | Better Auth, Clerk, Supabase | P1 | Module 01 |
| POR-02 | Tokenised share links (quote, contract, payment request, service report, handover pack) sent by WhatsApp — no account needed | Jobber, D-Tools | P0 (Phase 1–2) | Expiring, single-purpose |
| POR-03 | View & accept quotes online (options, comments, OTP acceptance) | Qwilr, Proposify, Portal.io, D-Tools, Odoo | P1 | Module 03 |
| POR-04 | Sign contracts (Nafath via TSP) and download signed copies | Signit, Zoho Sign, Odoo | P1 | Module 04 |
| POR-05 | Pay payment requests/invoices (mada, Apple Pay, cards); see statement & receipts | Odoo, Zoho, QBO, Xero | P1 | Module 08 |
| POR-06 | Project progress: stage, next step, approvals needed (specs, door directions, room numbers, design), documents | simPRO, Jobber Client Hub, D-Tools | P1 | Approvals start the delivery clock |
| POR-07 | My devices: installed base per site/unit, warranty status, manuals, QR sticker link | simPRO portal (assets & defects) | P1 | Phase 7b |
| POR-08 | Open & track tickets; book maintenance visits; CSAT | Zendesk, Freshdesk, Zoho Desk, Jobber | P1 | Phase 7b |
| POR-09 | AMC contracts: coverage, next visits, renewal & payment | ServiceTitan memberships, D365 agreements | P1 | Phase 7b |
| POR-10 | Site health dashboard from IoT (online devices, alarms, uptime) | ThingsBoard customer dashboards | P2 | Module 12 |
| POR-11 | Partner portal for consultants/contractors: register deals, see referral status & fees | Odoo resellers, Salesforce PRM | P2 | Module 02 |

## 4. Acceptance criteria
- **Phase 1:** quotes and payment requests reach customers on WhatsApp as approved utility templates with PDFs; every send is logged with cost.
- **Phase 2:** inbound WhatsApp messages are matched (phone or BSUID) and routed within one minute; customers accept quotes online with OTP.
- **Phase 7b:** customers see devices, warranty, invoices and tickets in the portal; ≥ 30% of service requests arrive through WhatsApp/portal self-service with full unit/device context.
