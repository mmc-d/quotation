# CRM & Sales Pipeline: Feature Benchmark for Motqinon Tech (متقنون تك)

Research date: 25 Sep 2026.

**Caveat on evidence.** The sandbox blocked direct page fetches for most vendor sites (hubspot.com, learn.microsoft.com, pipedrive.com, odoo.com, developers.facebook.com, taqnyat.sa). The web-search budget also ran out before a final Zoho feature check. Evidence therefore comes from search extracts of official pages plus reputable secondary sources. Labels used below:
- **(unverified)**: not confirmed in this session.
- **(nrv)**: established product knowledge, not re-verified.

**App codes:** SF Salesforce Agentforce Sales (formerly Sales Cloud) · HS HubSpot Sales Hub · ZO Zoho CRM · MS Dynamics 365 Sales · PD Pipedrive · OD Odoo CRM · FS Freshsales · KM Kommo · RI respond.io · BX Bitrix24. "All" means the 7 core CRMs (SF, HS, ZO, MS, PD, OD, FS).
**Priority:** P0 = MVP · P1 = second wave · P2 = later / differentiator.

## 1. Apps benchmarked

| App | Positioning / why it's a leader | Notable strengths |
|---|---|---|
| SF | Enterprise market leader. Agentforce 360 GA on 13 Oct 2025. Announced a $500M KSA investment with Hyperforce hosted on AWS in the Kingdom (Feb 2025; GA unverified); opened a Saudi HQ (Nov 2025). | Most mature sales agents (SDR, now "Engagement"; Sales Coach; Pipeline Management). Deepest customization (Flow, PRM, CPQ). Arabic UI (nrv). |
| HS | SMB and mid-market leader; one CRM for marketing, sales and service. INBOUND (Sept 2025) shipped 200+ updates and 20+ Breeze agents. | Easiest adoption, Prospecting Agent, quote engagement, native Snapchat lead-ads integration. **No Arabic UI and no RTL in the CRM** (HubSpot Community threads). |
| ZO | Value leader with the deepest KSA footprint: Jeddah and Riyadh data centres (Mar 2024); bilingual Arabic/English with RTL; Zia Agents (2025). | Blueprint enforces the sales process. Low cost, data residency inside KSA, business-card scanner, large Saudi partner network. |
| MS | Enterprise CRM built into Outlook, Teams and the Power Platform. Copilot agents added in 2025. Azure Saudi Arabia East region opens Nov 2026. | Business process flows and Power Automate approvals. AI fills forms from files and emails. Arabic UI (nrv). |
| PD | Pipeline-first SMB CRM; the UX benchmark for kanban boards and activity-based selling. | Deal rotting; AI assistant flags deals with no activity for 7+ days. LeadBooster, Smart Docs, WhatsApp inbox. Arabic UI (unverified). |
| OD | Open-source ERP: CRM, quote, sales, project/field service and invoicing share one data model. Closest match to Motqinon's flow. | Explainable predictive scoring (v19); resellers and commission plans; WhatsApp app; customer portal to sign and pay. Arabic RTL. |
| FS | Freshworks' mid-market CRM with built-in communications. | Built-in phone, multi-channel sequences, Freddy deal insights (7 status tags), contact scoring. Arabic UI (unverified). |
| KM | Messenger-first CRM (WhatsApp, Instagram, TikTok). | Salesbot plus an AI agent. Captures Meta, TikTok and LinkedIn lead forms; tracks UTM on Click-to-WhatsApp ads. |
| RI | B2C conversation platform popular in the Gulf, with a Saudi case study (Qobolak). | AI agents answer chats **and calls** and read voice notes, images and PDFs. Lifecycle stages; HS/SF sync. |
| BX | All-in-one suite (CRM, tasks, telephony, websites) with a free tier and partners in KSA and the UAE. | Open Channels (WhatsApp, Instagram). CoPilot transcribes and summarizes calls and auto-fills deal fields. Arabic RTL. |

## 2. Feature inventory (76 rows)

### 2.1 Accounts, contacts & customer 360
| Feature | What it does | Seen in | P | KSA / integrator notes |
|---|---|---|---|---|
| Company and individual accounts | B2B and B2C customers in one model | All (SF person accounts) | P0 | Contractors, developers, owners, villa owners |
| Relationships and hierarchies | Contact linked to several accounts, with roles; parent/child companies | SF, HS (association labels), MS, ZO | P1 | The same consultants appear across many projects |
| KSA identity fields and registry lookup | CR / unified no. (10 digits starting "7"); VAT no. (15 digits, starts and ends with 3); National Address. Auto-fill and verify from registry. | Custom fields in global CRMs; native in OD (Saudi localization), Daftra, Qoyod. Registry lookup via Wathq APIs, native in none | P0 fields / P1 lookup | ZATCA B2B invoices need the buyer's VAT number and address |
| 360 timeline | Emails, calls, WhatsApp, visits, quotes and contracts in one feed | All; KM and RI are chat-centric | P0 | Add ERP events (purchase order, installation, handover) |
| Installed base | Sites, devices, serials, warranty and spare-parts dates | SF (Assets), MS, OD (serial numbers) | P1 | 2-year warranty and 10-year spares drive renewals |
| Data enrichment | Auto-fills company details and emails | HS (Breeze Intelligence), OD, FS, MS (agent web research) | P2 | Global databases are thin on Saudi SMEs; Wathq is better |

### 2.2 Lead capture
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Web forms and email-to-lead | Forms or a sales@ address create a lead, with UTM tags | All; OD, BX (email address) | P0 | Bilingual form with a PDPL consent checkbox |
| WhatsApp-to-lead | First inbound message creates a lead and a conversation | KM, RI, BX, PD, OD, HS | P0 | #1 channel in KSA; also match on BSUID, not only phone |
| Click-to-WhatsApp ad attribution | Records which ad or campaign started the chat | KM, RI | P1 | The main ad format for Saudi SMEs |
| Meta (and Google) lead ads | Instant-form leads sync in real time | HS, ZO, SF (Marketing Cloud), KM; PD and MS via connectors | P0 Meta / P2 Google | |
| Snapchat and TikTok lead ads | Lead-gen form entries become leads; conversions are sent back | HS (Snapchat native), KM (TikTok native); others via Zapier, LeadsBridge, Datahash or the Snap API | P1 | Snapchat is very strong in KSA; build a direct connector |
| Web chat and bots | Qualify website visitors and book calls | PD (LeadBooster), HS, ZO (SalesIQ), FS, BX, OD, KM (Salesbot), RI | P1 | Arabic bot scripts; hand off to WhatsApp |
| Walk-in and exhibition capture | Quick-add, QR forms, business-card OCR | ZO, HS (card scanners) | P0 / P1 OCR | No good Arabic card OCR on the market |
| Referral capture | Stores the referrer and a referral code on the lead | OD ("Referred by"), SF (PRM deal registration) | P0 | Architects, consultants and contractors refer work |

### 2.3 Qualification, scoring, routing & dedup
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Qualify and convert | Converts a lead into account, contact and deal; disqualify or recycle | SF, MS, ZO, OD, FS; HS via lifecycle stages | P0 | |
| Qualification fields | Project type, units and doors, budget, timeline, decision role | All (custom); guided in SF (Path) and MS (business process flows) | P0 | Feeds the intercom bill of materials |
| Rule-based scoring | Points for fit and engagement | HS, ZO, FS, SF, MS | P1 | |
| Predictive scoring | ML win probability, with the factors explained | OD (explainable in v19), SF (Einstein), HS, ZO (Zia), FS, MS | P2 | Needs a sales history to learn from |
| Assignment and SLA | Round-robin, or by city or product; escalation timers | OD, SF, ZO, HS, FS, BX | P0 / P1 SLA | Sun–Thu working week |
| Duplicate detection and merge | Matches on phone, email, name, CR or VAT, then merges | SF, MS, HS, PD, OD, ZO, FS | P0 | Normalize phones to +966 format and Arabic letter variants (أ/إ/ا, ة/ه, ى/ي) |

### 2.4 Pipelines & deals
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Multiple pipelines | Separate stages per business line | All | P0 | Intercom B2B / smart-home B2C / IoT / maintenance |
| Kanban with rotting flags | Drag-and-drop board with totals; flags idle deals | All, KM, BX; rotting in PD, FS ("Gone Cold") | P0 | Right-to-left board |
| Stage gates | Required fields and checks per stage | ZO (Blueprint), SF (Path), MS (business process flows), HS | P0 light | Contract stage requires an approved quote, VAT no. and address |
| Deal value and line items | Amount in SAR, probability, close date, catalog lines | All | P0 | Reuse the existing quote engine (VAT 15%, installation line) |
| Versioned quotes | Quotes created from the deal, with versions and validity | SF (CPQ), HS, ZO, MS, PD (Smart Docs), OD | P0 | Bilingual PDF |
| Quote engagement | Alerts when a quote is viewed or shared | HS (Sep 2025), PD, OD | P1 | Trigger a WhatsApp follow-up |
| Competitors | Rival bidders per deal; win/loss against each | SF, MS; custom elsewhere | P1 | |
| Lost reasons | Reason required when a deal is lost | OD, PD, HS, SF, MS, FS | P0 | Price, consultant specified another brand, tender lost |
| Project, site and tender data | Site pin, building type, units, consultant, contractor, tender dates, BOQ | Custom in all; HS RFP Agent (beta) | P0 fields / P1 object | No benchmarked CRM integrates Etimad (government tenders) |
| Deal teams and splits | Several owners with split credit | SF, MS, HS | P2 | Salesperson, presales engineer, partner |

### 2.5 Activities & communications
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Activities | Calls, meetings, site surveys, tasks | All | P0 | Survey, demo and handover activity types |
| Email sync and tracking | Two-way Gmail/M365 sync, templates, open tracking | All | P0 | Google Workspace first |
| Calendar and booking links | Calendar sync; public booking pages | HS, PD (Scheduler), OD (Appointments), ZO (Bookings), MS, SF | P1 | Customers book site surveys |
| Click-to-call and call logging | Dial, record and auto-log calls | FS (built in), BX, OD (VoIP); others via Maqsam and similar | P1 | Maqsam integrates with HS, ZO, SF and PD |
| WhatsApp and social inbox | Shared team inbox linked to deals; Instagram, Messenger, TikTok | KM, RI, BX, PD, OD, HS, ZO, FS; SF and MS via add-ons | P0 WhatsApp / P1 Instagram / P2 others | Use the official Cloud API only |
| WhatsApp templates and 24-hour window | Approved Arabic/English templates; window timer | RI, KM, OD, PD | P0 | Quote and payment reminders |
| GPS field visits (mobile) | Check-in/out, photos, route planning | SF (Maps), ZO (unverified), add-ons (Spotio, Badger) | P1 | Site surveys are the core pre-sales step |
| Transcripts and summaries | Transcribe and summarize calls and meetings | BX (CoPilot), HS (Call Recap, beta 2025), SF, MS, Maqsam | P2 | Must handle Gulf-dialect Arabic |

### 2.6 Sequences & marketing
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Sequences and activity plans | Multi-step follow-ups that stop on reply | HS, SF, ZO, MS, FS; OD (activity plans) | P1 | WhatsApp steps must use approved templates |
| Segments | Static and dynamic lists | All | P0 | Saved views are enough for the MVP |
| WhatsApp and SMS broadcasts | Bulk sends to opted-in segments | RI, KM, BX, OD, HS | P1 | Consent filter; CST "-AD" sender; send only 08:00–22:00 |
| Email, landing pages, journeys | Campaigns, web pages, nurture flows | HS, PD, MS, OD, BX; ZO (unverified) | P2 | Satisfaction surveys, warranty-expiry reminders, upsell |

### 2.7 Forecasting, quotas, commissions & territories
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Weighted forecast | Amount × probability, summed by close month | All | P0 | |
| Forecast categories | Commit and best-case categories; manager roll-up | SF (Collaborative Forecasts), HS, MS, ZO | P1 | |
| Quotas and targets | Per rep, team and period | SF, HS, ZO, PD, OD | P1 | |
| Commission plans | Rates, caps and tiers; partner payouts | OD (v18), SF (Spiff, acquired 2024) | P1 partners / P2 reps | Referral fees are common |
| Territories and visibility | Ownership by region; own/team/all record access | SF, MS, ZO; roles in all | P0 roles / P1 territories | Makkah and Jeddah first |

### 2.8 Dashboards & reports
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Funnel conversion | Stage-to-stage conversion by source and rep | All | P0 | Lead → survey → quote → contract → won |
| Win/loss | By reason, competitor, product and rep | All | P0 | |
| Cycle time | Days spent in each stage | PD, HS, SF, ZO | P1 | |
| Rep leaderboard | Calls, visits, quotes sent, WhatsApp response time | PD, OD (Gamification), HS | P1 | |
| Source ROI | Revenue by lead source or ad | HS, SF, ZO, MS | P1 | Snapchat vs Instagram vs referrals |

### 2.9 Automation & approvals
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| No-code workflows | Trigger, conditions, actions (incl. WhatsApp template, webhook) | All, KM, BX | P0 | |
| Approvals | Multi-level approval of discounts and payment terms | SF, HS (Flexible Approvals, 2025), ZO, MS | P0 | Discounts above a threshold go to the founder |
| Time-based triggers | Fire after N idle days, on an unopened quote, or relative to a date | HS, SF, ZO, PD, OD | P1 | e.g., 60 days before warranty ends |

### 2.10 Customization
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Custom fields and validation | Picklists, formulas, roll-ups | All | P0 | |
| Custom objects and layouts | New record types; layouts per role or pipeline | SF, MS, ZO, HS (Enterprise), OD (Studio) | P1 | Site, Tender, Device |
| Arabic UI with RTL | Per-user language; bilingual values | ZO, OD, BX; SF and MS (nrv); not HS | P0 | Arabic-first |

### 2.11 Mobile
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Mobile app | Edit records, push alerts, call/WhatsApp, quick-add | All | P0 (a PWA is enough) | |
| Business-card scanner | OCR into a contact | ZO, HS | P1 | Needs Arabic OCR |
| Offline mode | Keeps working without signal | SF, MS | P2 | Basements and building sites |

### 2.12 Portals, partners & documents
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Customer portal | Customers view and accept quotes, contracts and invoices | OD, SF (Experience Cloud), MS (Power Pages), ZO, HS | P1 | Handover and warranty documents |
| Partner and referrer management | Partner levels, lead forwarding, partner portal, deal registration | OD (Resellers), SF (PRM) | P1 | Track specifiers as well as buyers |
| Document links | Drive files, BOQs, drawings, site photos | All | P0 | Keep Google Drive as the store |
| Document generation and e-signature | Contract templates, e-signature, deposit payment | PD (Smart Docs), OD, ZO (Zoho Sign), HS, SF | P1 | 50/40/10 payment contract; Nafath-based e-signature (unverified) |

### 2.13 AI
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Reply drafting | Drafts or rephrases emails and messages | HS, SF, ZO, MS, PD, FS, OD, KM | P1 | Toggle Modern Standard Arabic vs Saudi dialect |
| Deal insights and next-best-action | Risk tags and a suggested next step | FS, PD, HS, SF, MS | P1 | |
| AI form-fill | Pulls field values from emails, files and call transcripts | MS (2025 wave 2), BX, SF | P1 | Read CR and VAT certificates into the account |
| Conversation intelligence | Call analytics and coaching | HS, SF, MS, Maqsam | P2 | |
| Autonomous SDR agent | Qualifies, answers and books meetings 24/7 | SF, MS, HS, RI, KM, ZO | P2 | Must stay business-specific (Meta rule, Jan 2026) |
| Research and natural-language analytics | Account briefs; plain-language questions | MS, HS, ZO (Ask Zia) | P2 | Arabic prompts |

### 2.14 Integration, data & privacy
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Import and export | CSV/XLSX field mapping; dedup on import | All | P0 | Migrate from Google Sheets |
| API and webhooks | REST API, events, Zapier/Make | All | P0 | Bridge to Apps Script during migration |
| Consent and data-subject requests | Consent records per channel; export and delete personal data | SF, HS, MS, ZO | P0 consent / P1 requests | PDPL Art. 25 |
| Audit trail | Field change history | All | P0 | |
| KSA data residency | Hosting inside the Kingdom | ZO (2024), SF (announced 2025), MS (Nov 2026) | P1 | PDPL cross-border transfer rules |

## 3. Leading-edge 2025–2026 innovations worth copying
1. **Autonomous SDR / engagement agent.** Pioneered by SF Agentforce SDR (Oct 2024), now called "Agentforce Engagement". In 2026 it added group-calendar booking and an automatic inbound-to-nurture hand-off (secondary sources). Followers: MS Sales Agent (2025), HS Prospecting Agent (multilingual, Sept 2025), ZO Zia Agents. *Copy:* a WhatsApp agent that qualifies by city, building type and units, then books a site survey on the engineer's calendar.
2. **Pipeline-hygiene agent.** SF Pipeline Management proposes stage, close-date and next-step updates from emails and calls. BX CoPilot fills deal fields from calls. MS Form Fill Assist does the same from files (2025 wave 2). *Copy:* one-tap "suggested updates".
3. **Deal-specialist agents.** HS, public beta Sept 2025: Closing, Deal Loss, Call Recap, RFP, Company Research and Customer Handoff agents, plus deal-risk detection from call transcripts. *Copy:* a helper that turns a tender BOQ into a draft quote, and a sales-to-operations handoff pack.
4. **Quote engagement plus flexible approval routing.** HS (Sept 2025).
5. **AI sales coaching and role-play.** SF Agentforce Sales Coach (2025).
6. **Research canvas.** MS Sales Research Agent (2025 wave 2) coordinates specialist sub-agents and answers questions with charts and a written narrative.
7. **Explainable win probability.** OD 19 (Sept 2025) shows the positive and negative factors behind each score.
8. **Agent builders and marketplaces.** ZO Zia Agent Studio and Zia LLM (2025; agent-to-agent interoperability planned); HS Breeze Studio and Marketplace (beta, Sept 2025); SF Agentforce 360 (Oct 2025).
9. **Multimodal voice and chat agents.** RI agents take calls and chats and read voice notes, images and PDFs. This fits Saudi customers, who often send voice notes and photos of doors.
10. **Messenger-native pipeline.** KM makes every chat a pipeline card, qualified by Salesbot, and captures ad lead forms automatically.
11. **Arabic-dialect voice AI.** Maqsam, a MENA contact-centre platform.
12. **Meta Business Agent.** Meta's own WhatsApp/Instagram/Messenger agent moved to token pricing on 1 Aug 2026 (about $2 per million tokens, per BSP reports). Compare it before building an in-house agent.
13. **Data Agent.** HS Data Hub (Sept 2025) researches and fills CRM properties.

## 4. Saudi (KSA) & Arabic specifics

**PDPL (SDAIA).** In force since Sep 2023; enforced since Sep 2024 (nrv).
- Art. 25 requires **prior consent** before sending ads or awareness messages over personal channels (SMS, WhatsApp, email).
- Every message needs a **clear opt-out**. After withdrawal, marketing must stop without undue delay.
- Keep evidence of consent: timestamp, purpose, method and wording.
- SDAIA issued 48 violation decisions in 2025–26, including for marketing sent without consent.
- The Implementing Regulations also cover data-subject rights, breach notification (72 h, nrv) and cross-border transfers. The transfer rules favour hosting data in the Kingdom.

**CST rules for SMS.**
- Send only through a CST-licensed provider.
- Sender IDs must be registered with every network. This needs a CR copy and a signed authorization letter and takes about 3–5 days.
- Promotional sender IDs must end in **"-AD"**.
- Promotional messages may only go out **08:00–22:00** KSA time (per aggregators).
- Each promotional message needs an opt-out, honoured within 24 h. Aggregators also report DND-list screening.

**WhatsApp Business Platform.**
- Customers must opt in. Templates need Meta approval and are categorized as marketing, utility or authentication. Free-form messages are allowed only inside the 24-h service window.
- Since **1 Jul 2025**, Meta charges per delivered template. Utility templates sent inside the window are free.
- From **1 Oct 2026**, service messages and in-window utility templates become **chargeable**. BSP reports say the first 1,000 service messages per number per month stay free. A payment method must be on file by 30 Sep 2026.
- **General-purpose AI chatbots are banned from 15 Jan 2026** (from 15 Oct 2025 for new accounts). Business-specific bots are allowed.
- WhatsApp usernames arrive around Jun 2026. Some users will then show up with only a **BSUID** (business-scoped user ID; seen in webhooks since Apr 2026) and no phone number. The CRM must not rely on phone number as the only identity key.

**Commercial Register Law (Royal Decree M/83, effective 3 Apr 2025).**
- The CR number becomes the unified national number: 10 digits starting with "7".
- CRs no longer expire but need annual confirmation.
- Branch CRs are abolished, with a transition period until 3 Apr 2030.
- Store the unified number, legacy CR numbers, status and confirmation date.

**ZATCA.** A VAT number is 15 digits, starting and ending with "3" (nrv). B2B tax invoices need the buyer's VAT number and address, so capture both during the sales stage.

**Local vendors and competitors.**
- Zoho: local data centres, Arabic UI.
- Salesforce: Riyadh HQ; Hyperforce in KSA not yet confirmed as generally available.
- Microsoft: Saudi Arabia East region, Nov 2026.
- Odoo and Bitrix24: sold through Saudi partners.
- Daftra: MENA ERP with CRM and ZATCA e-invoicing.
- Qoyod: Riyadh accounting; integrates with Salla, Zid and Foodics.
- Rewaa: POS and inventory.
- Maqsam: contact centre with Arabic AI.
- SMS gateways: Taqnyat, Qalaama, Unifonic.
- WhatsApp CRMs common in the Gulf: respond.io, Kommo, Wati.

**Integrations to plan.**
- Messaging and ads: Meta WhatsApp Cloud API (BSUID-aware), Meta Lead Ads, Snap Lead Generation (direct API or LeadsBridge/Datahash), TikTok Lead Gen, Google Ads.
- Government data: Wathq (CR Search, CR under the new law, national address via SPL) and SPL National Address.
- Office and telephony: Google Workspace (Gmail, Calendar, Drive) or Microsoft 365; Maqsam; a CST-licensed SMS gateway.
- Downstream: ZATCA Fatoora (in accounting), e-signature (Zoho Sign/DocuSign or a Nafath-based local provider, unverified), and Etimad (tracked by hand).

**Arabic UX.**
- Arabic-first RTL, with English available per user.
- Bilingual name fields.
- Arabic search normalization.
- Optional Hijri dates on contracts.
- SAR currency formatting.
- Phone numbers stored in +966 E.164 format.
- SLA timers on a Sun–Thu working week.
- Gulf-dialect WhatsApp templates.

## 5. Data entities implied
- **Account**: type, name_ar/name_en, unified_no, legacy_crs, cr_status, cr_confirmed_at, vat_no, national address (building_no, street, district, city, postal_code, additional_no, short_address, lat/lng), segment, parent_id, owner_id, territory_id, source.
- **Contact**: names ar/en, mobile_e164, wa_bsuid, wa_username, email, title, language, preferred_channel. **AccountContactRole**: role (decision-maker, consultant, site engineer, specifier), is_primary.
- **Lead**: source, channel, campaign, utm_*, ad/click ids (CTWA, gclid, Snap/TikTok lead id), raw_payload, qualification fields, score + explanation, status, disqualify_reason, assignee, sla_due_at, referrer_id, duplicate_of, converted ids.
- **Pipeline/Stage**: order, probability, required_fields, rotting_days.
- **Deal**: pipeline/stage, amount_net/gross, probability, expected_close, owner, team, partner_id, competitors[], lost_reason, project_id, next_step, stage_history.
- **Project/Site**: location, building_type, units/floors/doors, consultant, main_contractor, tender dates, BOQ files.
- **Quote/QuoteLine/Contract** (existing engine): lines with discount, VAT and installation flag; version, status, validity, view events; 50/40/10 milestones; warranty_end, spares_end.
- **Activity**: type (call/meeting/visit/task/email/WhatsApp), due/done, outcome, related_to, gps_in/out, recording, transcript, ai_summary.
- **Conversation/Message**: channel, wamid, bsuid, direction, template_id, delivery status, pricing_category, window_expires_at, assignee. **MessageTemplate**: language, category, Meta status, variables.
- **Segment/Campaign/Broadcast**; **Consent** (contact, channel, purpose, status, source, wording_version, captured/withdrawn_at).
- **Partner** (type, level, commission_plan); **CommissionPlan/Line**; **Target**; **Territory/Team**; **ApprovalRequest**; **AutomationRule**; **Webhook**.
- **Asset** (serial, model, site, install_date, warranty_end, spares_end); **User/Role**; **AuditLog**; **Attachment** (Drive id); **AISuggestion** (payload, source, accepted_by).

## 6. Recommended MVP scope and deferrals

**MVP (P0)**
- **Accounts and contacts.** Company and individual accounts with KSA fields, validation and bilingual names. Contacts can hold several roles.
- **Data migration and dedup.** Import from Google Sheets. Detect duplicates by phone, email, VAT/CR and normalized Arabic names, and merge them.
- **Lead inbox.** Leads from web forms (with consent), WhatsApp, Meta lead ads, walk-in quick-add and referrals, with UTM tracking and round-robin or city-based assignment.
- **WhatsApp inbox (official API).** Arabic/English templates, a 24-h window indicator, BSUID-ready contact identity, and chats linked to deals.
- **Pipelines.** Right-to-left kanban for B2B, B2C and maintenance, with rotting flags, stage gates, lost reasons, a competitor field and site fields.
- **Deal-to-contract flow.** Deal line items feed the existing quote engine, then a versioned quote, discount approval and the generated contract.
- **Activities.** Calls, site surveys and tasks, with Gmail/Calendar sync and Drive links.
- **Automation and API.** No-code rules, REST API and webhooks.
- **Reports.** Funnel, weighted pipeline, win/loss and rep activity.
- **Access and compliance.** Roles, audit log, consent register and opt-out handling.
- **Mobile.** A progressive web app with click-to-call and WhatsApp.

**Second wave (P1)**
- **Selling:** sequences and quote-view tracking.
- **Channels and leads:** CST-compliant WhatsApp/SMS broadcasts, Snapchat/TikTok connectors and Click-to-WhatsApp attribution.
- **KSA data:** Wathq and National Address lookup.
- **Field sales:** business-card OCR, GPS check-ins and Maqsam calling.
- **Contracts:** e-signature plus deposit payment link.
- **Management:** forecast categories, quotas and territories.
- **Partners and portals:** partner portal with commissions and a customer portal.
- **Platform:** custom objects, data-subject request tooling and KSA hosting.

**Later (P2)**
- **AI:** WhatsApp SDR agent, predictive scoring, Arabic conversation intelligence, natural-language analytics and enrichment.
- **Marketing:** email marketing, landing pages and journeys.
- **Other:** offline mobile, route planning and deal splits.

## 7. Sources
Most pages were read through search extracts because direct fetches were blocked.

**Salesforce**
- https://help.salesforce.com/s/articleView?language=en_US&id=sales.sales_agent_sdr_intro.htm&type=5
- https://www.salesforce.com/news/stories/agentforce-sales-announcement/
- https://www.salesforce.com/news/press-releases/2025/10/13/agentic-enterprise-announcement/
- https://www.salesforce.com/blog/sales/digital-sales-success/
- https://www.salesforce.com/news/press-releases/2025/02/10/saudi-arabia-investment/
- https://www.salesforce.com/news/press-releases/2025/11/18/salesforce-saudi-arabia-launches/
- https://salesforcedictionary.com/blogs/agentforce-sales-complete-2026-guide
- https://www.cloudoxia.com/blogs/salesforce-agentforce-sdr
- https://frontline1st.com/2025/08/08/agentforce-sales-coach-excellence/
- https://saasgulf.com/en/reviews/salesforce-gcc-review/

**HubSpot**
- https://ir.hubspot.com/news-releases/news-release-details/hubspot-unveils-blueprint-building-hybrid-human-ai-teams-200
- https://www.hubspot.com/company-news/build-your-ai-team
- https://www.cmswire.com/digital-marketing/hubspot-unveils-data-hub-breeze-agents-and-the-loop-at-inbound-2025/
- https://huble.com/blog/hubspot-inbound-2025-key-product-updates
- https://www.hubspot.com/products/business-card-scanner-app
- https://community.hubspot.com/t5/HubSpot-Ideas/RTL-right-to-left-amp-amp-rich-text-functionality/idi-p/38023
- https://community.hubspot.com/t5/HubSpot-Ideas/Arabic-Language-Support/idi-p/322970
- https://forbusiness.snapchat.com/blog/snapchat-hubspot-integration
- https://www.marketingdive.com/news/snapchat-shores-up-lead-gen-ads-with-new-hubspot-integration/826552/
- https://businesshelp.snapchat.com/s/article/Iead-generation-integrations?language=en_US

**Microsoft**
- https://learn.microsoft.com/en-us/dynamics365/release-plan/2025wave2/sales/dynamics365-sales/planned-features
- https://learn.microsoft.com/en-us/dynamics365/release-plan/2026wave1/sales/dynamics365-sales/planned-features
- https://www.forvismazars.us/forsights/2025/10/sales-updates-in-2025-release-wave-2-for-dynamics-365
- https://www.cxtoday.com/marketing-sales-technology/microsoft-sales-agent-service-agent-general-availability/
- https://news.microsoft.com/source/emea/2026/08/microsoft-announces-saudi-arabia-east-datacenter-region-will-be-available-in-november-2026/
- https://news.microsoft.com/source/emea/2026/02/microsoft-confirms-saudi-arabia-datacenter-region-available-for-customers-to-run-cloud-workloads-from-q4-2026/

**Zoho**
- https://futurumgroup.com/insights/zoho-unveils-zia-llm-no%E2%80%91code-agent-studio-and-open-agent-interoperability/
- https://www.intelligentcio.com/me/2024/03/05/zoho-corp-announces-the-opening-of-its-first-middle-east-data-centres-in-saudi-arabia/
- https://www.zoho.com/crm/card-scanner.html
- https://marketplace.zoho.com/app/crm/maqsam-for-zoho

**Pipedrive**
- https://www.pipedrive.com/en/features/ai-sales-assistant
- https://support.pipedrive.com/en/article/whatsapp-integration
- https://www.pipedrive.com/en/features/crm-for-whatsapp
- https://www.businesswire.com/news/home/20220510005746/en/Pipedrive-Launches-Messaging-Inbox-and-Integrations-with-WhatsApp-Facebook-Messenger-and-DocuSign
- https://saleshive.com/vendors/pipedrive

**Odoo**
- https://www.odoo.com/documentation/19.0/applications/sales/crm/track_leads/lead_scoring.html
- https://www.odoo.com/documentation/18.0/applications/sales/crm/track_leads/resellers.html
- https://www.odoo.com/app/whatsapp
- https://www.cybrosys.com/blog/overview-of-predictive-lead-scoring-in-odoo-19-crm
- https://www.aaravsolutions.com/ai-in-odoo-crm-whats-new-in-odoo-19/
- https://www.erpgap.com/blog/odoo-sales-commissions

**Freshsales**
- https://www.freshworks.com/crm/freddy-ai/
- https://pipeline.zoominfo.com/sales/freshsales-features
- https://www.usecarly.com/blog/freshsales-ai/

**Kommo, respond.io, Bitrix24**
- https://www.kommo.com/
- https://www.kommo.com/blog/tiktok-ai/
- https://respond.io/ai-agents
- https://respond.io/whatsapp-crm-integration
- https://respond.io/blog/whatsapp-general-purpose-chatbots-ban
- https://helpdesk.bitrix24.com/open/24844930/
- https://www.bitrix24.com/tools/crm/
- https://crmsoft.tech/en/

**Meta / WhatsApp**
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- https://help.twilio.com/articles/30304057900699-Notice-Changes-to-WhatsApp-s-Pricing-July-2025
- https://www.wati.io/en/blog/meta-whatsapp-ai-token-pricing/
- https://blog.omnichat.ai/meta-business-agent-platform-explained-features-pricing-and-what-the-2026-whatsapp-changes-mean-for-your-business/
- https://www.intelliconcierge.com/blog/whatsapp-pricing-changes-2026-what-every-business-needs-to-know-before-october
- https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
- https://www.ycloud.com/blog/whatsapp-usernames-and-business-scoped-user-ids
- https://api.support.vonage.com/hc/en-us/articles/26938046521116-Understanding-WhatsApp-Usernames-and-Business-Scoped-User-IDs-BSUIDs-Required-Actions-and-Changes

**KSA regulation and registries**
- https://ksapdpl.com/ksa-saudi-pdpl-article-25-restrictions-on-direct-marketing-and-awareness-messages/
- https://saudiprivacylaw.com/blog/direct-marketing-and-consent-withdrawal-under-pdpl/
- https://sdaia.gov.sa/en/Research/Pages/DataProtection.aspx
- https://www.sgc.consulting/sdaia-saudi-personal-data-protection-law-pdpl-compliance-guide/
- https://cms.law/en/are/legal-updates/one-year-anniversary-saudi-personal-data-protection-law
- https://d7networks.com/sms/saudi-arabia/sms-regulations/
- https://www.clickatell.com/sms-country-regulations/saudi-arabia/
- https://qalaama.com/en/products/bulk-sms-saudi-arabia/
- https://taqnyat.sa/assets/download/compliance-en.pdf
- https://developer.wathq.sa/en/apis
- https://developer.wathq.sa/en/api/32
- https://mc.gov.sa/en/mediacenter/News/Pages/02-11-19-01.aspx
- https://www.hfw.com/insights/saudi-arabias-new-commercial-registration-law-impacts-and-next-steps-for-business-owners/
- https://www.lexismiddleeast.com/eJournal/2025-04-10_45/en

**Local market**
- https://maqsam.com/integrations
- https://ecosystem.hubspot.com/marketplace/listing/maqsam-275121
- https://lkwjd.com/best-crm-software
- https://www.daftra.com/en/hub/best-crm-software
- https://pipelinecrm.com/blog/best-field-sales-crm/
