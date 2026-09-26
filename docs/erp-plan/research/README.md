# Research appendix — raw benchmark reports (25 Sep 2026)

These are the unedited outputs of the eight research streams behind the plan. Each report lists the leading apps in its field, a feature inventory (feature · what it does · which apps have it · priority for the company · Saudi notes), 2025–2026 innovations, Saudi specifics, implied data entities, a recommended MVP and its sources.

> **Context:** the research was run on 25 Sep 2026 for a sibling company (Motqinon Tech, with a Makkah head office and a Jeddah branch) whose quotation tool is very similar; the plan was then adapted to **Al-Mada Al-Mubarak** (this repository) on 26 Sep 2026. The reports are kept unedited: where they name Motqinon, read "the company"; where they describe "the current tool" (Sheets/Drive/Apps Script, `contract.txt`, `Q-…`/`MTQCT-…` numbers), they describe the sibling tool — this repository's app is audited in [01-current-state.md](../01-current-state.md), and the core documents take precedence.

| # | Report | Feeds |
|---|--------|-------|
| 1 | [CRM & sales pipeline](01-crm.md) | [modules/02](../modules/02-crm.md) |
| 2 | [Quotations, CPQ, proposals, contracts & e-signature](02-cpq-proposals-contracts.md) | [modules/03](../modules/03-quotations-cpq.md), [modules/04](../modules/04-contracts-esign.md) |
| 3 | [Accounting, finance & ZATCA Phase 2](03-accounting-zatca.md) | [modules/08](../modules/08-accounting-zatca.md) |
| 4 | [Inventory, procurement, imports & RMA](04-inventory-procurement.md) | [modules/07](../modules/07-inventory-procurement.md) |
| 5 | [Projects, field service, helpdesk & IoT-connected service](05-projects-field-service-iot.md) | [modules/05](../modules/05-projects.md), [modules/06](../modules/06-field-service-assets.md), [modules/12](../modules/12-iot-ai.md) |
| 6 | [HR, payroll, attendance & commissions (KSA)](06-hr-payroll.md) | [modules/09](../modules/09-hr-payroll.md) |
| 7 | [Platform: login, authorisation, audit, hosting & stack](07-platform-auth-hosting-stack.md) | [modules/01](../modules/01-platform-login-security.md), [03-target-architecture.md](../03-target-architecture.md) |
| 8 | [BI, workflow, messaging, documents, localisation, mobile & AI](08-bi-workflow-messaging-ai.md) | [modules/10](../modules/10-reports-bi.md), [modules/11](../modules/11-portal-messaging.md), [modules/12](../modules/12-iot-ai.md) |

**How to read them**
- Priorities inside the reports are the researchers' proposals; the **decided** priorities and phases are in the module specs.
- Where a report and the plan differ, the plan wins. Notably, report 3 suggested owning the ledger with a ZATCA middleware and report 6 suggested building payroll in-house; the plan adopts the platform report's **hybrid** recommendation instead (ERPNext back office for ledger, ZATCA, stock and payroll) — see [03-target-architecture.md §2](../03-target-architecture.md#2-build-vs-extend--decision).
- Evidence limits: direct page fetches of many vendor and government sites were blocked, so most facts come from search-indexed extracts of official pages; items marked *(unverified)*, *(nrv)*, *[S]* or *[U]* must be re-checked before contractual or legal use.
- The detailed security findings on the sibling tool were redacted from report 7 in this public copy; this repository's own findings are in [01-current-state.md §3](../01-current-state.md#3-risk-assessment) and its Phase 0 steps in [§5](../01-current-state.md#5-phase-0--immediate-hardening-of-the-current-app-12-weeks).
