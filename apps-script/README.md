# Apps Script backend — deployment (Phase 0 item 7, R4)

`Code.gs` replaces whatever Apps Script project `index.html`'s "رابط Apps Script" setting
currently points at. It keeps the same request shape the page has always sent
(`POST`, `Content-Type: text/plain`, body `{fileName, state, folderId}` →
`{success, action, error}`), so switching deployments is safe, and adds:

- a folder allow-list the browser cannot override (Script Properties, not the `folderId` the
  browser sends);
- filename validation per document type;
- create-only invoices, and a `_history` copy of the previous version before a quote or contract
  is overwritten;
- quote/contract/invoice numbers issued under a lock (`action: "nextNumber"`), with the invoice's
  issue date/time in Asia/Riyadh — never the browser's own clock;
- a shared `settings.json`, writable only by admins once one exists (`action: "saveSettings"`);
- an append-only audit log (optional, needs a spreadsheet — see below);
- Google ID token verification when the page has sign-in configured (item 6) — optional.

This file never contains any company data, folder ID or key. Script Properties (step 3) are what
make a deployment specific to this company, and they live in the Apps Script project, not here.

## 1. Deploy as a new deployment (don't overwrite the live one)

1. In the Drive folder the quotes/contracts/invoices live in (or a new project), open
   **Extensions → Apps Script** if editing an existing bound project, or go to
   [script.google.com](https://script.google.com) → **New project**.
2. Replace the contents of `Code.gs` (or the default `Code.gs` it starts with) with this
   repository's `apps-script/Code.gs`, pasted in as-is.
3. **Deploy → New deployment → type: Web app.**
   - Execute as: **Me** (the owner's account — this is what gives the script permission to write
     to the Drive folders below; it never runs as the person using the page).
   - Who has access: **Anyone** (the page calls it unauthenticated over HTTPS; identity, where it
     matters, is checked inside the script itself — see §4).
   - Copy the resulting **Web app URL** (ends in `/exec`).
4. Paste that URL into `index.html` → **⚙️ الإعدادات → 🔌 الاتصال → رابط Apps Script**, for every
   staff browser (or publish it once everyone is on the shared `settings.json` from item 4 — the
   Apps Script URL itself stays a per-browser connection setting, same as the API key).
5. Keep the **previous** deployment's URL noted somewhere safe until this one has been verified
   end-to-end (saving a quote, a contract, and issuing a test invoice) — see §6 Rollback.

A code change alone does not update a live Web app URL: after editing `Code.gs` again later,
use **Deploy → Manage deployments → ✎ (edit) → Version: New version → Deploy** on the *same*
deployment to keep the same URL, or create a new deployment and repeat step 4.

## 2. Script Properties to set

**Project Settings (gear icon) → Script Properties → Add script property.** All of these are
read by `prop_()` / `folderFor_()` in `Code.gs`; nothing here is hard-coded in the script itself.

| Property | Required | Example | Notes |
|---|---|---|---|
| `FOLDER_QUOTES` | Yes | `1AbC...xyz` | Drive folder ID (from its URL), quotes `.json` files |
| `FOLDER_CONTRACTS` | Yes | `1AbC...xyz` | Contracts `.json` files — **use a new folder**, not the one in the old public `index.html` (owner checklist) |
| `FOLDER_INVOICES` | Yes (to issue invoices) | `1AbC...xyz` | Issued invoice `.json` files |
| `FOLDER_SETTINGS` | No | `1AbC...xyz` | Where `settings.json` lives; defaults to `FOLDER_QUOTES` if unset |
| `HISTORY_SUBFOLDER_NAME` | No | `_history` | Subfolder created inside each of the above to hold pre-overwrite copies |
| `ADMIN_USER_IDS` | Recommended | `92,15` | Comma-separated user numbers allowed to publish `settings.json` (also unions with the `adminIds` *inside* the current `settings.json`, once one exists) |
| `ADMIN_EMAILS` | No (needs item 6) | `owner@example.com` | Comma-separated Google e-mails with the same right |
| `GOOGLE_CLIENT_ID` | No (needs item 6) | `xxxx.apps.googleusercontent.com` | Must match `index.html`'s setting exactly, or ID tokens are rejected as wrong-audience |
| `INVOICE_PREFIX` | No | `MMC-INV-` | Seeds only the very first invoice ever issued (after that the running number's own prefix is kept — see §3) |
| `INVOICE_START` | No | `1` | The sequence never issues below this number |
| `AUDIT_SHEET_ID` | No | `1AbC...xyz` | A Google Sheet ID; see §5 |

Set `ADMIN_USER_IDS` (or `ADMIN_EMAILS`) **before** anyone publishes `settings.json` for the first
time if possible — the very first publish is allowed through with no admin yet (bootstrap), so the
window between deploying this script and setting that property is the only time any user could
publish the shared settings.

## 3. Counter seeding (continuing the old numbering)

Quote, contract and invoice numbers are kept in Script Properties once issued (`CTR_Q_<prefix>`,
`CTR_CONTRACT`, `CTR_INVOICE_LAST_NUMBER`) so that after the first call there is no repeated
folder scan. **The first time each counter is used**, it seeds itself from the existing files in
that type's folder:

- quotes: the highest existing sequence for *that day's* prefix (`MMC-YYWWDD…`) in `FOLDER_QUOTES`;
- contracts: the highest existing `MMCT-N` in `FOLDER_CONTRACTS`;
- invoices: the file with the highest trailing digit run in `FOLDER_INVOICES`, *whatever its prefix
  or digit width* — that file's prefix and width are then kept for every number after it, so a shop
  already mid-sequence doesn't jump back to `MMC-INV-00001`.

You don't need to pre-set these — just make sure `FOLDER_QUOTES`/`FOLDER_CONTRACTS`/
`FOLDER_INVOICES` already point at the folders with the existing files *before* the first save or
"next number" request against this deployment. If you ever need to force a counter (e.g. after
manually moving files around), set the Script Property directly: `CTR_CONTRACT` to the last-used
serial, or `CTR_Q_MMC-262622` to that day's last sequence, or `CTR_INVOICE_LAST_NUMBER` to the
full last invoice number string (e.g. `MMC-INV-00041`).

## 4. Identity (optional — only matters once item 6 is configured)

If `index.html` has no `googleClientId` set, requests never carry an `idToken`, and every save
behaves exactly as it does today (no sign-in required anywhere) — `ADMIN_USER_IDS` alone still
gates `settings.json`. Once sign-in is configured, `verifyIdToken_()` checks the token against
Google's `tokeninfo` endpoint (audience, expiry, `email_verified`) before trusting the e-mail it
carries; a missing or invalid token simply falls back to `actorId` (the typed user number) for
identification — it never blocks an ordinary quote/contract/invoice save, only `saveSettings` once
a `settings.json` already exists.

## 5. Audit log (optional)

Create a new Google Sheet, put its ID (from the URL) in `AUDIT_SHEET_ID`. Every save and every
reserved invoice number appends a row — time, actor (e-mail or user number), action, file name,
SHA-256 of the saved content — to its first sheet. Leave `AUDIT_SHEET_ID` unset to skip this
entirely; nothing else depends on it.

## 6. Rollback

Apps Script keeps every past deployment. If this one misbehaves in production:

1. **Deploy → Manage deployments** → find the previous deployment → copy its URL.
2. Put that URL back into every browser's **⚙️ الإعدادات → رابط Apps Script** (or republish
   `settings.json` once that's wired up — the Apps Script URL itself is deliberately kept
   per-browser, see item 4's notes, exactly so a rollback doesn't need a working deployment to
   distribute the new URL).
3. Nothing already saved is affected either way — this script only ever adds new files or copies
   the previous version into `_history` before changing one; it never deletes anything.

## 7. Testing a new deployment before trusting it

From a browser pointed at the new URL: save a quote (check it appears in `FOLDER_QUOTES`, and
that saving it again creates a `_history` copy, not a silent overwrite), open and save a contract
the same way, preview and issue a test invoice (check the number, the Asia/Riyadh time, and that
issuing it again never produces a duplicate number), and publish `settings.json` once as an admin.
`tests/` in this repository exercises the same contract against a fake server — see its README for
running it against this script directly instead of the fake one.
