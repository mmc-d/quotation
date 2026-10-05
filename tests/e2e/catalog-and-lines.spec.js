// @ts-check
const { test, expect } = require('@playwright/test');
const { openApp, addProduct, readTotals } = require('../helpers');
const { rows, PRODUCTS } = require('../fixtures/products');

test('catalog loads from the mocked sheet', async ({ page }) => {
  await openApp(page, { rows: rows() });
  await expect(page.locator('.cat-row')).toHaveCount(4);
  await expect(page.locator('#catCount')).toContainText('4');
});

test('adding a product with an install cost creates the INS line, last and auto-computed', async ({ page }) => {
  await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.GATEWAY[0]);
  await addProduct(page, PRODUCTS.AC[0]);

  const rowsLocator = page.locator('#quoteBody tr');
  await expect(rowsLocator).toHaveCount(3); // gateway + AC + INS
  const lastRow = rowsLocator.last();
  await expect(lastRow.locator('.code-tag')).toHaveText('INS');
  // 150 (gateway) + 80 (AC) = 230, each qty 1
  await expect(lastRow.locator('.row-total')).toContainText('230');

  await expect(page.locator('#itemCount')).toContainText('3');
});

test('deleting the INS line stops it from being auto re-added', async ({ page }) => {
  await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.GATEWAY[0]);
  await page.locator('#quoteBody tr', { hasText: 'INS' }).locator('.btn-del').click();
  await expect(page.locator('#quoteBody tr')).toHaveCount(1);
  // Bumping the gateway's qty must not resurrect the INS row the user explicitly removed.
  await page.locator('#quoteBody tr .qty-f').fill('3');
  await page.locator('#quoteBody tr .qty-f').blur();
  await expect(page.locator('#quoteBody tr')).toHaveCount(1);
});

test('a zero-price item renders FREE on screen, not 0', async ({ page }) => {
  await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.FREE[0]);
  await expect(page.locator('#quoteBody tr').first().locator('.free-tag')).toHaveText('FREE');
  await expect(page.locator('#quoteBody tr').first().locator('.row-total')).toContainText('FREE');
});

test('lowering the unit price below list price strikes through the original total', async ({ page }) => {
  await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.GATEWAY[0]); // list price 1500
  const row = page.locator('#quoteBody tr').first();
  await row.locator('.price-f').fill('1200');
  await row.locator('.price-f').dispatchEvent('input');
  // The struck-through original total (1,500) appears alongside the new total.
  await expect(row.locator('.row-total')).toContainText('1,500');
  await expect(row.locator('.row-total')).toContainText('1,200');
  const totals = await readTotals(page);
  expect(totals.subTotal).toBe(1350); // 1,200 (reduced gateway price) + 150 (its INS line)
});
