# Phase 0 — owner checklist (مهام المالك)

The code side of Phase 0 is done — see the status table at the end of [`01-current-state.md` §5](01-current-state.md#phase-0-status-as-of-2026-10-05-branch-claude-new-session-l6y9qi). These nine actions are the ones only the owner (Google account owner / repository admin) can take, in a sensible order. None of them were done in this session — they need account access, payment details, or irreversible choices this session should not make on its own.

## 1. Make the repository private, and purge history

The repository has been public since the first upload, so every commit — including ones before this Phase 0 branch — still contains the company stamp image, the representative's name and mobile, the old contracts-folder ID, and the old hard-coded admin number. Making the repo private going forward does **not** remove them from history; anyone who already cloned it keeps a copy.

1. **Settings → General → Danger Zone → Change repository visibility → Private**, on `mmc-d/quotation`.
2. Decide whether history must be purged at all — if the stamp/rep data genuinely needs to disappear (PDPL exposure already happened; purging only stops *new* clones from getting it), use [`git filter-repo`](https://github.com/newren/git-filter-repo) (not the older `git filter-branch` or BFG unless you're already comfortable with them). Its `--replace-text` option takes a file of `find==>replace` lines — put the representative's exact name and mobile number there yourself (deliberately not repeated in this checklist; you have the pre-Phase-0 commits to copy them from exactly):
   ```bash
   # from a FRESH clone, not your working copy
   git clone --no-local https://github.com/mmc-d/quotation.git purge-clone
   cd purge-clone
   pip install git-filter-repo   # or: brew install git-filter-repo
   cat > /tmp/sensitive-replacements.txt <<'EOF'
   <representative's full name exactly as it appears in old commits>==>[رُحذف]
   <representative's mobile number exactly as it appears>==>[رُحذف]
   EOF
   git filter-repo --replace-text /tmp/sensitive-replacements.txt
   ```
   The stamp image is a base64 blob with no fixed short text to match-and-replace; removing it cleanly usually means rewriting the *blob* for `index.html` at each affected commit (`git filter-repo` supports `--path index.html --invert-paths` for whole-file removal, but that deletes the file's history too). Get a second pair of eyes before running this — it rewrites every commit hash after the earliest change, and anyone with a local clone (including this session's checkout) will need to re-clone.
3. Force-push the rewritten history: `git push origin --force --all && git push origin --force --tags`. Do this only after confirming nobody else has in-flight work on any branch.
4. GitHub Pages: a Pages site stays reachable at its old URL even after the repo goes private, *unless* you also disable Pages (**Settings → Pages → source: None**) or your plan supports GitHub Enterprise Cloud's access-controlled Pages. Since the tool is moving behind sign-in anyway (item 4 below), disable the public Pages deployment once staff have the new URL (or the MMC Core replacement, later).

## 2. Share Drive folders and the product sheet with staff only; move contracts

Today's folders/sheet are (per the app's own hints) shared "anyone with the link" — readable by anyone who obtains a link or ID, which the public repository made trivial.

1. For the products sheet, the images folder, and the quotes/invoices folders: **Share → remove "Anyone with the link"; add each staff Google account individually** (Viewer is enough for the sheet and images; the quotes/invoices folders need Viewer for staff who browse past documents).
2. **Create a brand-new Drive folder for contracts** — do not reuse the old one, since its ID is in the public repository's history. Share it the same way (staff only). Move existing contract `.json` files into it, then update `apps-script`'s `FOLDER_CONTRACTS` Script Property (step 5) and every staff browser's "معرّف مجلد Drive (العقود المحفوظة)" setting to the new folder ID.
3. If a Google Workspace domain exists for the company, prefer sharing with the domain rather than individual accounts (simpler to maintain as staff change). If not (today's repository only shows a consumer Gmail account), individual sharing is the only option until/unless a Workspace domain is set up (see item 4's note).

## 3. Restrict and rotate the API key

1. **Google Cloud Console → APIs & Services → Credentials** → find the key `index.html` has been using.
2. **Application restrictions**: HTTP referrers → add the exact URL(s) the tool is served from (the GitHub Pages URL and/or wherever it moves to).
3. **API restrictions**: limit it to exactly the two APIs the tool calls — Google Sheets API and Google Drive API.
4. Rotate it: create a **new** key with those restrictions, roll it out to every staff browser's Settings, confirm the tool still works, then delete the old (unrestricted) key. Do this rotation **after** item 2 (folder sharing), since a key alone no longer grants access once the folders require a signed-in account — but before then, the old key is still a live credential and should not be left around longer than needed.
5. Once Google sign-in (item 4) is rolled out everywhere, the API key path becomes a fallback only; it can eventually be removed from Settings entirely if every staff member has signed in.

## 4. Create the OAuth client ID for Google sign-in

1. **Google Cloud Console → APIs & Services → OAuth consent screen**:
   - The company account visible in this repository is a consumer Gmail address, not a Workspace domain. Two paths:
     - **Quick path**: User type **External**, keep the app in **Testing**, and add each staff Google account under **Test users** (Testing-mode apps are limited to 100 test users and the consent screen shows an "unverified app" warning staff must click through — acceptable for a small internal team).
     - **Proper path**: move the company to **Google Workspace** (a paid per-user subscription), then set User type **Internal** — no test-user limit, no unverified-app warning, and `hd`-claim domain restriction becomes available for later hardening.
2. **Credentials → Create Credentials → OAuth client ID → Web application.**
   - **Authorized JavaScript origins**: the exact origin(s) the tool is served from (e.g. `https://mmc-d.github.io` or wherever Pages/the new host serves it from — scheme + host + port, no path).
   - No redirect URI is needed (Google Identity Services' token/ID-token flows used here are origin-based, not redirect-based).
3. Copy the Client ID (`....apps.googleusercontent.com`) into `index.html` → Settings → 🔌 الاتصال → "معرّف عميل Google", **and** into the Apps Script's `GOOGLE_CLIENT_ID` Script Property (item 5) so the two sides agree on the audience — a mismatch there makes every sign-in fail ID-token verification.
4. Roll this out gradually: `googleClientId` is opt-in per browser, so you can pilot it with one or two staff accounts before asking everyone to sign in.

## 5. Deploy the Apps Script and set its properties

Follow **`apps-script/README.md`** in this repository in full — it covers creating the deployment, every Script Property (`FOLDER_QUOTES`/`FOLDER_CONTRACTS`/`FOLDER_INVOICES`/`FOLDER_SETTINGS`, `ADMIN_USER_IDS`/`ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, `INVOICE_PREFIX`/`INVOICE_START`, `AUDIT_SHEET_ID`), how each number counter seeds itself from your existing files, and rollback to today's deployment if something goes wrong. Two things worth doing in this exact order, before telling staff to switch:

1. Set **`ADMIN_USER_IDS`** (your own numeric user code, at minimum) in Script Properties **immediately after** deploying — the very first `settings.json` publish is allowed through with no admin configured yet (a deliberate bootstrap), so the shorter that window, the better.
2. Test it yourself first (§7 of that README) — save a quote, open and save a contract, issue one test invoice, publish `settings.json` once — before pointing every staff browser's "رابط Apps Script" setting at the new URL.

Until this is deployed, items 4-6 of the code side keep working on today's client-side fallbacks (quotes/contracts) or simply refuse (invoices) — see the status table in `01-current-state.md`.

## 6. Publish the shared company settings

Once the Apps Script (item 5) is live and at least one admin is allow-listed:

1. On one browser, as an admin (your user number in `ADMIN_USER_IDS`, or your Google e-mail in `ADMIN_EMAILS` once signed in): open **⚙️ الإعدادات → 🏢 بيانات المنشأة**, fill in the company's real profile — legal name, VAT number, CR, national address, bank/IBAN, the representative's name and mobile (these now come from here, no longer from the page itself), and the admin allow-list.
2. If a stamp should be auto-insertable via the new "🔏 ختم وطباعة" contract button, upload the stamp image to the same Drive folder product images live in and put its file ID in "معرّف ملف الختم في Drive". (It is **never** applied automatically — only on that explicit button, and only for admins.)
3. Click **"📤 نشر هذه البيانات كإعدادات مشتركة لكل المستخدمين"**. From that point, every browser that loads the tool picks up this file at start-up instead of whatever was locally configured.
4. Tell staff they can leave their own "بيانات المنشأة" fields as-is — the shared file now overrides them.

## 7. Confirm VAT registration and the ZATCA wave on the FATOORA portal

This tool's own "غير مسجل في ضريبة القيمة المضافة" switch is a local setting today and must reflect reality:

1. Log in to the [FATOORA portal](https://fatoora.zatca.gov.sa/) (or ask the company's accountant/tax advisor to confirm) whether the company is VAT-registered, and if so, since when and under which e-invoicing wave.
2. If registered and the applicable wave's integration deadline has passed without a Phase-2-compliant system already in place: this tool only produces **Phase 1** QR invoices (tags 1-5, no cryptographic stamp or clearance) — subscribe to a certified invoicing SaaS now as a bridge (decision D1 in `05-roadmap.md`), and plan to stop issuing tax invoices from this tool once ERPNext + the KSA compliance app goes live (Phase 1F of the roadmap).
3. If not registered: keep "غير مسجل في ضريبة القيمة المضافة" switched on in the shared settings (item 6) — but register once taxable supplies pass SAR 375,000 in any 12 months (voluntary registration is allowed above SAR 187,500).
4. Set the VAT-registered switch in the shared `settings.json` (item 6) to match whatever this confirms — every quote, contract and invoice follows it from there.

## 8. Decide the warranty wording

The quote terms and contract article 7 currently promise **different** warranties (quote: 1 year parts+labour + 1 extra year parts-only; contract: 2 years from installation covering manufacturing/programming defects, 10 years spare parts). Phase 0 deliberately left both untouched — picking one is a business decision, not a code one. Decide:

- Which of the two (or a new, reconciled wording) is the company's actual policy going forward.
- Whether the "10-year spare parts" commitment is realistic to keep as a blanket promise.

Once decided, the text can be updated directly in `index.html`'s default notes/terms strings and the contract's Article 7 — a small, low-risk edit a future session (or you, directly) can make once the wording is final. The same decision should also resolve the quote terms' payment-trigger wording ("قبل الشحن" / "after operation and handover") vs. the contract's ("قبل توريد المواد" / "بعد الانتهاء من البرمجة") to stop promising customers two slightly different sequences.

## 9. Export all local data on every staff browser

Before any of the above changes staff workflows (and definitely before any Drive folder gets re-shared or re-organized), get a backup of what is currently sitting only in each person's browser:

1. On **every** staff computer that has used this tool: open **⚙️ الإعدادات → 📤 تصدير كل البيانات المحلية / Export all local data**, save the downloaded JSON file somewhere safe (a shared drive, dated by machine — e.g. `backup-salesrep1-2026-10-05.json`).
2. This file contains every locally-saved quote, local invoice copies, the last invoice number this browser knew about, the local company-profile settings, and the contract serial — everything Drive doesn't already have a copy of. It never contains the API key or any credential.
3. Keep these dated exports until the eventual MMC Core migration (Phase 1) — they are explicitly its input for merging browser-only data (see `05-roadmap.md` §5 "Data migration plan").
