// @ts-check
const { test, expect } = require('@playwright/test');
const { openApp, addProduct, cspViolations } = require('../helpers');
const { rows, PRODUCTS } = require('../fixtures/products');

test('no CSP violations across the catalog, discount, VAT and save flow', async ({ page }) => {
  await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.GATEWAY[0]);
  await page.fill('#discountPercent', '10');
  await page.locator('#discountPercent').dispatchEvent('input');
  await page.locator('#vatToggle').uncheck();
  await page.locator('#vatToggle').check();
  await page.locator('.topnav button:has-text("💾 حفظ")').click();
  await expect(page.locator('#toast')).toContainText('تم الحفظ');

  expect(await cspViolations(page)).toEqual([]);
});

const SELLER = {
  adminIds: ['92'], nameAr: 'شركة تجريبية للحلول الذكية', vat: '300000000000003', crn: '1112223334',
  building: '1234', street: 'شارع تجريبي', district: 'حي تجريبي', city: 'جدة', postal: '12345', additional: '1234',
};

test('no CSP violations opening a contract and an invoice preview', async ({ page }) => {
  await openApp(page, { rows: rows(), seller: SELLER, cfg: { userId: '92' } });
  await addProduct(page, PRODUCTS.GATEWAY[0]);

  await page.click('.topnav button:has-text("⚙️ الإعدادات")');
  await page.click('#ctcBtn');
  await expect(page.locator('#contractOverlay')).toBeVisible();
  await page.click('#contractOverlay button:has-text("✕ إغلاق")');

  await page.click('.topnav .opt-wrap button');
  await page.locator('#optMenu .opt-item').first().click();
  await page.fill('#byName', 'عميل');
  await page.fill('#byCrn', '9998887776');
  await page.fill('#byBuilding', '1111');
  await page.fill('#byStreet', 'شارع');
  await page.fill('#byDistrict', 'حي');
  await page.fill('#byCity', 'جدة');
  await page.fill('#byPostal', '11111');
  await page.fill('#invSupplyDate', '2026-10-01');
  await page.click('button:has-text("👁️ معاينة الفاتورة")');
  await expect(page.locator('#invoiceOverlay')).toBeVisible(); // renders the ZATCA QR via the pinned qrcode-generator script

  expect(await cspViolations(page)).toEqual([]);
});
