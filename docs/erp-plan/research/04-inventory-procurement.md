# ERP Operations Benchmark: Product Master, Inventory, Procurement, Import Logistics & RMA
*Prepared for Motqinon Tech Trading Co. (شركة متقنون تك للتجارة). Research date: 25 Sep 2026.*

**Method and caveats.** I ran about 30 web searches in September 2026. The research sandbox's egress proxy blocked direct fetches of vendor documentation (odoo.com, learn.microsoft.com, netsuite.com, zoho.com, frappe.io, cin7.com). The facts below therefore come from search-indexed extracts of those pages, reputable partner pages and established product knowledge. Anything I could not confirm is marked *(unverified)*.
**"Seen in" legend:** **OD** Odoo 19 · **EN** ERPNext v15/16 · **NS** NetSuite 2026.x · **BC** Dynamics 365 Business Central · **B1** SAP Business One 10 · **ZI** Zoho Inventory · **C7** Cin7 Core · **FB** Fishbowl.
**Priority:** **P0** = MVP must-have · **P1** = second wave · **P2** = later or differentiator.

---

## 1. Apps benchmarked

| App | Positioning / why it's a leader | Notable strengths (relevant to Motqinon) |
|---|---|---|
| **Odoo 19** (Inventory, Purchase, MRP, Barcode, Quality, Repairs) | The most widely deployed modular open-core SMB suite. v19 was released in October 2025. | Kits via BoM type "Kit". Five landed-cost split methods. A GS1 Barcode app, reworked in v19. Alternative RFQs ("call for tenders") and blanket orders. AI bill digitization that matches bills to POs. A Saudi ZATCA e-invoicing localization. |
| **ERPNext v15/16** (Frappe) | Fully open source (GPL) and self-hostable, with a strong MENA partner base. | The standard buying chain: Material Request → RFQ → Supplier Quotation → PO → Purchase Receipt → Purchase Invoice. Supplier portal, Supplier Scorecard, Landed Cost Voucher, Serial No with warranty/AMC expiry dates, stock reservation and project-wise stock tracking. |
| **Oracle NetSuite 2026.1** | Leading cloud ERP for the mid-market. | Inbound Shipment Management, Supply Allocation/ATP, Demand Planning and landed cost on shipments. 2026.1 added **native vendor consignment** and **Intelligent Bill Capture**. Return Authorization and Vendor Return Authorization. |
| **MS Dynamics 365 Business Central** | Microsoft's SMB ERP, tightly integrated with M365 and Power BI. | Item tracking codes with a warranty date formula. Item charges for landed cost. Assembly BOMs that can include labor resources. Reservations, ATP/CTP, planning worksheets and Service Items. **Payables Agent** (2025 wave 2). |
| **SAP Business One 10** (FP 2502/2508) | SAP's SMB ERP, with a strong GCC partner channel. | Landed Costs document driven by item **Customs Groups**. Serial/batch valuation, Purchase Quotation Generation Wizard, approval procedures, MRP, and **Customer Equipment Cards** with service contracts. |
| **Zoho Inventory** | Low-cost SaaS inside Zoho One. Offers a KSA edition with Arabic/RTL, and ZATCA Phase 2 through Zoho Books. | Composite items, serial/batch tracking, backorders and drop-ship. Landed cost allocation across multiple bills (2025). Multi-level approvals on purchase receives. Mobile scanning. |
| **Cin7 Core** (formerly DEAR) | Inventory-first SaaS for wholesalers and product brands. | Assemblies with auto-assembly kitting, FIFO/FEFO/"Special" serial costing, landed costs, and **ForesightAI** (24-month forecasts that generate POs automatically). |
| **Fishbowl / Katana** (optional) | Inventory and MRP add-ons for QuickBooks/Xero SMBs. | Kitting and serial tracking (FB), make-to-order BOMs (Katana). Low relevance, because Motqinon resells rather than manufactures. |

---

## 2. Feature inventory

### 2.1 Item master & pricing
| Feature | What it does | Seen in | Priority | Notes (KSA / integrator) |
|---|---|---|---|---|
| SKU + bilingual name | Unique code with Arabic/English text | All | P0 | Migrate the Google-Sheet codes as they are. Arabic is mandatory on KSA tax invoices. |
| Brand, manufacturer, model, MPN | Structured make/model identity | NS, B1, EN, ZI, C7 | P0 | SABER PCoC and CST approvals are issued per model. |
| Category tree + typed specs | Hierarchy plus filterable attributes | OD, EN, BC, NS, ZI | P0 | PoE class, resolution, protocol (SIP/Zigbee/Wi-Fi/LoRa), IP/IK rating |
| UoM with buy/sell conversion | Converts box↔unit and roll↔meter | OD, EN, BC, B1, NS, C7 | P0 | Cat6 is bought per 305 m box and sold per meter. |
| Multiple barcodes per item/UoM | EAN/UPC/GS1/vendor codes all resolve to one item | OD (GS1), BC (item references), B1, EN, ZI, C7 | P0 | On Chinese imports the carton barcode differs from the unit barcode. |
| Images, datasheets, manuals | Media and attachments on the item | OD, EN, B1, ZI, NS | P0 | Reuse them in quotation PDFs and handover packs. |
| Supplier catalog per item | Vendor SKU, price, currency, MOQ, lead time, validity window | OD (vendor pricelist), EN (Item Supplier + buying price list), BC, B1 (BP catalog no.), NS, C7 | P0 | The same model often has a China factory source and a KSA distributor source. Keep last-price history. |
| HS code + country of origin | Customs classification on the item | OD, EN (Customs Tariff Number), BC (Tariff No.), NS (Schedule B / country of manufacture) | P0 | Store the 12-digit GCC HS code and link it to a dated duty-rate table (§4). |
| Warranty terms | Default warranty length per item | EN (Warranty Period), BC (warranty date formula on item tracking code), B1 (warranty template) | P0 | Keep two clocks: the supplier's warranty and Motqinon's 2-year customer warranty. |
| Linked labor/service item | Bundles installation and programming labor with hardware | BC (resources in assembly BOM), NS (service items in kits), EN (non-stock item in bundle) | P0 | Replaces the Sheet's "installation cost" column. |
| Variants | Attribute combinations under one template | OD, EN, BC, NS (matrix), ZI (item groups), C7 (families) | P1 | Panel finishes, 7" vs 10" monitors |
| Buy and sell price lists | Multi-currency, tiered, dated prices | OD, EN, BC, B1, NS, ZI, C7 | P0 | Separate lists for developers, contractors and retail. The SAR/USD peg (3.75) makes USD buying simpler. |
| Substitutes + lifecycle status | Alternate items and EOL/obsolete flags | BC (substitutions), B1 (alternative items), EN (Item Alternative) | P1 | Supports the 10-year spare-parts obligation. |
| Compliance certificates per model | PCoC, CST approval and IECEE RC numbers with expiry dates | Not native (custom fields in every product) | P0 | Differentiator: warn or block a PO or sale when a certificate is missing or expired. |

### 2.2 Kits, bundles & BoMs
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Kit / phantom BoM | Sells a kit that explodes into components on delivery; availability is computed from components | OD (BoM type Kit), EN (Product Bundle), NS (Kit/Package), BC (assemble-to-order), B1 (Sales BOM), ZI (composite items), C7 (auto-assembly), FB | P0 | "Apartment intercom kit" = door station + monitor + PSU + switch port + labor |
| Template / parametric BoM | Component quantities can be edited per document or driven by a formula | B1 (Template BOM), BC (editable ATO lines) | P1 | Qty = f(floors, apartments, entrances), which gives an auto-generated BOQ |

### 2.3 Warehouses, locations & flows
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Multi-warehouse | Keeps separate stock per site | All | P0 | Makkah HQ + Jeddah store |
| Bins + putaway rules | Shelf-level locations | OD, EN, BC, B1, NS, C7 | P1 | Serialized devices by aisle/shelf |
| Technician van stock | A van is a location with a named custodian | Generic locations (all) | P1 | Custody sign-off; min/max van refill |
| Project/site stock, issue-to-project | Issues materials to a project and posts their cost to it | EN (Stock Entry + Project), BC (project planning lines + warehouse picks), OD *(unverified)* | P0 | One site sub-location per contract; handles returns from site |
| Transfers with in-transit | Two-step moves between locations | BC, NS, EN, B1, ZI, C7, OD (routes) | P0 | Makkah ↔ Jeddah ↔ vans |
| Drop-ship | Vendor delivers straight to the customer or site | OD, EN, NS, BC, B1, ZI, C7 | P1 | Local distributor → site. Serials are still captured at installation. |
| Vendor consignment | Stock stays vendor-owned and is billed on use | NS (native, 2026.1), OD (stock "owner") | P2 | Negotiable with KSA distributors |
| Stock status / quarantine | Separates good, damaged, under-test and RMA stock | NS (Inventory Status), OD/BC (locations/bins) | P1 | DOA and returned units |

### 2.4 Serial/lot tracking & installed base
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Serial tracking on every move | Captures a unique serial at receipt, move and issue | All | P0 | Applies to every device. Lots are needed only for cable reels and batteries (P2). |
| Bulk serial import at receipt | Paste or import serial lists | OD, C7, BC *(unverified)* | P0 | Source is the supplier's packing-list Excel with SN/MAC |
| Extra identifiers per serial | MAC(s), firmware, SIP account, IMEI | Custom fields only (e.g., BC Serial No. Information card, EN Serial No doctype) | P0 | Validate the MAC (12 hex digits, OUI prefix). Allow several MACs per device. |
| Up/down traceability | Traces vendor/PO → customer/site | OD, BC (Item Tracing), EN, B1, NS, C7 | P0 | Proof for recalls and warranty claims |
| Installed base / equipment card | Records each serial at the customer site with warranty and contract dates | B1 (Customer Equipment Card), BC (Service Items), EN (Serial No warranty/AMC expiry), OD (Repairs/Field Service, partial) | P0 | Customer warranty starts at handover. Map each serial to building/apartment. |

### 2.5 Reservation, availability & replenishment
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Reservation / allocation | Hard-reserves stock to an order or project | OD, EN (Stock Reservation, v15), BC, NS, C7 | P0 | Trigger it when the 50% advance is received. |
| Projected / forecast qty | On hand − reserved + incoming | OD, EN, BC, B1, NS | P0 | Show it on the quotation screen. |
| ATP/CTP + supply allocation | Promises a date from stock plus incoming POs and shipments | NS (ATP; Supply Allocation incl. inbound shipments), BC (ATP/CTP) | P1 | Use a Sun–Thu working calendar with Saudi holidays for the 45–60 working-day commitments. |
| Reorder rules + replenishment worksheet | Min/max and reorder points that produce suggested POs | OD, EN (auto Material Request), BC (planning worksheet), B1 (MRP wizard), NS, ZI, C7 | P1 | Fast movers: exit buttons, PSUs, cable, maglocks |
| Demand forecasting | Statistical or AI forecasts that feed purchase suggestions | NS (Demand Planning), C7 (ForesightAI), BC (Sales & Inventory Forecast ext.), OD (MPS, manual) | P2 | For a project business, pipeline-weighted demand beats time-series forecasting (§3). |
| Backorders | Automatically splits partial deliveries and receipts | OD, EN, BC, NS, ZI, C7 | P0 | Common with partial container arrivals |

### 2.6 Valuation & landed cost
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Perpetual valuation with GL | Every stock move posts value to the ledger | OD, EN, BC, B1, NS, C7 | P0 | Required for real margins |
| Costing methods | FIFO / average / standard / specific | OD (Std/FIFO/AVCO); EN (FIFO/Moving Avg/LIFO); BC (FIFO/LIFO/Avg/Std/Specific); B1 (Moving Avg/Std/FIFO/Serial-Batch); NS (Avg/FIFO/LIFO/Std/Group Avg); C7 (FIFO/FEFO/Special) | P0 | KSA uses IFRS, and IAS 2 prohibits LIFO. Recommend moving weighted average. |
| Landed-cost allocation | Capitalizes freight, insurance, duty and clearance into item cost | OD (equal, qty, current cost, weight, volume); EN (qty, amount, manual); BC item charges (equally, amount, weight, volume); B1 (qty, weight, volume, value, value-after-customs, equal); NS (qty, value, weight); ZI (qty, value, dimensions, weight); C7 | P0 | Import VAT is **not** a landed cost because it is recoverable. |
| One charge across many receipts/bills | Spreads container-level costs over several POs | ZI (multi-bill, 2025), OD, EN, NS (per inbound shipment) | P0 | One container often holds several suppliers' POs. |
| Duty from an item rate table | Computes duty automatically from the item's customs rate | B1 (Customs Groups) | P1 | 12-digit HS code → dated duty rate |
| Estimated → actual landed cost | Accrues a % at receipt, then trues up on final bills | Mostly custom; B1 projected vs actual customs *(unverified)* | P1 | Quotation margins need an estimated LC% per supplier/lane. |

### 2.7 Counting, scanning & execution
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Full stock take | Freezes stock, counts, and posts variances | All | P0 | Year-end (financials/Zakat) |
| Cycle counts | Periodic counts by class or location | OD, BC, B1, NS, C7 | P1 | Monthly on high-value serialized items |
| Mobile barcode/QR scanning | Receive, move, issue and count by scanning | OD Barcode (GS1), NS WMS, ZI & C7 apps, BC (mobile/partner WMS), EN (camera scan) | P0 | Phone-camera PWA that scans SN/MAC labels at GRN and on site |
| Label printing | Prints item, serial and location labels (ZPL/PDF) | OD, NS, BC, ZI, C7 | P1 | QR sticker linking each device to its warranty page |
| Proof of delivery | Captures signature or photo on delivery | OD | P1 | Release delivery only after the 40% payment. The signed POD and handover support the final 10%. |

### 2.8 Procurement (requisition → RFQ → PO)
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Material request / requisition | Records internal demand from a BOQ, a reorder rule or staff | EN (Material Request), NS (Requisitions), B1 (Purchase Request), BC (requisition worksheet), OD (replenishment) | P0 | Generate automatically from the signed contract BOQ minus reserved stock. |
| RFQ to multiple vendors | Sends the same need to several suppliers | EN (RFQ), OD (alternative RFQs / call for tenders), B1 (Purchase Quotation Generation Wizard), NS *(unverified)* | P1 | China factory vs UAE trader vs KSA distributor |
| Bid comparison | Compares price, lead time and terms side by side | OD (compare product lines), EN (Supplier Quotation Comparison) | P1 | Compare on landed cost + lead time, not unit price. |
| Multi-currency PO | Foreign-currency POs with exchange rates | All | P0 | Policy: value stock at the GRN-date rate; post bill FX differences to FX gain/loss. |
| Approval limits | PO approval by amount or role | OD (2-step, minimum amount), BC (approval user limits), NS (purchase limits/routing), B1 (approval procedures), EN (workflow), ZI (multi-level) | P0 | Example: POs above SAR 20k go to the founder. |
| Back-to-back PO from contract | Links PO lines to sales/project lines | OD (MTO), NS & BC (special order), EN, B1 | P0 | Traceable to the contract; feeds project costing |
| Vendor prepayments | Records deposits against a PO | BC (prepayments), B1 (A/P down payment), NS (vendor prepayment) | P0 | 30% T/T deposits are typical with Chinese suppliers. |
| Incoterms on PO | EXW/FOB/CIF terms on the order | OD, BC, NS, B1 | P0 | Determines which landed-cost lines to expect |
| Blanket / framework agreements | Long-term price/volume deals with call-offs | OD, EN, BC, NS | P2 | Annual deal with a KSA distributor |

### 2.9 Receiving, quality & vendor bills
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Partial receipts (GRN) + tolerances | Receives in parts, within over/under limits | All; EN (over-receipt allowance %) | P0 | Capture serials at GRN. |
| Quality inspection | Checklists and pass/fail at receipt | OD (Quality app), EN (Quality Inspection), NS (QM SuiteApp) | P1 | Power-on and firmware check before stock goes to site |
| 2/3-way match | Controls quantity and price across PO, receipt and bill | OD (bill control), BC, B1, NS, EN | P0 | Blocks payment for quantities not received |
| Bill OCR / AI capture | Extracts vendor bill data into a draft bill | OD (digitization), BC (Payables Agent), NS (Intelligent Bill Capture), B1 (via SAP BTP) | P1 | For foreign proformas and commercial invoices |
| Structured e-invoice ingestion | Creates bills from UBL XML | BC (E-Documents), OD (UBL import) | P1 | KSA supplier invoices are ZATCA UBL 2.1 XML, so parse them instead of using OCR. |

### 2.10 Import logistics
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Import shipment record | Groups PO lines into one shipment with B/L, container, vessel, ETD/ETA and status | NS (Inbound Shipment); others need add-ons | P0 (lite) | Status: ordered → shipped → arrived → clearing → released → received |
| Document checklist | Tracks CI, PL, B/L, CoO, SCoC, declaration and insurance | Not native | P1 | Differentiator (§4) |
| Customs declaration capture | Records declaration no., duty, import VAT and fees | Not native | P0 | Duty goes to landed cost; VAT goes to input VAT. |
| Shipment-level landed cost | Allocates all charges for a shipment in one step | NS | P1 | Freight, insurance, duty, port, broker, SABER fees |
| ETA risk alerts | Flags a late ETA against the contract delivery date | NS (supply allocation), custom | P1 | Protects 45–60-day commitments |

### 2.11 Vendor management
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Vendor master with KSA fields | CR, VAT no., national address, IBAN, currency, terms | All (KSA fields are custom) | P0 | Foreign vendors carry no VAT number. |
| Vendor scorecards | Scores on-time %, lead time and quality | EN (Supplier Scorecard, which can block RFQs/POs), OD (on-time rate), BC (Power BI Vendor Quality Analysis, 2025 w2) | P2 | Computed from GRN dates and RMA rates |
| Supplier portal | Vendors answer RFQs and confirm POs | EN, OD, NS (Vendor Center) | P2 | Low value until the vendor base grows |

### 2.12 Returns, RMA & warranty
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Customer returns / RMA | Authorize, receive, inspect, then restock or scrap | NS (Return Authorization), BC (Sales Return Order), OD, EN, B1, ZI, C7 | P1 | Goes to a quarantine location |
| Return to vendor | Vendor RMA plus debit/credit note | NS (Vendor Return Authorization), BC (Purchase Return Order), B1 (Goods Return Request), EN, ZI, C7 | P1 | Re-export to China needs customs references *(verify with broker)*. |
| Warranty replacement (swap) | Replaces a failed serial and updates the installed base | B1 (service call on equipment card), BC (service orders), OD (Repairs "under warranty", Helpdesk), EN (Warranty Claim) | P0 | The swap must also update the MAC in the intercom/SIP configuration. |
| Repair orders | Parts and labor on a repair | OD (Repairs), BC (Service Mgmt), B1 (Service), EN (Maintenance Visit) | P1 | Bench repairs |
| Back-to-back supplier claim | Links a customer RMA to a supplier warranty claim | Not native | P1 | Recovers cost within the supplier's warranty window |
| Spare-parts obligation planning | Compares installed base by model with spares on hand and EOL dates | Not native | P2 | For the 10-year obligation; raises last-time-buy alerts |

### 2.13 Reports
| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Stock on hand & valuation (as of date) | Quantity and value by item/location | All | P0 | Supports month-end close |
| Stock ledger / movement history | Every move, with its source document | All | P0 | Audit trail |
| Reserved vs available by contract | Shows committed stock per contract | OD, EN, BC, NS | P0 | Readiness for each contract |
| Consumption vs BOQ per project | Compares issued materials with the BOQ/budget | EN (Project-wise Stock Tracking), BC (project budget vs usage) | P0 | The integrator's key margin report |
| Aging & slow movers | Stock grouped by days held | EN (Stock Ageing), ZI (Inventory Aging); others via BI | P1 | Obsolete models |
| Shortage / reorder | Items below their reorder level | EN (Item Shortage), C7 (reorder report), OD, ZI | P1 | |
| Purchase analysis & price variance | Spend by vendor/item and price trends | OD, EN, BC (Power BI Purchasing), B1, NS | P1 | |
| Landed-cost % by supplier/lane | Actual uplift over FOB | Custom | P1 | Feeds quotation pricing |

---

## 3. Leading-edge 2025–2026 innovations worth copying
1. **Agentic accounts payable: BC Payables Agent** (2025 release wave 2; more countries from Nov 2025; enhanced in 2026 wave 1).
   - What it does: reads vendor invoices from an M365 mailbox, extracts them with OCR, drafts purchase invoices, matches them to POs, ranks drafts by confidence and learns from posted bills.
   - *Copy as* a "bills inbox". Parse ZATCA XML deterministically, use OCR/LLM only for foreign PDFs, and keep human approval.
2. **GenAI document capture.**
   - NetSuite 2026.1 **Intelligent Bill Capture** uses an OCI Document Understanding generative model. Rollout is progressive from mid-2026, US data centers first.
   - **Odoo 19** bill digitization replaces OCR values with the matched PO's data.
   - *Copy as* extraction of supplier **packing lists** to pre-create serial/MAC records before the goods arrive.
3. **In-app AI agents: Odoo 19** (Oct 2025). RAG agents that act on data (create tasks, update fields, send email), AI-filled fields and natural-language search. *Copy as* Arabic natural-language stock queries.
4. **Order-intake agent: BC Sales Order Agent** (preview 2025; evolving in 2026 wave 1). Reads customer email, checks availability and drafts a quote or order. *Copy as* WhatsApp/email RFQ → draft BOQ built from kit templates.
5. **AI forecasting with auto-POs.** **Cin7 ForesightAI** forecasts up to 24 months ahead with ABC segmentation and multi-location planning; **NetSuite Demand Planning + Planner Workbench** is similar. *Copy as* pipeline-weighted demand (open quotations × win % × kit explosion) for long-lead imports.
6. **Supply allocation over inbound shipments: NetSuite.** Demand is matched to stock, POs and shipments by required date, and ATP comes from firmed supply. *Copy as* an ETA-driven "material readiness %" per contract.
7. **Native vendor consignment: NetSuite 2026.1.** Works with regular, lot and serial items; ownership transfers at sale; vendor returns and replenishment are supported.
8. **Analytics packs: BC 2025 wave 2.** The Power BI Purchasing app adds Key Purchasing Influencers, Vendor Quality Analysis and a Purchase Forecast report; a new Inventory app forecasts stock flow.
9. **Zoho Inventory 2025.** One landed-cost charge can be allocated across multiple bills, and purchase receives support multi-level and custom approvals.
10. **SAP Business One.** AI can be enabled in the web client ("Ask AI"), and document extraction runs through SAP BTP. Partner demos show agentic purchase-quotation creation *(maturity unverified)*.

**Ideas specific to Motqinon (none of the apps does these natively):**
- **Scan-to-commission.** A technician scans SN/MAC on site; the device binds to building/unit, the warranty clock starts and an Arabic handover certificate is generated.
- **Compliance gate.** POs and quotations raise warnings when a model's PCoC or CST approval is missing or expired.
- **Device-cloud sync.** Push installed serials to vendor device clouds where APIs exist *(unverified per brand)*.

---

## 4. Saudi (KSA) specifics
**Customs clearance (ZATCA / FASAH)**
- FASAH is ZATCA's single window for imports.
- The importer (with a CR) or a licensed customs broker files the declaration.
- Per the U.S. Commercial Service, the declaration should be filed at least **48 hours before arrival**. Physically submitted documents were cut from 12 to 2 (commercial invoice + B/L).
- A certificate of origin is still required.
- Sequence: obtain the **SABER SCoC first, then file in FASAH**. Pay duty and import VAT (via SADAD, *verify*), then the goods are released.

**Duties & VAT**
- **Valuation and base rate.** The customs value is **CIF**. Most goods pay **5%**; the range is 0–100%.
- **12-digit HS codes.** The GCC moved to a unified 12-digit HS code on 1 Jan 2025 (reported).
- **July 2024 increase.** From **16 Jul 2024**, HS 8535.21/.29 and **8536.49 (relays > 60 V)** rose from 5% to **15%**. In-wall 230 V smart relays may fall under 8536.49 *(verify)*.
- **Late-2025 amendment.** A further amendment to the Integrated Tariff raised rates, reportedly up to 20%, mainly in food/agri/light manufacturing. Check every electronics line individually.
- **ITA lines may be 0%.** KSA is a **WTO ITA participant**, so many IT/telecom lines should be 0%. Confirm the applied rate per line.
- **Import VAT.** 15% on (CIF + duty), paid at clearance. It is recoverable as input tax, using the declaration in the importer's name as evidence.
- **Imported services** fall under reverse-charge VAT.
- **Indicative HS codes** *(unverified; confirm with a broker or the ZATCA tariff search)*:

| Product | Indicative HS code |
|---|---|
| IP door stations / monitors, PoE switches, Zigbee gateways | 8517.62 or 8517.69 |
| IP cameras | 8525.89 |
| Power supplies (PSUs) | 8504.40 |
| Exit buttons | 8536.50 |
| Electric / smart locks | 8301.40 |
| Magnetic locks | 8505.90 or 8301.40, depending on design |
| LAN cable | 8544.49 |

**SABER / SASO**
- **Step 1:** on saber.sa, register the product with its HS code. SABER maps it to the applicable technical regulation(s).
- **Step 2:** a notified body issues a **PCoC** per model, typically valid 1 year.
- **Step 3:** each shipment needs its own **SCoC** that references the PCoC. Without it the goods cannot clear.
- The Low-Voltage Electrical Equipment regulation covers mains-powered items and adapters. Some electrical products also need a **SASO IECEE Recognition Certificate**.
- The "Letter of Undertaking" self-declaration route was reportedly removed in 2025.
- When buying from a KSA distributor, the importer of record carries the SABER/CST burden. Flag that source as "compliance by vendor".

**CST type approval**
- Radio or network-connected devices need CST type approval **before import or sale**. That covers Wi-Fi, Zigbee, BLE, LoRa, cellular and IoT modules.
- Certificates are reported valid for 2 years.
- CST's updated **IoT framework (2024)** requires a compliance certificate for every imported IoT device. It reportedly took effect around 30 Sep 2024.
- CST registration may run through SABER *(verify)*.

**Import document set per shipment**
1. Commercial invoice
2. Packing list, with the SN/MAC list
3. B/L or AWB
4. Certificate of origin
5. SABER SCoC(s)
6. CST certificate (radio items)
7. Insurance certificate (under CIF)
8. FASAH declaration and duty/VAT receipt
9. Port release / delivery order
10. Broker invoice

**National Address (SPL)**
- Components: building no. (4 digits), street, district, city, postal code (5 digits) and additional no. (4 digits).
- The short address is 4 letters + 4 digits (e.g., RCTB4359).
- Use it for sites, customers and vendors, plus a geo-pin for deliveries.
- ZATCA B2B invoices carry structured buyer address fields, so every vendor must hold Motqinon's correct national address.

**E-invoicing on the purchase side**
- Phase 2 waves continue into 2026.
- B2B standard invoices are **cleared by ZATCA before they reach the buyer**. They arrive as **XML or PDF/A-3 with embedded XML**, with a QR code, and the buyer must **receive and store** them securely.
- The ERP should:
  - keep the original file;
  - parse the UBL into the bill;
  - validate the supplier VAT number (15 digits), the VAT arithmetic and Motqinon's own VAT number and address;
  - link credit and debit notes to the original UUID.
- POs and GRNs are not tax documents.
- Foreign suppliers issue no ZATCA invoice; VAT on their goods is settled at customs.
- Retention: 6 years, longer for capital assets *(verify)*.

**Local supply base (found)**
- **Akuvox:** Digital Myth Solutions (Riyadh; describes itself as the first/main distributor), SaudiTK, Al-VoIP.
- **Hikvision** (including intercom): Adel Abdulaziz Al Quraishi (national distributor), hikvision-saudi.com, Steps Group, TeleNoc.
- **Locks:** AlMoajil Hardware (sole agent for Yale/Union/MAB), Smart Finger (Riyadh/Jeddah), Akada Trading.
- **Marketplaces:** Microless (Aqara, Commax, Yale), plus Amazon.sa and Noon.
- I found no KSA distributors for DNAKE, 2N or Fermax.

**How the KSA requirements appear in the ERP**
| Requirement | Object / fields | Control |
|---|---|---|
| HS code & duty | item.hs_code12 → hs_duty_rate (dated) | Duty estimate on the PO; variance against the actual declaration |
| SABER | cert (PCoC per model); shipment_line.scoc_no | Warn or block a PO when the PCoC is missing or expired; SCoC required before "clearing" status |
| CST | item.radio_tech[] + cert | Certificate mandatory whenever a radio flag is set |
| FASAH | import_shipment.declaration_no/date, duty, VAT, fees | Duty + fees go to landed cost; VAT goes to the input-VAT account with the declaration reference |
| ZATCA vendor e-invoice | vendor_bill.zatca_uuid, qr, xml, supplier_vat | Reject bills with an invalid VAT number or totals |
| National address | address (SPL parts, short address, geo) | Required on vendors, customers and sites |
| Calendar | Fri–Sat weekend; Eids; 22 Feb (Founding Day); 23 Sep (National Day) | Delivery promise dates and SLA timers |

---

## 5. Data entities implied

| Entity | Key fields |
|---|---|
| item | sku, name_ar/en, brand, model, mpn, category, type (stock/service/kit), base_uom, tracking (none/serial/lot), hs_code12, origin_country, weight/volume, warranty_months_customer/supplier, install_service_item, lifecycle, radio_tech[] |
| item_barcode | item, uom, code, type (EAN/UPC/GS1/vendor) |
| item_supplier | item, vendor, vendor_sku, currency, price, moq, lead_time_days, valid_from/to, preferred |
| price_list / line | kind (buy/sell), currency, segment, item, uom, min_qty, price, validity |
| compliance_cert | item/model, type (PCoC, SCoC, CST, IECEE RC), number, issuer, issued/expiry, file |
| hs_duty_rate | hs_code12, duty_pct, effective_from/to, source |
| kit_bom / kit_bom_line | parent, type (phantom/assembly/template), component, qty or qty_formula, optional |
| location | warehouse, type (internal/bin/van/project_site/transit/quarantine/consignment), project, custodian |
| stock_move (ledger) | item, qty, uom, from/to location, serials/lots, unit_cost, value, source_doc, project, user, timestamp |
| stock_quant | item, location, serial/lot, on_hand, reserved |
| serial_number | serial, item, macs[], firmware, status, location, vendor, po/grn, supplier_warranty_end, customer, project, unit/apartment, handover_date, customer_warranty_end |
| reservation | item, qty/serials, demand ref (contract/project), location, released_at |
| project | contract no., customer, site address, BOQ lines, milestones (50/40/10), due date (working days) |
| material_request | project/BOQ, source (BOQ/reorder/manual), lines (item, qty, need_by), status |
| rfq / rfq_vendor / supplier_quote_line | items, vendors, price, currency, lead_time, incoterm, validity |
| purchase_order / line | vendor, currency, fx_rate, incoterm, payment_terms (deposit %), approval_state; lines (item, qty, price, need_by, project, contract_line) |
| approval_rule | doc_type, threshold, role, sequence |
| import_shipment | mode, carrier, bl_awb, containers[], vessel, port, ETD/ETA, status, broker, fasah_decl_no/date, duty, import_vat, fees |
| shipment_document | shipment, type (CI/PL/BL/CoO/SCoC/decl/insurance), number, file, verified |
| landed_cost / line / allocation | receipts/shipment, charge type, vendor_bill, amount, method, allocated per receipt line |
| goods_receipt / line | po_line, qty, serials, location, inspection_status |
| quality_inspection | grn_line/serial, checklist, result, photos |
| vendor_bill / line | vendor, number, date, currency, fx, VAT, zatca_uuid, qr, xml, match_status |
| vendor | name_ar/en, CR, VAT no., national address, country, currency, terms, IBAN, scorecard metrics |
| rma / vendor_rma | serial, party, reason, warranty_check, disposition, replacement_serial, linked claim, customs ref |
| stock_count / line | scope, snapshot_qty, counted_qty, variance, approver |

---

## 6. Recommended MVP scope and what to defer

**MVP (P0), in about 3 months:**
1. **Item master v2.** Import from the Google Sheet and add brand/model, UoM, barcodes, datasheets, HS code/CoO, both warranty clocks, supplier catalog, buy/sell price lists, kits, and certificate fields.
2. **Locations and transfers.** Makkah and Jeddah warehouses, project-site, transit and quarantine locations, with simple transfers.
3. **Serials.** Serial + MAC tracking with bulk import from packing lists, and a **phone-camera PWA** for GRN, issue-to-project and on-site install/handover.
4. **Contract-to-PO chain.** Signed contract/50% advance → reservation → shortage → material request → multi-currency PO (deposits, Incoterms, amount-based approval) → partial GRN with backorders.
5. **Import shipment "lite".** B/L, containers, ETA, status, document uploads, FASAH declaration number, and the duty/VAT split.
6. **Costing.** Moving-average perpetual valuation, and landed costs allocated by value/quantity across several receipts.
7. **Vendor bills.** 3-way match, with the ZATCA XML/PDF attached.
8. **Installed base and warranty.** Installed base per site, warranty lookup by serial, and warranty swaps.
9. **Reports.** Valuation, stock ledger, reserved vs available, and consumption vs BOQ per project.

**Second wave (P1), months 4–8:**
- Bins and van replenishment.
- RFQ with bid comparison.
- Reorder rules and replenishment worksheet.
- Cycle counts.
- Quality inspection.
- ZATCA XML auto-ingestion, plus OCR for foreign invoices.
- Full customer and vendor RMA, repairs, and supplier claims.
- ATP driven by ETAs, and ETA risk alerts.
- Document-checklist enforcement.
- Dated HS duty table and estimated→actual landed cost.
- Label printing, drop-ship, aging and purchase analytics.

**Defer (P2):**
- AI forecasting (start with the pipeline-weighted version).
- Vendor scorecards and supplier portal.
- Blanket agreements and consignment.
- Assemble-to-stock.
- Specific-identification costing and lot tracking.
- Spare-parts obligation planning.
- Agentic AP.

**Build-vs-adopt note:** ERPNext's doctype model is the closest open-source blueprint for this domain (Material Request, RFQ, Supplier Quotation, Landed Cost Voucher, Serial No, Warranty Claim, Stock Reservation). Mirror its entities even if you build custom.

---

## 7. Sources
*Direct page fetches of these domains were blocked by the research sandbox's egress proxy. Content was consulted through search-engine extracts of the pages listed.*

**Odoo**
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/landed_costs.html
- https://www.odoo.com/documentation/19.0/applications/finance/accounting/vendor_bills/invoice_digitization.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/manage_deals/blanket_orders.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/manage_deals/rfq.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/gs1_usage.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment.html
- https://www.odoo-bs.com/blog/global-5/odoo-19-features-401
- https://innowise.com/blog/what-to-expect-from-odoo-19/
- https://www.nalios.com/en/blog/what-s-new-in-odoo-6/odoo-19-ai-deploying-your-own-intelligent-agents-with-rag-123
- https://ecosire.com/blog/odoo-purchase-vendor-management

**ERPNext**
- https://docs.erpnext.com/docs/user/manual/en/request-for-quotation
- https://docs.frappe.io/erpnext/supplier-scorecard
- https://docs.erpnext.com/docs/v14/user/manual/en/buying/articles/how-to-create-a-supplier-quotation-through-the-supplier-portal
- https://docs.frappe.io/erpnext/v13/user/manual/en/stock/material-request
- https://greycube.in/erpnext_v15_modulewise_feature

**NetSuite**
- https://www.netsuite.com/portal/resource/articles/erp/new-netsuite-2026-1-inventory-pricing-connector-and-warehouse-management-ai-capabilities-help-optimize-business-operations.shtml
- https://www.houseblend.io/articles/netsuite-2026-1-release-ai-features-breakdown-2
- https://www.houseblend.io/articles/netsuite-document-ai-invoice-extraction
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159171219251.html
- https://www.houseblend.io/articles/netsuite-atp-methods-supply-allocation
- https://www.brokenrubik.com/blog/netsuite-landed-cost-guide

**Business Central**
- https://learn.microsoft.com/en-us/dynamics365/release-plan/2025wave2/smb/dynamics365-business-central/planned-features
- https://learn.microsoft.com/en-us/dynamics365/release-plan/2026wave1/smb/dynamics365-business-central/planned-features
- https://www.the365people.com/blog/dynamics-365-business-central-2025-release-wave-2
- https://www.withum.com/resources/whats-new-in-business-central-2025-wave-2-features-and-timeline/
- https://stoneridgesoftware.com/dynamics-365-business-central-2026-wave-1-new-tools-and-features/

**SAP Business One**
- https://sap-b1-blog.com/en/new-features-in-sap-business-one-10-0-fp-2502/
- https://sap-b1-blog.com/en/new-features-in-sap-business-one-10-0-fp-2508/
- https://help.sap.com/docs/SAP_BUSINESS_ONE_WEB_CLIENT/2554bf7e9aa347729b0547a737e123ac/ac9f7d8d395e499c9e0ef91f0f0a84fd.html
- https://learning.sap.com/courses/managing-logistics-in-sap-business-one/managing-serial-numbers-and-batches
- https://sap-business-one.us/purchase-quotations-wizard-sap-business-one/

**Zoho Inventory**
- https://www.zoho.com/us/inventory/kb/general-overview/zom-feature-list.html
- https://www.zoho.com/us/inventory/whats-new/
- https://www.zoho.com/us/inventory/kb/bill/landed-cost.html
- https://www.zoho.com/us/inventory/backorders-dropshipments/
- https://www.zoho.com/us/inventory/help/advanced-inventory-tracking/serial-number-tracking.html
- https://zocoden.com/ksa/inventory-management/

**Cin7 Core**
- https://www.cin7.com/features/inventory/forecasting/
- https://help.core.cin7.com/hc/en-us/articles/10955782486927-Introduction-to-Cin7-ForesightAI
- https://www.cin7.com/features/manufacturing/assembly-manufacturing/

**KSA: customs and duties**
- https://www.trade.gov/country-commercial-guides/saudi-arabia-import-requirements-and-documentation
- https://www.fasah.sa/trade/sau/html/en_US/ImporterServices.html
- https://radhiawad.com.sa/english/saudi-customs-clearance/
- https://radhiawad.com.sa/english/saudi-customs-duty-and-tariff-guide-2026/
- https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/Integrated-Tarrifs.aspx
- https://globaltaxnews.ey.com/news/2025-2468-saudi-arabia-amends-its-integrated-customs-tariff-schedule
- https://www.deloitte.com/middle-east/en/services/tax/perspectives/ksa-increased-customs-duty-on-specific-electrical-items.html
- https://www.wto.org/english/tratop_e/inftec_e/itapart_e.htm
- https://www.cleartax.com/sa/vat-on-imports-and-exports

**KSA: SABER/SASO and CST**
- https://www.s-ge.com/export/en/articles/guide/saudi-arabia-conformity-assessment-saber-frequently-asked-questions-and-step-step
- https://watheeq.com.sa/media_center/saso-lve-guide-2025/
- https://santiq.com/articles/compliance-guides/saudi-arabia-cst-certification-type-approval-overview
- https://www.eleoscompliance.com/en/article/saudi-arabia-new-iot-regulation
- https://icertifi.com/saudi-arabia-cst-updated-iot-regulatory-framework/
- https://thesaudigate.com/cst-registration-through-saber-saudi-arabia-simplify-product-compliance-and-market-entry-with-the-saudi-gate/

**KSA: e-invoicing and national address**
- https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf
- https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx
- https://www.cleartax.com/sa/faqs-on-phase-2-of-e-invoicing-in-saudi-arabia
- https://splonline.com.sa/en/national-address-1/
- https://addressguard.io/address-format/saudi-arabia/

**KSA: distributors and marketplaces**
- https://dms-ksa.com/akuvox/
- https://www.sauditk.com/brand/akuvox/
- https://al-voip.com/collections/akuvox-products
- https://www.hikvision.com/sa/Partners/channel-partners/find-a-distributor/
- https://hikvision-saudi.com/
- https://stepsgroup.net/hikvision-authorized-dealer-distributor-riyadh/
- https://hwdev.almoajilholding.org/Home/products
- https://saudi.microless.com/smart-door-locks/
- https://smart-finger.com/smart-door-locks/
- https://akada.com.sa/product-category/smart-locks/smart-home/smart-locks-2/
