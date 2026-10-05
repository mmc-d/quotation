# Module 10 — Reports, Dashboards & KPIs (التقارير ولوحات المؤشرات)

| | |
|---|---|
| **Phases** | P0 reports ship with their module's first phase · P1 within 6–12 months · P2 later |
| **Benchmarked** | Salesforce Reports & Dashboards → Tableau Next, Zoho Analytics (Ask Zia), Odoo 19 Spreadsheet & Dashboards, Microsoft Power BI, Metabase, Apache Superset, HubSpot reporting |
| **Business owner** | General Manager |

> **Key finding:** Power BI, Metabase and Superset have weak Arabic **RTL layout** support (open issues as of 2025–2026). Staff- and customer-facing dashboards are therefore rendered **in-app** (RTL charts with Apache ECharts on versioned SQL views); Metabase is optional for internal ad-hoc analysis only. Finance facts come from ERPNext through the back-office port.

## 1. Reporting platform features

| ID | Feature | Adopted from | P | Notes |
|----|---------|-------------|---|-------|
| RPT-01 | List/pivot views with group-by, subtotals and export (XLSX with `rightToLeft` sheets, CSV, PDF) | Odoo pivot, Salesforce, HubSpot | P0 | Replaces today's Excel-only workflow |
| RPT-02 | Saved views, favourites, default filters per user | Odoo 19.4, Salesforce, HubSpot | P0 | |
| RPT-03 | Global dashboard filters (period, branch, owner, city) with Gregorian dates and optional Hijri display | Odoo, Metabase, Superset | P0 | |
| RPT-04 | KPI tiles with target and period comparison; drill-down chart → list → record | Salesforce, HubSpot, Zoho, Power BI | P0 | |
| RPT-05 | Row-level security in reports (same scopes as the app) | Salesforce sharing, Power BI RLS | P0 | |
| RPT-06 | Semantic/metric layer: one versioned definition per KPI (win rate, GM%, DSO…) | Tableau Semantics, Power BI models | P1 | SQL views in `rpt` schema |
| RPT-07 | Scheduled delivery (e-mail / WhatsApp link) of dashboards and the monthly management pack | Salesforce subscriptions, Zoho Analytics | P1 | |
| RPT-08 | Spreadsheet-style live analysis for the founder | Odoo Spreadsheet | P1 | Via Metabase or XLSX live export |
| RPT-09 | Natural-language questions (Arabic/English) → chart, over the semantic layer | Ask Zia, Tableau Next Concierge | P2 | Module 12 |
| RPT-10 | AI-narrated insights & anomaly alerts (discount outliers, margin leakage, duplicate bills) | Zia Insights, Tableau Next Inspector | P2 | Needs 6–12 months of data |
| RPT-11 | Customer-portal analytics (site health, service history) | Metabase/Superset/Power BI embed (weak RTL) | P2 | Rendered in-app |

## 2. Dashboards

| Dashboard | Audience | Content (report IDs) | Phase |
|-----------|----------|----------------------|-------|
| **CEO cockpit** | Owner, GM | Revenue MTD/YTD vs target, GM %, cash, AR > 60 days, backlog, weighted pipeline, win rate, recurring-revenue share (E1, E2, S1, PR3, A1, A9) | 1 (sales tiles) → 3 → 6 |
| Sales | Sales manager, reps | Pipeline, win/loss, stale deals, quote register, discount & margin, targets (S1–S9, Q1–Q7) | 1–2 |
| Projects | PMs, GM | Health, delivery clocks, milestones & collections, change orders, P&L (PR1–PR9) | 4 → 6 |
| Field service | Ops manager | Jobs board, compliance, devices/tech-day, FTF, SLA, utilisation, warranty/AMC pipeline (F1–F10) | 4 → 7b |
| Stock & purchasing | Ops, storekeeper | Valuation, reorder, reserved vs available, open POs, landed cost (I1–I8, PU1–PU6) | 5 |
| Finance | Finance manager | AR/AP aging, cash, DSO, VAT, e-invoice status, P&L, budget vs actual (A1–A13) | 3 → 6 |
| HR | HR officer | Attendance, document expiry, productivity, payroll & Saudization (H1–H5) | 7a |

## 3. Report catalogue (77 reports)

### Sales / CRM
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|--------|----------------------|-----------------|-------|---|
| S1 | Pipeline by stage | # deals, SAR, weighted SAR, average age in stage | owner, source, city, segment, close month | funnel + stacked bar | P0 |
| S2 | Won/lost analysis | won/lost count & SAR, lost reason, competitor | period, owner, product family | Pareto | P0 |
| S3 | Stale deals / missing next step | days since last activity, next activity date | owner, stage, > X days | RAG table | P0 |
| S4 | Top customers (ABC) | revenue, GM, # orders, last order, AR | period, segment, city | Pareto | P0 |
| S5 | Lead-source performance | leads, qualified %, won %, won SAR | source/campaign, period | bar | P1 |
| S6 | Lead response time | median minutes to first reply, % < 1 h | owner, channel | box/bar | P1 |
| S7 | Sales vs target | booked SAR, target, attainment % | rep, month/quarter | bullet | P1 |
| S8 | Sales forecast | weighted pipeline by close month, commit vs best case | owner, stage | stacked column | P1 |
| S9 | Activity report | calls, site visits, WhatsApp threads, meetings | rep, week | stacked bar | P1 |
| S10 | Sales-cycle length | days lead → won | segment, deal-size band | histogram | P2 |
| S11 | Segment mix | villas / compounds / developers / contractors / government | period | treemap | P2 |

### Quotations
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|--------|----------------------|-----------------|-------|---|
| Q1 | Quote register | no., rev, customer, project, date, validity, total, status, owner | status, date, owner | table | P0 |
| Q2 | Quote win rate | won ÷ decided (count & SAR) | owner, segment, size band, brand | bar + trend | P0 |
| Q3 | Discount analysis | list vs net, weighted discount %, # approvals triggered | owner, brand, category | histogram | P0 |
| Q4 | Quote margin | cost, price, GM SAR/% per quote and line | owner, brand, category | table + bar | P0 |
| Q5 | Expiring & aging quotes | days since sent, days to expiry, last follow-up | owner, ≤ 7 days | RAG table | P0 |
| Q6 | Quote turnaround | request → sent (business hours), # revisions | owner, complexity | bar | P1 |
| Q7 | Top quoted items/packages | qty, SAR, win rate per SKU/package | brand, category | bar | P1 |
| Q8 | Lost-quote price gap | our price vs competitor/target | competitor, brand | scatter | P2 |
| Q9 | Quote → order leakage | quoted vs ordered SAR (scope cuts) | owner | waterfall | P2 |

### Projects
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|--------|----------------------|-----------------|-------|---|
| PR1 | Project P&L / gross margin | contract + change orders, revenue recognised, material/labor/subcontract cost, GM % | PM, status, city, customer | table + bar | P0 |
| PR2 | Budget vs actual (EAC) | budget, cost to date, committed (open POs), EAC, variance | project | variance bar | P0 |
| PR3 | Backlog | signed but uninvoiced SAR, backlog months | month, PM, segment | area | P0 |
| PR4 | Billing milestones | milestone, due, requested, invoiced (386/388), collected | project, overdue | table | P0 |
| PR5 | Project health & delivery clock | % complete, days elapsed vs 45–60 window, open snags, pending approvals | PM | RAG table | P1 |
| PR6 | Change orders | count, SAR, % of contract, days impact, status | project, customer | table | P1 |
| PR7 | Retention receivable | retention held, release date | customer | table | P1 |
| PR8 | Labor hours plan vs actual | planned vs actual hours, overtime | project, technician | bar | P1 |
| PR9 | Estimate accuracy | actual ÷ quoted cost by category | project type | scatter | P2 |

### Field service
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|--------|----------------------|-----------------|-------|---|
| F1 | Jobs board summary | scheduled / in progress / done / overdue | date, technician, city, type | stacked bar | P0 |
| F2 | Installed-base register | site, unit, model, serial/MAC, firmware, install date, warranty end | customer, brand, model | table | P0 |
| F3 | Job completion compliance | % jobs with photos, serials, signature, checklist | technician, type | bar | P0 |
| F4 | Devices per technician-day | devices commissioned ÷ technician-days | technician, device type, month | bar | P1 |
| F5 | First-time-fix rate | % service jobs fixed on first visit | technician, brand, issue | line | P1 |
| F6 | Repeat-visit rate | jobs reopened within 30 days | technician, brand | bar | P1 |
| F7 | SLA compliance | % responded/resolved within SLA | contract, priority | gauge + trend | P1 |
| F8 | Technician utilisation | job hours ÷ available hours | technician, week | heatmap | P1 |
| F9 | Warranty/AMC expiry pipeline | devices/contracts expiring in 30/60/90 days; renewal SAR | customer | table | P1 |
| F10 | MTTR & response time | mean hours to arrive / resolve | priority, city | line | P2 |

### Inventory
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|--------|----------------------|-----------------|-------|---|
| I1 | Stock on hand & valuation | qty, landed average cost, value | warehouse/van, brand | table | P0 |
| I2 | Reorder / low stock | on hand, reserved, on order, min, suggested qty | warehouse, supplier | table | P0 |
| I3 | Stock movement ledger | in/out/transfer with source document | item, date | table | P0 |
| I4 | Reserved for projects vs free | qty reserved per project; consumption vs BOQ | project, item | stacked bar | P1 |
| I5 | Serial traceability | serial → PO → project → site/unit → warranty | serial, item | table | P1 |
| I6 | Slow-moving / dead stock | days since last movement, value | age bucket | bar | P1 |
| I7 | Van stock by technician | qty/value per van, count variances | technician | table | P2 |
| I8 | Inventory turnover / DIO | COGS ÷ average inventory | category | bar | P2 |

### Purchasing
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|--------|----------------------|-----------------|-------|---|
| PU1 | Open POs & expected receipts | PO, supplier, ETA, value, % received | supplier, project | table | P0 |
| PU2 | Spend by supplier/category | SAR, # POs, share % | period | Pareto | P1 |
| PU3 | 3-way-match exceptions | mismatches PO/receipt/bill | supplier | table | P1 |
| PU4 | Purchase price variance | actual vs last/standard cost | item, supplier | bar | P2 |
| PU5 | Supplier on-time delivery | OTD %, average lead days | supplier | bar | P2 |
| PU6 | Import landed cost | FOB + freight + duty + clearance → unit landed cost | shipment | waterfall | P2 |

### Accounting / finance
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|--------|----------------------|-----------------|-------|---|
| A1 | AR aging | 0–30 / 31–60 / 61–90 / 90+ by customer | customer, owner, project | stacked bar + table | P0 |
| A2 | Customer statement of account | opening, invoices, receipts, balance | customer, period | bilingual PDF | P0 |
| A3 | AP aging | buckets by supplier | supplier | stacked bar | P0 |
| A4 | Profit & loss | revenue, COGS, GM, opex, net by project/line | period, dimension | table + trend | P0 |
| A5 | Balance sheet | standard | as-of date | table | P0 |
| A6 | Trial balance / GL | account movements | period, account | table | P0 |
| A7 | VAT return (ZATCA) | standard-rated sales/purchases, zero-rated, exempt, imports, reverse charge, net VAT | month/quarter | table | P0 |
| A8 | E-invoice status | cleared / reported / rejected / pending with ZATCA messages | date, document type | counts + table | P0 |
| A9 | Cash & bank position | balances; receipts/payments today & week; PDCs maturing | bank | KPI + line | P1 |
| A10 | DSO & collection effectiveness | DSO, CEI, promises to pay | owner | line | P1 |
| A11 | Revenue by stream | devices / installation / programming / AMC / IoT monitoring | period | stacked column | P1 |
| A12 | 13-week cash forecast | expected receipts (milestones, PDCs), AP due, payroll, pipeline × probability | week | area | P2 |
| A13 | Budget vs actual (company) | by account group | month | variance bar | P2 |

### HR
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|--------|----------------------|-----------------|-------|---|
| H1 | Attendance & timesheets incl. field hours | hours, overtime, lateness | employee, week | table | P1 |
| H2 | Iqama & document expiry | iqama, passport, licence, insurance | expiring ≤ 60 days | RAG table | P1 |
| H3 | Technician productivity | billable hours %, jobs/day | technician | bar | P1 |
| H4 | Leave balance & calendar | balance, planned leave | department | calendar | P2 |
| H5 | Payroll, GOSI & Saudization | gross, GOSI, net; Saudi ratio by profession group | month | table | P2 |

### Executive
| # | Report | Key metrics / columns | Typical filters | Chart | P |
|---|--------|----------------------|-----------------|-------|---|
| E1 | CEO cockpit | revenue vs target, GM %, cash, AR > 60 days, backlog, pipeline, win rate | period | KPI tiles + sparklines | P0 |
| E2 | Sales-to-cash funnel | leads → quotes → contracts → invoiced → collected | period | funnel | P1 |
| E3 | Monthly management pack | P&L, cash, AR, backlog, top projects | month | bilingual PDF | P1 |
| E4 | Customer satisfaction | CSAT/NPS from WhatsApp surveys, complaints | technician, project | bar/line | P2 |
| E5 | Recurring revenue share | (AMC + subscriptions + monitoring) ÷ total revenue | quarter | line | P2 |
| E6 | Repeat customers / cohorts | % revenue from returning customers | cohort year | cohort grid | P2 |

## 4. KPI definitions (single source of truth)

| KPI | Definition |
|-----|-----------|
| Quote win rate (count) | Won ÷ (Won + Lost) in the period of decision; quotes > 30 days past validity count as lost; all revisions of one opportunity count once |
| Quote win rate (value) | SAR won ÷ SAR decided |
| Average discount % | Σ(list × qty − net) ÷ Σ(list × qty), value-weighted; also % of quotes needing approval |
| Quote turnaround | Median business hours (Sun–Thu calendar) from request logged to first quote sent |
| Gross margin by project | (Revenue recognised − direct cost) ÷ revenue recognised; direct cost = materials at landed cost + labor hours × loaded rate + subcontract + project expenses |
| Estimate accuracy | Actual direct cost ÷ quoted cost (target 0.95–1.05) |
| Backlog value / months | Signed value incl. approved change orders − revenue recognised; ÷ trailing-3-month average revenue |
| Book-to-bill | New contracts SAR ÷ invoiced SAR |
| Pipeline coverage | Weighted pipeline closing in period ÷ remaining target |
| Lead response time | Median minutes (business hours) from first inbound message/call to first human or approved-AI reply |
| Devices per technician-day | Devices commissioned (serial captured + tested) ÷ technician-days on installation jobs (≥ 4 h on site = 1 day) |
| First-time-fix rate | Service jobs resolved on first visit with no follow-up within 30 days ÷ service jobs closed |
| SLA response compliance | Jobs with arrival within SLA (business-hours clock) ÷ jobs under SLA |
| Technician utilisation | Job hours ÷ available hours (shift − leave − training); travel reported separately |
| Job completion compliance | Jobs closed with all mandatory evidence ÷ jobs closed |
| DSO | (Ending AR ÷ credit sales in period) × days in period |
| Collection effectiveness index | (Opening AR + credit sales − ending total AR) ÷ (opening AR + credit sales − ending current AR) × 100 |
| DIO / turnover | Average inventory ÷ COGS × 365 / COGS ÷ average inventory |
| Cash conversion cycle | DSO + DIO − DPO |
| Change-order rate | Approved change-order SAR ÷ original contract SAR |
| Warranty claim rate | Warranty jobs ÷ devices installed per brand/model over 12 months (supplier selection) |
| Messaging cost per won deal | WhatsApp + SMS spend attributed to opportunities ÷ deals won |
| **Recurring revenue share** | (AMC + subscription + monitoring revenue) ÷ total revenue — the key metric for becoming an IoT company |
