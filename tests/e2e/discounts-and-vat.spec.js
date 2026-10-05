// @ts-check
const { test, expect } = require('@playwright/test');
const { openApp, addProduct, readTotals } = require('../helpers');
const { rows, PRODUCTS } = require('../fixtures/products');

test('a percentage discount reduces the after-discount and VAT amounts correctly', async ({ page }) => {
  await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.GATEWAY[0]); // 1500 + 150 install (INS) = 1650 subtotal
  await page.fill('#discountPercent', '10');
  await page.locator('#discountPercent').dispatchEvent('input');

  const t = await readTotals(page);
  expect(t.subTotal).toBe(1650);
  expect(t.afterDiscount).toBeCloseTo(1485, 2); // 1650 * 0.9
  expect(t.vatAmt).toBeCloseTo(1485 * 0.15, 2);
  expect(t.grandTotal).toBeCloseTo(1485 * 1.15, 2);
});

test('a fixed-amount discount is capped at the subtotal and is mutually exclusive with %', async ({ page }) => {
  await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.AC[0]); // 800 + 80 install = 880

  await page.fill('#discountPercent', '20');
  await page.locator('#discountPercent').dispatchEvent('input');
  await page.fill('#discountValue', '5000'); // far above the subtotal — must cap, and clear %
  await page.locator('#discountValue').dispatchEvent('input');

  await expect(page.locator('#discountPercent')).toHaveValue('');
  const t = await readTotals(page);
  expect(t.afterDiscount).toBe(0); // capped at the 880 subtotal
  expect(t.grandTotal).toBe(0);
});

test('VAT toggle adds/removes exactly 15% on the after-discount amount', async ({ page }) => {
  await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.AC[0]); // 880
  let t = await readTotals(page);
  expect(t.vatAmt).toBeCloseTo(880 * 0.15, 2);

  await page.locator('#vatToggle').uncheck();
  t = await readTotals(page);
  expect(t.vatAmt).toBe(0);
  expect(t.grandTotal).toBe(880);
});

test('"not registered for VAT" locks VAT off everywhere, even if the toggle was on', async ({ page }) => {
  await openApp(page, { rows: rows(), seller: { vatRegistered: false, nameAr: 'شركة تجريبية', crn: '1112223334' } });
  await addProduct(page, PRODUCTS.GATEWAY[0]);

  await expect(page.locator('#vatToggle')).not.toBeChecked();
  await expect(page.locator('#vatToggle')).toBeDisabled();
  const t = await readTotals(page);
  expect(t.vatAmt).toBe(0);
  expect(t.grandTotal).toBe(t.subTotal);
});
