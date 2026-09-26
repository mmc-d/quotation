# Quotations / CPQ / Proposals / Contracts / E-signature: Benchmark for Motqinon Tech (Sep 2026)

**How this was researched:** About 30 web searches were run on 25 Sep 2026. The sandbox proxy blocked direct page fetches, so the facts come from search-engine summaries of the pages listed in §7. Official and help-centre pages were preferred.

Tags used in this report:
- **(unverified):** could not be confirmed.
- **(practice):** normal practice in Saudi (KSA) projects, not a feature of a benchmarked product.
- **[Has]:** already in Motqinon's current app.

---

## 1. Apps benchmarked

| App | Positioning / why it's a leader | Notable strengths |
|---|---|---|
| **D-Tools Cloud** | Leading cloud platform for AV, security and smart-home integrators, covering sales through service. Won Best of Show at CEDIA 2026. | Catalog with cost and margin. Packages, accessories, alternate sets, labor per item. Customer Portal with sign and deposit. Change orders. Quote Assist AI (2026). |
| **D-Tools SI v24** | Desktop standard for designing and estimating complex projects | Visio/AutoCAD drawings (floor plans, single-line, rack elevations, wiring) linked live to the BOM. Multi-user editing (2026). |
| **Portal.io** | Proposal-first app for integrators | Catalog of 2M+ products with live dealer pricing. Areas and upgrades. Payment schedule and payments. Recurring items. Change orders. One-click POs. AI Proposal Builder. |
| **Jetbuilt** | Project sales and delivery for commercial AV, IT and security | Versions. Options become change orders at contract stage. Labor by hours, days and crew. PO/RFQ page designer. P&L. Jetbot AI. |
| **simPRO** | Field-service and project ERP for electrical, security and fire contractors | Prebuilds (kits), take-off templates, drawing Takeoffs, approvals, quote → job → invoice |
| **ServiceTitan Pricebook Pro** | Leading flat-rate pricebook for the trades | One-click Good/Better/Best, prices that follow vendor cost, AI recommendations and price insights |
| **Salesforce Agentforce Revenue Management** (formerly Revenue Cloud, renamed at Dreamforce 2025) | Enterprise reference for quote-to-cash | Unified catalog, Constraint Builder configurator, advanced approvals, document generation, orders and billing |
| **HubSpot CPQ** | CPQ built into the CRM, for SMB and mid-market | AI drafts, tiered pricing, per-line discount and tax, rule-based approvals, Closing Agent (2025) |
| **Zoho CRM CPQ + Contracts + Sign** | Low-cost suite with KSA data centres and Arabic/English right-to-left (RTL) support | Configurator and price rules. Contract management (CLM) with clause library and obligations. Nafath signing via emdha. |
| **PandaDoc** | Document automation with CPQ and e-signature | Bundles and rulesets, conditional approvals, smart content, Stripe payment at signing, MCP server |
| **Proposify** | Proposal software with approval controls | Content library, interactive quoting, approvals, view analytics, user roles |
| **Qwilr** | Proposals delivered as web pages | Interactive pricing. Accept, sign and pay in one step. Engagement alerts per block. |
| **DealHub** | CPQ, CLM and billing in one platform | Guided-selling playbooks. DealRoom with chat, redlining and e-signature. Parallel approvals. Versioned order forms. |
| **DocuSign IAM** | E-signature leader that has expanded into AI contract management | Navigator repository, Maestro workflows, Agreement Desk, obligation tracking, Iris agents (2026) |
| **Signit (KSA)** | Trust service provider licensed by the Digital Government Authority (DGA), plus CLM | Identity via Nafath, Absher and Wathq. Clause library, redlining, obligations, electronic seals. Arabic interface. Data held in KSA. |

---

## 2. Feature inventory

**Abbreviations:** DT = D-Tools Cloud · SI = D-Tools SI · PT = Portal.io · JB = Jetbuilt · SP = simPRO · ST = ServiceTitan · SF = Salesforce · HS = HubSpot · ZO = Zoho · PD = PandaDoc · PR = Proposify · QW = Qwilr · DH = DealHub · DS = DocuSign · SG = Signit.

**Priority (P):** P0 = must be in the MVP, P1 = second wave, P2 = later or a differentiator.

### 2.1 Product catalog & pricebook
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Product master | Code, brand, model, category, images, specs, search | DT, PT, JB, SF | P0 | **[Has]** (Sheet, Drive images). Move to a database and add Arabic/English text. |
| Supplier cost, margin & markup | Cost per item; margin and markup shown live | DT | P0 | Basis for guardrails. Hide cost on customer documents. |
| Datasheets / explainer PDFs | Spec sheets attached to items | ST, SI | P1 | Reuse in submittals |
| Typed attributes / ports | Specs stored as fields (PoE watts, ports, I/O) | SF, DT (I/O config) | P1 | Needed for capacity rules |
| Distributor catalog feeds | Live dealer pricing | PT (2M+ items), JB | P2 | Rare in KSA. Use Excel import instead. |
| Cost-driven repricing | A supplier cost change re-prices the linked items | ST (dynamic pricing) | P1 | Supplier price-list import |
| Price lists / tiers | Price books per segment, or quantity tiers | SF, HS, ZO | P1 | Retail / contractor / developer / government |
| Multi-currency & FX | Cost in USD/CNY, sale price in SAR | SF, HS (unverified) | P1 | |
| Recurring service items | Maintenance, warranty and subscription lines shown separately | PT, QW, DH, HS | P1 | Annual maintenance contract (AMC, عقد صيانة) |

### 2.2 Bundles, options & configuration
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Packages / kits | One line that expands into itemized components | DT, SP (prebuilds), PD | P0 | "Villa intercom package" |
| Accessory auto-add | Adding an item also adds its required accessories | DT, SI | P1 | Outdoor unit → back box. Lock → bracket and power supply. |
| Area / system sections | Grouped lines with subtotals | DT, PT, JB | P0 | **[Has]** drag-and-drop ordering. Add sections (Gate, GF, Apt 1). |
| Optional lines | Priced but excluded from the total until chosen | PR, QW, PT | P0 | |
| Alternate sets / Good-Better-Best | Customer picks one tier | DT, ST, QW | P1 | 2-wire / IP / IP with face recognition |
| Compatibility rules | Rules that require, exclude or suggest items | SF (Constraint Builder), ZO, PD | P2 | Simple rule table in P1 |
| Capacity checks | Switch ports, PoE budget and power-supply amps vs device count | Generic constraints in SF | P1 | Intercom differentiator |
| Guided selling | Questionnaire that produces a draft BOM | DH (Playbooks), PD, SF | P2 | Floors, apartments, gates → quote |

### 2.3 Labor & installation
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Per-item install cost → INS line | Sums install cost × qty; can be overridden | DT, SI | P0 | **[Has]** |
| Labor types × hours × rate | Installation, cabling, programming, commissioning | DT, JB | P1 | Rolled-up INS line on the PDF stays optional |
| Crew and day breakdown | Converts hours to days based on crew size | JB | P2 | Feeds scheduling |

### 2.4 Pricing, discounts, margin & approvals
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Line overrides with trace | Edit description or price; the original stays visible | HS (line discounts) | P0 | **[Has]** (strike-through, FREE, modified flag). Add a per-line discount %. |
| Header discount | % or fixed amount | All | P0 | **[Has]** |
| VAT & per-line tax | 15% VAT plus zero-rated or exempt lines | HS | P0 | **[Has]** VAT toggle |
| Discount approval thresholds | Over a set % or value → approver | PD, HS, PR, DH, SF | P0 | Block PDF and sending until approved |
| Margin guardrails | Minimum margin per category or quote | DT (margin view), SF/DH (unverified) | P0 | |
| Parallel / multi-level approvals | Status visible to the sales rep | DH, SF | P1 | |
| Automatic price rules | Discounts based on customer or quantity | ZO, PD | P2 | |
| Payment schedule on quote | Milestone amounts calculated automatically | PT | P0 | **[Has]** in contracts (50/40/10) |

### 2.5 Quote lifecycle, templates & documents
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Numbering | Unique IDs | All | P0 | **[Has]** Q-YYYY-{user}{seq}. Add Rev suffix. |
| Status pipeline | Draft → Pending approval → Sent → Viewed → Accepted / Lost / Expired | HS, SF, JB, DT | P0 | Lost reason mandatory |
| Versions / revisions | Keeps history; locks versions once sent | JB, DH | P0 | Replaces JSON-in-Drive **[Has]** |
| Version compare | Shows differences in lines and prices | DH, PT (Highlight Changes) | P1 | |
| Validity & reminders | Expiry date and follow-ups | HS, PD (unverified) | P0 expiry / P1 reminders | |
| Quote templates | Packages, labor and wording pre-filled by job type | DT, PR, PD, HS | P0 | Villa, building, smart home, access control |
| Content library | Reusable scope and terms blocks | PR, PD | P1 | **[Has]** partially (notes and terms) |
| Conditional content | Shows or hides blocks based on deal data | PD (smart content) | P2 | Face-recognition items → PDPL clause |
| Bilingual AR/EN output | Arabic-first RTL with English | ZO, SG | P0 | Must-have in KSA |
| PDF & Excel output | A4 print; Excel with images | All (PDF) | P0 | **[Has]** |
| Customer & contact database | Accounts, contacts and sites with CR, VAT and address | SF, HS, ZO, JB | P0 | Missing today |
| Roles, permissions & audit log | Who sees cost, approval limits, history | PR, SP, DH, SG | P0 | |

### 2.6 Interactive proposals, e-signature & payment
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Web proposal link | Live mobile page instead of a PDF | QW, PT, DT, PR, DH | P1 | Arabic RTL |
| Client option selection | Customer toggles options and quantities; totals update | QW, PR, DT, PT | P1 | |
| Client comments | Questions and answers on the proposal | DT (Customer Portal), DH (DealTalk) | P1 | |
| View tracking & alerts | Opens, time per section, forwards, stalls | QW, PR, DT | P1 | |
| Online acceptance (simple e-signature) | Typed or drawn signature with OTP and audit trail | PD, PT, DT, JB, PR, QW | P1 | Adequate for quotes |
| Nafath-verified e-signature | Signing through a DGA-licensed trust service provider | SG, emdha, Sadq, ZO Sign | P1 | For contracts |
| Deposit / payment at acceptance | Deposit paid at signing | PD (Stripe), QW, PT, DT | P2 | Local payment gateways not researched |
| AI buyer assistant | Answers customer questions inside the quote | HS (Closing Agent) | P2 | |
| Electronic seal | Digital company seal | SG | P2 | Replaces the scanned stamp |

### 2.7 Conversion & post-sale
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Quote → contract | Contract generated from the accepted quote | DH, SF | P0 | **[Has]** |
| Quote → sales order / project | Locks the scope as the baseline | JB, DT, SF | P1 | |
| Quote → milestone invoices | One invoice per milestone | PT, JB, SF, DH | P1 | Must use ZATCA Phase 2 invoicing |
| Quote → purchase orders | POs grouped by supplier | PT (1-click), JB | P1 | |
| Change orders / variations | Linked to the original, approved, running total; client-facing or internal | PT, DT, JB | P1 | أوامر تغيير |
| Recurring AMC | Service plans, renewals, billing | PT, DH, HS | P1 | |
| Serial / asset tracking | Each asset tracked from warehouse to install to service | DT (May 2026) | P2 | Warranty by serial number or MAC |
| Project P&L | Estimate vs actual | JB | P2 | |
| QR service desk | Scanning the device's QR code opens a ticket | JB (Jetbot) | P2 | Sticker on the outdoor unit |

### 2.8 Contracts & CLM
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Contract templates by type | Supply, supply and install, AMC, smart home | ZO, SG | P0 | **[Has]** one template |
| Contract numbering | Serial numbers | — | P0 | **[Has]** MTQCT-N |
| Clause library | Approved Arabic/English clauses with a picker | ZO, SG | P1 | |
| Clause versioning & standards check | Flags deviations from approved wording | DS (Iris), ZO (unverified) | P2 | |
| Internal approval before signing | Routes the contract internally first | ZO, SG, DH | P1 | |
| Redlining & negotiation | Tracked changes and version comparison | ZO, DH, SG | P2 | Markups from the client or consultant |
| Repository & search | Metadata and full-text search | DS (Navigator), SG, ZO | P1 | |
| Obligations & renewals | Reminders for payments, warranty, defects liability period (DLP), retention, renewals | ZO, DS, SG | P1 | |
| AI term extraction | Pulls key terms from uploaded contracts | DS | P2 | Contracts issued by clients |
| Tamper-evident signed PDF | Locked after signing, with audit trail | SG, emdha | P1 | |

### 2.9 Design, drawings & BOQ
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Consultant BOQ Excel import/export | Maps columns, matches to the catalog, prices, exports in the same layout | SP (import schedules). AI parsers (Pelles, DesignDrafter) do fuzzy row matching. | P1 (AI matching P2) | Critical in KSA |
| Drawing takeoff | Counts symbols; measures cable and conduit | SP (Takeoffs) | P2 | |
| Plan-based design → BOM | Devices placed on drawings generate the BOM | SI (Visio/AutoCAD) | P2 | |
| Line / riser diagrams from BOM | Connection drawings generated automatically | DT, JB (Jetbot), SI | P2 | Outdoor unit → switch → indoor units |
| Rack elevations & wiring schedules | Rack layouts and cable schedules | SI | P2 | |
| Submittal pack | Datasheets, compliance statement and BOQ | (practice) | P1 | Consultant material approval |

### 2.10 Analytics & AI
| Feature | What it does | Seen in | P | Notes |
|---|---|---|---|---|
| Pipeline dashboard | Value and count by status; aging | HS, SF, JB | P1 | A filterable list is P0 |
| Win rate & quote-to-close time | By product, rep and segment | SF, HS (unverified specifics) | P1 | |
| Discount leakage | List price vs net price by rep and product | SF (unverified) | P1 | |
| AI quote from voice or walkthrough | Dictated notes or site video → proposal | PT | P2 | Needs Arabic speech |
| AI quote from emails, drawings and photos | Produces scope and rooms/systems | DT (Quote Assist) | P2 | |
| AI BOM recommendation | Describe a space → equipment list | JB (Jetbot Recommend) | P2 | |
| AI pricing insights | Regional benchmarks; AI material matching | ST | P2 | Needs local data |
| MCP / agent access | Gives Claude/ChatGPT access to the data | DT (read-only), PD | P2 | |
| AI contract agents | Checks against standards, suggests edits, monitors obligations | DS (Iris agents) | P2 | |

---

## 3. Leading-edge 2025–2026 innovations worth copying

1. **D-Tools Quote Assist** (CEDIA Expo, 2–4 Sep 2026): conversations, emails, drawings, site photos and notes become a scope plus a working quote with rooms and systems. The same event previewed **AI proposal templates**, built from a description or a sample proposal you upload, and launched a **read-only MCP server** for Claude and ChatGPT.
2. **D-Tools Inventory Asset Management** (InfoComm, May 2026): one record per asset covering warehouse intake, project allocation, installation and service. **SI v24** adds multi-user project editing and a Mobile Install App.
3. **Portal AI Proposal Builder** (general release reported Mar 2025, date unverified): dictate the scope at the site or record a walkthrough, and a proposal is built with areas, descriptions and labor.
4. **Portal change orders:** approved changes are overlaid on the original in colour ("Highlight Changes"), with a running total and balance. Change orders can be client-facing or internal, and the internal ones track margin.
5. **Jetbot (Jetbuilt):** builds schematics from the BOM and scope. "Recommend" suggests equipment from a description of the space. Service Desk opens tickets from QR codes on installed equipment.
6. **HubSpot Closing Agent** (2025): AI on the quote answers the customer's questions. HubSpot also dropped code-level quote templates for new accounts (2025). The lesson for Motqinon: control your own document rendering, because Arabic RTL layouts need it.
7. **DocuSign Iris agents** (Momentum, May 2026): check agreements against company standards, suggest edits, request approvals automatically, and watch obligations and risks.
8. **DealHub DealRoom:** one space where the customer gets chat, redlining, e-signature and live approval status.
9. **ServiceTitan:** vendor cost updates re-price services overnight. Configurable Services learns from technicians' picks. Good/Better/Best proposals are generated in one click.
10. **Qwilr:** accept, sign and pay in one step. Alerts fire when the customer stalls, shares the proposal or adds a new viewer.

---

## 4. Saudi (KSA) & Arabic specifics

**E-signature legality**
- **Law:** the Electronic Transactions Law (Royal Decree M/18, 1428H) and its Implementing Regulations (1/1429) make electronic records and signatures equivalent to paper. A signature is fully binding when it is:
  - linked to a certificate from the National Centre for Digital Certification (NCDC) or a licensed provider,
  - backed by a certificate that is valid at the moment of signing,
  - made by a signer whose identity matches the certificate.
- **Regulator:** the DGA licenses trust service providers (TSPs), a role previously held by CITC/CST. The NCDC is the national root certificate authority.
- **Identity:** Nafath is the national digital identity platform (biometrics and multi-factor authentication). Absher is also used for people, and Wathq for companies.
- **Providers:**
  - **Signit:** full DGA trust-service licence since Dec 2024. Identity via Absher, Nafath and Wathq. CLM features, electronic seals, data held in KSA.
  - **emdha:** the first licensed TSP. Signing via Nafath or Iqama. REST API.
  - **Sadq:** DGA-licensed. Uses Nafath, Wathq and Absher.
  - **Zoho Sign:** uses emdha with Nafath, available only in the KSA data centre.
  - **SCCA:** the Saudi Center for Commercial Arbitration offers a signing service for arbitration documents.
  - DocuSign and Adobe with a Saudi TSP: (unverified).
- **Recommendation:** use two tiers.
  1. Quotes: click-to-accept with an OTP, an audit trail and a SHA-256 hash of the PDF.
  2. Contracts and developer/government clients: Nafath signing through a TSP's API. Store the transaction ID and the signed PDF.

**Contract and document norms**
- **Language:** Arabic is the language of the courts, and foreign-language documents need a certified Arabic translation. Make Arabic the master text and add an "Arabic text prevails" clause (practice).
- **Contract law:** the Civil Transactions Law has been in force since Dec 2023. Have templates reviewed by a lawyer.
- **Company identifiers:**
  - The Commercial Register Law (Royal Decree M/83, in force 3 Apr 2025) introduced a 10-digit unified national number starting with "7". Branch CRs are being phased out, with a grace period to Apr 2030.
  - Store both the old and new numbers, and verify them through the **Wathq API** (trade name, status, capital, owners and managers).
  - Whether the number must be printed on documents is (unverified).
- **Tax identifiers:** the VAT number (15 digits) and the Saudi National Address are needed for B2B e-invoices.
- **Tafqit:** **[Has]**. Add English wording and halalas.
- **Dates:** Gregorian by default, Hijri optional.
- **Payment structure:** advance, progress and retention at handover **[Has]** (the 50/40/10 schedule). VAT is due on an advance payment when it is received, so the deposit needs its own tax invoice.
- **Stamp:** the company stamp is still customary.
- **PDPL:** face-recognition intercoms process biometric data. Add consent and data-processing clauses (verify with counsel).

**ZATCA e-invoicing**
- Quotes are not tax invoices, but quote → invoice must go through a Fatoora Phase 2 solution: XML, QR code, cryptographic stamp, UUID and clearance.
- **Wave 23** covers revenue above SAR 750k, with a deadline of 31 Mar 2026.
- **Wave 24** covers taxable revenue above SAR 375k in any of 2022–2024, with a deadline of 30 Jun 2026.
- Motqinon is very likely in scope.

**BOQ and consultant culture (practice)**
- **How project work arrives:** consultants issue a BOQ in Excel or PDF, with item references, specs, units and quantities.
- **How it must be priced:** contractors price it without changing the structure. Alternatives go into a separate deviation list, with a compliance statement against the spec.
- **Material approval:** before buying, the contractor sends material submittals (datasheets, certificates) for the consultant's approval. Approved-manufacturer lists apply, and revisions cycle through Rev A/B/C.
- **Billing:** progress claims (مستخلصات) are certified against BOQ quantities. Retention and variation orders apply.
- **Government work:** tenders go through Etimad.
- **Implications:** Motqinon needs:
  - BOQ import/export that keeps the item references,
  - compliance and brand columns,
  - a submittal-pack generator,
  - an approval status for each material,
  - later, invoicing driven by BOQ quantities.

---

## 5. Data entities implied

**Company, users and customers**
- **CompanySettings:** Arabic and English names, unified CR number, VAT number, national address, IBANs, logo, stamp, number sequences (Q-, MTQCT-, CO-, PO-, INV-).
- **User / Role:** can see cost, maximum discount %, approval limit in SAR.
- **Customer:** type (individual, company, developer, government), Arabic and English names, old CR and unified number, VAT number, national address, price list, payment terms, date of last Wathq check.
- **Contact:** mobile, email, role, signer flag, national ID or Iqama (only when needed for Nafath).
- **Site:** city, building type, number of units.
- **Opportunity:** stage, consultant, competitor, value, lost reason.

**Catalog and configuration**
- **Product:** SKU, brand, model, category, Arabic and English text, unit, list price, currency, cost, supplier, install cost, labor type and hours, attributes as JSON (ports, PoE watts, power-supply amps), images, datasheets, warranty, status, "replaced by" link.
- **SupplierPrice:** cost, currency, lead time, valid-from date. **FXRate** for conversion.
- **PriceList / PriceListItem:** fixed price or markup %.
- **Package / PackageItem:** quantity, rolled-up or itemized display.
- **AlternateSet:** tier label (good, better, best).
- **Rule:** type (requires, excludes, capacity), condition, action, message.
- **LaborType:** sell rate and cost rate.

**Quotes**
- **Quote:** number, customer, contact, site, owner, template, language, status, valid-until date, current version.
- **QuoteVersion:** revision label, locked flag, sent date, snapshot of totals (subtotal, discount, VAT, total, cost, margin %), PDF and Excel files, change note.
- **QuoteSection:** area or system name, sort order.
- **QuoteLine:**
  - product reference, snapshot of code and Arabic/English description, "description modified" flag
  - quantity, list price, unit price, cost, discount, install cost, labor hours
  - optional flag, alternate set, selected flag, parent package line
  - BOQ reference, compliance note, sort order
- **ContentBlock / Template:** type, language, body, display conditions, version.
- **ApprovalPolicy / ApprovalRequest:** trigger (discount %, margin %, total), approver role, status, comments, timestamps.
- **PaymentMilestone:** percentage or amount, trigger event, tafqit text.

**Proposals and signatures**
- **ProposalLink / ProposalEvent:** token, expiry, event type (open, time on section, option changed, comment), IP address or device.
- **Signature:** document version, signer, method (OTP / drawn / Nafath via TSP), provider transaction ID, timestamp, IP address, SHA-256 hash, signed file.

**Contracts**
- **Contract / ContractVersion:** number, quote version, snapshot of the parties, template, value, dates, status, signed file.
- **Clause / ClauseVersion:** category, Arabic and English text, version number, approver, effective date.
- **Obligation:** type (payment, handover, warranty or defects liability period, retention, AMC renewal), due date, owner, reminders.
- **ChangeOrder / ChangeOrderLine:** lines that change, reason, visibility (client or internal), approval status, effect on value.

**Operations and finance**
- **SalesOrder / Project.**
- **PurchaseOrder.**
- **Invoice:** ZATCA fields (UUID, invoice counter, previous invoice hash, QR code, clearance status).
- **Payment.**
- **BOQImport:** column mapping, rows (reference, description, unit, quantity, matched product, match confidence, rate).
- **Asset** (P2): serial number or MAC address, warranty end date.
- **AuditLog:** entity, field, old value, new value, user, time.

---

## 6. Recommended MVP scope

**MVP (P0)**
- **Database and access:** replace the Google Sheet and JSON-in-Drive storage with a relational database and an API. Add users and roles (sales, manager, admin). Migrate the catalog and images.
- **Customers:** customer and contact records with the unified CR number, VAT number and national address.
- **Catalog:** add cost and margin, Arabic/English text, datasheet links and packages/kits.
- **Quote builder:** keep everything **[Has]**. Add area/system sections, optional lines and per-line discount.
- **Lifecycle:** statuses, validity date, revisions that lock once sent, duplicating a quote, and a lost reason.
- **Approvals:** thresholds for discount %, margin floor and total value. Block the PDF and sending until approved, with an approver inbox.
- **Templates:** quote templates by job type, plus the notes and terms library.
- **Documents:** Arabic-first bilingual PDF and Excel; tafqit.
- **Contracts from quotes:** 3–4 templates (supply, supply and install, AMC, smart home) with contract statuses.
- **Visibility:** a filterable list, a pipeline and won/lost summary, and an audit log.

**Wave 2 (P1)**
- **Selling:**
  - web proposal with option selection, comments, OTP acceptance, view tracking and notifications (email/WhatsApp)
  - Good/Better/Best alternates
  - auto-added accessories, plus PoE budget and switch-port capacity rules
  - labor types × hours
  - version comparison and reminders
- **BOQ and pricing inputs:**
  - consultant BOQ import/export
  - submittal pack
  - Wathq CR lookup
  - price lists, and supplier price imports with FX
- **Delivery, billing and contracts:**
  - Nafath e-signature for contracts through Signit, emdha or Sadq
  - quote → project → POs
  - change orders
  - ZATCA milestone invoicing
  - AMC with renewals
  - clause library, repository and obligations
- **Analytics:** win rate, quote-to-close time, discount leakage.

**Defer (P2)**
- **AI features** (BOQ and drawing parsing, voice site survey, AI templates, contract agents) should wait until the catalog and quote history are clean.
- **Floor-plan design, takeoff, and riser and rack diagrams** are heavy to build. Integrate later, or use D-Tools SI in the meantime.
- **Online payments** can wait because bank transfer is the norm in KSA.
- **Also later:** redlining, electronic seal, asset tracking, QR service desk, guided selling, conditional content, MCP server.

---

## 7. Sources

Accessed through search-result summaries, because direct fetches were blocked by the proxy.

- **D-Tools:**
  - https://www.d-tools.com/d-tools-cloud-change-orders
  - https://d-tools.com/live-proposals/
  - https://www.d-tools.com/resource-center/from-first-contact-to-signed-deal-a-look-at-d-tools-clouds-sales-capabilities
  - https://www.d-tools.com/resource-center/news-events/d-tools-cloud-expands-feature-set-adds-innovative-new-capabilities
  - https://www.d-tools.com/system-integrator-features
  - https://www.d-tools.com/system-integrator-visio_autocad-integration
  - https://www.d-tools.com/customer-payment-portal
  - https://www.d-tools.com/resource-center/d-tools-showcases-smarter-scalable-project-management-solutions-at-infocomm-2026
  - https://www.d-tools.com/resource-center/d-tools-cloud-wins-residential-systems-best-of-show-award-at-cedia-expo-2026
  - https://www.commercialintegrator.com/news/d-tools-unveils-its-largest-set-of-new-cloud-capabilities-at-cedia-expo-2026/149784
  - https://www.cepro.com/sponsored/d-tools-brings-ai-powered-quote-assist-ai-advisor-to-cedia-expo-2026/627973
  - https://docs.d-tools.cloud/en/articles/1661748-what-are-products-labor-allowances-and-packages
  - https://docs.d-tools.cloud/en/articles/8276200-alternate-set
  - https://docs.d-tools.cloud/en/articles/6622239-getting-started-with-labor
- **Portal.io:**
  - https://help.portal.io/en/articles/11572894-proposal-deep-dive
  - https://help.portal.io/en/articles/11572808-proposal-overview-quickstart-guide
  - https://help.portal.io/en/articles/11573170-change-orders
  - https://www.cepro.com/news/portal-ai-proposal-builder-officially-rolls-out/143683/
  - https://www.strata-gee.com/proposals-that-build-themselves-see-the-game-changing-ai-proposals-from-portal/
- **Jetbuilt:**
  - https://jetbuilt.com/
  - https://jetbuilt.com/2025-updates-rollout/
  - https://help.jetbuilt.com/en/articles/2969351-labor-breakdown
  - https://help.jetbuilt.com/en/articles/4101863-project-overview
  - https://help.jetbuilt.com/en/articles/10184436-project-p-l-reporting
  - https://xtenav.com/blog/jetbuilt-alternatives/
- **simPRO:**
  - https://www.simprogroup.com/features/estimating-software
  - https://www.simprogroup.com/features/takeoffs
  - https://www.simprogroup.com/industries/electrical-software
- **ServiceTitan:**
  - https://www.servicetitan.com/features/pro/pricebook
  - https://help.servicetitan.com/docs/pricebook-pro-overview
  - https://www.servicetitan.com/blog/pricebook-with-titan-intelligence
  - https://winktoolbox.com/blog/how-to-set-up-dynamic-pricing-and-automate-your-servicetitan-pricebook
- **Salesforce:**
  - https://trailhead.salesforce.com/content/learn/modules/product-catalog-management-with-revenue-cloud
  - https://trailhead.salesforce.com/content/learn/modules/revenue-lifecycle-management-foundations/explore-revenue-lifecycle-management
  - https://www.forsysinc.com/blog/what-is-agentforce-revenue-management-the-complete-2026-guide/
  - https://dealhub.io/glossary/salesforce-agentforce-revenue-management-arm/
- **HubSpot:**
  - https://www.hubspot.com/products/revenue/cpq
  - https://vantagepoint.io/blog/hs/hubspot-commerce-hub-cpq-ai-powered-quoting
  - https://medium.com/@wendyteo.wy/hubspots-new-cpq-platform-where-did-code-level-quote-customisation-go-38662805a82e
- **Zoho:**
  - https://www.zoho.com/contracts/features.html
  - https://www.zoho.com/crm/cpq.html
  - https://help.zoho.com/portal/en/kb/crm/cpq/articles/how-it-works
  - https://www.zoho.com/blog/sign/zoho-sign-for-saudi-arabia-transforming-enterprises-with-compliant-digital-signatures.html
  - https://help.zoho.com/portal/en/kb/zoho-sign/integrations/digital-signature-and-identity-providers/articles/advanced-electronic-signatures-via-nafath-for-saudi-arabia
  - https://www.intelligentcio.com/me/2024/03/05/zoho-corp-announces-the-opening-of-its-first-middle-east-data-centres-in-saudi-arabia/
- **PandaDoc:**
  - https://www.pandadoc.com/cpq-software/
  - https://www.pandadoc.com/press/pandadoc-cpq-for-salesforce/
  - https://www.pandadoc.com/press/pandadoc-launches-cpq-solution-for-pipedrive/
  - https://pipeline.zoominfo.com/sales/pandadoc-features
- **Proposify:**
  - https://www.proposify.com/product-overview
  - https://www.capterra.com/p/133332/Proposify/
- **Qwilr:**
  - https://qwilr.com/product/quotes-and-payments/
  - https://help.qwilr.com/article/179-creating-quotes-with-quote-blocks
- **DealHub:**
  - https://dealhub.io/platform/
  - https://thecroreport.com/tools/dealhub/
  - https://pipeline.zoominfo.com/sales/dealhub-review
- **DocuSign:**
  - https://www.docusign.com/products/platform/ai
  - https://www.docusign.com/blog/ai-contract-agents-future-agreement-management
  - https://www.prnewswire.com/news-releases/docusign-unveils-ai-assistant-and-agents-to-power-the-next-era-of-agreement-work-302777909.html
  - https://thelettertwo.com/2026/05/21/docusign-iris-ai-agents-agreement-automation/
- **Saudi e-signature:**
  - https://signit.sa/en
  - https://signit.sa/en/blogs/contract-lifecycle-management-in-saudi-arabia
  - https://signit.sa/en/blogs/signit-secures-dga-trust-license
  - https://channelpostmea.com/2024/12/20/signit-secures-comprehensive-digital-trust-provider-license-in-saudi-arabia/
  - https://www.emdha.sa/
  - https://vinyet.co/saas/Sadq
  - https://hmco.com.sa/digital-contracts-and-e-signatures-are-they-legally-binding-in-saudi-arabia/
  - https://salamahlaw.com/en/electronic-signatures-under-saudi-law/
  - https://www.esignglobal.com/blog/saudi-arabia-electronic-transactions-law-compliance
  - https://sadr.org/en/media-center/news/scca-launches-its-digital-signature-service-to-boost-legally-binding-e-signatures-across-documents-in-arbitration-and-other-adr-proceedings
- **Saudi law and ZATCA:**
  - https://www.hfw.com/insights/saudi-arabias-new-commercial-registration-law-impacts-and-next-steps-for-business-owners/
  - https://dwfgroup.com/en/news-and-insights/insights/2025/4/saudi-commercial-register-law-and-law-of-trade-names
  - https://www.pinsentmasons.com/out-law/analysis/navigating-saudi-civil-transactions-law
  - https://zatca.gov.sa/en/Pages/news_1426.aspx
  - https://www.vatupdate.com/2026/06/30/saudi-arabia-ksa-zatca-phase-2-wave-24-compliance-by-30-june-2026/
  - https://developer.wathq.sa/en/api/32
  - https://developer.wathq.sa/en/apis
- **BOQ AI:**
  - https://www.pelles.ai/university/articles/ai-document-parsing-construction
  - https://designdrafter.com/extract-quantity/
