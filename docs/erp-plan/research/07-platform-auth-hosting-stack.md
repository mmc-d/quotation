# Platform Foundation Benchmark and 2026 Stack Recommendation

**Client:** Motqinon Tech Trading Co. (شركة متقنون تك للتجارة)
**Scope:** login and identity, authorization (RBAC), audit, multi-tenancy, Saudi compliance and hosting, tech stack
**Prepared:** 2026-09-25

**How this was verified.** The environment's egress proxy blocked direct fetches of most government and vendor sites (nist.gov, sdaia.gov.sa, my.gov.sa, owasp.org, odoo.com and others), and the session's web-search quota ran out partway through. So verification works at three levels:

- **Checked against primary sources on GitHub:** NIST SP 800-63B-4 (NIST's own `usnistgov/800-63-4` repository), the OWASP Top 10:2025 list, the Odoo ZATCA module's licence, the ERPNext and Frappe licences, the LavaLoon ZATCA app, and the Better Auth admin plugin.
- **Checked at search-result level:** PDPL, NCA, cloud regions, Nafath, Keycloak and Supabase. I read the titles and snippets of official or legal pages but could not open the full pages.
- **Not re-fetched this session:** the ERP/CRM authorization models (Salesforce, Dynamics, Zoho, Odoo) and the Auth0, Clerk, WorkOS and Entra feature lists. These come from long-standing vendor documentation.

Anything I could not confirm is marked *(unverified)*.

---

## 0. Bottom line

1. **Current app: stop the data exposure now.** Three problems need fixing before the rebuild:
   - Anyone can read the quote and contract files, which hold client personal data and prices.
   - Anyone can create or overwrite quotes and contracts, because the Apps Script save endpoint has no authentication.
   - Planted content can run code in a user's browser when a contract or quote is opened (a "stored XSS" chain).

   The quick wins in §3 fix most of this in days.
2. **Build or extend? Do both, one for each layer.**
   - **Extend** a proven open-source ERP for the commodity back office: general ledger, VAT, **ZATCA Phase 2**, inventory and purchasing.
   - **Build** your own product for the front office that makes you different: quotations and product configuration (CPQ), CRM, projects and installations, service contracts, a technician app, and an IoT device registry.
   - **Do not** write your own ZATCA signing or accounting engine.
3. **Back office: ERPNext plus an open-source ZATCA app.** ERPNext is GPLv3. For ZATCA, use either LavaLoon's *KSA Compliance* app (AGPL-3.0, Phase 1 and 2) or ERPGulf's *zatca_erpgulf*.
   - **Odoo Community 19 is a credible alternative.** Its ZATCA module, `l10n_sa_edi`, is **LGPL-3 and ships in the free Community code** (verified from its manifest file). Several blogs wrongly say it needs the paid Enterprise edition.
4. **Front office: a TypeScript stack as one modular application.** Next.js for the web UI, NestJS (or Hono) for the API, PostgreSQL with the Drizzle ORM, and Better Auth for login.
   - Make it **multi-tenant from day one**: every table carries a `tenant_id` column, and PostgreSQL Row-Level Security (RLS) stops one tenant's rows from being read by another.
5. **Identity (login):**
   - **Staff** sign in with Google Workspace. Add **passkeys** and **TOTP** authenticator codes. NIST requires at least one phishing-resistant sign-in option at its "AAL2" assurance level, and passkeys meet that.
   - **Customer-portal users** sign in with an emailed one-time code or magic link.
   - **Keep identity data in-Kingdom.** Better Auth stores it in your own Postgres, which is simpler under PDPL than US-hosted services (Clerk, Auth0, WorkOS).
   - **Keycloak** is the fallback if later SaaS customers need heavy enterprise single sign-on (SAML) or automatic user provisioning (SCIM).
6. **Hosting: Google Cloud Dammam (`me-central2`) is the best fit today.** Managed PostgreSQL (Cloud SQL and AlloyDB) is listed there.
   - Oracle has two Saudi regions (Jeddah and Riyadh).
   - Azure's Saudi region is announced for November 2026 and AWS's for December 2026. Neither was available on 2026-09-25.
7. **Security acceptance bar:** OWASP ASVS 5.0 Level 2, the OWASP Top 10:2025, and NIST SP 800-63B-4 at assurance level AAL2 for all staff. Admins and finance users additionally use passkeys.

---

## 1. Solutions benchmarked

| Product | Category | Why it's a leader | Notable strengths |
|---|---|---|---|
| Auth0 (Okta Customer Identity) | Customer-identity SaaS | Defined the category; Universal Login and "Actions" extensibility | Organizations (B2B), passkeys, adaptive MFA, breached-password detection, bot detection, private-cloud option. No public Saudi region *(unverified)*. |
| Microsoft Entra External ID | Customer-identity SaaS | Microsoft's successor to Azure AD B2C | Conditional Access, federation with Microsoft identities, sign-in logs. Saudi data location *(unverified)*. |
| Google Workspace / Cloud Identity | Staff identity provider | Motqinon already works in Google Drive and Sheets | Central enforcement of 2-step verification and passkeys, login audit, account suspension. OIDC `hd` claim restricts sign-in to your domain. |
| Clerk | Developer-first auth SaaS | Best drop-in React components | Organizations, passkeys, MFA, session and device lists, impersonation. US-hosted, which is a PDPL cross-border transfer. |
| Supabase Auth | Backend-as-a-service auth | Tight integration with Postgres RLS | MFA (TOTP, phone, WebAuthn factors), SAML SSO, custom access-token hook for role claims, **passkeys in beta (May 2026)**. Self-hostable. No Saudi region. |
| Keycloak | Open-source identity provider (CNCF) | Default choice for self-hosted identity | OIDC/SAML brokering, **Organizations with per-org fine-grained admin (26.7, July 2026)**, passkeys, brute-force detection, event logs, impersonation, **SCIM API (preview, 26.7)**. Java service to operate. |
| WorkOS | B2B "enterprise-readiness" SaaS | Fastest way to add SSO and SCIM | AuthKit, SAML/OIDC, Directory Sync (SCIM), Audit Logs, fine-grained authorization, self-serve admin portal. US-hosted. |
| **Better Auth** | Open-source TypeScript auth library (runs inside your app) | Fastest-growing TypeScript auth library; now maintains Auth.js/NextAuth; announced joining Vercel *(date unverified)* | Plugins: organization and teams, admin (ban users, list/revoke sessions, **impersonation with 1-hour default**, custom access control), 2FA (OTP/TOTP), passkey, magic link, email OTP, phone, SSO, SCIM. Data stays in your Postgres. You own patching: a 2026 SCIM authorization-bypass CVE (CVE-2026-67330) was fixed upstream. |
| Nafath (نفاذ) | National digital identity | Covers every citizen and resident | Passwordless push to the Nafath app with number matching. Private-sector access requires application and approval (see §4.2). |
| Salesforce | CRM | Reference model for CRM authorization | Profiles plus permission sets and permission-set groups; role hierarchy; org-wide defaults plus sharing rules; field-level security; Setup Audit Trail; field history. |
| Dynamics 365 / Dataverse | ERP and CRM | Cleanest "privilege × scope" model | Business units; security roles where each privilege has a scope (user / business unit / parent-child units / organization); teams; field security profiles; hierarchy security; auditing. |
| Odoo 19 | Open-core ERP | Largest open-source ERP ecosystem | Groups, access-control lists (`ir.model.access`), record rules (`ir.rule`), multi-company. ZATCA module `l10n_sa_edi` is LGPL-3 in Community. |
| ERPNext / Frappe | Open-source ERP (GPLv3; framework MIT) | Complete open-source ERP; strong Saudi community | Role permissions with "perm levels" (field-level), User Permissions (limit records by company, branch or territory), "If Owner" rules, submit/cancel/amend immutability, version history. Two ZATCA apps available. |
| Zoho CRM | Small-business CRM | Arabic UI and strong in the Gulf | Role hierarchy, profiles, data-sharing rules, territories, field-level permissions. |

---

## 2. Feature inventory

### 2.1 Login and identity

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| NIST-grade passwords | Minimum **15 characters if the password is the only factor, 8 with MFA**; accept at least 64; no composition rules; no forced periodic changes; allow paste; count each Unicode character as one; store salted and hashed | NIST 63B-4 §3.1.1.2; Better Auth, Keycloak, Auth0 | P0 | Verified in NIST's own source. Use Argon2id or scrypt for hashing. |
| Blocked and breached passwords | Reject common or leaked passwords when set or changed | NIST (mandatory); Auth0, Clerk, Entra password protection; Better Auth HIBP plugin | P0 | Use the k-anonymity HIBP range API (only a hash prefix leaves your server) |
| Passkeys (WebAuthn) | Phishing-resistant sign-in using the device's biometric or PIN | Better Auth, Keycloak, Supabase (beta), Auth0, Clerk, Entra, WorkOS | P0 | NIST §3.2.5: services **must offer at least one phishing-resistant option at AAL2**. Synced passkeys are fine at AAL2 but **not allowed at AAL3**. |
| TOTP MFA and recovery codes | Authenticator-app codes; single-use backup codes stored hashed | All vendors | P0 | Mandatory for admin, finance and approver roles |
| SMS or WhatsApp OTP | Code sent to the phone | Supabase, Auth0, Clerk, Better Auth (phone and email OTP) | P2 | NIST classes SMS/phone codes as a **"restricted" authenticator** (§3.1.3.3): offer alternatives and watch for SIM-swap signals. Neither SMS nor WhatsApp codes are phishing-resistant, so use them only as a fallback. |
| Google / Microsoft SSO | Staff sign in with their Google Workspace or Microsoft account | All vendors | P0 | Check the verified email and domain (`hd` claim). Enforce 2-step verification or passkeys on the Google side. |
| Magic link / email OTP | Passwordless sign-in for occasional users such as customer-portal clients | Better Auth, Supabase, Clerk, Auth0, WorkOS | P1 | Valid for 15 minutes or less, single use, and invalid after a successful login |
| Enterprise SSO per tenant | A SaaS customer connects its own identity provider after proving it owns its domain | WorkOS, Auth0 Organizations, Keycloak, Better Auth SSO, Supabase SAML | P2 | Becomes P1 at the SaaS stage |
| Invitation-only onboarding | Admin sends a signed, expiring, single-use invite with the role and branch preset | Better Auth organization plugin, Clerk, Auth0, Keycloak | P0 | No public sign-up for staff |
| Safe account recovery | Reset through a verified channel plus a second factor; no security questions or hints; notify the user | NIST forbids security questions (KBA) | P0 | |
| Step-up authentication | Ask for a passkey or TOTP again before sensitive actions: approving a large discount, exporting data, changing an IBAN, granting roles | Auth0 step-up, Entra authentication strengths, Keycloak level-of-assurance | P1 | |
| Bot defence on login | CAPTCHA or Turnstile challenge when risk signals appear | Auth0 Bot Detection, WorkOS Radar, Clerk; NIST §3.2.2 | P1 | |
| Nafath verification | National-ID-verified identity for customers, for example before signing a contract | Nafath, usually through an approved intermediary | P2 | Needs approval; see §4.2 |
| Arabic-first login screens | Right-to-left layout, Arabic error messages, OTP fields that accept Arabic-Indic digits (٠-٩) | Localization in Clerk and Auth0; your own UI with Better Auth | P0 | Convert Arabic-Indic digits to Western digits before checking a code |

### 2.2 Session and device security

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Server-side sessions in secure cookies | Opaque session ID in an `HttpOnly`, `Secure`, `SameSite` cookie; no tokens in `localStorage` | Better Auth (database sessions), Keycloak, Clerk | P0 | The current app keeps its API key in `localStorage` |
| Re-login timeouts | AAL2: log out after **24 hours overall / 1 hour idle**. AAL3: **12 hours / 15 minutes** | NIST 63B-4 §2.4.3 and §2.5.3 | P0 | Make these configurable per role |
| Session list and revoke | Show each session's device, IP, location and last activity; revoke one or all | Better Auth admin (list/revoke), Keycloak, Clerk, Entra | P0 | |
| Automatic global sign-out | Revoke all sessions on password reset, MFA change, role change or deactivation | Keycloak, Better Auth | P0 | |
| Throttling | Disable an authenticator after **no more than 100 consecutive failures**; add growing delays; limit per IP | NIST §3.2.2; Better Auth rate limiter; Keycloak brute-force detection | P0 | Prefer delays to hard lockouts, which attackers can abuse to lock users out |
| Remember device for MFA | Skip the second factor on a trusted device for up to 30 days | Auth0 "remember browser", Entra | P1 | Never for admins or approvers; revoke on password reset |
| New-device alerts | Email or WhatsApp notice with a "this wasn't me" revoke link | Google, Clerk, Auth0 | P1 | |
| Technician mobile-app tokens | Mobile OAuth sign-in (PKCE), rotating refresh tokens, secure device storage | Better Auth (Expo), Keycloak, Auth0 | P1 | |
| Impersonation sessions | Support staff act as a user for a limited time, with a visible banner and full audit; impersonating admins needs explicit permission | Better Auth (1-hour default; separate `impersonate-admins` permission), Clerk, Keycloak, Salesforce "Login As" | P1 | |
| CSRF and clickjacking defence | SameSite cookies, Origin checks, `frame-ancestors 'none'` | All modern frameworks | P0 | |

### 2.3 Authorization model

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Permission catalogue (resource:action) | Includes actions beyond create/read/update/delete: submit, approve, cancel, amend, print, export, share | ERPNext, Odoo access lists, Dynamics privileges | P0 | |
| Roles as additive permission sets | A user can hold several roles; permissions only add up, with no deny rules except separation-of-duties checks | Salesforce permission sets, Zoho profiles, Odoo groups, ERPNext roles | P0 | |
| Record scope per permission | Each permission applies to **own / team / branch / company / all** records | Dynamics scope levels, Odoo record rules, ERPNext "If Owner" plus User Permissions | P0 | This is the core of the model |
| Company and branch context | Each user has a list of allowed companies and branches plus an active one; every record is stamped with `company_id` and `branch_id` | Odoo multi-company, ERPNext Company user permission, Dynamics business units | P0 | |
| Manager hierarchy | Managers see their team's records | Salesforce role hierarchy, Dynamics hierarchy security, Zoho | P1 | |
| Sharing | Share a single record by hand, or share by rules based on criteria | Salesforce, ERPNext Share, Dynamics | P1 | |
| Territories | Region-based access (Makkah, Jeddah, Riyadh) | Zoho territories, Salesforce territory management | P2 | |
| Field-level security | Hide or lock groups of fields: cost, margin, supplier price, national ID, IBAN | Salesforce field-level security, ERPNext perm levels, Dynamics field security profiles, Odoo field groups | P0 | |
| Approval limits | Per-role maximum discount %, quote value and PO value, with an escalation chain | ERPNext Authorization Rule and Workflow, Dynamics approvals, Odoo approvals | P0 | |
| Separation of duties | The person who creates a document cannot approve it, and the person who creates a payment cannot post it | ERP audit practice | P1 | |
| Document state gates | Draft → submitted → approved → posted. Posted documents cannot change; corrections go through an amendment or credit note. | ERPNext document status, Odoo posted entries | P0 | Matches ZATCA's credit/debit note rules |
| Server-side enforcement plus database backstop | Every API call checks the policy, and Postgres RLS enforces tenant separation as a second line of defence | OWASP A01:2025; Supabase RLS | P0 | Hiding buttons in the UI is cosmetic only |
| "Why can I see this?" explainer | Shows a user's effective permissions for troubleshooting | Salesforce access summary, Dynamics "Check access" | P2 | |
| Separate policy engine | Move authorization decisions into a dedicated service | Keycloak 26.7 (AuthZEN standard), WorkOS FGA, Cerbos, OpenFGA | P2 | Only if rules outgrow in-app code |

**Recommended model in one sentence:** a *role assignment* links a user to a role within a scope (tenant, company or branch). Each permission a role grants names an action and the widest record scope it covers (own, team, branch, company or all). On top of that sit field-group masks, per-role approval limits and document state gates. Tenant separation is also enforced a second time in the database with Postgres RLS.

### 2.4 Audit and governance

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Append-only audit log | Records who (including any impersonator), which tenant, what action, which record, before/after values, IP, browser and reason | WorkOS Audit Logs, Salesforce Setup Audit Trail, Dynamics auditing | P0 | App's DB role can only insert; hash-chain rows; daily export to a locked storage bucket |
| Field history on key records | Tracks price, quantity, discount, status, owner and the customer's VAT and CR numbers | Salesforce field history and Field Audit Trail, Odoo tracking, ERPNext Version | P0 | |
| Login and admin event log | Logins, failures, MFA and passkey changes, role grants, impersonation | Keycloak events, Entra sign-in logs, Google login audit | P0 | |
| Document revisions | Quote revisions R1, R2…; contract versions; an immutable PDF snapshot with its SHA-256 hash | ERPNext amend (`-1` suffix), Salesforce quote versions | P0 | The current app overwrites files in place |
| Soft delete and restore | Records get "deleted by / deleted at" instead of disappearing; a trash view; purge after the retention period | Odoo archiving, Salesforce Recycle Bin | P1 | |
| Retention and legal hold | Retention rules per type of data | Salesforce Shield, Dynamics | P1 | VAT records must be kept at least 6 years *(unverified)*; PDPL requires keeping personal data to the minimum |
| Controlled exports | CSV/XLSX export that needs permission, is logged and watermarked; also used for PDPL data-access requests | Salesforce, Odoo, ERPNext Data Export | P1 | Alert on unusually large exports |
| In-Kingdom backups | Encrypted backups, point-in-time recovery (PITR), quarterly test restores. Target: **recovery point (RPO) ≤ 15 minutes, recovery time (RTO) ≤ 4 hours** | Cloud SQL and AlloyDB in `me-central2` | P0 | |
| Security alerting | Alerts on large exports, permission escalation, after-hours admin logins, repeated failures | OWASP A09:2025 | P1 | |
| PDPL registers | Record of processing activities (ROPA), consent records, data-subject request tracker, breach log (72-hour clock) | PDPL | P1 | See §4 |

### 2.5 Multi-tenancy

A "tenant" is one customer company using the platform. Motqinon itself is tenant 1.

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| `tenant_id` on every row, enforced by RLS | Postgres filters every query to the current tenant | Supabase and Postgres practice | P0 (design now) | Turn on `FORCE ROW LEVEL SECURITY`. The app's DB role must not own the tables or have `BYPASSRLS`. Mark views `security_invoker`. |
| Tenant set per transaction | The app tells Postgres the tenant with `set_config('app.tenant_id', $1, true)` inside each transaction | Standard pattern | P0 | Stays correct behind a connection pooler (PgBouncer in transaction mode) |
| Tenant-scoped keys and numbering | Unique indexes include `tenant_id`; numbering is per tenant, company, document type and year | ERPNext naming series | P0 | Gap-free, locked counters |
| Tenant-aware everything else | File paths, caches, search indexes, job queues and logs all carry the tenant | General practice | P0 | |
| Per-tenant settings | Letterhead and branding, VAT and CR numbers, ZATCA device keys held in a key-management service | Odoo and ERPNext per-company settings | P1 | |
| Organizations in the identity layer | Tenant membership lives in the auth system | Better Auth organization plugin, Keycloak Organizations, Clerk, Auth0 | P1 | |
| Tenant lifecycle | Create, suspend, export and delete a tenant | General practice | P1 | |
| Noisy-neighbour limits | Per-tenant rate limits and query timeouts | General practice | P2 | |
| Separate database when needed | Move a large or regulated tenant to its own database, routed through a tenant catalogue | ERPNext (one site per tenant) | P2 | |

The three standard ways to separate tenants in Postgres:

| Pattern | Isolation | Operating cost | Scale | Fit |
|---|---|---|---|---|
| **Shared tables + `tenant_id` + RLS** ("pool") | Logical only; depends on correct RLS policies and tests | Lowest. One schema, one migration run. | Tens of thousands of tenants | **Default choice.** Start here with Motqinon as tenant 1. |
| Schema per tenant ("bridge") | Better; separate namespaces | Every migration runs once per tenant; catalogue bloat past about 1,000 schemas; pooler pitfalls | Hundreds to low thousands | Only if tenants need heavy schema customization |
| Database per tenant ("silo") | Strongest; backup, restore and data location per tenant | Highest | Dozens to hundreds | Premium or regulated tenants; this is ERPNext's model |

### 2.6 Admin console and user lifecycle

| Feature | What it does | Seen in | Priority | Notes |
|---|---|---|---|---|
| Invite and onboard | Invite a user with role, company and branch preset | Better Auth, Clerk, Auth0, Keycloak | P0 | |
| Offboarding | Deactivate rather than delete; reassign their records; revoke sessions and API keys | All vendors | P0 | Google SSO alone does not end existing app sessions, so keep sessions short and re-check the account |
| Role templates | Owner, Admin, Sales, Sales Manager, Technician, Accountant, Viewer | Salesforce, ERPNext | P0 | |
| Permission matrix screen | Roles × permissions × scope, with a diff before saving | Dynamics, ERPNext Role Permission Manager | P1 | |
| Support impersonation | Requires a ticket number or reason; shows a banner; time-limited and fully audited | Better Auth, Clerk, Keycloak | P1 | |
| Break-glass admin | Emergency admin account protected by a hardware key, with an alert whenever it is used | Industry practice | P1 | |
| API keys and service accounts | Scoped, expiring and rotated keys for integrations and IoT gateways | Better Auth, WorkOS, Keycloak service accounts | P1 | |
| Delegated admin | A branch admin manages only their own branch | Keycloak per-organization admin permissions (26.7) | P2 | |
| SCIM / automatic provisioning | Create and remove users automatically from Google or Entra | WorkOS, Better Auth SCIM, Keycloak SCIM (preview) | P2 | |
| Access reviews | Quarterly re-approval of who has access; report of stale accounts | Entra access reviews | P2 | |
| Security dashboard | MFA and passkey adoption, last login, risky users | Clerk, Entra | P2 | |

### 2.7 Security hardening

| Feature | What it does | Seen in / standard | Priority | Notes |
|---|---|---|---|---|
| No secrets in the browser | The browser talks to your own backend; keys live in a secret manager or KMS in-region | OWASP A02 and A04:2025 | P0 | |
| Safe output | Encode everything by default (React does this); clean rich text with DOMPurify; never use `innerHTML` with untrusted data | OWASP A05:2025 Injection | P0 | |
| Strict Content Security Policy (CSP) | Nonce-based CSP, Trusted Types, `frame-ancestors` | ASVS 5.0 V3 Web Frontend Security | P0 | |
| Supply-chain controls | Lockfiles, pinned versions, integrity hashes (SRI) or self-hosted scripts, Renovate, software bill of materials (SBOM), secret scanning | OWASP **A03:2025 Software Supply Chain Failures** | P0 | |
| Input validation | Validate requests against a schema (Zod) at the API edge; parameterized queries only | ASVS V1 and V2 | P0 | |
| Safe file uploads | Check real file type and size, scan for malware, private bucket with short-lived signed links | ASVS V5 | P0 | |
| Encryption | TLS 1.2 or higher with HSTS; customer-managed keys at rest; column-level encryption for national IDs and IBANs | ASVS V11, V12, V14 | P1 | |
| Fail closed | Errors deny access by default; clients get generic messages plus a correlation ID | OWASP **A10:2025 Mishandling of Exceptional Conditions** | P0 | |
| Logging and alerting | OpenTelemetry to in-region logging, with personal data scrubbed | OWASP A09:2025 | P0 | |
| Verification | Test against ASVS 5.0 Level 2; annual penetration test; automated security scanning (DAST) in CI | ASVS 5.0 | P1 | |
| Web application firewall and rate limits | Cloud Armor in front of the app | Google Cloud | P1 | |
| Least-privilege cloud access | CI deploys through Workload Identity Federation, with no long-lived service-account keys | Google Cloud | P1 | |

---

## 3. Security findings on the current app

> *Adaptation note (26 Sep 2026): this section was written for the sibling tool the research was run against. The same classes of findings apply to this repository's app; its own risks and Phase 0 steps are in [01-current-state.md §3 and §5](../01-current-state.md#3-risk-assessment). This repository has no `contract.txt` — its committed personal data sits inside `index.html`.*

*Redacted in this public copy.* The findings (critical: customer data exposure and an unauthenticated save endpoint; high: client-side-only admin check, stored XSS, personal data committed to Git; medium: API key handling, numbering collisions, missing CSP/SRI, no audit trail) are summarised in [01-current-state.md §3](../01-current-state.md#3-risk-assessment). Line-level details are withheld until the Phase 0 fixes are deployed.

### Quick wins before the rebuild (roughly 1–2 weeks)

1. **Clean up the repository.** Make it private, or remove `contract.txt` from the full Git history (for example with `git filter-repo`) and force-push. Record the incident and get legal advice on whether the PDPL 72-hour notification to SDAIA applies.
2. **Close the public folders.** Remove "anyone with the link" sharing from the quotes and contracts folders, and share them only with a staff Google group.
3. **Replace the API key with real Google sign-in.** Use **Google Identity Services** (OAuth token client) so each user signs in with their own Google account and Drive checks their permissions. This keeps the static hosting. If the team is on Google Workspace, set the OAuth consent screen to *Internal*. Alternatively, serve the UI from Apps Script `HtmlService` running as "the user accessing the web app".
4. **Make admin a server-side decision.** Grant admin by Google account (Drive or Group membership), not by a typed ID.
5. **Retire or harden the Apps Script endpoint.** If it must stay: ignore the `folderId` sent by the browser and use a fixed server-side list; validate `fileName` against `^(Q|MTQCT)-[0-9-]+$`; write a new revision instead of overwriting; append every write (time, email, action, file, SHA-256) to an audit sheet; use `LockService` to issue numbers safely.
6. **Fix the XSS sinks.** Add a small `esc()` helper for every interpolated value; replace inline `onclick` strings with `data-*` attributes and `addEventListener`; clean contract HTML with DOMPurify (pinned version, with SRI) before rendering, or better, store structured contract fields instead of raw HTML.
7. **Tighten the page.** Add an SRI hash to ExcelJS or self-host it; add a CSP meta tag (limit `connect-src` to `googleapis.com` and `accounts.google.com`); set `Referrer-Policy: no-referrer`.
8. **Lock down the key and accounts.** Rotate the API key and restrict it to the Drive and Sheets APIs and your site's referrer. Enforce 2-step verification or passkeys on every Google account that owns the Drive folders or the Apps Script.

---

## 4. Saudi compliance and hosting

All items checked on 2026-09-25. "Search-level" means I read official or legal-firm titles and snippets but could not open the full page.

### 4.1 Regulation

| Item | Status | What it means for Motqinon | Verified |
|---|---|---|---|
| **PDPL** (Personal Data Protection Law) | In force; transition period ended **14 Sep 2024** | Applies to all your processing of customer and staff personal data | Search-level (Morgan Lewis, Sep 2024) |
| Cross-border transfer rules | SDAIA issued an **updated Transfer Regulation effective 1 Sep 2024**. It covers adequacy decisions (SDAIA publishes a list of countries, reviewed at least every 4 years), safeguards (standard contractual clauses, binding corporate rules), exemptions and risk assessments. | Storing data in Google Drive or with US identity SaaS is a transfer; hosting in-Kingdom removes most of this work | Search-level (SPA N2163905, Securiti, Mayer Brown Oct 2024) |
| Breach notification | Notify **SDAIA within 72 hours** of a breach that may cause harm; notify affected people without undue delay | Needs an incident runbook and a breach register | Search-level |
| Data protection officer (DPO) | Mandatory for public entities serving at large scale, for organizations whose core work is large-scale systematic monitoring, and for those whose core work is large-scale processing of sensitive data | Probably not required today. Could become required if you store biometric data (e.g., intercom faces, fingerprint locks), which PDPL treats as sensitive *(unverified in-session)*. | Search-level |
| Registration on SDAIA's national data platform | Required for public entities, for controllers whose main activity is processing personal data, and for those processing sensitive data | Same trigger as the DPO row | Search-level (Morgan Lewis, Dec 2024) |
| Records of processing (ROPA) | Required. Retention of "processing period + 5 years" | Keep a ROPA from the start | Retention *(unverified)* |
| 2025 draft amendments | Would merge the DPO and registration rules into the regulations and simplify ROPA | Not final as of May 2026 per secondary sources; status in Sept 2026 *(unverified)* | Search-level |
| **NCA ECC-2:2024 / CCC-2:2024** (national cybersecurity controls) | Mandatory for government bodies and their companies, and for private owners or operators of critical national infrastructure. NCA "strongly encourages" everyone else. | Not mandatory for Motqinon, but government-linked clients may pass these requirements down in contracts. Use ECC as your control checklist. | Search-level (NCA pages) |
| ZATCA e-invoicing | Phase 1 (generation) applies to all VAT-registered businesses. Phase 2 (integration with ZATCA's Fatoora platform) rolls out in revenue-based waves, with individual notice to each taxpayer. | Check your wave on the Fatoora portal. Plan to be Phase-2 ready in 2026–27. | Wave details *(unverified; search quota exhausted)* |

### 4.2 Nafath: can a private company integrate it?

**Yes, with approval.** Nafath is offered for "government **and private** services". It is run by the National Information Center under SDAIA, which publishes the *Nafath Platform User Guide* for "Single Sign-on to Government & Private Services". Public sources say it was built by Elm and the Technology Control Company.

It is not a sign-up-and-go API. Integrators report these requirements:

- A registered Saudi entity with a legitimate use case, and an approval cycle "planned in months, not weeks".
- Possibly a licence through the Technology Control Company (reported by Circularo).
- Or going through an approved provider. For example, Elm's Rabet API marketplace issues separate credentials for the app and web channels, and e-signature platforms such as SignIt and Circularo already integrate Nafath.

How it works for the user: they enter their national ID or Iqama, then pick a displayed number in the Nafath app (push with number matching), and the service gets a callback. Some integrators describe it as OIDC. I could not check the official specification.

**Recommendation.** Nafath is not needed for staff login. Use it through a licensed e-signature or identity provider to verify customers before contract signing, or to verify tenant owners in the SaaS phase.

### 4.3 In-Kingdom hosting and managed PostgreSQL

| Provider | Saudi region | Status on 2026-09-25 | Managed Postgres | Notes |
|---|---|---|---|---|
| **Google Cloud** | `me-central2` Dammam | Available | **Cloud SQL for PostgreSQL and AlloyDB listed for `me-central2`** | Recommended. Check other services (Cloud Run, Memorystore) region by region. |
| Oracle OCI | `me-jeddah-1` (2020), `me-riyadh-1` | Available; each region has one availability domain with three fault domains | OCI Database with PostgreSQL *(unverified)* | Two regions allow disaster recovery inside the Kingdom |
| AWS | Saudi region (3 zones, US$5.3bn) | **Planned for Dec 2026; not yet available** | Expected *(unverified)* | Revisit in 2027 |
| Microsoft Azure | Saudi Arabia East (Eastern Province, 3 zones) | **Announced for Nov 2026** (Microsoft, Aug 2026) | Expected *(unverified)* | |
| stc (center3 / stc cloud / Oracle Alloy) | Riyadh, Jeddah, Dammam data centres | Available | Oracle Alloy runs 100+ OCI services (Postgres *(unverified)*) | Sovereign or locally operated option |
| SCCC (stc × Alibaba Cloud) | Riyadh | Available | ApsaraDB RDS for PostgreSQL is in the product line (availability in this region *(unverified)*) | |
| Huawei Cloud | Riyadh (Sept 2023, 3 zones, CST Class C licence) | Available | RDS for PostgreSQL (in-region *(unverified)*) | |
| Supabase Cloud | **No Saudi region** | — | — | Would mean a cross-border transfer; self-host inside the Kingdom instead |

### 4.4 Security standards

| Standard | Status | Key points |
|---|---|---|
| NIST SP 800-63B-4 (US digital identity guidelines) | **Final, 2025** | Verified in NIST's source: passwords 15/8 characters; must offer a phishing-resistant option at AAL2; SMS is "restricted"; no more than 100 failed attempts; AAL2 timeouts 24 h / 1 h; synced passkeys allowed at AAL2 but not AAL3 |
| OWASP ASVS 5.0 (security verification checklist) | Released **30 May 2025** | About 350 requirements in 17 chapters; new chapters on web front end, self-contained tokens, and OAuth/OIDC |
| OWASP Top 10:2025 (most critical web risks) | Announced Nov 2025 | **A01** Broken Access Control; A02 Security Misconfiguration; **A03** Software Supply Chain Failures; A04 Cryptographic Failures; A05 Injection; A06 Insecure Design; A07 Authentication Failures; A08 Software or Data Integrity Failures; A09 Security Logging and Alerting Failures; **A10** Mishandling of Exceptional Conditions (verified in the OWASP GitHub repo) |

---

## 5. Stack comparison and recommendation

### 5.1 Comparison

| Criterion | (a) TypeScript: Next.js + NestJS/Hono + Postgres + Drizzle + Better Auth | (b) Supabase | (c) Django / FastAPI | (d1) ERPNext / Frappe | (d2) Odoo 19 |
|---|---|---|---|---|---|
| Time to ZATCA Phase 2 | Slow if you build it; fast if you connect to an ERP | Slow; you build it | Slow; you build it | **Fast** with the KSA Compliance or ERPGulf apps | **Fast** with `l10n_sa_edi` (LGPL-3, in Community) |
| Accounting and ERP breadth | You build it | You build it | You build it | **Full**: GL, stock, buying, projects, maintenance | **Full**. Some advanced accounting and Studio features are Enterprise-only. |
| Differentiated UX and owning the product | **Best** | Good | Good (needs a separate React front end) | Limited (Frappe "desk" UI conventions) | Limited (Odoo framework) |
| Login, permissions and audit out of the box | Strong with Better Auth plugins; you build the audit | RLS plus Auth; audit is do-it-yourself | Django auth and admin, plus packages such as `django-simple-history` | **Strong**: roles, perm levels, user permissions, versions | **Strong**: groups, record rules, tracking |
| Path to multi-tenant SaaS | Shared tables with RLS, built in from day one | Shared tables with RLS | Schema per tenant (`django-tenants`) or RLS | One site (database) per tenant | Database per tenant or multi-company |
| Data in the Kingdom | Any Postgres in `me-central2` | Only if self-hosted (about 6 services to run) | Yes | Self-host (MariaDB) | Self-host |
| Licence | Yours | Apache-2.0 (self-host) | Yours | GPLv3 (ERPNext); AGPL (KSA Compliance app) | LGPL-3 (Community); proprietary (Enterprise) |
| Arabic right-to-left | Strong (Tailwind logical properties, Radix, shadcn) | Same as (a) | Strong | Built in | Built in |
| Operating load for a small team | Moderate | Low on Supabase Cloud, high self-hosted | Moderate | Moderate (bench, MariaDB, Redis) | Moderate |
| Fit for IoT integration | Strong (Node MQTT clients, WebSockets) | Realtime is a plus | Strong (Python data tooling) | Weak | Weak |

### 5.2 Recommendation

**Use a hybrid: extend a proven ERP for the commodity back office, and build your own product for the front office.**

1. **Back office: ERPNext v15+ with LavaLoon KSA Compliance (or ERPGulf `zatca_erpgulf`), self-hosted in `me-central2`.** This gets you to ZATCA Phase 2 in weeks rather than a year. Building ZATCA yourself means UBL XML, ECDSA signing, device-certificate (CSID) onboarding, clearance and reporting APIs, and an invoice hash chain, plus keeping up with ZATCA's changing specs. ERPNext also brings a full ledger and inventory with an audit-friendly model where submitted documents cannot change.
   - Choose **Odoo Community** instead if your staff or partners already know Odoo. Its ZATCA module is in Community under LGPL-3, and LGPL lets you keep your own modules proprietary.
2. **Front office, which is your differentiated product: TypeScript (option a).** It handles CPQ and quotations, CRM, contracts, projects and installations, service and warranty, the technician app and the IoT device registry. Reasons:
   - One language for web, API and mobile (Expo).
   - Better Auth runs inside your app and stores users in **your own in-Kingdom Postgres**. That gives organizations, roles, 2FA, passkeys, admin and impersonation, SSO and SCIM without sending identity data to US SaaS.
   - Postgres RLS gives tenant isolation that is ready for a later SaaS launch.
   - Your code stays unencumbered by GPL or AGPL.
   - It integrates with ERPNext over REST and webhooks: customers, items, sales invoices, payments and stock.
3. **What not to do yet:**
   - **Supabase Cloud:** no Saudi region, and passkeys are still beta. Keep the RLS patterns, not the platform.
   - **Keycloak:** add it later only if SaaS tenants need SAML or SCIM brokering at scale.
   - **Django:** a solid alternative if the founder prefers Python. The trade-off is running two languages.

### 5.3 Reference architecture

All components run in `me-central2` unless noted.

1. **Edge:** HTTPS load balancer with Cloud Armor (WAF, rate limits, bot rules).
2. **Web:** Next.js (App Router), Arabic by default with English, a right-to-left design system (Tailwind logical properties with shadcn/ui), Arabic fonts (Cairo or IBM Plex Sans Arabic).
3. **API:** a NestJS modular application with modules for `identity`, `tenancy`, `crm`, `cpq`, `contracts`, `projects`, `service`, `erp-sync`, `iot-registry`, `files`, `notifications` and `audit`. Publish an OpenAPI spec with a typed client.
4. **Identity:** Better Auth with the Postgres adapter.
   - Sign-in: Google OIDC restricted to your domain, passkeys, TOTP, email OTP for the customer portal.
   - Plugins: `organization` (tenants, teams, invitations) and `admin` (ban users, manage sessions, impersonation).
   - Protection: rate limiter and HIBP breached-password checks.
   - Later: SSO and SCIM plugins.
5. **Authorization:** a policy module (permission catalogue, scope resolver, field masks, approval limits) plus Postgres RLS for tenants, and for branches where practical.
6. **Database:** Cloud SQL for PostgreSQL (or AlloyDB) with high availability, point-in-time recovery, customer-managed keys and private IP. Drizzle migrations include the RLS policies. Add a read replica for reporting.
7. **Background jobs:** a Postgres-backed queue (pg-boss or Graphile Worker) with an outbox table for integration events. This avoids running Redis at the start.
8. **Files:** a private Google Cloud Storage bucket with signed URLs and object versioning. Keep audit exports in a bucket with Bucket Lock (WORM retention).
9. **Documents:** server-side PDF rendering with headless Chromium and Arabic text shaping. Store a SHA-256 hash of every issued document. Optionally add Nafath-backed e-signature through a provider.
10. **ERP:** ERPNext with KSA Compliance on Compute Engine or GKE, with its own MariaDB, connected over REST and webhooks.
11. **Messaging:** a Saudi SMS and WhatsApp provider for notifications and fallback codes (vendor *(unverified)*); email through a Workspace relay.
12. **Observability:** OpenTelemetry to Cloud Logging and Monitoring, alert rules, and a daily hash-chained export of the audit log.
13. **Secrets:** Secret Manager and Cloud KMS in-region, including ZATCA keys if you ever sign invoices yourself.
14. **CI/CD:** GitHub Actions with Workload Identity Federation (no stored keys), Artifact Registry, and Cloud Run or GKE Autopilot (check availability in `me-central2`). Add Renovate, CodeQL, secret scanning and an SBOM.
15. **Mobile:** an Expo (React Native) technician app using the Better Auth Expo client, secure storage and offline job sheets.
16. **IoT (later phase):** an MQTT broker (EMQX or Mosquitto) and a device registry linked to customer, site and contract.

---

## 6. Data entities implied

| Group | Entities and key fields |
|---|---|
| Tenancy and organization | `tenants` (slug, plan, status, data_region); `tenant_domains` (domain, verified_at); `companies` (legal name ar/en, CR, VAT, address, ZATCA settings); `branches`; `teams`; `memberships` (user, tenant, company, branch, team, status) |
| Identity | `users` (email, phone, name ar/en, locale, status, last_login_at); `accounts` (provider, provider_user_id, password_hash); `passkeys` (credential_id, public_key, sign_count, transports, device_name); `mfa_factors` (type, encrypted secret, verified_at); `recovery_codes` (hash, used_at); `sessions` (token_hash, ip, user_agent, device_label, created/expires/last_seen, `impersonated_by`); `verification_tokens`; `invitations` (email, role, scope, expires_at, token_hash); `trusted_devices`; `api_keys` (prefix, hash, scopes, expires_at); `sso_connections`; `scim_directories` |
| Authorization | `permissions` (resource, action); `roles` (tenant, name ar/en, is_system); `role_permissions` (role, permission, **scope_level** own/team/branch/company/all); `role_assignments` (user, role, company, branch, valid_from/to); `field_groups` and `role_field_access` (read/write); `record_shares`; `sharing_rules`; `approval_policies` (doc_type, role, max_amount, max_discount_pct, chain); `approval_requests` and `approval_steps`; `delegations` |
| Audit and governance | `audit_log` (tenant, actor, on_behalf_of, action, entity, entity_id, diff jsonb, ip, ua, request_id, reason, prev_hash, hash); `auth_events`; `field_history`; `document_revisions` (doc, rev, snapshot jsonb, pdf_sha256); `number_sequences` (tenant, company, doc_type, year, next_value); `data_exports`; `retention_policies`; `legal_holds`; `deleted_at` / `deleted_by` columns on business tables |
| PDPL | `consents` (subject, purpose, channel, given/withdrawn_at); `dsar_requests` (data-subject requests: type, due_at, status); `processing_activities` (ROPA); `breach_incidents` (detected_at, notified_sdaia_at); `transfer_assessments` |
| Integration | `erp_links` (entity, erp_doctype, erp_name); `outbox_events`; `webhook_endpoints`; `zatca_devices` (only if you sign invoices yourself) |

---

## 7. Sources

### Fetched directly (primary sources on GitHub, 2026-09-25)
- https://github.com/usnistgov/800-63-4
- https://github.com/usnistgov/800-63-4/blob/nist-pages/sp800-63b/aal/index.html
- https://github.com/usnistgov/800-63-4/blob/nist-pages/sp800-63b/authenticators/index.html
- https://github.com/OWASP/Top10/tree/master/2025/docs/en
- https://github.com/odoo/odoo/blob/19.0/addons/l10n_sa_edi/__manifest__.py
- https://github.com/odoo/odoo/tree/19.0/addons/certificate
- https://github.com/frappe/erpnext
- https://github.com/frappe/frappe
- https://github.com/lavaloon-eg/ksa_compliance
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/admin.mdx
- https://github.com/orgs/supabase/discussions/46240
- Local files: `/home/user/mtq-quotations/index.html` and `contract.txt`

### Search-result level (titles and snippets reviewed, 2026-09-25)
- **NIST:** https://pages.nist.gov/800-63-4/sp800-63b.html · https://blog.typingdna.com/nist-sp-800-63b-rev-4-sms-otp-is-now-a-restricted-authenticator-but-we-have-the-fix/ · https://www.intercede.com/from-draft-to-final-whats-new-in-nists-latest-password-guidance/
- **OWASP:** https://owasp.org/Top10/2025/ · https://www.fastly.com/blog/new-2025-owasp-top-10-list-what-changed-what-you-need-to-know · https://github.com/OWASP/ASVS · https://softwaremill.com/whats-new-in-asvs-5-0/
- **Nafath:** https://my.gov.sa/en/services/20936 · https://sdaia.gov.sa/en/Services/ServicesGuidelines/SingleSignontoGovernmentPrivateServices.pdf · https://help.circularo.com/en/help-center/latest/nafath-integration · https://help.signit.sa/en/how-to-integrate-custom-nafath-provider · https://en.wikipedia.org/wiki/Unified_national_access · https://rabet.sa/products · https://www.devbrickstech.com/blog/nafath-api-integration-implementing-national-single-sign-on-for-saudi-b2b-portals
- **PDPL:** https://www.spa.gov.sa/en/N2163905 · https://securiti.ai/regulation-on-personal-data-transfer-outside-the-kingdom/ · https://www.mayerbrown.com/en/insights/publications/2024/10/updates-to-saudi-arabias-personal-data-protection-regulations-sccs-guidelines-and-more · https://www.morganlewis.com/pubs/2024/09/saudi-arabia-personal-data-protection-law-transition-period-ends-september-14 · https://www.morganlewis.com/blogs/sourcingatmorganlewis/2024/12/saudi-arabias-personal-data-protection-law-a-guide-to-registering-as-a-data-controller · https://cms-lawnow.com/en/ealerts/2025/09/one-year-anniversary-saudi-personal-data-protection-law · https://www.sgc.consulting/sdaia-saudi-personal-data-protection-law-pdpl-compliance-guide/
- **NCA:** https://nca.gov.sa/en/regulatory-documents/controls-list/ecc/ · https://nca.gov.sa/en/regulatory-documents/controls-list/ccc/ · https://www.cyberarrow.io/blog/nca-ccc-2-2024-whats-new-in-nca-ccc-2/
- **Cloud:** https://www.aboutamazon.com/news/aws/aws-cloud-region-saudi-arabia · https://www.computerweekly.com/news/366649447/AWS-sets-2026-opening-date-for-Saudi-cloud-region · https://news.microsoft.com/source/emea/2026/08/microsoft-announces-saudi-arabia-east-datacenter-region-will-be-available-in-november-2026/ · https://docs.cloud.google.com/sql/docs/postgres/region-availability-overview · https://docs.cloud.google.com/alloydb/docs/locations · https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm · https://docs.oracle.com/en-us/iaas/releasenotes/changes/45cb2bf5-290f-40fb-af89-b7b9455f35fe/index.htm · https://sccc.sa/en · https://www.huaweicloud.com/intl/en-us/product/pg.html · https://www.center3.com/ · https://vision2030.ai/sectors/technology/saudi-arabia-cloud-regions/
- **Auth vendors:** https://better-auth.com/blog/1-7 · https://better-auth.com/blog/authjs-joins-better-auth · https://better-auth.com/blog/better-auth-joins-vercel · https://better-auth.com/docs/plugins/scim · https://better-auth.com/docs/plugins/passkey · https://www.thehackerwire.com/cve-2026-67330-better-auth-scim-authorization-bypass/ · https://www.keycloak.org/2026/07/keycloak-2670-released · https://www.keycloak.org/2026/05/org-fgap · https://www.keycloak.org/2025/04/keycloak-2620-released · https://supabase.com/changelog/46458-passkeys-for-supabase-auth-beta · https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook · https://supabase.com/docs/guides/platform/regions
- **ZATCA and ERP:** https://cloud.frappe.io/marketplace/apps/ksa_compliance · https://cloud.frappe.io/marketplace/apps/zatca_erpgulf · https://github.com/ERPGulf/zatca_erpgulf · https://www.lavaloon.com/products/ksa-compliance · https://frappe.io/erpnext/saudiarabia · https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations/saudi_arabia.html

### Not re-fetched this session (vendor documentation knowledge)
Authorization models for Salesforce, Dynamics 365, Zoho CRM and Odoo, and the Auth0, Clerk, WorkOS, Entra External ID and Google Workspace feature sets.
