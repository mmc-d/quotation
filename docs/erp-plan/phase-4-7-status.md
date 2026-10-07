# Phases 4, 5 and 7b — build status (as of 2026-10-06, branch `mmc-core`)

Built and tested locally in MMC Core. As with Phases 1–3, production use waits on hosting and on the
external accounts listed at the end. Phase 6 (full accounting) is **not** built in Core — see the last section.

## Phase 4 — Projects & field operations

| Area | Built |
|------|-------|
| Projects (module 05) | A project is created automatically when a contract is signed (or from the contract page). Cockpit: 8-stage stepper; **stage gates** (advance + client approvals → procurement; 40% + materials → delivery; devices → commissioning; tests + final request → handover; snags + acceptance → warranty) with logged overrides; **delivery clock** in working days on the company calendar (pauses, extensions, 70/90% warnings); client approval packages with revisions and attachments; tasks with start/due dates, finish-to-start dependencies and a timeline view; snag list with photos; acceptance → warranty end dates on every device; bilingual **handover package** PDF (never prints credentials). |
| Installed base (module 06) | Site location tree (building → floor → unit, bulk generator), device registry with serial/MAC/IP/firmware, CSV import with dry run, commissioning tests, timeline, coverage today. |
| Service calls | Tickets from phone/WhatsApp/web/portal, caller matched by phone, **coverage decided at creation** (project / warranty / AMC / chargeable) with the reason, one click to a work order. |
| Work orders & dispatch | Lifecycle checks, dispatch board (day lanes by hour, week view, unscheduled queue, drag to schedule), **KSA scheduling warnings** (weekends/holidays, 12:00–15:00 outdoor heat ban 15 Jun–15 Sep, Ramadan 6-hour day, prayer times at the site — Umm al-Qura method), check-in distance vs the site pin (> 300 m flagged). |
| Technician app `/tech` | Installable («يومي»). My day, navigation (pin or address search), travel/check-in with PDPL notice, checklist, photos (downscaled, offline outbox), device scan (BarcodeDetector) and registration, parts, findings, signature pad, completion gate with the missing-evidence list, service report PDF sent by WhatsApp; checklist/parts/findings queue while offline. |

Not built: drag-editing on the timeline, critical path/baselines (P2), full offline sync engine (only queued saves), map view with live technician location (P1), skills matching (P1).

## Phase 5 — Procurement & inventory

MMC Core keeps the stock ledger **until ERPNext is connected** (every move has an `erpName` slot for the later sync).

| Area | Built |
|------|-------|
| Ledger | One `postMove` path: balances, negative-stock guard, serial tracking on every move, moving-weighted-average cost; `stock_move` is append-only at the database level. |
| Warehouses | Main store, technician vans (custodian sees only their van), project sites, transit, quarantine. |
| Demand | Material requests from the signed contract's BOQ (kits exploded), automatic reservations, shortage lines; reservations follow issues, transfers and consumption. |
| Purchasing | Multi-currency POs (Incoterms, deposit, VAT for local VAT-registered suppliers), approval routed by amount (≤ 5k purchaser, ≤ 20k GM, above owner; creator ≠ approver), **SABER/CST compliance** blocking unless acknowledged, bilingual PO PDF, supplier catalogue. |
| Receiving | Goods receipts with serial + MAC lists (validated, duplicates refused), auto-reserve for project POs. |
| Imports | Shipments with B/L, containers, ETA, documents checklist, FASAH declaration (duty; import VAT recoverable), charges, clearance checks, **landed-cost allocation** into average cost. |
| Operations | Transfers via transit, issue/return to projects, technician consumption from the van when a work order is completed, stock counts with accuracy and adjustments, supplier bills with **3-way match** (exceptions accepted later by an approver). |
| Reports | Valuation, reorder suggestions, project consumption vs BOQ, ledger, serial traceability. |
| Opening stock | `/inventory/opening`: paste code/qty/cost from Excel or enter lines, preview (unknown codes, service items, serial counts, serials already in stock, existing balance warnings, cost source entered/average/catalogue), then post as `opening` moves that set the average cost (`stock_opening`, `OPN-nnnn`). Storekeepers post quantities without seeing or typing costs. |
| Direct supplier bills | `/purchasing/bills/new`: local purchases without a PO — product lines received into stock at unit price × rate (VAT excluded), expense lines, serials, per-line VAT 15/0 with the printed VAT accepted within rounding, cash purchases paid at once. |
| Payables | `/purchasing/bills`: all bills (PO + direct) with unpaid/overdue/paid/exception filters, CSV export, totals owed / overdue / due in 7 days and aging by supplier; payments to suppliers (partial, never above what is owed, void with reason — all audited) by `payment.record` or `purchase.approve`. ERP sync: direct-bill receipts and opening moves go as stock entries, the bill as a purchase invoice without a PO. |

Not built: OCR/AI capture of supplier documents, supplier ZATCA XML parsing (INV-66), RFQ comparison (P1), bins/putaway and label printing (P1), vendor scorecards (P2). PO sending to the supplier only changes the status (no template yet).

## Phase 7 — Service, portal, people & intelligence (Core parts)

| Area | Built |
|------|-------|
| 7b Service agreements | AMC contracts: preventive-visit work orders, payment requests per billing period (388 on payment), renewals with uplift, coverage `amc` on calls. |
| 7b SLA & CSAT | Response/resolution targets in business hours, at-risk/breached escalations (job every 15 min), one-tap CSAT after each visit, CSAT/SLA reports. |
| 7b Customer portal | `/portal`: WhatsApp-code sign-in, devices & warranty, service requests with photos, project progress and online approvals, bills and pay links, agreements, site health. Customers never see costs. |
| 7a Commissions | Plans by category on revenue or margin, earned on 388, clawed back by 381, payable as collected, payroll CSV; technician incentives. Payroll itself → Frappe HR later. |
| 7c IoT | Signed ThingsBoard webhook → one ticket + work order per device/alarm type, heartbeats, ack/clear back to ThingsBoard. |
| 7c AI | Gateway (Claude, PII redaction, budget, append-only log), BOQ → draft quote with human approval, reply drafting & translation, read-only MCP server with personal tokens. Sandbox until `ANTHROPIC_API_KEY` is set. |

Not built: HR master data/payroll (Frappe HR), knowledge base, WhatsApp AI assistant, commission tiers/splits, AI evaluation sets.

## Phase 6 — Full accounting: ERPNext (owner decision 2026-10-06)

The owner kept the plan: the ledger, bank reconciliation, expenses, fixed assets, VAT return and period
close will run in **ERPNext + the KSA compliance app**, installed later with an implementer and the
accountant. MMC Core does not get its own general ledger. Until then Core keeps operational records
(invoice mirrors via the fake back office, payments, the stock ledger) ready to sync, and provides the
finance and project-profitability dashboards from its own data.

## External accounts still needed

VPS in Saudi Arabia, SMTP, Google OAuth client, WhatsApp Business (templates incl. `service_report`, `csat_request`, `portal_otp`, `amc_renewal`), payment gateway merchant account, Nafath signing provider, ERPNext + KSA compliance app, Wathq subscription.
