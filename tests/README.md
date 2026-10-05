# Validation suite (Phase 0)

Playwright tests for the Phase 0 hardening of `../index.html`. Not part of the deployed page —
dev-only, same as any other `tests/` directory.

## Running

```bash
cd tests
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # Chromium is pre-installed in this sandbox;
npm test                                         # unset that env var if yours isn't
```

`playwright.config.js` serves the repository root with `python3 -m http.server`, so the suite
exercises the real `index.html` — no build step, same as production.

## What it covers

- **`fixtures/mockGoogle.js`** — intercepts every external request the page makes (Sheets, Drive
  listing/content, the Apps Script endpoint, and the three CDN scripts — served from `../vendor/`,
  byte-identical to what `index.html` pins via `integrity=`) with an in-memory fake backend. No
  real network access, no real credentials or company data anywhere in the suite.
- **`e2e/`** — one spec per Phase 0 concern: catalog/INS/FREE/strike-through, discounts and VAT
  (including "not registered for VAT"), save/load (including the Drive-archive round trip and the
  "لم يُرفع" offline marker), contracts (totals, tafqit, the stamp staying off by default), invoices
  (server-issued number and Asia/Riyadh time, decoding and checking the ZATCA QR TLV, create-only
  numbering), XSS probes (`<img src=x onerror=…>` in a product description, client name, quote
  number, and a Drive file name — plus a tampered saved contract run through DOMPurify), and that
  none of the above trips a CSP violation.
- **`parity/parity.spec.js`** — the same fixtures run through this branch's `index.html` *and*
  through the original on `main` (fetched with `git show main:index.html` straight into memory —
  it is never written to disk or committed, since it still carries the stamp/representative data
  item 3 removed here), asserting the quote totals, every contract tafqit line, and the invoice
  line/VAT allocation come out identical. This is what proves the hardening didn't change a
  business rule.

## Adding a scenario

Add rows to `fixtures/products.js` or extend `helpers.js`' `openApp()` options (`seller`, `cfg`)
rather than hand-rolling `localStorage` in a test — that keeps every spec using the same shared
mock contract.

## Running against a real (or staging) Apps Script instead of the mock

Pass `cfg.appsScriptUrl` (and `cfg.userId`/a real API key via `rows`/mock overrides) to `openApp()`
pointing at a deployed `apps-script/Code.gs` to smoke-test a deployment end to end instead of the
fake backend — see `apps-script/README.md` §7. Never point it at the production folders; use a
disposable test folder tree.
