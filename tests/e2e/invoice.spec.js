// @ts-check
const { test, expect } = require('@playwright/test');
const { openApp, addProduct, parseMoney } = require('../helpers');
const { rows, PRODUCTS } = require('../fixtures/products');

// Decodes a ZATCA TLV (tag, BER length, value) base64 string into {tag: value} — mirrors what
// zatcaTlvBase64()/invoiceQrBase64() in index.html build, decoded independently here.
function decodeTlv(base64) {
  const bytes = Buffer.from(base64, 'base64');
  const out = {};
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i++];
    let len = bytes[i++];
    if (len === 0x81) len = bytes[i++];
    else if (len === 0x82) { len = (bytes[i] << 8) | bytes[i + 1]; i += 2; }
    out[tag] = bytes.slice(i, i + len).toString('utf8');
    i += len;
  }
  return out;
}

const SELLER = { nameAr: 'شركة تجريبية للحلول الذكية', vat: '300000000000003', crn: '1112223334', building: '1234', street: 'شارع تجريبي', district: 'حي تجريبي', city: 'جدة', postal: '12345', additional: '1234' };

test('issuing a tax invoice gets its number and time from the server, with a valid ZATCA QR', async ({ page }) => {
  const { google } = await openApp(page, { rows: rows(), seller: SELLER });
  await addProduct(page, PRODUCTS.GATEWAY[0]);

  await page.click('.topnav .opt-wrap button');
  await page.locator('#optMenu .opt-item').first().click(); // فاتورة ضريبية — always the first entry
  await page.fill('#byName', 'عميل تجريبي للفاتورة');
  await page.fill('#byCrn', '9998887776');
  await page.fill('#byBuilding', '4321');
  await page.fill('#byStreet', 'شارع العميل');
  await page.fill('#byDistrict', 'حي العميل');
  await page.fill('#byCity', 'الرياض');
  await page.fill('#byPostal', '54321');
  await page.fill('#invSupplyDate', '2026-10-01');
  await page.click('button:has-text("👁️ معاينة الفاتورة")');

  await expect(page.locator('#invoiceOverlay')).toBeVisible();
  await page.click('#invIssueBtn');
  await page.click('#confirmYes'); // appConfirm()'s in-app yes/no — native confirm() is suppressed
  await expect(page.locator('#invoiceOverlay')).toContainText('MMC-INV-00001');

  // The server's Asia/Riyadh clock, not this machine's — see mockGoogle.js's fixed serverTime.
  await expect(page.locator('#invoiceOverlay')).toContainText('05/10/2026');

  const savedInvoice = google.readSaved('MMC-INV-00001.json');
  expect(savedInvoice).not.toBeNull();
  expect(savedInvoice.issueDate).toBe('2026-10-05');
  expect(savedInvoice.issueTime).toBe('12:34:56');
  expect(savedInvoice.icv).toBe(1);

  const tlv = decodeTlv(savedInvoice.qr);
  expect(tlv[1]).toBe(SELLER.nameAr);              // seller name
  expect(tlv[2]).toBe(SELLER.vat);                  // seller VAT number
  expect(tlv[3]).toBe('2026-10-05T12:34:56');        // ISO-ish timestamp, server time
  expect(parseFloat(tlv[4])).toBeCloseTo(savedInvoice.totals.total, 2);
  expect(parseFloat(tlv[5])).toBeCloseTo(savedInvoice.totals.vat, 2);
});

test('issuing twice never reuses a number, and the second invoice chains to the first', async ({ page }) => {
  const { google } = await openApp(page, { rows: rows(), seller: SELLER });

  for (let i = 0; i < 2; i++) {
    await addProduct(page, PRODUCTS.AC[0]);
    await page.click('.topnav .opt-wrap button');
    await page.locator('#optMenu .opt-item').first().click();
    await page.fill('#byName', 'عميل ' + i);
    await page.fill('#byCrn', '9998887776');
    await page.fill('#byBuilding', '1111');
    await page.fill('#byStreet', 'شارع');
    await page.fill('#byDistrict', 'حي');
    await page.fill('#byCity', 'جدة');
    await page.fill('#byPostal', '11111');
    await page.fill('#invSupplyDate', '2026-10-01');
    await page.click('button:has-text("👁️ معاينة الفاتورة")');
    await page.click('#invIssueBtn');
    await page.click('#confirmYes');
    await expect(page.locator('#invoiceOverlay')).toBeVisible();
    await page.click('.inv-toolbar button:has-text("✕ إغلاق")');
    await page.click('button:has-text("🗑️ مسح الكل")');
  }
  const first = google.readSaved('MMC-INV-00001.json');
  const second = google.readSaved('MMC-INV-00002.json');
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second.prevNumber).toBe('MMC-INV-00001');
  expect(second.icv).toBe(2);
});

test('a plain invoice (seller not VAT-registered) carries no VAT and no QR', async ({ page }) => {
  await openApp(page, { rows: rows(), seller: { ...SELLER, vatRegistered: false } });
  await addProduct(page, PRODUCTS.AC[0]);
  await page.click('.topnav .opt-wrap button');
  await page.locator('#optMenu .opt-item').first().click();
  await page.fill('#byName', 'عميل');
  await page.fill('#invSupplyDate', '2026-10-01');
  await page.click('button:has-text("👁️ معاينة الفاتورة")');
  await expect(page.locator('#invoiceOverlay')).toContainText('البائع غير مسجل في ضريبة القيمة المضافة');
  await expect(page.locator('.inv-qr-ph, .inv-qr')).toHaveCount(0);
});

test('the nav "🧾 الفواتير الصادرة" button finds a previously issued invoice by its number', async ({ page }) => {
  await openApp(page, { rows: rows(), seller: SELLER });
  await addProduct(page, PRODUCTS.GATEWAY[0]);
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
  await page.click('button:has-text("👁️ معاينة الفاتورة")');
  await page.click('#invIssueBtn');
  await page.click('#confirmYes');
  await expect(page.locator('#invoiceOverlay')).toContainText('MMC-INV-00001');
  await page.click('.inv-toolbar button:has-text("✕ إغلاق")');

  await page.click('.topnav button:has-text("🧾 الفواتير الصادرة")');
  await expect(page.locator('#invListOverlay')).toBeVisible();
  await page.fill('#invSearch', 'MMC-INV-00001');
  await page.click('#invListOverlay button:has-text("🔍 بحث")');
  await page.click('#invListResults .cat-row'); // inline onclick="openIssuedInvoice(i)" — numeric index, not data-*
  await expect(page.locator('#invoiceOverlay')).toBeVisible();
  await expect(page.locator('#invoiceOverlay')).toContainText('MMC-INV-00001');
});
