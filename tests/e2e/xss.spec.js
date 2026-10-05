// @ts-check
const { test, expect } = require('@playwright/test');
const { openApp, addProduct } = require('../helpers');
const { rows, PRODUCTS } = require('../fixtures/products');

// Every probe sets window.__xssFired instead of alert() (which would hang the test waiting on a
// dialog) — a script that actually ran would still have to execute this onerror/onload handler.
async function armProbe(page) {
  await page.addInitScript(() => { window.__xssFired = false; });
}
async function expectNoXss(page) {
  expect(await page.evaluate(() => window.__xssFired)).toBe(false);
}

test('a product description with a crafted <img onerror> never executes, in the catalog or the quote line', async ({ page }) => {
  await armProbe(page);
  await openApp(page, { rows: rows() });
  await expect(page.locator(`.cat-row[data-code="${PRODUCTS.XSS[0]}"] .cat-name`)).toContainText('<img');
  await expectNoXss(page);

  await addProduct(page, PRODUCTS.XSS[0]);
  await expect(page.locator('#quoteBody tr').first().locator('.desc-edit')).toContainText('<img');
  await expectNoXss(page);
});

test('a crafted client name never executes, including when it flows into the generated contract', async ({ page }) => {
  await armProbe(page);
  await openApp(page, { rows: rows(), seller: { adminIds: ['92'] }, cfg: { userId: '92' } });
  await addProduct(page, PRODUCTS.GATEWAY[0]);
  const payload = '<img src=x onerror="window.__xssFired=true">';
  await page.fill('#clientName', payload);
  await page.fill('#clientCo', payload);
  await expectNoXss(page);

  await page.click('.topnav button:has-text("⚙️ الإعدادات")');
  await page.click('#ctcBtn');
  await expect(page.locator('#contractOverlay')).toContainText('<img');
  await expectNoXss(page);
});

test('a crafted quote number never executes in the local-quotes list', async ({ page }) => {
  await armProbe(page);
  await openApp(page, { rows: rows() });
  await addProduct(page, PRODUCTS.AC[0]);
  const payload = 'MMC-1"><img src=x onerror="window.__xssFired=true">';
  await page.fill('#quoteNo', payload);
  await page.locator('.topnav button:has-text("💾 حفظ")').click();
  await expectNoXss(page);

  await page.click('.topnav button:has-text("📂 تحميل عرض")');
  await expect(page.locator('#localQuotesList')).toContainText('<img');
  await expectNoXss(page);
});

test('a crafted Drive file name never executes when browsing or searching saved quotes', async ({ page }) => {
  await armProbe(page);
  const { google } = await openApp(page, { rows: rows() });
  const evilName = 'MMC-9999999"><img src=x onerror="window.__xssFired=true">.json';
  google.drive[google.quotesFolder].set('evil-file', {
    id: 'evil-file', name: evilName, content: JSON.stringify({ quoteNo: 'MMC-9999999', items: [] }), modifiedTime: new Date().toISOString(),
  });

  await page.click('.topnav button:has-text("📂 تحميل عرض")');
  await page.fill('#loadQuoteId', '*');
  await page.click('#loadOverlay button:has-text("🔍 بحث")');
  await expect(page.locator('#loadResults')).toContainText('<img');
  await expectNoXss(page);
});

test('a tampered saved contract HTML is sanitized by DOMPurify on load, not executed', async ({ page }) => {
  await armProbe(page);
  const { google } = await openApp(page, { rows: rows(), seller: { adminIds: ['92'] }, cfg: { userId: '92' } });
  const evilHtml = '<div class="ct-page">محتوى <img src=x onerror="window.__xssFired=true"> <script>window.__xssFired=true</script></div>';
  google.drive[google.contractsFolder].set('evil-contract', {
    id: 'evil-contract', name: 'MMCT-999.json',
    content: JSON.stringify({ html: evilHtml, contractNo: 'MMCT-999', quoteNo: '' }),
    modifiedTime: new Date().toISOString(),
  });

  await page.click('.topnav button:has-text("⚙️ الإعدادات")');
  await page.click('#lcBtn'); // openLoadContract() already searches '*' on open
  await page.click('#loadContractOverlay [data-file-id="evil-contract"]');
  await expect(page.locator('#contractOverlay')).toBeVisible();
  await expect(page.locator('#contractOverlay')).toContainText('محتوى');
  await expectNoXss(page);
});
