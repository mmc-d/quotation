// @ts-check
const { test, expect } = require('@playwright/test');
const { openApp, addProduct, parseMoney } = require('../helpers');
const { rows, PRODUCTS } = require('../fixtures/products');

// The admin-only CTC/LC buttons only show once the signed-in user is on the admin allow-list
// (seller.adminIds) — this replaces the old hard-coded ADMIN_USER_ID (R2/R3).
const ADMIN_SELLER = { adminIds: ['92'], nameAr: 'شركة تجريبية للحلول الذكية', crn: '1112223334', bank: 'بنك تجريبي', iban: 'SA0000000000000000000000' };

test('contract totals and the 50/40/10 payment words match the quote, with tafqit filled in', async ({ page }) => {
  await openApp(page, { rows: rows(), seller: ADMIN_SELLER, cfg: { userId: '92' } });
  await addProduct(page, PRODUCTS.GATEWAY[0]); // 1500 + 150 install, VAT on by default

  await page.click('.topnav button:has-text("⚙️ الإعدادات")');
  await page.click('#ctcBtn');
  await expect(page.locator('#contractOverlay')).toBeVisible();

  const grandText = await page.locator('#ctGrand').innerText();
  const grand = parseMoney(grandText);
  expect(grand).toBeCloseTo(1650 * 1.15, 2); // (1500+150) * 1.15 VAT

  // Payment split: 50/40/10 of the VAT-inclusive grand total, each spelled out.
  const p50 = parseMoney(await page.locator('#ctP50').innerText());
  const p40 = parseMoney(await page.locator('#ctP40').innerText());
  const p10 = parseMoney(await page.locator('#ctP10').innerText());
  expect(p50).toBeCloseTo(grand * 0.5, 2);
  expect(p40).toBeCloseTo(grand * 0.4, 2);
  expect(p10).toBeCloseTo(grand * 0.1, 2);
  await expect(page.locator('#ctGrandWords')).toContainText('ريال سعودي');
  await expect(page.locator('#ctP50Words')).not.toBeEmpty();

  // Second-party block falls back to the seller settings (R2) — no hard-coded representative.
  await expect(page.locator('#ctContent')).toContainText('شركة تجريبية للحلول الذكية');
  await expect(page.locator('.ct-bank')).toContainText('SA0000000000000000000000');
});

test('editing a contract line recalculates totals and tafqit live', async ({ page }) => {
  await openApp(page, { rows: rows(), seller: ADMIN_SELLER, cfg: { userId: '92' } });
  await addProduct(page, PRODUCTS.AC[0]);
  await page.click('.topnav button:has-text("⚙️ الإعدادات")');
  await page.click('#ctcBtn');

  await page.locator('.ct-price').first().fill('1000');
  await page.locator('.ct-price').first().dispatchEvent('input');
  await expect(page.locator('.ct-line-total').first()).toContainText('1,000.00');
  // Grand total and its Arabic words both follow the edited price (ctRecalc() re-bound by
  // attachContractHandlers() even though DOMPurify would have stripped the inline oninput=).
  const grand = parseMoney(await page.locator('#ctGrand').innerText());
  await expect(page.locator('#ctGrandWords')).not.toBeEmpty();
  expect(grand).toBeGreaterThan(1000);
});

test('an admin can stamp-and-print only on demand — the stamp never appears by default', async ({ page }) => {
  await openApp(page, { rows: rows(), seller: { ...ADMIN_SELLER, stampFileId: 'FAKE-STAMP-ID' }, cfg: { userId: '92' } });
  await addProduct(page, PRODUCTS.GATEWAY[0]);
  await page.click('.topnav button:has-text("⚙️ الإعدادات")');
  await page.click('#ctcBtn');

  await expect(page.locator('#ctStampSlot')).toBeEmpty();
  await expect(page.locator('#ctStampBtn')).toBeVisible();
});
