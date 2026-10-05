'use strict';
const { installGoogleMocks } = require('./fixtures/mockGoogle');

/**
 * Mocks every Google endpoint, pre-seeds this browser's localStorage exactly the way
 * ⚙️ الإعدادات would (so tests never have to click through the settings modal), and opens the app.
 * `seller`: merged into the per-browser gseller_info the app reads at start-up.
 * `cfg`: overrides for the connection settings (apiKey/folders/appsScriptUrl come from the mock
 * automatically; pass e.g. {userId:'92'} or {appsScriptUrl:''} to test the no-Apps-Script path).
 */
async function openApp(page, { rows, costRate, images, seller = {}, cfg = {} } = {}) {
  const google = await installGoogleMocks(page, { rows, costRate, images });
  const localStorageSeed = {
    gapi_key: google.apiKey,
    gsheet_id: google.sheetId,
    gsheet_name: 'المنتجات',
    gdrive_folder: google.imagesFolder,
    gquotes_folder: google.quotesFolder,
    gcontracts_folder: google.contractsFolder,
    ginvoices_folder: google.invoicesFolder,
    gapps_script_url: 'appsScriptUrl' in cfg ? cfg.appsScriptUrl : google.appsScriptUrl,
    guser_id: cfg.userId ?? '92',
    gcontract_serial: cfg.contractSerial ?? '1',
    gseller_info: JSON.stringify(seller),
  };
  await page.addInitScript(seed => {
    Object.entries(seed).forEach(([k, v]) => window.localStorage.setItem(k, v));
  }, localStorageSeed);

  const cspViolations = [];
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', e => {
      window.__cspViolations.push(e.violatedDirective + ': ' + e.blockedURI);
    });
  });

  await page.goto('/index.html');
  await page.waitForSelector('.cat-row', { state: 'attached' });
  return { google, cspViolations };
}

async function addProduct(page, code) {
  await page.click(`.cat-row[data-code="${code}"]`);
}

async function cspViolations(page) {
  return page.evaluate(() => window.__cspViolations || []);
}

function parseMoney(text) {
  // Strips the trailing "SAR" alt text / any non-numeric characters the riyal <img>'s alt leaves
  // behind, keeping the first number — matches both "1,234.50" and plain "0" renderings.
  const m = String(text).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}
async function readTotals(page) {
  const [sub, after, vat, grand] = await Promise.all([
    page.locator('#subTotal').innerText(),
    page.locator('#afterDiscount').innerText(),
    page.locator('#vatAmt').innerText(),
    page.locator('#grandTotal').innerText(),
  ]);
  return { subTotal: parseMoney(sub), afterDiscount: parseMoney(after), vatAmt: parseMoney(vat), grandTotal: parseMoney(grand) };
}

module.exports = { openApp, addProduct, cspViolations, readTotals, parseMoney };
