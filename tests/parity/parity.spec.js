// @ts-check
// Parity check (handoff §"Validation"): the exact same fixtures run through this branch's
// index.html and through the original on `main`, asserting identical totals, payment amounts,
// tafqit and invoice lines. The original file is fetched from git at run time via `git show` and
// handed to the browser purely in memory (page.route fulfill) — it is NEVER written to disk or
// committed, since it still contains the stamp/representative data item 3 removed from this branch.
const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const path = require('path');
const { installGoogleMocks } = require('../fixtures/mockGoogle');
const { rows, PRODUCTS } = require('../fixtures/products');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ORIGINAL_PATH = '/__original_main__.html';

function originalIndexHtml() {
  return execSync('git show main:index.html', { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 }).toString('utf8');
}

// cfg.userId differs: the original checks the hard-coded ADMIN_USER_ID; this branch checks an
// allow-list (seller.adminIds) — both are set up so the SAME scenario is admin on both pages.
async function setupPage(page, { original }) {
  const google = await installGoogleMocks(page, { rows: rows() });
  const seller = { nameAr: 'شركة تجريبية للحلول الذكية', crn: '1112223334', bank: 'بنك تجريبي', iban: 'SA0000000000000000000000', adminIds: ['6753'] };
  const seed = {
    gapi_key: google.apiKey, gsheet_id: google.sheetId, gsheet_name: 'المنتجات',
    gdrive_folder: google.imagesFolder, gquotes_folder: google.quotesFolder,
    gcontracts_folder: google.contractsFolder, ginvoices_folder: google.invoicesFolder,
    gapps_script_url: google.appsScriptUrl,
    guser_id: '6753', // the original's own hard-coded admin number — also allow-listed above for this branch
    gcontract_serial: '1',
    gseller_info: JSON.stringify(seller),
  };
  await page.addInitScript(seed => { Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, v)); }, seed);

  if (original) {
    await page.route('**' + ORIGINAL_PATH, route => route.fulfill({ contentType: 'text/html', body: originalIndexHtml() }));
    await page.goto(ORIGINAL_PATH);
  } else {
    await page.goto('/index.html');
  }
  await page.waitForSelector('.cat-row', { state: 'attached' });
  return google;
}

function parseMoney(text) {
  const m = String(text).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}
async function readTotals(page) {
  const [sub, after, vat, grand] = await Promise.all([
    page.locator('#subTotal').innerText(), page.locator('#afterDiscount').innerText(),
    page.locator('#vatAmt').innerText(), page.locator('#grandTotal').innerText(),
  ]);
  return { subTotal: parseMoney(sub), afterDiscount: parseMoney(after), vatAmt: parseMoney(vat), grandTotal: parseMoney(grand) };
}
async function buildQuote(page) {
  // Matched by visible code text, not data-code — the original page (pre-item-1) has no such
  // attribute; both versions render the code inside .cat-code either way.
  await page.locator('.cat-row', { hasText: PRODUCTS.GATEWAY[0] }).click();
  await page.locator('.cat-row', { hasText: PRODUCTS.AC[0] }).click();
  await page.fill('#discountPercent', '12.5');
  await page.locator('#discountPercent').dispatchEvent('input');
}

test('quote totals (subtotal/discount/VAT/grand) are identical to main', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const [pageOriginal, pageNew] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
  await Promise.all([setupPage(pageOriginal, { original: true }), setupPage(pageNew, { original: false })]);
  await Promise.all([buildQuote(pageOriginal), buildQuote(pageNew)]);

  const [totalsOriginal, totalsNew] = await Promise.all([readTotals(pageOriginal), readTotals(pageNew)]);
  expect(totalsNew).toEqual(totalsOriginal);
  // Sanity: the fixture actually produced a non-trivial, non-zero scenario worth comparing.
  expect(totalsOriginal.grandTotal).toBeGreaterThan(0);

  await ctxA.close();
  await ctxB.close();
});

test('contract grand total and every tafqit (50/40/10 + total) line up with main', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const [pageOriginal, pageNew] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
  await Promise.all([setupPage(pageOriginal, { original: true }), setupPage(pageNew, { original: false })]);
  await Promise.all([buildQuote(pageOriginal), buildQuote(pageNew)]);

  for (const page of [pageOriginal, pageNew]) {
    await page.click('.topnav button:has-text("⚙️ الإعدادات")');
    await page.click('#ctcBtn');
    await expect(page.locator('#contractOverlay')).toBeVisible();
  }
  const read = async page => ({
    grand: parseMoney(await page.locator('#ctGrand').innerText()),
    grandWords: (await page.locator('#ctGrandWords').innerText()).trim(),
    p50Words: (await page.locator('#ctP50Words').innerText()).trim(),
    p40Words: (await page.locator('#ctP40Words').innerText()).trim(),
    p10Words: (await page.locator('#ctP10Words').innerText()).trim(),
  });
  const [ctOriginal, ctNew] = await Promise.all([read(pageOriginal), read(pageNew)]);
  expect(ctNew).toEqual(ctOriginal);
  expect(ctOriginal.grandWords).toContain('ريال سعودي');

  await ctxA.close();
  await ctxB.close();
});

test('invoice line amounts and VAT allocation (computeInvoiceLines) match main exactly', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const [pageOriginal, pageNew] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
  await Promise.all([setupPage(pageOriginal, { original: true }), setupPage(pageNew, { original: false })]);
  await Promise.all([buildQuote(pageOriginal), buildQuote(pageNew)]);

  const draftOf = async page => {
    await page.click('.topnav .opt-wrap button');
    await page.locator('#optMenu .opt-item').first().click();
    await page.fill('#byName', 'عميل تجريبي');
    await page.fill('#byCrn', '9998887776');
    await page.fill('#byBuilding', '1111');
    await page.fill('#byStreet', 'شارع');
    await page.fill('#byDistrict', 'حي');
    await page.fill('#byCity', 'جدة');
    await page.fill('#byPostal', '11111');
    await page.fill('#invSupplyDate', '2026-10-01');
    // Seller data is filled in per-page below (both need it; the original has no adminIds field).
    await page.click('button:has-text("👁️ معاينة الفاتورة")');
    await expect(page.locator('#invoiceOverlay')).toBeVisible();
    // `seller`/`_invDraft` are `let`-declared top-level globals — reachable as bare identifiers
    // inside page.evaluate() (same execution context), but never as window.* properties.
    return page.evaluate(() => ({ lines: _invDraft.lines, totals: _invDraft.totals }));
  };

  // Both pages need complete seller (ZATCA) data — set directly on the `seller` global, bypassing
  // the settings form, identically on both versions (the field names/shape haven't changed).
  const fillSeller = page => page.evaluate(() => {
    Object.assign(seller, { vat: '300000000000003', building: '1234', street: 's', district: 'd', city: 'c', postal: '12345', additional: '1234' });
  });
  await Promise.all([fillSeller(pageOriginal), fillSeller(pageNew)]);

  const [draftOriginal, draftNew] = await Promise.all([draftOf(pageOriginal), draftOf(pageNew)]);
  expect(draftNew.totals).toEqual(draftOriginal.totals);
  expect(draftNew.lines).toEqual(draftOriginal.lines);

  await ctxA.close();
  await ctxB.close();
});
