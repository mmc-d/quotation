# Phase 6D — ZATCA Phase-2 e-invoicing: owner steps and limits

Core can sign, clear and report its own invoices (`packages/zatca`, screen **المحاسبة ← الفوترة الإلكترونية**).
It is **off** until every step below is done — nothing changes for an unregistered company.

## Before you start (only the owner can do these)

1. **VAT registration** — the company must be registered (Settings → company: «مسجلة في ضريبة القيمة المضافة»,
   15-digit VAT number starting and ending with 3). Core refuses to switch e-invoicing on otherwise.
2. **Notified by ZATCA** that integration (Phase 2) applies — the wave and date are on fatoora.zatca.gov.sa; ZATCA
   notifies at least six months ahead.
3. **Seller identity** complete in the company profile: commercial registration (or 700 number), street,
   4-digit building number, district, city, 5-digit postal code (+ optional 4-digit additional number).
4. **Customers**: a standard (B2B) invoice needs the customer's VAT number *or* commercial registration and a full
   billing address (street, 4-digit building number, district, city, 5-digit postal code). Invoices that miss any
   of this are held (`/accounting/einvoice` → «فواتير موقوفة») and cannot be shared until fixed.
5. **Secrets**: set `EINVOICE_KEY` (`openssl rand -base64 32`) in the production `.env`. Without it the API refuses
   to store the EGS key and CSIDs. Back it up with the database — losing it loses the ability to sign.
6. **Do not use ERPNext as the invoicing engine at the same time** — when `ERPNEXT_URL` is set, Core will not enable it.

## Going live

1. Run **تشغيل التجربة** (sandbox rehearsal) — a no-side-effect run against ZATCA's public sandbox. It proves our
   documents pass ZATCA's validator; it does not onboard your company.
2. In the Fatoora portal create an EGS unit and generate an **OTP** (single use, short-lived).
3. In Core: **وحدة جديدة** (environment *simulation* first), then **إدخال OTP** → **تشغيل فحوصات الامتثال**
   (six documents, standard + simplified × invoice / credit / debit) → **طلب شهادة الإنتاج**.
   A failed OTP is shown immediately and never retried — generate a new one.
4. Repeat with a *production* unit when the simulation is clean (revoke the simulation unit first: one unit is live at a time).
5. **تفعيل الفوترة الإلكترونية**. From then on each invoice (386 / 388 / 381 / 383) gets a signed document with the next
   ICV, chained to the previous hash. Standard invoices are cleared by ZATCA before they can be shared (the
   2-minute job, or **إرسال المعلّق الآن**); simplified invoices are reported (due within 24 hours).
   Invoices issued before the unit went live stay Phase-1 — they are not in the chain.

If an invoice has no VAT, set the **zero-rating reason code** (`VATEX-SA-…`) in the same screen; otherwise it is held.

## What to know

- **Rejections**: a rejected document is shown with ZATCA's error codes. Fix the cause (customer data, company data),
  then **إعادة إصدار** — a new document (new ICV and UUID) replaces it; the rejected one stays in the chain.
- **Never edit an issued invoice** — correct with a credit (381) / debit (383) note; Core records the reason on the document.
- **Archive**: every document is kept (signed XML, and ZATCA's stamped XML once cleared) for the statutory period,
  inside KSA with the database. «PDF/A-3» on a document gives the invoice PDF with the XML embedded. The auditor pack
  carries the register and all XML files.
- **Integrity**: **فحص السلسلة** recomputes every hash and stamp and checks the ICV is gapless and each PIH links.
  The database refuses to change or delete a signed document.
- **Validation**: `ZATCA_SDK_HOME=<sdk> pnpm --filter @mmc/zatca test` runs all document kinds through the official Java SDK
  (needs a JDK 11–14). Run it after any change to `packages/zatca`.

## Not built (known limits)

- **Certificate renewal** — the call shape could not be confirmed; re-onboard with a fresh OTP before the CSID expires.
- **VAT groups and several branches** — one live unit per tenant; the CSR carries the head-office name.
- **Export / exempt / out-of-scope scenarios** — only the configured zero-rating reason is applied to a no-VAT invoice;
  per-line categories (E / O, export flag) need a data model first.
- **ZATCA contingency (offline) invoices** — if the gateway is down, standard invoices wait; they are sent in order once it is back.
- **Self-billing, nominal, summary and third-party transaction flags** — the builder supports the flags, nothing sets them.
