// @ts-check
const { test, expect } = require('@playwright/test');
const { openApp, addProduct, readTotals } = require('../helpers');
const { rows, PRODUCTS } = require('../fixtures/products');

test('saving locally and reloading restores items, discount and client fields', async ({ page }) => {
  const { google } = await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.GATEWAY[0]);
  await page.fill('#clientName', 'عميل تجريبي');
  await page.fill('#discountPercent', '5');
  await page.locator('#discountPercent').dispatchEvent('input');
  const quoteNo = await page.locator('#quoteNo').inputValue();

  await page.locator('.topnav button:has-text("💾 حفظ")').click();
  await expect(page.locator('#toast')).toContainText('تم الحفظ');

  // The save also reaches the shared Drive archive (R7/R8) whenever Apps Script is configured.
  expect(google.readSaved(quoteNo + '.json')).not.toBeNull();

  await page.reload();
  await page.click('.topnav button:has-text("📂 تحميل عرض")');
  await page.click(`#localQuotesList [data-key="quote_${quoteNo}"]`);
  await expect(page.locator('#clientName')).toHaveValue('عميل تجريبي');
  await expect(page.locator('#quoteBody tr')).toHaveCount(2); // gateway + its INS line
  await expect(page.locator('#discountPercent')).toHaveValue('5');
});

test('a quote saved with no Apps Script configured is marked "لم يُرفع" locally', async ({ page }) => {
  await openApp(page, { rows: rows(), cfg: { appsScriptUrl: '' } });
  await addProduct(page, PRODUCTS.AC[0]);
  await page.locator('.topnav button:has-text("💾 حفظ")').click();
  await expect(page.locator('#toast')).toContainText('محلياً فقط');

  await page.click('.topnav button:has-text("📂 تحميل عرض")');
  await expect(page.locator('#localQuotesList')).toContainText('لم يُرفع');
});
