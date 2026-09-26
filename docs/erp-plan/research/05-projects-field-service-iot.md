# Benchmark: Project Execution, Field Service, Service Contracts, Helpdesk & IoT-Connected Service
*For Motqinon Tech Trading Co. (شركة متقنون تك للتجارة). Research date: 2026-09-25.*

**How this was researched.** I ran about 35 searches and fetches. The sandbox proxy blocked direct fetches of most vendor sites, so vendor facts come from search-engine extracts of the official pages listed in §7. I read the Microsoft Dynamics 365 and ThingsBoard docs in full through their GitHub mirrors. "(unverified)" means I could not confirm the item from a source in this session.

**Table abbreviations:** PC = Procore · MON = monday.com · ASA = Asana · CU = ClickUp · MSP = MS Project/Planner · SS = Smartsheet · ODO = Odoo · ZP = Zoho Projects · ST = ServiceTitan · SIM = simPRO · JOB = Jobber · HCP = Housecall Pro · SF = Salesforce Field Service · D365 = Dynamics 365 Field Service (CFS = Connected Field Service) · ZF = Zoho FSM · DT = D-Tools Cloud · ZD = Zendesk · FD = Freshdesk · ZDk = Zoho Desk · TB = ThingsBoard.

---

## 1. Apps benchmarked

| App | Positioning / why it's a leader | Notable strengths |
|---|---|---|
| Procore | The leading construction-management platform | RFIs, submittals, drawings (versions and markup), daily log, punch list, inspections, budget and change events. **Helix** agents for daily logs, RFIs, submittal review and deep search: 150+ actions, human approval |
| monday.com WM | No-code boards with a broad SMB and mid-market base | Kanban, Gantt, calendar and workload views; automations. monday agents, magic, vibe and sidekick (2025) |
| Asana | Cross-functional work management | Timelines, portfolios, rules. **AI Studio** builds agents without code; Basic tier auto-provisioned since Jun 2025 |
| ClickUp | All-in-one tasks, docs and time | Dependencies, Gantt, time tracking, Super Agents; Brain 2 (Jun 2026) |
| MS Project / Planner | The default in Microsoft 365 shops | Project for the web retired from Aug 2025 → **Planner Premium** (Gantt, lead/lag, baselines, Copilot PM agent in preview). Desktop Project remains the critical-path reference. Project Online is also retiring |
| Smartsheet | Grid-based project and portfolio management for enterprises | Critical path, baselines, templated roll-out through Control Center, resource management; Smart Agents (2025) |
| Odoo Project/Timesheets (+FS/Planning) | Open-core ERP where projects link natively to sales, stock and accounting | Sales order → project/tasks, **milestone invoicing**, timesheet costing. v19: FS tasks created from sales orders, GPS stamp on the timer, task templates |
| Zoho Projects | Low-cost project management in Zoho One | Gantt, timesheets, issues, client users; linked to Zoho CRM, Books, Desk and FSM |
| ServiceTitan | The top trades FSM (10k+ contractors) | Dispatch board, memberships, pricebook. **Dispatch Pro** assigns jobs with AI and re-optimizes every 10 minutes. **Atlas** AI (2025) handles natural-language dispatch and reports and drafts daily logs, RFIs and change orders |
| simPRO | FSM plus projects for electrical, security and fire integrators | Quote → job, job costing, asset register with test readings and defects, **Maintenance Planner**, customer portal that shows assets |
| Jobber | Leader for SMB home-service firms | Client Hub, "on my way" texts, route optimization (Oct 2025), **AI Receptionist** (Aug 2025) |
| Housecall Pro | SMB home-service software | Booking, customer texts, CSR AI (fall 2025). No route optimization |
| Salesforce FS | Enterprise FSM built on Service Cloud | Scheduling optimization, maintenance plans, entitlements with milestones, offline mobile. **Agentforce for FS**: scheduling GA May 2025, troubleshooting Jun 2025, job wrap-up |
| Dynamics 365 FS + CFS | Enterprise FSM and the reference IoT pattern | Incident types, schedule board with RSO, **functional locations**, asset hierarchy, **agreements**. CFS turns an alert into a case and then a work order, aggregates alerts and sends device commands. Copilot |
| Zoho FSM | Mid-market FSM | Dispatch console (Gantt, grid and calendar views, live location, skills), maintenance plans, assets |
| Odoo Field Service | Field service inside the ERP | Map, Planning Gantt, worksheets, signature, stock deduction. Reportedly merging into Planning in 19.x (unverified) |
| D-Tools Cloud | Built specifically for AV, security and low-voltage integrators | Catalog-driven proposals with client approval and deposits, Gantt, change orders, job costing, service calls and **service plans**. 2025 added AI, a native mobile app and Interconnect diagrams |
| Zendesk | The helpdesk benchmark | SLA policies, macros, WhatsApp. **Resolution Platform** AI agents (early access May 2025), Knowledge Builder |
| Freshdesk (Omni) | Value-priced helpdesk | Freddy AI Agent on WhatsApp, Copilot ($29 per agent per month), SLA management, intelligent assignment, sentiment detection |
| Zoho Desk | Low-cost helpdesk with a strong KSA partner base | Zia supports **Arabic**; help center in 40+ languages; Zia agents |
| ThingsBoard | The leading open-source IoT platform | Alarms (5 severities, propagation up the tree), rule engine with a REST API call node, device profiles, OTA, per-customer dashboards. 4.2 added an AI node; 4.3 added Alarm Rules 2.0 and API keys |
| CFS pattern (Azure/AWS IoT) | Reference architecture for turning IoT data into service work | IoT Hub → Stream Analytics (threshold rules) → Service Bus → Logic App → IoT alert → case/work order. Commands such as reboot flow back to devices |

---

## 2. Feature inventory
**Priority key:** P0 = MVP must-have · P1 = second wave · P2 = later or a differentiator.

### 2.1 Project initiation & structure
| Feature | What it does | Seen in | Priority | Notes (Saudi / integrator / IoT) |
|---|---|---|---|---|
| Project from won quote/contract | Confirming a quote or sales order creates the project, tasks, BOQ and budget | ODO (v19), DT, SIM, ST | P0 | Carry over the BOQ per unit, the 50/40/10 terms and contract clauses |
| Project templates by type | Preset phases, tasks, checklists, roles and durations | ODO (task templates with roles), SS (Control Center), MON, ASA | P0 | Templates: villa intercom, building intercom, smart home, smart lock, LoRaWAN |
| Stages & stage gates | Stage pipeline where a gate blocks progress until its criteria are met | Stages in all apps; gates built with automations (MON, ASA, ODO) | P0 | Gates: advance paid + signed approvals → procurement; 40% paid → delivery; programming done → 10% invoice |
| Contractual delivery clock | Counts 45–60 working days from the later of advance receipt and written approval | None natively; must be built | P0 | Needs a KSA business calendar. Provides evidence in delay disputes |
| Status & portfolio dashboards | % complete, overdue items, RAG status, cash position, roll-up across projects | ASA (portfolios), SS, MON, MSP | P1 | By PM and city (Makkah/Jeddah). Weekly WhatsApp status |

### 2.2 Planning & views
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| WBS: tasks/subtasks/checklists | Hierarchical breakdown of the work | All | P0 | Generate tasks per building and floor from the unit list |
| Dependencies with lead/lag | Finish-to-start and similar links that reschedule automatically | MSP (Planner Premium), SS, CU, MON, ZP | P1 | Cabling → mounting → programming |
| Gantt / timeline | Visual schedule | MSP, SS, MON, CU, ZP, ODO, DT | P1 | A simple timeline is enough for the MVP |
| Critical path | Highlights the chain of tasks with zero float | MSP desktop, SS, CU, ZP (unverified) | P2 | Only worth it for towers |
| Baselines | Snapshot of the plan to compare against actuals | MSP (Planner Premium), SS | P2 | Evidence when client approvals slip |
| Milestones | Key dates and deliverables | All; ODO ties them to invoicing | P0 | Approval, delivery, installation, programming, handover |
| Kanban / list / calendar | The same data shown in several views | All | P0 | Kanban by stage; calendar for site visits |
| Workload / capacity | Hours per technician or team against availability | MON, ASA, SS, CU, ODO (Planning) | P1 | Installers and programmers are separate pools |
| Automation rules | A trigger fires an action | MON, ASA, CU, ODO | P1 | "Approval signed" → purchase request; "punch list closed" → 10% invoice |

### 2.3 Project financials
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Milestone billing | Releases an invoice when its milestone is met | ODO ("based on milestones"), PC (owner invoices), DT (deposit at approval), SIM (progress invoicing, unverified) | P0 | 50/40/10, each a ZATCA e-invoice. Block delivery until the 40% is paid |
| Budget by cost type | Materials, labor, subcontract and expenses | PC (budget, commitments), SIM, DT (job costing), ODO (analytic accounts) | P1 | Seed it from the quotation BOQ costs |
| Budget vs actual + forecast | Variance and estimate at completion | PC, SIM, DT, ODO (profitability panel) | P1 | |
| Timesheets & labor costing | Hours × cost rate posted to the project or work order | ODO, CU, ZP, DT, ST | P0 (capture) | Costing can wait for P1 |
| Profitability & WIP | Margin, and earned vs billed | PC (forecasting), SIM, ST (WIP unverified) | P2 | Needs the accounting module |
| Change orders / variations | Scope + price + time impact, signed by the client | PC (change events; agents create them), DT, SIM, ST (Atlas drafts them) | P0 | Room additions or door-direction changes after approval. Extends the delivery clock |
| Project purchasing link | Purchase requests, POs and receipts tagged to the project | PC (commitments), SIM, ODO | P1 | Procurement is the biggest risk to the delivery date |

### 2.4 Site execution & documents
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Site-survey digital forms | Structured capture per door and per unit | ODO (worksheets), SIM (forms), D365 (inspections), SF (work steps) | P0 | Door hand/direction, lock type, cable route, monitor and PoE/rack positions, measurements |
| Photos/video with GPS, time & markup | Evidence attached to a task or asset | PC, ST, JOB, ODO | P0 | Before/after photos at every door |
| Daily site log | Manpower, work done, delays, photos | PC (Daily Log, AI-drafted), ST (Atlas auto-filled logs) | P1 | Consultants often ask for these |
| Punch/snag list | Each item has a location, photo, assignee and due date, and is verified before closing | PC (Punch List with AI capture) | P0 | Gate for handover and the final 10% |
| QA / commissioning test sheets | Test results recorded per device | SIM (test readings), PC (inspections), D365 (inspections) | P0 | Call, video, unlock, face enrolment, fire-alarm release |
| Drawings/docs with versions & markup | Revisions, redlines and the current set | PC (Drawings), DT (Interconnect diagrams, 2025) | P1 | Riser diagrams, IP plans, as-builts |
| Submittals / material approvals | Package → reviewer → status code → resubmit | PC (Submittals; AI checks them against the spec) | P1 | KSA consultants expect material approval requests (MAR) |
| RFIs, inspection requests & correspondence registers | Formal questions, requests for consultant inspection (IR/WIR), letters and site instructions | PC (RFI agent, Inspections, Correspondence), ST (Atlas RFIs) | P2 | P1 for buildings led by a consultant |

### 2.5 Client collaboration & handover
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Client approval capture | Versioned approval packages with e-signature that lock the spec | DT (proposal approval), ODO (Sign), PC (submittal workflow) | P0 | Written approval of specs, door directions, room numbers and design starts the delivery clock |
| Client portal | Progress, approvals, documents, invoices and assets | SIM (quotes, jobs, invoices, assets, defects), JOB (Client Hub), DT | P1 | In the MVP, tokenised share links sent by WhatsApp |
| Handover package generator | As-builts, device schedule, manuals, warranties, training and acceptance | No benchmarked app does this end to end (partial: PC punch/closeout, DT diagrams) | P0 | **Differentiator.** Bilingual PDF plus a digital asset list |
| Credentials vault | Encrypted device/admin credentials, revealed only to authorised roles, with an audit trail | Missing from the benchmarked FSMs (gap) | P1 | Never print credentials in the handover PDF. The client rotates them at handover |
| Training & acceptance sign-off | Attendee list and a signed acceptance certificate | ODO (Sign); SF/D365/JOB (signed reports) | P0 | The acceptance date becomes the warranty start |
| Warranty registration per device | Creates warranty records automatically at acceptance | SIM, ZF, D365, DT (assets) | P0 | Track the 2-year installation warranty separately from the manufacturer warranty |

### 2.6 Work orders, scheduling & dispatch
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Work order types | Survey, installation, commissioning, corrective, preventive, warranty, inspection | D365 (WO types), SF (work types), ST (job types) | P0 | The type drives the checklist, billing and SLA |
| Job/incident templates | Default tasks, duration, skills and parts for each job type | D365 (incident types), SF (work types/plans) | P1 | e.g. "indoor monitor swap", "face-DB re-enrolment" |
| Dispatch board (drag-and-drop) | One lane per technician over time, plus an unscheduled queue | ST, D365 (schedule board), ZF, SF, ODO (Planning) | P0 | |
| Multi-day crew bookings | Reserves a team across several days | ST (week-ahead view, project tracking), ODO, D365 | P0 | Installation crew + programmer |
| Map & live technician location | Jobs and technicians on one map | ZF, SF, D365, ST | P1 | Jeddah/Makkah traffic |
| Skills/certification matching | Offers only qualified technicians | SF, D365, ZF, ST (Dispatch Pro) | P1 | Vendor brand certificates, fire-alarm interface, LoRaWAN |
| Route optimization | Best order for the day's visits | JOB (Oct 2025), SF, D365 (RSO); not in HCP | P2 | Little value while job density is low |
| AI auto-scheduling | Keeps re-optimizing the schedule | ST (Dispatch Pro), SF (Agentforce, GA May 2025) | P2 | |
| Arrival windows / promised times | Time windows promised to the customer, tracked against SLA | SF, D365, JOB | P1 | Must respect prayer and midday-heat windows (§4) |
| Recurring work orders from contracts | Generates preventive visits ahead of their due date | D365 (booking setups), ZF (maintenance plans), SIM (Maintenance Planner), ST (recurring services), SF (maintenance plans) | P1 | AMC visits per building |

### 2.7 Technician mobile app
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Offline-first | Works without signal and syncs later | SF, D365 (offline profiles) | P1 | Basements, risers and new towers without Internet |
| Job list & one-tap navigation | Today's jobs with details and maps | All; D365 Copilot mobile | P0 | |
| Check-in/out with GPS stamp | Records time and location at start and stop | ODO (v19 GPS on timer) | P0 | |
| Geofence validation | Flags check-ins made outside the site radius | D365 (unverified) | P1 | |
| Dynamic checklists/forms | Mandatory steps, readings and photos | ODO (worksheets), SIM (service-level checklists), D365, SF | P0 | Arabic labels |
| Photo/video/voice notes | Evidence and notes from the field | All; D365 Copilot voice-to-text | P0 | Arabic voice-to-text is P2 |
| Signature & service report | Signed report PDF | ODO (option to hide prices, v19), SF, D365, JOB | P0 | Bilingual, sent via WhatsApp |
| Parts used + barcode/serial scan | Consumes van stock and captures serials | ODO (automatic stock deduction), D365, SF | P0 | Serial/MAC scans feed the installed base |
| On-site asset registration | Creates a device and binds it to its unit with MAC, IP and firmware | SIM (register new assets in the app) | P0 | Core of the installed base |
| On-site follow-up quote | Builds and signs an upsell quote on site | ST, JOB, HCP, SIM | P1 | Extra monitors, smart locks |
| Auto timesheet from work order | Posts travel and work time automatically | ODO, DT, ST | P0 | |
| AI troubleshooting & wrap-up | Guided fixes and automatic job summary | SF (Agentforce, Jun 2025), ST (Atlas mobile), D365 (Copilot) | P2 | Train it on the Arabic KB and vendor manuals |
| Arabic RTL UI & bilingual output | Arabic-first screens and PDFs | ODO, ZDk; the US FSMs don't advertise Arabic (unverified) | P0 | Hard requirement |

### 2.8 Service contracts, AMC & warranty
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| AMC / service agreement | Coverage, term, tier, visits and price | D365 (agreements), SF (service contracts), ST (memberships), DT (service plans), SIM | P1 | Sell it at handover, when the warranty starts |
| Preventive-visit generation | Recurrence + lead time + pre-booking | D365, ZF, SIM, SF | P1 | Quarterly or semi-annual checks |
| Recurring contract billing | Invoices on a schedule, independent of visits | D365 (invoice setups), ST, DT | P1 | ZATCA e-invoices |
| Entitlement/coverage check | Decides warranty, AMC or chargeable when a ticket or work order is opened | SF (entitlements), D365 (entitlements drive pricing) | P0 | Stops free work on out-of-warranty devices |
| SLA tiers per contract | Response and resolution targets | SF (milestones), ZD, FD, ZDk | P1 | Business-hours vs 24/7 tiers |
| Renewals | Reminders, auto-renewal, price uplift | D365, ST | P1 | |
| Contract profitability tuning | Service levels, charge rates, inflation, site overrides | SIM (Maintenance Planner) | P2 | |
| RMA / vendor claims | Fault → vendor return → replacement, swapping the serial | SF (return orders), ODO (Repairs), DT (repair/replacement) | P1 | Vendor warranty tracked separately from Motqinon's |
| 10-year spare-parts obligation | Installed models compared with spare stock and end-of-life status | None (gap) | P2 | Contract clause; alerts when a model nears end of life |

### 2.9 Installed base (asset registry)
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Location hierarchy | Typed tree of any depth: site → building → floor → unit | D365 (functional locations: "Campus → Building → Floor"), TB (asset relations) | P0 | Apartment numbers are the intercom directory |
| Asset hierarchy | Parent/child devices; children inherit the parent's location | D365, SF | P0 | Door panel → lock → exit button |
| Technical attributes | Serial, MAC, IP/VLAN, firmware, SIP extension, dates | SIM (asset database), ZF, D365 (asset properties by type) | P0 | Attribute templates per device type |
| Asset service timeline | Every work order, ticket, part and reading for the device | All FSMs | P0 | |
| Test readings & defects | Recorded tests and open defects per asset | SIM (defect and test-history reports) | P1 | |
| Bulk import/export | Excel device schedules in and out | Common | P0 | Towers have hundreds of devices |
| QR label per device/unit | Scan to open the asset page or report a fault | (unverified in these apps) | P1 | Resident scans → WhatsApp ticket pre-filled with the unit |

### 2.10 Customer communication & feedback
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Confirmations, reminders & "on the way" + ETA | Automatic appointment messages and a departure alert | JOB, HCP, SF (Appointment Assistant) | P1 | WhatsApp template with the technician's name and photo |
| CSAT/NPS | Survey after a job or ticket | ZD, FD, ZDk, ODO (ratings) | P1 | One-tap WhatsApp survey |
| Service-report delivery | Sends the report PDF by email or WhatsApp | ODO, JOB | P0 | |

### 2.11 Helpdesk
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Omnichannel inbox | Turns WhatsApp, email, phone and web messages into tickets | ZD, FD, ZDk | P0 (WhatsApp + phone + web) | WhatsApp dominates in KSA |
| Ticket → work order | Escalates to a field visit and keeps the links | D365 (case → WO), SF, ZDk + ZF | P0 | |
| Caller → customer/unit match | Identifies the caller by phone number or unit | JOB (AI Receptionist matches caller ID) | P0 | Links resident phone numbers to units |
| SLA policies & escalations | Business-hour clocks and breach alerts | ZD, FD (plus Insights), ZDk | P1 | Calendar must include Ramadan hours |
| Macros / canned replies | One-click replies and actions | ZD (works on WhatsApp tickets), FD, ZDk | P1 | Arabic templates |
| Knowledge base (Arabic) | Public and internal articles | ZDk (40+ languages), ZD (Knowledge Builder, early access May 2025) | P1 | How-to videos for residents |
| Routing & automations | Assignment rules and round-robin | ZD, FD (intelligent assignment), ZDk | P1 | |
| First-line AI agent | Resolves FAQs and collects details | ZD AI agents, FD Freddy (WhatsApp), ZDk Zia (Arabic) | P2 | Test quality on Saudi dialect |
| Agent copilot | Summaries, draft replies, sentiment | FD Copilot, ZD | P2 | |
| AI phone receptionist | Answers calls and books visits 24/7 | JOB (Aug 2025), ST (booking agents) | P2 | |

### 2.12 IoT-connected service
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Device ↔ asset binding | Links the IoT device ID to the ERP asset | D365 CFS | P1 | TB device name = serial/MAC |
| Alarm → ticket/work order | Opens a ticket automatically, then a work order | D365 CFS (alert → case → WO), TB (alarm + REST API call node) | P1 | P0 for the IoT product line |
| Alert aggregation/dedup | Groups repeated alerts under a parent | D365 CFS (5-minute window, keyed on device ID), TB (one active alarm per type and originator) | P1 | Prevents floods of tickets |
| Alarm state sync | Acknowledge/clear is mirrored in both systems | TB (active/cleared × acknowledged/unacknowledged) | P1 | Closing the ticket acks or clears the alarm through a TB API key (4.3) |
| Offline/heartbeat detection | Raises an alarm when a device stops reporting | TB (inactivity timeout) | P1 | Intercoms polled by ping/SNMP through the TB IoT Gateway |
| Remote commands | Reboot, configure, test | D365 CFS (commands via IoT Hub), TB (RPC) | P2 | Saves site visits |
| OTA firmware campaigns | Assigns firmware per profile or device and tracks it | TB (per-device override), AWS IoT Jobs | P2 | Intercom firmware often goes through the vendor's cloud (unverified) |
| Per-site health dashboard | Device status for each customer | TB (customer dashboards) | P1 | Embed it in the client portal |
| Uptime-based SLAs | Availability % per site or device | TB calculated-field aggregation (4.3) → ERP | P2 | A new AMC tier |
| Predictive / AI triage | Detects trends; an LLM explains them | D365 CFS (Stream Analytics + SQL), TB AI Request node (4.2) | P2 | Battery, lock cycle counts, PoE power draw |

### 2.13 Analytics & AI assistants
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Service KPIs | First-time fix rate, MTTR, SLA %, utilization, callbacks | ST, D365, SF | P1 | |
| Conversational ops assistant | Natural-language queries and actions | ST Atlas, SF Agentforce, D365 Copilot, MON sidekick | P2 | Arabic prompts |
| AI project-risk agent | Flags slippage and risks | SS (PM Smart Agent), MSP (Project Manager agent, preview) | P2 | |
| AI document drafting | Daily logs, RFIs, submittal checks | PC Helix, ST Atlas | P2 | |

*(101 feature rows.)*

---

## 3. Leading-edge 2025–2026 innovations worth copying

1. **Agentic scheduling.** Salesforce **Agentforce for Field Service**: the scheduling agent reached GA in May 2025. It re-plans for skills, traffic, SLA and urgency, reshuffles when jobs are cancelled or run long, and takes natural-language commands from dispatchers and voice from technicians. ServiceTitan **Dispatch Pro** weighs skill, proximity, customer history and *expected revenue* and re-evaluates every 10 minutes. *Copy:* start with an explainable "top-3 technicians" suggestion.
2. **AI wrap-up and onsite troubleshooting.** Salesforce job summaries (GA) and troubleshooting (June 2025). D365 Copilot mobile adds voice-to-text, next-job navigation and photos. ServiceTitan Atlas runs in its mobile app. *Copy:* generate the Arabic service-report narrative from the checklist and photos.
3. **Document agents with a human approving each output.** Procore **Helix** agents draft daily logs, check RFI quality, compare submittals with specs and search across drawings and specs, with 150+ actions and human approval. *Copy:* AI drafts the daily log and checks submittals against the approved BOQ; the engineer approves.
4. **Revenue-aware operations.** ServiceTitan Atlas throttles marketing when the schedule is full (Pantheon 2025 / Fall 2025 release ST-75).
5. **AI front door.** Jobber **AI Receptionist** (Aug 2025, caller-ID match, books visits), Zendesk **Resolution Platform** agents (several intents per message across messaging, email and voice; early access May 2025), Freshdesk **Freddy** on WhatsApp, and Zoho **Zia** with Arabic. *Copy:* a WhatsApp bot that goes phone → unit → device → entitlement, collects a photo, and opens a ticket.
6. **Self-building knowledge.** Zendesk **Knowledge Builder** drafts KB articles from past tickets. A fast way to build an Arabic KB.
7. **No-code agents in work management.** monday agents (2025), Asana AI Studio (Jun 2025), ClickUp Super Agents and Brain 2 (Jun 2026), Smartsheet Smart Agents, and the Planner Project Manager agent (preview). *Copy:* a "project watchdog" that flags late approvals, unpaid milestones and ageing punch items.
8. **IoT + AI.** ThingsBoard **4.2** added an AI Request rule node that puts LLM calls inside rule chains. **4.3** (GitHub release dated 20 Jan; the year is likely 2026, not verified) added Alarm Rules 2.0 (rules on profiles or directly on devices, assets or customers), calculated fields with geofencing and aggregation, API keys, enforced 2FA and PATCH support in the REST call node. CFS adds alert aggregation and device commands. *Copy:* create tickets automatically by severity, with an LLM-written triage note.
9. **Remote assist, reality check.** Microsoft deprecated **Remote Assist** mobile (Mar 25 2025) and stopped selling Remote Assist and Guides (Nov 1 2025); security updates end Dec 31 2026. The capability moves to Teams mobile, with annotations. *Copy:* WhatsApp or Teams video plus annotated snapshots saved to the work order. No AR headsets.
10. **Integrator design-to-handover.** D-Tools **Interconnect diagrams + AI** (2025) keep wiring documentation connected to the project, and it becomes the as-built.

---

## 4. Saudi (KSA) & Arabic specifics

- **Working week and hours.** Friday is the legal weekly rest day (at least 24 continuous hours, paid), and the private sector typically works Sun–Thu. Art. 98 caps work at 8 h/day or 48 h/week. **During Ramadan, Muslim workers are limited to 6 h/day or 36 h/week.** The SLA and scheduling calendars need a Ramadan profile, with Hijri dates ±1 day for moon sighting. Customers usually want visits after iftar.
- **Midday outdoor-work ban.** Outdoor work is banned from **12:00 to 15:00 between 15 Jun and 15 Sep** (MHRSD/NCOSH, enforced 2025–2026). The scheduler should block *outdoor* tasks (outdoor-unit mounting, external cabling) in that window and still allow indoor programming.
- **Hijri dates.** Show both Gregorian and Umm al-Qura Hijri dates on contracts, work orders and warranty certificates. The Hijri year is about 11 days shorter, so state which calendar the 2-year warranty and the "45–60 working days" use. I recommend Gregorian.
- **Public holidays.** Eid al-Fitr and Eid al-Adha (about 4 days each in the private sector; verify each year), Founding Day (22 Feb) and National Day (23 Sep).
- **Prayer times (a design constraint, not a regulation).** Compute daily prayer times per city (Umm al-Qura method). Soft-block about 20–30 minutes around each prayer in calendars and ETAs, and avoid Friday Jumu'ah. No benchmarked vendor does this, so it is a differentiator.
- **Makkah seasonality.** Hajj season and the last ten nights of Ramadan bring Haram-area closures and entry-permit rules (verify each season). Factor them into capacity plans and delivery clocks.
- **Residential etiquette.** Visits to occupied homes are pre-arranged, often with a male household member present. Send the technician's name and photo in advance.
- **Consultant approval culture.** On buildings and compounds, the consultant (المكتب الاستشاري) approves material submittals (MAR), shop drawings and method statements, inspection requests (IR/WIR) and NCRs, and issues site instructions. Status codes are typically A/B/C/D (approved / approved as noted / revise & resubmit / rejected). Keep a revision-tracked register, because consultant delays shift the delivery clock.
- **Camera law.** The *Law of the Use of Security Surveillance Cameras* (Royal Decree, Oct 2022) and its Implementing Regulation (Ministerial Decision 22688/1444, plus the security-conditions and technical-spec documents) require **Ministry of Interior approval to import, sell, install, operate or maintain security cameras**. Cameras are mandatory in listed facility types, and the law **does not apply inside private residential units and complexes**. Store an applicability flag per site.
- **Fire code SBC 801** (based on IFC 2015; Civil Defense is the fire-code authority) covers electrically locked egress doors in §1010. IFC-derived rules require magnetic locks to **release on fire-alarm activation and on power loss, with a manual release**; the exact SBC clause is unverified. Put a fail-safe/fire-alarm release test in the commissioning checklist and the acceptance certificate. Fire-alarm work itself needs Civil Defense-licensed contractors (e.g. through Salamah; scope unverified).
- **PDPL (personal data).** In force since Sep 2023, fully enforced since Sep 2024. Face-recognition templates are **biometric (sensitive) data**, and resident directories are personal data. Keep face images out of the ERP, log every credential reveal, and set retention rules.
- **Invoicing and channels.** Milestone and AMC invoices must be ZATCA e-invoices. Use WhatsApp Business *utility* templates in Arabic. Meta moved to per-message pricing in Jul 2025 (unverified). Track CST radio type approval per LoRaWAN or Wi-Fi model (unverified).
- **Arabic UX.** RTL-first screens, bilingual PDFs, a choice of Western or Arabic-Indic digits, and Saudi National Address fields.

---

## 5. Data entities implied (tables & key fields)

```
-- Parties & places
customer(id, type[individual|company|developer|consultant], name_ar, name_en, cr_no, vat_no, phones[], whatsapp, lang)
site(id, customer_id, name, city, district, national_address, lat, lng, consultant_id, camera_law_applicable, access_notes)
location(id, site_id, parent_id, type[building|floor|zone|unit|room|riser|rack], code, name_ar, name_en, path)  -- D365 "functional location" style n-level tree
unit_occupant(id, location_id, name, phone, is_primary, consent_at)        -- PDPL consent

-- Installed base
product_model(id, sku, brand, category[outdoor_unit|indoor_monitor|door_panel|maglock|exit_button|poe_switch|smart_lock|sensor|gateway],
              attr_template_id, latest_fw, eol_date, spares_until, cst_approval_ref)
asset(id, location_id, parent_asset_id, product_model_id, serial, mac, ip, vlan, fw_version, sip_ext, door_direction,
      install_date, commissioned_at, status[stock|installed|faulty|rma|replaced|retired], project_id, qr_code, tb_device_id)
asset_attribute(asset_id, key, value)                                       -- per-type properties
warranty(id, asset_id, kind[installation|manufacturer|extended], start, end, terms, source_project_id)
credential(id, asset_id|site_id, username, secret_encrypted, rotated_at, handed_over_at)  + credential_access_log(user, reason, ts)

-- Projects
project(id, contract_id, quotation_id, template_id, type, site_id, stage, pm_id, advance_paid_at, approvals_signed_at,
        delivery_due_date (computed, working days), planned_start/end, contract_value)
stage_gate(project_id, stage, criteria_json, passed_at, passed_by)
task(id, project_id, parent_id, wbs, location_id, assignee/team, planned/actual dates, status, checklist_json)
task_dependency(pred_id, succ_id, type[FS|SS|FF], lag_days)
milestone(id, project_id, name, percent[50|40|10], trigger, due, invoice_id, status)
approval_package(id, project_id, kind[spec|door_directions|room_numbers|design|material|shop_drawing|IR], revision,
                 submitted_to[client|consultant], status_code[A|B|C|D], submitted_at, responded_at, signature_ref, files[])
change_order(id, project_id, description, amount, days_impact, status, approved_by, signed_at)
site_survey(id, site_id, project_id, form_template_id, answers_json, measurements, photos[], surveyed_by, at)
daily_log(project_id, date, manpower, hours, work_done, issues, photos[])
punch_item(id, project_id, location_id, asset_id, description, photo, assignee, due, status, verified_by)
document(id, entity_type, entity_id, doc_type[drawing|as_built|manual|certificate|report], version, file, markup, approved)
handover(project_id, checklist_json, acceptance_signed_at, signer, training_attendees[], device_schedule_export)

-- Service
work_order(id, number, type[survey|installation|commissioning|corrective|preventive|warranty|inspection],
           source[project_task|ticket|agreement|iot_alarm], customer_id, site_id, location_id, primary_asset_id,
           priority, coverage[warranty|amc|chargeable], sla_policy_id, promised_window, status, resolution_code,
           signature, report_pdf, follow_up_quote_id)
  status: new → scheduled → dispatched → en_route → on_site → paused/awaiting_parts → completed → closed | cancelled
wo_line(wo_id, asset_id, task_template_id, result, checklist_json, readings_json)
booking(id, wo_id, resource_id, start, end, travel_min, check_in_ts/gps, check_out_ts/gps, geofence_ok)
resource(id, user_id, team_id, skills[], certifications[], home_base, van_warehouse_id, cost_rate, calendar_id)
part_usage(wo_id, product_model_id, qty, serial_in, serial_out, warehouse_id, billable)
time_entry(user_id, wo_id|task_id, kind[travel|work|wait], start, end, cost)
service_agreement(id, customer_id, sites[], assets[], tier, start, end, price, billing_freq, visits_per_year, renewal, status)
agreement_schedule(agreement_id, recurrence, task_template_id, lead_days, next_generate_on)
rma(id, asset_id, fault, vendor_id, shipped_at, replacement_serial, status)
ticket(id, channel[whatsapp|phone|email|portal|iot], customer_id, contact, location_id, asset_id, category, priority,
       sla_first_response_due, sla_resolve_due, status, wo_id, csat_score)
sla_policy(id, conditions_json, targets_by_priority, calendar_id, escalations_json)
business_calendar(id, workdays[Sun–Thu], hours, ramadan_hours, holidays[hijri-derived], prayer_blocks, heat_ban_rule)

-- IoT
iot_link(asset_id, tb_device_id, tb_profile, last_seen, health)
iot_alarm(tb_alarm_id, asset_id, type, severity, state[active|cleared], acked, start_ts, dedup_key, ticket_id)
iot_command / ota_campaign(id, targets[], fw_version, status_per_device)
```

**Key design rules:**
- Keep **one location tree and one asset tree**. Work orders, tickets, agreements and IoT alarms all reference `location_id` and `asset_id`.
- Coverage (warranty/AMC) is **computed at ticket or work-order creation**.
- Mirror the TB asset tree from the ERP location tree, so that alarm propagation gives per-site views.

---

## 6. Recommended MVP scope, and what to defer

**MVP (P0): "quote → project → handover → warranty → service call".**
1. Won quotation → project from a template (villa intercom, building intercom, smart home), with the BOQ carried over.
2. Stage gates. An e-signed, versioned approval package starts the working-day delivery clock on the KSA calendar.
3. Kanban, list and calendar views of tasks and milestones. 50/40/10 milestones trigger invoices, and change orders update the contract value and the delivery clock.
4. Survey form, commissioning test sheets and punch list.
5. Location tree and device registry with bulk import and mobile serial/MAC scanning. Warranties are created automatically at acceptance.
6. Handover-pack generator plus a separate credentials sheet.
7. Work orders by type, a dispatch calendar with crew bookings, and an Arabic mobile PWA: GPS check-in/out, checklists, photos, signature, serial-scanned parts, WhatsApp service report, automatic timesheets.
8. Helpdesk-lite: WhatsApp, phone and web form create tickets, matched to customer, unit and device, with an entitlement check and one-click conversion to a work order.

**Wave 2 (P1):**
- AMC agreements with automatic preventive visits, recurring billing and renewals; SLA policies and escalations.
- Client portal.
- Consultant submittal and IR register, daily logs.
- Budget vs actual, capacity view, map and skills matching.
- Offline mode, "on the way" messages, CSAT, Arabic KB, RMA.
- **ThingsBoard alarm → ticket integration**: REST call node → signed ERP webhook, dedup, ack/clear sync, per-site health dashboards.

**Later (P2):**
- Critical path and baselines, WIP.
- Route optimization and AI dispatch.
- Arabic AI agent and copilot.
- Remote commands and OTA, uptime SLAs, predictive and LLM triage.
- Video assist.
- 10-year spare-parts planning.

**Avoid:** AR headsets, a full CPM engine, and building your own IoT stack (reuse ThingsBoard).

**Semantics to copy:**
- D365's functional locations, incident types and agreements (booking setups + invoice setups).
- simPRO's asset tests and defects.
- Procore's punch list and submittals.
- Odoo's milestone invoicing and GPS-on-timer.

---

## 7. Sources

**Read in full through GitHub:**
- https://github.com/MicrosoftDocs/dynamics-365-customer-engagement/blob/main/ce/field-service/cfs-iot-alerts.md (mirror of https://learn.microsoft.com/en-us/dynamics365/field-service/cfs-iot-alerts)
- https://github.com/MicrosoftDocs/dynamics-365-customer-engagement/blob/main/ce/field-service/connected-field-service-architecture.md
- https://github.com/MicrosoftDocs/dynamics-365-customer-engagement/blob/main/ce/field-service/functional-locations.md
- https://github.com/MicrosoftDocs/dynamics-365-customer-engagement/blob/main/ce/field-service/agreements-overview.md
- https://github.com/thingsboard/thingsboard.github.io/blob/master/_includes/docs/user-guide/alarms.md
- https://github.com/thingsboard/thingsboard/releases/tag/v4.3

**Consulted via search-result extracts (direct fetch was blocked):**
- Procore:
  - https://www.procore.com/ai/agents
  - https://www.procore.com/helix-intelligence
  - https://www.procore.com/press/procore-advances-the-future-of-construction-with-new-ai-innovations
  - https://www.enr.com/articles/63042-procore-releases-new-ai-agients-after-datagrid-integration
- Salesforce:
  - https://www.salesforce.com/news/stories/agentforce-for-field-service-announcement/
  - https://www.salesforce.com/news/stories/agentforce-for-field-service-deep-dive/
- ServiceTitan:
  - https://www.servicetitan.com/press/servicetitan-introducing-the-next-evolution-of-ai-at-pantheon-2025-keynote
  - https://help.servicetitan.com/release-hub/docs/fall-2025-release-hub-st-75
  - https://www.servicetitan.com/features/pro/dispatch
  - https://www.tradesly.ai/blog/servicetitan-dispatch-pro-review
- simPRO:
  - https://www.simprogroup.com/industries/security
  - https://www.simprogroup.com/features/maintenance-planner
  - https://helpguide.simprogroup.com/Content/Service-and-Enterprise/Maintenance-Asset-Forms.htm
- D-Tools:
  - https://www.d-tools.com/cloud
  - https://www.d-tools.com/field-service-management
  - https://www.d-tools.com/resource-center/coming-soon-to-d-tools-cloud-mobile-interconnects-and-ai
  - https://docs.d-tools.cloud/en/articles/7156437-service-management-overview
- Odoo:
  - https://www.odoo.com/odoo-19-release-notes
  - https://www.odoo.com/documentation/19.0/applications/services/field_service.html
  - https://www.erpgap.com/blog/whats-new-in-field-service-odoo-19
- Zoho FSM:
  - https://www.zoho.com/fsm/schedule-and-dispatch.html
  - https://www.zoho.com/fsm/scheduled-maintenance.html
  - https://www.zoho.com/fsm/assets.html
- Jobber / Housecall Pro:
  - https://www.getjobber.com/comparison/jobber-vs-housecall-pro/
  - https://fieldcamp.ai/reviews/jobber/
  - https://www.fieldpulse.com/resources/blog/housecall-pro-vs-jobber
- Zendesk:
  - https://www.zendesk.com/newsroom/articles/product-updates-features-2025/
  - https://www.zendesk.com/newsroom/press-releases/zendesk-unveils-powerful-new-ai-capabilities-within-the-resolution-platform-to-accelerate-service-at-scale/
- Freshdesk:
  - https://www.freshworks.com/freshdesk/omni/freddy-ai-copilot/
  - https://support.freshdesk.com/support/solutions/articles/50000010359-overview-of-freddy-ai-for-ticketing
- Zoho Desk:
  - https://www.eesel.ai/blog/zoho-desk-zia-language-support
  - https://help.zoho.com/portal/en/kb/desk/support-channels/help-center/articles/languages-supported-in-zoho-desk-help-center
- ThingsBoard:
  - https://thingsboard.io/blog/thingsboard-4-2-release-reporting-2-0-ai-integration-secrets-management-and-more/
  - https://thingsboard.io/blog/thingsboard-4-3-alarm-rules-2-0-enhanced-calculated-fields-api-keys-and-more/
  - https://thingsboard.io/docs/user-guide/device-profiles/
- Microsoft:
  - https://techcommunity.microsoft.com/blog/plannerblog/transitioning-to-microsoft-planner-and-retiring-microsoft-project-for-the-web/4410149
  - https://techcommunity.microsoft.com/blog/plannerblog/microsoft-project-online-is-retiring-what-you-need-to-know/4450558
  - https://www.cloudservus.com/blog/dynamics-365-remote-assist-and-guides-retirement
  - https://cloudblogs.microsoft.com/dynamics365/bdm/2024/04/17/introducing-new-microsoft-copilot-capabilities-to-optimize-dynamics-365-field-service-operations/
- Work-management AI:
  - https://ir.monday.com/news-and-events/news-releases/news-details/2025/monday-com-Expands-AI-Powered-Agents-CRM-Suite-and-Enterprise-Grade-Capabilities/default.aspx
  - https://investors.asana.com/news-releases/news-release-details/asana-announces-ai-studio-no-code-builder-designing-and
  - https://help.clickup.com/hc/en-us/articles/31010910371991-What-are-Super-Agents
  - https://siliconangle.com/2026/05/12/exclusive-clickup-endows-brain-assistant-agentic-capabilities/
  - https://www.smartsheet.com/content-center/news/smartsheet-debuts-intelligent-work-management-unifying-ai-data-and-people
- KSA:
  - https://www.hrsd.gov.sa/en/knowledge-centre/articles/312
  - https://alothmanlaw.sa/en/article-98/
  - https://ksacalc.com/learn/saudi-working-days-explained/
  - https://www.hrsd.gov.sa/en/media-center/news/100620246
  - https://www.spa.gov.sa/en/N2337578
  - https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2026/saudi-arabia-enforces-seasonal-midday-work-ban-to-protect-workers
  - https://saudipedia.com/en/law-of-the-use-of-security-surveillance-cameras-in-saudi-arabia
  - https://www.lexismiddleeast.com/law/SaudiArabia/MinisterialDecision_22688_1444/en
  - https://rulebook.sama.gov.sa/en/confirmation-application-provisions-law-use-surveillance-cameras-its-implementing-regulations
  - https://sbc.gov.sa/ar/BC/Documents/tableofcontent2024/SBC%20801/SBC801_CR_241224-FA.pdf (search listing only; fetch blocked)
  - https://esi.edu.sa/en/courses/saudi-fire-code-sbc-801/
