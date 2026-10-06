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

Not built: OCR/AI capture of supplier documents, supplier ZATCA XML parsing (INV-66), RFQ comparison (P1), bins/putaway and label printing (P1), vendor scorecards (P2). PO sending to the supplier only changes the status (no template yet).

## Phase 7b — Service agreements & customer portal

In progress at the time of writing: AMC agreements with preventive-visit work orders and payment requests per billing period, SLA targets and escalations on service calls (business-hour clock), CSAT after each visit, and the customer portal (WhatsApp-OTP sign-in; devices and warranty, service calls, invoices and payment requests, project progress and online approvals). Phase 7a (HR & payroll on Frappe HR) and 7c (IoT/ThingsBoard, AI) are not started.

## Phase 6 — Full accounting: decision pending

The plan places bank reconciliation, expenses, fixed assets, cost centres/project P&L, VAT return and period close in **ERPNext** (module 08), with Core showing dashboards. Building a general ledger in Core would duplicate ERPNext and need a migration later, so it has not been started. Owner decision needed: install ERPNext (implementer + accountant), or a temporary Core ledger.

## External accounts still needed

VPS in Saudi Arabia, SMTP, Google OAuth client, WhatsApp Business (templates incl. `service_report`, `csat_request`, `portal_otp`, `amc_renewal`), payment gateway merchant account, Nafath signing provider, ERPNext + KSA compliance app, Wathq subscription.
