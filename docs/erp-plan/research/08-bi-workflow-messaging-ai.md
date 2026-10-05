# Cross-cutting capabilities benchmark: BI, workflow, messaging, documents, localization, mobile, integrations, AI

**For:** Motqinon Tech Trading Co. (شركة متقنون تك للتجارة), roadmap from quotation app to ERP + CRM + accounting
**Research date:** 2026-09-25. **Method:** about 30 web searches and fetches. The proxy blocked direct fetches of some official pages (developers.facebook.com, odoo.com, docs.unifonic.com, dev.to). Their content was read through search-result extracts of those same pages and cross-checked against partner/BSP pages.
**Labels:** "(3rd-party)" means the claim came from a partner or blog, not the vendor. "(unverified)" means it was not confirmed from any primary source. "(general knowledge)" means it was not re-checked in this session.
**Priority:** P0 = MVP must-have · P1 = next 6–12 months · P2 = later.

---

## 1. Solutions benchmarked

| # | Solution | Area | Model | 2025–26 facts that matter for Motqinon (dated) | Arabic/RTL fit |
|---|---|---|---|---|---|
| 1 | Salesforce Reports & Dashboards / CRM Analytics → **Tableau Next** | BI | SaaS | Tableau Next runs on Data 360 with Agentforce analytics skills: Concierge (natural-language Q&A), Inspector (monitoring), Data Pro. It uses the "Tableau Semantics" metric layer. CRM Analytics dashboards still work. | Arabic UI; RTL depth (unverified) |
| 2 | Zoho Analytics | BI | SaaS / on-prem | "Ask Zia" is agentic: it builds pipelines, reports and dashboards from prompts. Zia Insights writes narrative explanations. | Arabic NLQ not documented |
| 3 | Odoo Spreadsheet & Dashboards (19.x) | BI | Odoo Enterprise | 19.0: global filters in the search bar, multi-company dashboards, zoom on time charts. 19.4: saved and default global filters, domains on range pivots. | Full RTL UI |
| 4 | Microsoft Power BI | BI | SaaS | Desktop does not mirror layout for RTL; the Service only partly does. Users were still requesting RTL for embedded Arabic reports in Jan 2025. | Weak |
| 5 | Metabase | BI | OSS + paid | The UI is "designed around LTR". RTL issues are still open (#24954, #34318). | Weak |
| 6 | Apache Superset | BI | OSS | No RTL layout; only Arabic string translations (#25258). | Weak |
| 7 | HubSpot reporting | BI | SaaS | "Create report with AI" works on one object only. The custom report builder is cross-object on Pro/Enterprise. Since Jan 2026, Breeze agents can run inside workflows (3rd-party). | n/a |
| 8 | Salesforce Flow + **Flow Approval Orchestration** | Workflow | SaaS | Spring '25: approvals built in Flow Builder (stages, screen-flow approval steps, background steps). Summer '25: recall and fault paths. Winter '26: debug mode. Spring '26: orchestration runs have no usage caps (Enterprise+). | — |
| 9 | HubSpot Workflows | Workflow | SaaS | Breeze Assistant builds workflows from natural language. | — |
| 10 | Zoho CRM **Blueprint** | Process enforcement | SaaS | Transitions have Before/During/After steps; automatic time-based transitions; SLA per state with before/after escalation actions (email, task, field update, webhook, function, WhatsApp, SMS). | Arabic UI |
| 11 | Odoo automation rules / Studio / Approvals | Workflow | Odoo | Odoo 19: AI can update fields in server actions, read attached files and search the web. | RTL |
| 12 | Microsoft Power Automate | Workflow / iPaaS | SaaS | Approvals can be acted on inside Teams and Outlook (general knowledge). | — |
| 13 | **n8n** | iPaaS, self-hosted | Sustainable Use License (fair-code) | Community Edition is free for internal business use; reselling it is not allowed. 400+ integrations and AI Agent nodes. MCP works both ways: MCP Server Trigger and MCP Client Tool. Self-hosted Business plan is about $800/mo (3rd-party). | — |
| 14 | Temporal | Durable workflows | OSS (MIT) + Cloud | Code-first durable execution with timers, retries and long-running sagas (general knowledge). | — |
| 15 | **WhatsApp Business Platform (Cloud API)** | Messaging | Per-message | Per-message billing since 1 Jul 2025. Saudi marketing rate raised 1 Apr 2026. BSUID added Apr 2026; usernames from Jun 2026. **Service messages become billable 1 Oct 2026.** Also offers Flows and a Calling API. | Native Arabic |
| 16 | Unifonic / Taqnyat / Msegat | KSA CPaaS | SaaS | Local SMS gateways that are also WhatsApp BSPs. Unifonic documents the CST sender-ID process; Taqnyat is a Meta partner with WhatsApp plans of about 600–950 SAR/mo (3rd-party); Msegat offers bulk sends, scheduling and delivery reports. | Local |
| 17 | Amazon SES / Postmark / Resend | Email | API | Transactional email with bounce and complaint webhooks (general knowledge; pricing not re-checked). | — |
| 18 | Headless Chromium (Playwright / Puppeteer) | PDF | OSS | Shapes Arabic correctly. A 3rd-party test reports it stores Arabic *presentation forms*, so the text in the PDF often cannot be searched or extracted. | Good |
| 19 | **Gotenberg 8.x** | PDF API | OSS Docker | Chromium and LibreOffice routes; PDF/A-3b output; file attachments with `/AFRelationship`; a Factur-X route that builds PDF/A-3 + XML in one call. | Good |
| 20 | Typst; Carbone / DOCX templating | PDF | OSS | Typst supports RTL (set `lang`/`dir` for correct bidi punctuation). Carbone lets staff edit DOCX/XLSX templates that LibreOffice renders (general knowledge). | Typst good; LibreOffice needs testing |
| 21 | `Intl` (ICU/CLDR) + tafqit libraries (`tafqit`, `arabicfmt`, `arabic-tafqeet`) | Localization | Browser/Node, OSS | `ar-SA` defaults to the `islamic-umalqura` calendar; `getWeekInfo()` returns weekend days. The libraries spell SAR amounts with riyal/halala inflection; `arabicfmt` adds Umm al-Qura and bidi helpers. | — |
| 22 | PowerSync / ElectricSQL / Zero / RxDB | Offline sync | Mixed | PowerSync: Postgres/Mongo → SQLite, the most mature, conflicts resolved in your API. Electric: Postgres "shapes", last-write-wins. Zero: server-authoritative mutations, offline reads with queued writes. RxDB: IndexedDB/SQLite replicating to any backend. | — |
| 23 | Odoo JSON-2 API | Integration | Odoo 19+ (incl. Community) | `POST /json/2/<model>/<method>` with bearer API keys (maximum 3-month life). XML-RPC/JSON-RPC are removed in Online 21.1 and Odoo 22 (fall 2028). | — |
| 24 | Salesforce Agentforce 360 + Hosted MCP Servers | AI | SaaS | MCP support announced Jun 2025. Hosted MCP servers GA Apr 2026 for Enterprise+. They expose data, Flows, Apex and Named Queries, governed by a central tool registry and policy. | — |
| 25 | HubSpot Breeze | AI | SaaS | Customer, Prospecting and Data agents. Remote MCP server (read/write CRM) GA Apr 2026 (3rd-party). Breeze agents can call third-party MCP servers (Spring 2026). | — |
| 26 | Zoho Zia | AI | SaaS | Announced 17 Jul 2025: in-house Zia LLM (1.3B / 2.6B / 7B), 25+ prebuilt agents, Agent Studio (700+ actions), MCP server covering 15+ apps. GA expected end of 2025. | — |
| 27 | Odoo 19 AI | AI | Odoo | AI agents (livechat lead generation; internal users query their own database), AI fields, AI inside server actions, natural language to domain filter, drafting and chatter summaries. | RTL |
| 28 | Dynamics 365 Business Central / Finance & Ops | AI | SaaS | BC 2026 wave 1: Sales Order, Payables and Expense agents plus a BC MCP server (3rd-party). Announced 23 Sep 2026: Finance Agent (collections, variance analysis), Procurement Agent (preview), Scheduling Operations Agent (preview), ERP MCP server. | — |
| 29 | NetSuite AI Connector Service / NetSuite Next | AI | SaaS | MCP connector (mid-2025) that enforces role permissions. NetSuite Next (SuiteWorld 2025) at no extra cost. Connector Companion + Prompt Library (2026). "MCP Apps" usable inside Claude. | — |
| 30 | Azure AI Document Intelligence v4 | OCR | API | The prebuilt invoice model supports Arabic; the Read model handles Arabic handwriting. | Good |
| 31 | Model Context Protocol | AI plumbing | Open standard | Nov 2025 spec added async operations, statelessness, server identity and a registry. Donated to the Linux Foundation's Agentic AI Foundation on 9 Dec 2025. | — |

---

## 2. Feature inventory (97 rows)

### 2.1 Reports, dashboards & BI

| Feature | What it does | Seen in | Priority | Notes (Saudi/Arabic) |
|---|---|---|---|---|
| List/pivot reports with group-by and subtotals | Turns any list into grouped, summed, exportable views | Odoo pivot, SF Reports, HubSpot | P0 | Replaces today's Excel-only workflow |
| Saved views, favorites, default filters | Remembers each user's report state | Odoo 19.4, SF, HubSpot | P0 | — |
| Global dashboard filters | One date/owner/city filter drives every widget | Odoo, Metabase, Superset | P0 | Gregorian filter, with a toggle to show Hijri |
| KPI tiles with target and period comparison | Shows value, change vs last period, and progress to quota/goal | SF, HubSpot goals, Zoho | P0 | SAR formatting; Latin digits by default |
| Drill-down to records | Chart segment → filtered list → record | SF, Odoo, Power BI | P0 | — |
| XLSX/CSV/PDF export | Export any report | All | P0 | Keep ExcelJS; set worksheet view `rightToLeft` for Arabic |
| Row-level security | Reps and technicians see only their own or their team's data | SF sharing, Power BI RLS, Metabase sandboxing (paid) | P0 | — |
| Scheduled report delivery | Sends an email/WhatsApp snapshot daily or weekly | SF subscriptions, Zoho Analytics, Metabase | P1 | WhatsApp utility template with a PDF link to the owner |
| Spreadsheet-native live BI | Spreadsheet cells bound to live ERP data | Odoo Spreadsheet | P1 | Good fit for the founder's ad-hoc analysis |
| Semantic/metric layer | One definition of "win rate" and "GM%" used everywhere | Tableau Semantics, Power BI models | P1 | Build as versioned SQL views |
| Natural-language → report | Ask a question, get a chart | Ask Zia, HubSpot AI reports (single object), Tableau Next Concierge | P2 | No vendor has proven Arabic NLQ; run your own LLM over the semantic layer |
| AI-narrated insights and anomaly alerts | Explains changes and flags outliers | Zia Insights, Tableau Next Inspector | P2 | — |
| Embedded / customer-portal analytics | Dashboards shown to customers | Metabase/Superset embed, Power BI Embedded | P2 | All three are weak in RTL; draw charts in-app |

### 2.2 Workflow automation, approvals & process enforcement

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Document state machines | Draft→Sent→Accepted→Ordered→Invoiced, with locked transitions | Odoo, SF | P0 | A quote revision (Rev A/B) creates a new version and never overwrites the issued one |
| Record-triggered automation rules | Run actions on create, update or field change | Odoo automation rules, SF record-triggered flows, HubSpot | P0 | — |
| Time-based triggers and automatic transitions | Fire X days before or after a date field; move a record on when time elapses (quote → Expired) | Odoo, HubSpot delays, SF scheduled paths, Zoho Blueprint | P0 | Count business days on a Sun–Thu calendar |
| Stage-gate enforcement | Mandatory fields/checklist per transition, e.g., no "Installed" until photos, serials and signature exist | Zoho Blueprint ("During"), SF validation | P0 | The core field-quality control |
| Validation rules | Block saves with invalid data | SF, Odoo constraints | P0 | Saudi VAT no. = 15 digits, first and last digit 3 (ZATCA rule; verify). Also validate CR no. |
| Threshold approvals (multi-level) | Discount > X%, margin < Y%, PO > Z SAR → approver chain | SF Flow Approval Orchestration, Odoo Approvals/Studio, Power Automate | P0 | — |
| Parallel approvals, recall, delegation | Several approvers; submitter can recall; out-of-office delegate | SF (recall added Summer '25), Power Automate | P1 | — |
| Approve from WhatsApp/email/mobile | One-tap approval with context | Power Automate (Teams/Outlook) | P1 | WhatsApp utility template with buttons, sent to managers |
| SLA timers and escalations | Max time per state, with before/after escalation actions | Zoho Blueprint SLA | P1 | Escalate by WhatsApp or SMS |
| Webhooks and custom code steps | Call external APIs from inside an automation | HubSpot custom code, Zoho functions, Odoo | P1 | — |
| Visual / natural-language flow builder | Build flows without code | SF Flow Builder, HubSpot + Breeze Assistant, Power Automate, n8n | P2 | Don't build one; use self-hosted n8n |
| Durable long-running orchestration | Retries, timers and compensation across services | Temporal, SF Orchestration | P2 | Start with a Postgres job queue; adopt Temporal only if multi-day sagas grow |
| Automation run log and audit | Who or what changed a record, and when | SF debug, n8n executions | P0 | Needed to settle approval disputes |

### 2.3 Notifications & customer messaging

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| WhatsApp template sends from records | Quote sent, visit booked, technician on the way, job done, invoice, reminder | Odoo WhatsApp, Zoho, Unifonic/Taqnyat | P0 | Use the utility category; attach the PDF as a document header or link |
| Template library with category and approval-status sync | Manages Meta templates, variables and ar/en languages | WhatsApp Manager/API, BSP consoles | P0 | Category sets the price. Meta can re-categorize templates, so keep promotional text out of utility templates. |
| Inbound WhatsApp → contact match / lead create | Webhook → match by phone **or BSUID** → create lead | Odoo AI livechat lead generation, HubSpot | P0 | With usernames (Jun 2026) a phone number may not be present |
| Timeline logging | Every WhatsApp/SMS/email appears in the record's chatter | Odoo chatter, SF activity timeline | P0 | — |
| Shared inbox with 24-h window indicator | Assign conversations; show window / free-entry-point status | HubSpot Inbox, Zoho, BSP inboxes | P1 | Window status changes cost from 1 Oct 2026 |
| Interactive messages, WhatsApp Flows, Calling | Buttons, lists and in-chat forms (confirm visit slot, accept quote); VoIP calls | Meta Flows, Calling API | P1 (Calling P2) | — |
| Opt-in/consent registry and opt-out handling | Proof of opt-in per channel and purpose | HubSpot subscription types; Meta policy | P0 | Saudi PDPL applies too (verify details with counsel) |
| Transactional email with SPF/DKIM/DMARC | Sends quotes and invoices; records bounces | SES, Postmark, Resend | P0 | Arabic UTF-8 subject lines |
| KSA SMS gateway (OTP, fallback) | Registered sender ID; delivery reports | Unifonic, Taqnyat, Msegat | P1 | CST rules in §5 |
| In-app notification center + web push (PWA) | Bell with unread count and deep links; dispatch and approval alerts | All; FCM / Web Push | P1 | iOS only delivers push to installed Home-Screen PWAs (iOS 16.4+) |
| Channel preferences and quiet hours | Route by preference; suppress at night | HubSpot | P1 | Promotional SMS allowed only 08:00–22:00 KSA time |
| Messaging cost ledger | Cost per message by category, linked to the record | Gap in most products | P1 | Critical after 1 Oct 2026 |
| AI triage / auto-reply with human handoff | Answers FAQs and "where is my technician?"; books visits | HubSpot Customer Agent (vendor claims >70% auto-resolved), Zia agents, Odoo AI agents | P2 | Quality in Hijazi dialect must be tested |

### 2.4 Document generation & printing

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| HTML/CSS → PDF on headless Chromium | Server-side bilingual PDFs identical to the browser view | Playwright/Puppeteer, Gotenberg | P0 | Shaping is correct; test whether PDF text can be extracted |
| Bilingual template set | Quote, proforma, delivery note, job/service report, tax invoice, statement, PO | Odoo QWeb, Zoho templates | P0 | Arabic first, English second |
| Tafqit (amount in words) | "فقط … ريالاً سعودياً و… هللة لا غير" | Local libraries | P0 | Unit-test gender, dual and plural cases |
| Numbering, revisions, watermarks | Q-2026-0012 Rev B; immutable issued copies; DRAFT/مسودة stamp | Odoo, SF CPQ | P0 | — |
| ZATCA QR (TLV, base64) | Phase-2 QR code (9 tags) | ZATCA | P0 | Mandatory on simplified (B2C) invoices |
| PDF/A-3 with embedded UBL XML | Hybrid e-invoice | Gotenberg (PDF/A-3b + attachments), ZATCA | P1 | Becomes P0 once your integration wave is notified |
| Arabic page "x of y" and repeating table headers | Multi-page BOQ quotes | Chromium print CSS / header templates | P0 | Header templates don't load external resources; inline fonts and logos |
| Merge datasheets and attachments | Appends product datasheets and drawings | Gotenberg merge | P1 | — |
| Online acceptance and e-signature | Customer accepts and signs the quote from a link | Odoo portal, HubSpot quotes, Zoho Sign | P1 | Send the link by WhatsApp |
| Business-editable DOCX templates | Non-developers adjust layouts in Word | Carbone, docxtemplater, Gotenberg LibreOffice | P2 | Test LibreOffice's Arabic output |
| Immutable archive with hash | Stores issued PDFs tamper-evidently | Odoo Documents | P1 | — |

### 2.5 Arabic/RTL/Hijri localization & UX

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| RTL-first layout with CSS logical properties | `margin-inline-start`, `dir="rtl"` mirroring | Odoo, Zoho | P0 | One stylesheet serves both directions |
| Per-user UI language; per-document language; bilingual master data | ar/en UI, document language per customer, translatable product names | Odoo, Zoho | P0 | — |
| Bidi isolation of LTR tokens | `<bdi>` / `unicode-bidi: isolate` for SKUs, phones, emails, IBANs | W3C ALReq | P0 | e.g., "Akuvox R20K" inside an Arabic sentence |
| Digits policy | Latin vs Arabic-Indic digits per user/document; pin `-u-nu-latn` | Intl | P0 | Defaults differ between ICU/CLDR versions |
| Gregorian primary + Umm al-Qura Hijri secondary | Two dates on documents and HR records | Intl `islamic-umalqura` | P1 | Pin `-u-ca-gregory` explicitly (see §5) |
| Company work calendar | Sun–Thu week, Fri–Sat weekend, Ramadan hours, Eid / Founding Day (22 Feb) / National Day (23 Sep) | Odoo resource calendars | P0 | Drives SLAs and due dates |
| SAR and VAT formatting | 15% VAT; new riyal sign U+20C1 (Unicode 17) | — | P0 | Check that fonts include U+20C1 (verify); fall back to "ر.س" / "SAR" |
| Arabic search normalization | Treats أ/إ/آ/ا, ة/ه and ى/ي as equal; strips tashkeel | — | P1 | Postgres `unaccent` + custom rules |
| RTL-aware charts | Mirrored axes and legends, Arabic labels | Weak in Power BI, Metabase, Superset | P1 | In-app charts, e.g., ECharts with `inverse` axes |
| Saudi identifiers and address | National Address (building no., short address), CR, VAT, Iqama | — | P1 | Needed for B2B e-invoice buyer data |
| Self-hosted Arabic fonts | Same rendering in the UI and in PDFs | — | P0 | Embed the fonts; no network font fetch inside the PDF service |

### 2.6 Mobile/PWA/offline for field staff

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Installable responsive PWA | Home-screen app from the same codebase | — | P0 | The cheapest path |
| "My jobs" day plan | Today's visits, map link, customer contact | SF Field Service, Odoo FSM | P0 | Google Maps deep links |
| Job checklists / worksheets | One per job type (intercom install, lock programming) | Odoo FSM worksheets, SF FSL | P0 | Feeds the stage gate |
| Before/after photos with compression and geotag | Evidence of work done | SF FSL, Odoo FSM | P0 | Upload queue for weak signal |
| Serial/MAC barcode and QR scan | Captures installed devices | Odoo barcode, SF FSL | P0 | Builds the installed-base register |
| Customer signature capture | Sign-off on screen | Odoo FSM, SF FSL | P0 | Embedded in the service-report PDF |
| Offline read cache + outbox | Keeps working without signal and syncs later | RxDB, PowerSync, Zero | P1 | Basements and new compounds often lack coverage |
| Full bidirectional sync with conflict rules | Merges offline edits safely | PowerSync (rules in your API), Electric (LWW), Zero (server-authoritative) | P2 | Adopt only if the outbox proves insufficient |
| GPS check-in/out and travel time | Measures time on site and travel | SF FSL | P1 | PDPL privacy notice |
| On-site service report → WhatsApp | Closes the job and sends the PDF to the customer | Odoo FSM, SF FSL | P1 | — |
| Native wrapper (Capacitor / Expo) | BLE/NFC access for lock and intercom provisioning | — | P2 | Only if device programming moves into the app |

### 2.7 Integrations/API/import-export

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Spreadsheet import with mapping and dedupe preview | Loads customers, products, price lists, opening balances | Odoo import, HubSpot import | P0 | Migrate the current quotation app's data |
| Excel/CSV export everywhere | — | All | P0 | — |
| Field-level audit history | Before/after values, who and when | SF field history, Odoo tracking | P0 | — |
| Idempotent inbound webhooks | Receives WhatsApp, payment and ZATCA events exactly once | — | P0 | Idempotency keys |
| REST/JSON API with scoped, expiring keys + OpenAPI | Documented external access | Odoo JSON-2 (≤3-month keys), HubSpot, Zoho | P1 | Design API-first from day one |
| Signed outbound webhooks with retries | Event notifications to other systems | HubSpot, Zoho, Odoo | P1 | — |
| Supplier price-list import | Distributor CSV/XLSX → updated costs | — | P1 | Keeps margins accurate |
| ZATCA Fatoora integration (direct or via provider) | CSID onboarding; clearing/reporting invoices | Odoo KSA localization, local providers | P1 | Becomes P0 at your wave date |
| Payment links (Mada/Apple Pay via a local PSP) | Customer pays from WhatsApp | — | P1 | Payment providers not researched here (unverified) |
| iPaaS connectivity | Zapier / Make / n8n nodes | All | P2 | n8n's Odoo node still calls deprecated RPC (#21545); the lesson is to keep your own API stable |
| MCP server over the ERP | Lets Claude/ChatGPT/Copilot query and act with the user's permissions | HubSpot, SF, NetSuite, Zoho, BC | P1 | Read-only first; writes only through approvals |

### 2.8 AI features

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| BOQ → draft quotation | Parses a BOQ (PDF/XLSX/photo), matches catalog SKUs, quantities and labor, and drafts a quote for review | Pattern: BC Sales Order Agent (email → quote/order for approval) | P1 | The flagship differentiator for an integrator |
| Vendor bill OCR → draft bill | Extracts supplier, VAT no., lines and totals; matches the PO | Odoo digitization, BC Payables Agent, Azure DI (Arabic invoices) | P1 | Check the VAT arithmetic and the supplier VAT number |
| Natural-language search/filter | "unpaid invoices Jeddah > 60 days" → filter | Odoo 19 NL→domain, Ask Zia | P1 | Arabic and English queries |
| Drafting and translation | WhatsApp/email replies; AR↔EN line descriptions | Odoo, Zia, Breeze | P1 | — |
| Visit summaries from voice notes | Arabic voice → structured job report and next steps | Odoo chatter summaries, HubSpot, SF | P1 | Technicians prefer voice to typing |
| AI fields | Fields defined by a prompt (lead type, device count extracted from notes) | Odoo 19 | P2 | — |
| WhatsApp AI agent | FAQs, status, booking, handoff to a human | HubSpot Customer Agent, Zia agents, Odoo livechat agent | P2 | Mind 24-h window economics |
| Anomaly detection | Discount outliers, margin leakage, duplicate bills, shrinkage | Zia, Tableau Next Inspector | P2 | Needs 6–12 months of data |
| Cash-flow forecast | AR behavior + pipeline × win probability + AP | D365 Finance Agent, NetSuite | P2 | — |
| Collections agent | Personalized WhatsApp dunning; promise-to-pay tracking | D365 Finance Agent (collections) | P2 | — |
| Technician schedule optimization | Assigns by skill, location and time window | D365 Scheduling Operations Agent (preview, Sep 2026) | P2 | — |
| RAG over datasheets and manuals | Answers tech-support questions from vendor docs | — | P2 | Akuvox/Hikvision/lock manuals |
| MCP server with RBAC | Assistant access to ERP data under the user's role | NetSuite AI Connector, SF Hosted MCP, HubSpot, Zoho, BC | P1 | — |
| Agent guardrails and audit | Human approval before anything posts; full logs | BC agents ("prepare for approval"), NetSuite role enforcement, SF tool registry | P0 once any AI writes data | — |

---

## 3. Report & dashboard catalog (77 reports)

### Sales / CRM
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|---|---|---|---|---|
| S1 | Pipeline by stage | # deals, SAR, weighted SAR, average age in stage | owner, source, city, segment, close month | funnel + stacked bar | P0 |
| S2 | Won/lost analysis | won/lost count and SAR, lost reason, competitor | period, owner, product family | Pareto bar | P0 |
| S3 | Stale deals / missing next step | days since last activity, next activity date | owner, stage, >X days | RAG table | P0 |
| S4 | Top customers (ABC) | revenue, GM, # orders, last order date, AR | period, segment, city | Pareto | P0 |
| S5 | Lead source performance | leads, qualified %, won %, won SAR | source/campaign, period | bar | P1 |
| S6 | Lead response time | median minutes to first reply, % < 1 h | owner, channel (WhatsApp/call/web) | box/bar | P1 |
| S7 | Sales vs target | booked SAR, target, attainment % | rep, month/quarter | bullet | P1 |
| S8 | Sales forecast | weighted pipeline by close month, commit vs best case | owner, stage | stacked column | P1 |
| S9 | Activity report | calls, site visits, WhatsApp threads, meetings | rep, week | stacked bar | P1 |
| S10 | Sales cycle length | days from lead to won | segment, deal-size band | histogram | P2 |
| S11 | Segment mix | villas / compounds / developers / contractors / government | period | treemap | P2 |

### Quotations
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|---|---|---|---|---|
| Q1 | Quote register | no., rev, customer, project, date, validity, total, status, owner | status, date, owner | table | P0 |
| Q2 | Quote win rate | won ÷ decided, by count and by SAR | owner, segment, size band, brand | bar + trend | P0 |
| Q3 | Discount analysis | list vs net, weighted discount %, # approvals triggered | owner, brand, category | histogram/box | P0 |
| Q4 | Quote margin | cost, price, GM SAR, GM % per quote and per line | owner, brand, category | table + bar | P0 |
| Q5 | Expiring & aging quotes | days since sent, days to expiry, last follow-up | owner, ≤7 days to expiry | RAG table | P0 |
| Q6 | Quote turnaround | request→sent (business hours), # revisions | owner, complexity | bar | P1 |
| Q7 | Top quoted items/bundles | qty, SAR, win rate per SKU/bundle | brand, category | bar | P1 |
| Q8 | Lost-quote price gap | our price vs competitor's or customer's target | competitor, brand | scatter | P2 |
| Q9 | Quote→order leakage | quoted SAR vs ordered SAR (scope cuts) | owner | waterfall | P2 |

### Projects
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|---|---|---|---|---|
| PR1 | Project P&L / gross margin | contract + change orders, revenue recognized, material/labor/subcontract cost, GM % | PM, status, city, customer | table + bar | P0 |
| PR2 | Budget vs actual (EAC) | budget, cost to date, committed (open POs), estimate at completion, variance | project | variance bar | P0 |
| PR3 | Backlog | signed but uninvoiced SAR, backlog months | month, PM, segment | area | P0 |
| PR4 | Billing milestones | milestone, due, invoiced, collected, retention | project, overdue | table/Gantt | P0 |
| PR5 | Project health | % complete, schedule slip (days), open snags | PM | RAG table | P1 |
| PR6 | Change orders | count, SAR, % of contract, approval status | project, customer | table | P1 |
| PR7 | Retention receivable | retention held, release date | customer | table | P1 |
| PR8 | Labor hours, plan vs actual | planned vs actual hours, overtime | project, technician | bar | P1 |
| PR9 | Estimate accuracy | actual ÷ quoted cost by category | project type | scatter | P2 |

### Field Service
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|---|---|---|---|---|
| F1 | Jobs board summary | scheduled / in progress / done / overdue | date, technician, city, job type | stacked bar | P0 |
| F2 | Installed-base register | site, model, serial/MAC, firmware, install date, warranty end | customer, brand, model | table | P0 |
| F3 | Job completion compliance | % of jobs with photos, serials, signature, checklist | technician, job type | bar | P0 |
| F4 | Devices per technician-day | devices commissioned ÷ technician-days | technician, device type, month | bar | P1 |
| F5 | First-time-fix rate | % of service jobs fixed on the first visit | technician, brand, issue type | line | P1 |
| F6 | Repeat-visit rate | jobs reopened within 30 days | technician, brand | bar | P1 |
| F7 | SLA compliance | % responded/resolved within SLA | contract, priority | gauge + trend | P1 |
| F8 | Technician utilization | on-job hours ÷ available hours | technician, week | heatmap | P1 |
| F9 | Warranty/AMC expiry pipeline | devices/contracts expiring in 30/60/90 days; renewal SAR | customer | table | P1 |
| F10 | MTTR & response time | mean hours to arrive / to resolve | priority, city | line | P2 |

### Inventory
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|---|---|---|---|---|
| I1 | Stock on hand & valuation | qty, average (landed) cost, value | warehouse/van, brand | table | P0 |
| I2 | Reorder / low stock | on hand, reserved, on order, minimum, suggested qty | warehouse, supplier | table | P0 |
| I3 | Stock movement ledger | in/out/transfer with source document | item, date | table | P0 |
| I4 | Reserved for projects vs free | qty reserved per project | project, item | stacked bar | P1 |
| I5 | Serial traceability | serial → PO → project → site → warranty | serial, item | table | P1 |
| I6 | Slow-moving / dead stock | days since last movement, value | age bucket | bar | P1 |
| I7 | Van stock by technician | qty/value per van, count variances | technician | table | P2 |
| I8 | Inventory turnover / DIO | COGS ÷ average inventory | category | bar | P2 |

### Purchasing
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|---|---|---|---|---|
| PU1 | Open POs & expected receipts | PO, supplier, ETA, value, % received | supplier, project | table | P0 |
| PU2 | Spend by supplier/category | SAR, # POs, share % | period | Pareto | P1 |
| PU3 | 3-way match exceptions | mismatches between PO, receipt and bill | supplier | table | P1 |
| PU4 | Purchase price variance | actual vs last/standard cost | item, supplier | bar | P2 |
| PU5 | Supplier on-time delivery | OTD %, average lead days | supplier | bar | P2 |
| PU6 | Import landed cost | FOB + freight + customs + clearance → unit landed cost | shipment | waterfall | P2 |

### Accounting / Finance
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|---|---|---|---|---|
| A1 | AR aging | 0–30 / 31–60 / 61–90 / 90+ by customer | customer, owner, project | stacked bar + table | P0 |
| A2 | Customer statement of account | opening balance, invoices, receipts, balance | customer, period | bilingual PDF | P0 |
| A3 | AP aging | buckets by supplier | supplier | stacked bar | P0 |
| A4 | Profit & loss | revenue, COGS, GM, opex, net, by analytic (project/line) | period, analytic | table + trend | P0 |
| A5 | Balance sheet | standard | as-of date | table | P0 |
| A6 | Trial balance / general ledger | account movements | period, account | table | P0 |
| A7 | VAT return (ZATCA) | standard-rated sales/purchases, zero-rated, exempt, adjustments, net VAT | month/quarter | table | P0 |
| A8 | E-invoice status | cleared / reported / rejected / pending, with ZATCA error text | date, document type | counts + table | P0 at wave |
| A9 | Cash & bank position | balances; receipts and payments today/this week | bank | KPI + line | P1 |
| A10 | DSO & collection effectiveness | DSO, CEI, promises to pay | owner | line | P1 |
| A11 | Revenue by stream | devices / installation / programming / AMC & services | period | stacked column | P1 |
| A12 | 13-week cash forecast | expected AR, AP due, payroll, pipeline × probability | week | area | P2 |
| A13 | Budget vs actual (company) | by account group | month | variance bar | P2 |

### HR
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|---|---|---|---|---|
| H1 | Timesheets / attendance incl. field hours | hours, overtime, lateness | employee, week | table | P1 |
| H2 | Iqama & document expiry | iqama, passport, driving licence, medical insurance | expiring ≤60 days | RAG table | P1 |
| H3 | Technician productivity | billable hours %, jobs per day | technician | bar | P1 |
| H4 | Leave balance & calendar | balance, planned leave | department | calendar | P2 |
| H5 | Payroll, GOSI & Saudization | gross, GOSI, net; Saudi/non-Saudi mix (Nitaqat) | month | table | P2 |

### Executive
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|---|---|---|---|---|
| E1 | CEO cockpit | revenue MTD/YTD vs target, GM %, cash, AR > 60 days, backlog, pipeline, win rate | period | KPI tiles + sparklines | P0 |
| E2 | Sales-to-cash funnel | leads → quotes → orders → invoiced → collected, with conversion rates | period | funnel | P1 |
| E3 | Monthly management pack | P&L, cash, AR, backlog, top projects | month | bilingual PDF | P1 |
| E4 | Customer satisfaction | CSAT/NPS from WhatsApp surveys, complaints | technician, project | bar/line | P2 |
| E5 | Recurring revenue share | AMC + subscriptions + IoT monitoring ÷ total revenue | quarter | line | P2 |
| E6 | Repeat customers / cohorts | % of revenue from returning customers | cohort year | cohort grid | P2 |

### KPI definitions for an installation/integrator business

| KPI | Definition |
|---|---|
| Quote win rate (count) | Won ÷ (Won + Lost), counted in the period of the decision. A quote more than 30 days past its validity counts as Lost. All revisions of one opportunity count once. |
| Quote win rate (value) | SAR won ÷ SAR decided (won + lost). |
| Average discount % | Σ(list × qty − net) ÷ Σ(list × qty), weighted by value. Also report the simple per-quote mean and the % of quotes that needed approval. |
| Quote turnaround | Median business hours (Sun–Thu shifts) from a request being logged to the first quote being sent. |
| Gross margin by project | (Revenue recognized − direct cost) ÷ revenue recognized. Direct cost = materials at landed cost + labor hours × loaded rate + subcontract + project expenses. Show material margin and labor margin separately. |
| Estimate accuracy | Actual direct cost ÷ quoted cost. Target 0.95–1.05. |
| Backlog value | Signed contract value (including approved change orders) − revenue recognized to date. Backlog months = backlog ÷ average monthly revenue over the trailing 3 months. |
| Book-to-bill | New orders SAR ÷ invoiced SAR in the period. |
| Pipeline coverage | Weighted pipeline closing in the period ÷ remaining target. |
| Lead response time | Median minutes from a first inbound WhatsApp/call to the first human (or approved AI) reply, measured in business hours. |
| Installed devices per technician-day | Devices commissioned (serial captured + tested) ÷ technician-days on installation jobs. Define a technician-day as one technician on site for at least 4 hours. |
| First-time-fix rate | Service jobs resolved on the first visit with no follow-up visit within 30 days ÷ service jobs closed. |
| Repeat-visit rate | New jobs on the same site and system within 30 days of closure ÷ jobs closed. |
| SLA response compliance | Jobs where on-site arrival was within the SLA target (business-hours clock) ÷ jobs under an SLA. |
| Technician utilization | Job hours ÷ available hours (shift − leave − training). Report travel time separately. |
| Job completion compliance | Jobs closed with all mandatory evidence (photos, serials, signature, checklist) ÷ jobs closed. |
| DSO | (Ending AR ÷ credit sales in the period) × days in the period. |
| Collection effectiveness index (CEI) | (Opening AR + credit sales − ending total AR) ÷ (opening AR + credit sales − ending *current* AR) × 100. |
| AR > 60 days % | AR aged over 60 days ÷ total AR. |
| DIO / inventory turnover | DIO = average inventory ÷ COGS × 365. Turnover = COGS ÷ average inventory. |
| Cash conversion cycle | DSO + DIO − DPO. |
| Change-order rate | Approved change-order SAR ÷ original contract SAR. |
| Warranty claim rate | Warranty jobs ÷ devices installed, per brand/model over a 12-month window. Use it when choosing suppliers. |
| Messaging cost per won deal | WhatsApp + SMS spend attributed to opportunities ÷ deals won. |
| Recurring revenue share | (AMC + subscription + monitoring revenue) ÷ total revenue. This is the key metric for becoming an IoT company. |

---

## 4. Leading-edge 2025–2026 innovations worth copying

1. **Zoho CRM Blueprint**: during-transition forms plus SLA escalations that can send WhatsApp or SMS. This is the model for installation stage gates (no "Installed" status without serials, photos and signature).
2. **Salesforce Flow Approval Orchestration** (Spring '25 to Winter '26): staged approvals, screen-flow approval steps, recall and fault paths, and debug mode. Use it as the model for discount, margin and PO approvals.
3. **Odoo 19 AI fields and AI server actions**: fields defined by a prompt that update automatically, and AI that reads attachments and searches the web inside automations. Odoo 19 also turns natural language into search domains.
4. **Dynamics 365 BC Sales Order Agent** reads a customer's inbound request and prepares a quote or order for human approval. Copy it as a **BOQ-to-quote agent**. The **Payables Agent** does the same for vendor invoices.
5. **HubSpot**: a remote MCP server (GA Apr 2026, 3rd-party), and Breeze agents that can call external MCP servers (Spring 2026). MCP runs in both directions.
6. **Salesforce Hosted MCP Servers** (GA Apr 2026) expose Flows and Apex as governed tools, with a central registry, rate limits and access policy.
7. **NetSuite AI Connector Service**: "bring your own assistant" over MCP, limited to the user's role, with a curated prompt library (2026) and MCP Apps that run inside Claude.
8. **Tableau Next** adds agentic analytics skills (Concierge for NLQ, Inspector for proactive monitoring) on top of a governed semantic layer.
9. **Zoho Zia LLM** (Jul 2025) uses small in-house models (1.3B–7B) for private, low-cost tasks. Agent Studio offers 700+ actions and there is an MCP server.
10. **D365 Scheduling Operations Agent** (preview, Sep 2026): the optimizer proposes a schedule and the dispatcher approves it. D365 Finance Agent adds collections and variance skills.
11. **WhatsApp Flows** (structured forms in chat), the **Calling API**, and **usernames/BSUID**, which lets the CRM identify a customer without a phone number.
12. **Gotenberg's Factur-X route** produces a PDF/A-3 hybrid e-invoice in one call. The same pattern works for ZATCA PDF/A-3 with embedded UBL.
13. **n8n's MCP Server Trigger** makes any self-hosted workflow a tool that AI can call. This is a cheap way to give AI assistants governed actions.
14. **Odoo 19 JSON-2 API** uses short-lived, scoped API keys (≤3 months). Follow it as the pattern for your own API security.
15. **Local-first sync (Zero, PowerSync)** gives an instant UI and offline use with server-authoritative mutations. It is the long-term technician-app architecture.

---

## 5. Saudi / Arabic specifics

### WhatsApp Business Platform: rules and pricing timeline
| Date | Change | Implication |
|---|---|---|
| 1 Jul 2025 | Billing changed from per-conversation to **per delivered template message**, priced by category (marketing / utility / authentication) and recipient country. Utility templates sent inside an open 24-h customer-service window (CSW) became free. Free-form service replies stayed free. | Classify templates carefully |
| Since 2024 | Meta caps how many **marketing** templates one user receives across *all* businesses (exact cap not published). Utility, authentication and service messages are not capped. | Don't depend on marketing templates for operational messages |
| 1 Apr 2026 | Saudi marketing rate increased. Approximate SA rates: marketing SAR 0.1877; utility and authentication SAR 0.0401 (3rd-party; verify against Meta's rate card). OTPs sent across borders use "authentication-international" rates. | A quote-follow-up campaign costs about 4.7× a utility notification |
| Apr–Jun 2026 | **BSUID** (business-scoped user ID) appears in webhooks. **Usernames** roll out from Jun 2026, so users can message a business without revealing their phone number. | Contact key = phone **or** BSUID |
| **1 Oct 2026** (6 days after this report) | **Service messages** are charged at the utility rate after **1,000 free per business phone number per month**. **Utility templates inside the CSW are charged again.** The 72-h free-entry-point window (from click-to-WhatsApp ads or Page CTAs) stays free. | Build a cost ledger; watch volume per number |

Other rules: businesses need opt-in before sending business-initiated messages (Meta policy). Meta can re-categorize a template it judges misclassified, so keep utility templates purely transactional. A local BSP (Unifonic/Taqnyat/Msegat) gives Arabic support and SAR invoicing, but adds a platform fee on top of Meta's rates. Going direct to the Cloud API avoids the markup but needs your own inbox and UI.

### SMS sender IDs (CST, formerly CITC)
- Sender names must be **pre-registered** and are typed as transactional or promotional. **Promotional sender IDs must end in "-AD"**, which leaves at most 8 characters before the suffix. For example, "MOTQINON" (8 characters) for transactional traffic and "MOTQINON-AD" for promotional.
- **Promotional SMS may only be sent 08:00–22:00 KSA time.**
- Sender names cannot be numeric-only or in Arabic characters. Allowed specials are `- _ . , &` and space, but not at the start or end.
- Unifonic's docs say **Mobily blocks promotional (-AD) sender IDs** (the date is not stated; verify it still applies).
- Registration needs company documents (CR, a letter of authorization, sample content, expected volume; exact list unverified). An international aggregator quotes 50–60 business days; local providers are typically faster (unverified).
- The governing framework is the CITC/CST "Regulations for Curbing Spam Messages and Calls" (v3, Oct 2022).

### Hijri, digits, calendars
- `new Intl.DateTimeFormat('ar-SA')` **defaults to the Umm al-Qura Hijri calendar**, and may output Arabic-Indic digits. This is a classic bug in otherwise Gregorian documents. Always pin both: `ar-SA-u-ca-gregory-nu-latn` for the main date, and `ar-SA-u-ca-islamic-umalqura` for a secondary Hijri date.
- Use `islamic-umalqura`, not `islamic` or `islamic-civil`, which can be off by 1–2 days. ICU's Umm al-Qura table covers AH 1300–1600 and falls back to the arithmetic calendar outside that range (general knowledge).
- The Saudi **weekend is Fri–Sat** (since 2013) and the **work week is Sun–Thu**. Keep your own company calendar rather than relying on `Intl.Locale#getWeekInfo()`, because engine support and CLDR first-day data vary. The calendar must include Ramadan working hours (the Labor Law caps Muslim workers at 6 h/day), Eid holidays (announced by Hijri date), Founding Day (22 Feb) and National Day (23 Sep). SLA clocks, quote validity and due dates all depend on it.

### Arabic PDF pitfalls
1. **Shaping:** lightweight PDF libraries break Arabic; ReportLab only added a first shaping/RTL attempt in 4.4.0 (Apr 2025). Render with Chromium (or Typst).
2. **Searchability:** a 3rd-party test found that headless Chrome embeds **presentation forms** for most Arabic fonts. The PDF looks right, but copy/search/extraction fails, and some fonts reverse the lam-alef ligature. Test your chosen font. Keep the UBL XML as the machine-readable source of truth.
3. **Fonts:** self-host and embed one family that covers Arabic, Latin, both digit sets and U+20C1. Never fetch fonts over the network inside the PDF service.
4. **Bidi:** isolate model numbers, phone numbers, emails, IBANs and percentages with `<bdi>` or `dir="ltr"` spans. Check negative amounts and the position of the currency sign.
5. **Tables:** use `thead{display:table-header-group}` so headers repeat, `break-inside:avoid` on rows, and mirrored column order. Chromium header/footer templates don't load external resources, so inline logos and fonts as base64.
6. **Tafqit:** apply gender agreement and the 3–10 counted-noun rules, and the ريال/ريالان/ريالات/ريالاً forms. Follow the "فقط … لا غير" convention and spell halalas separately.
7. **ZATCA Phase 2 (Integration):** invoices must be UBL 2.1 XML, or PDF/A-3 with embedded XML. They need a cryptographic stamp, a UUID and a QR code (9 TLV tags). B2B invoices are **cleared** in real time; B2C invoices are **reported within 24 h**. Taxpayers are onboarded in revenue-based waves with at least 6 months' notice. Gotenberg can produce PDF/A-3b with an XML attachment (`AFRelationship`). The required PDF/A-3 conformance level for ZATCA was not confirmed (unverified).

---

## 6. Recommended MVP scope and what to defer

**MVP (P0), sized for a small team to build on one Postgres backend:**
- **Foundation:** roles and permissions (row-level for reps and technicians), a field-level audit log, a company work calendar (Sun–Thu, holidays), bilingual master data, and an API-first design with idempotent inbound webhooks.
- **Workflow:** state machines for Quote (with revisions), Order, Project, Job and Invoice. Discount and margin approvals (one or two levels). Time-based rules for quote expiry, invoice due and visit reminders. A **stage gate** on job completion (checklist, photos, serials, signature). A log of every automation run.
- **Messaging:** WhatsApp Cloud API (direct, or a local BSP if you want support) with 6–8 **utility** templates: quote sent (PDF), visit scheduled, technician en route, job completed + service report, invoice issued, payment reminder, payment received. Inbound webhook → contact/lead matching by phone and BSUID; everything logged on the timeline; an opt-in registry; transactional email (SES or Postmark) with SPF/DKIM/DMARC. **Plan for the 1 Oct 2026 service-message charging** by tracking message counts and cost per phone number.
- **Documents:** a Chromium PDF service (Playwright or Gotenberg) with bilingual templates for quote, proforma, delivery note, service report, tax invoice with ZATCA QR, and statement of account. Tafqit, revision numbering and watermarks.
- **Localization:** RTL-first logical CSS; ar/en per user and per document; explicit locale pinning (`-u-ca-gregory-nu-latn`), with Hijri as a secondary display.
- **Field PWA:** job list, checklists, photo upload queue, serial scanning, signature capture. Online-first, with an IndexedDB outbox for photos and drafts.
- **Reports:** all P0 rows in §3 (about 30), starting with the CEO cockpit, pipeline, the quotation register/win rate/discount/margin set, AR aging, project GM and backlog. Built as SQL views with in-app RTL charts and XLSX export.
- **Import:** CSV/XLSX importers for customers, products, price lists and the quotation app's historical data.

**Next (P1):** SLA escalations, approvals from WhatsApp, the shared inbox, WhatsApp Flows, KSA SMS sender (transactional + OTP), PDF/A-3 + Fatoora integration (move to P0 when your wave is notified), online quote acceptance, a public REST API + webhooks, a **read-only MCP server** (role-scoped), **BOQ-to-quote** and **vendor-bill OCR** agents that always stop at human approval, natural-language filters, voice-note visit summaries, offline read cache, and scheduled report delivery.

**Defer (P2):** a general BI tool (Metabase or Superset only for internal English ad-hoc analysis, given their weak RTL), a visual flow builder (use self-hosted n8n), Temporal, a full bidirectional sync engine (PowerSync or Zero only if the outbox fails in the field), native apps (only for BLE/NFC lock provisioning), WhatsApp AI auto-reply agents and Calling, promotional "-AD" SMS, anomaly detection, cash-flow forecasting, collections agents, schedule optimization, and customer-portal analytics.

**Design now so the deferred items stay cheap:** use UUID primary keys and idempotent command-style mutations (sync-ready), a documented metrics layer (NLQ-ready and MCP-ready), an event log (webhooks and AI), and store the channel identity separately from the phone number (BSUID).

---

## 7. Sources (consulted 2026-09-25)

Official pages marked * were read through search-result extracts because direct fetches were blocked.

**WhatsApp / messaging**
- https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/ *
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing *
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/ *
- https://developers.facebook.com/docs/whatsapp/messaging-limits/ *
- https://developers.facebook.com/documentation/business-messaging/whatsapp/calling *
- https://help.twilio.com/articles/30304057900699-Notice-Changes-to-WhatsApp-s-Pricing-July-2025
- https://www.twilio.com/en-us/changelog/whatsapp-usernames--new-business-scoped-user-id--bsuid--field-re
- https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/
- https://sendpulse.com/blog/whatsapp-service-message-pricing
- https://respond.io/blog/whatsapp-pricing-change-2026
- https://quali-d.com/blog/whatsapp-api-pricing-saudi-arabia
- https://whautomate.com/whatsapp-business-api-pricing-saudi-arabia
- https://gmcsco.com/whatsapp-business-api-pricing-billing-ksa-uae-2026/
- https://docs.unifonic.com/docs/ksa-sender-id-registration-requirmnets *
- https://help.clicksend.com/en/articles/43566-saudi-arabia-966
- https://www.stc.com.sa/content/dam/corporatesite/common/business/pdf/RegulationsforCurbingSPAMMessagesCallspdfEN.pdf
- https://taqnyat.sa/en/channels/WhatsApp-Business-API-service-provider/
- https://www.unifonic.com/en/channels/whatsapp
- https://whatsloop.net/en/blog/best-whatsapp-business-platforms-saudi-2026

**BI**
- https://help.tableau.com/current/tableau-next/en-us/tableau_next_overview.htm
- https://www.zoho.com/analytics/help/zia/
- https://www.odoo.com/odoo-19-release-notes *
- https://www.odoo.com/odoo-19-4-release-notes *
- https://www.odoo.com/documentation/19.0/applications/productivity/spreadsheet/work_with_data/global_filters.html *
- https://community.fabric.microsoft.com/t5/Service/Request-for-RTL-Support-When-Embedding-Reports-in-Arabic-for-GCC/m-p/4367113
- https://beyondtheanalytics.com/blog/arabic-power-bi-dashboards-rtl-localization
- https://www.metabase.com/docs/latest/configuring-metabase/localization
- https://github.com/metabase/metabase/issues/24954
- https://github.com/apache/superset/issues/25258
- https://blog.mediaposte-martech.com/en/mediaposte-martech-hubspot-feature-updates/create-report-with-ai-option-in-reporting

**Workflow**
- https://www.salesforceben.com/salesforce-spring-25-release-new-flow-approval-process-capabilities/
- https://www.zoho.com/crm/developer/docs/api/v8/blueprints.html
- https://help.zoho.com/portal/en/kb/crm/process-management/blueprint/articles/execute-blueprint
- https://knowledge.hubspot.com/workflows/use-ai-assistants-in-workflows
- https://docs.n8n.io/sustainable-use-license/
- https://docs.n8n.io/deploy/host-n8n/community-edition-features
- https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp
- https://toolradar.com/blog/n8n-pricing-2026

**Documents / localization**
- https://gotenberg.dev/docs/manipulate-pdfs/attachments
- https://gotenberg.dev/docs/manipulate-pdfs/factur-x
- https://gotenberg.dev/docs/convert-with-chromium/convert-html-to-pdf
- https://typst.app/docs/reference/text/text/
- https://docs.reportlab.com/rl-arabic/
- https://dev.to/support_confileo_ce7442eb/i-printed-arabic-to-pdf-with-13-fonts-only-one-produced-text-you-can-search-4he0 *
- https://www.w3.org/International/alreq/
- https://github.com/tc39/proposal-intl-locale-info
- https://medium.com/@ahmelq/date-in-javascript-a-deep-dive-into-arabic-and-hijri-calendars-localization-c632e89b79a2
- https://github.com/MohsenAlyafei/tafqit
- https://github.com/cc1a2b/arabicfmt
- https://github.com/mahmoudQq2023/arabic-tafqeet
- https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf
- https://out2sol.global/blog/zatca-e-invoicing-phase-2-integration-explained/

**Mobile / offline / integrations**
- https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026
- https://kanopylabs.com/blog/electric-sql-vs-powersync-vs-livestore-local-first
- https://procedure.tech/blogs/react-native-offline-first/
- https://github.com/LASTRADA-Software/morph/issues/203
- https://www.odoo.com/documentation/19.0/developer/reference/external_api.html *
- https://github.com/n8n-io/n8n/issues/21545
- https://github.com/ivnvxd/mcp-server-odoo/issues/134

**AI / MCP**
- https://www.odoo.com/documentation/19.0/applications/productivity/ai/support_operations.html *
- https://www.zoho.com/news/zoho-launches-zia-llm-and-deepens-ai-portfolio-with-prebuilt-agents-custom-agent-builder-mcp-and-marketplace.html?zwcDate=july+17,+2025
- https://www.hubspot.com/company-news/spring-2025-spotlight-breeze-agents
- https://pipeline.zoominfo.com/sales/hubspot-breeze-mcp
- https://developer.salesforce.com/blogs/2025/06/introducing-mcp-support-across-salesforce
- https://developer.salesforce.com/blogs/2026/04/salesforce-hosted-mcp-servers-are-now-generally-available
- https://www.netsuite.com/portal/products/artificial-intelligence-ai/mcp-server.shtml
- https://www.itpro.com/software/netsuite-announces-new-mcp-apps-for-ai-connector-service-allowing-users-to-access-financial-data-directly-within-claude
- https://www.brokenrubik.com/blog/netsuite-ai-guide
- https://www.microsoft.com/en-us/dynamics-365/blog/business-leader/2026/09/23/build-the-future-of-agentic-erp-with-new-microsoft-dynamics-365-capabilities/ (fetched directly)
- https://erpsoftwareblog.com/2026/08/dynamics-365-business-central-ai-agents-mcp-guide/
- https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/copilot/copilot-mcp
- https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/prebuilt?view=doc-intel-4.0.0
- https://blog.modelcontextprotocol.io/posts/2025-12-09-mcp-joins-agentic-ai-foundation/
- https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
