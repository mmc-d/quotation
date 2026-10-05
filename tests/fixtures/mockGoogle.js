// Mocks every external endpoint index.html calls, so the suite never needs real network access
// (useful here — this sandbox's own proxy blocks cdn.jsdelivr.net — and never needs real
// credentials, folders or company data. All content below is synthetic.
'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR_DIR = path.join(__dirname, '..', '..', 'vendor');
const CDN_FILES = {
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js': 'exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js': 'qrcode.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js': 'purify.min.js',
};

const FAKE_API_KEY = 'FAKE-TEST-API-KEY';
const FAKE_SHEET_ID = 'FAKE-SHEET-ID';
const FAKE_IMAGES_FOLDER = 'FAKE-IMAGES-FOLDER';
const FAKE_QUOTES_FOLDER = 'FAKE-QUOTES-FOLDER';
const FAKE_CONTRACTS_FOLDER = 'FAKE-CONTRACTS-FOLDER';
const FAKE_INVOICES_FOLDER = 'FAKE-INVOICES-FOLDER';
const FAKE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/FAKE-TEST-DEPLOYMENT/exec';

// index.html builds its Drive "q" values with literal "+" standing in for a space (the classic
// application/x-www-form-urlencoded convention); URLSearchParams.get() already turns those back
// into real spaces when it parses the query string, so the patterns below match spaces, not "+".
function driveQueryFolderId(urlStr) {
  const q = new URL(urlStr).searchParams.get('q') || '';
  const m = /'([^']+)'\s+in\s+parents/.exec(q);
  return m ? m[1] : null;
}
function driveQueryNameFilter(urlStr) {
  const q = new URL(urlStr).searchParams.get('q') || '';
  const eqM = /name\s*=\s*'([^']+)'/.exec(q);
  if (eqM) return { type: 'eq', value: eqM[1] };
  const containsM = /name\s+contains\s+'([^']+)'/.exec(q);
  if (containsM) return { type: 'contains', value: containsM[1] };
  return null;
}

/**
 * Creates a fresh fake Google backend and wires route interception for `page`.
 * `rows`: raw sheet rows (array of arrays) for the products sheet, header rows included — same
 * shape loadSheet() parses from the real Sheets API.
 * `costRate`: value returned for cell I2 (purchase-cost CNY/USD rate); omit to simulate "not set".
 */
async function installGoogleMocks(page, { rows, costRate, images = {} } = {}) {
  const drive = {
    [FAKE_IMAGES_FOLDER]: new Map(),
    [FAKE_QUOTES_FOLDER]: new Map(),
    [FAKE_CONTRACTS_FOLDER]: new Map(),
    [FAKE_INVOICES_FOLDER]: new Map(),
  };
  Object.entries(images).forEach(([code, content]) => drive[FAKE_IMAGES_FOLDER].set(code, { id: 'img-' + code, content }));
  let nextFileSeq = 1;
  const counters = { quote: new Map(), contract: 0, invoiceLastNumber: '' };
  const calls = []; // every Apps Script POST body this run — tests can inspect this

  function fileEntry(folderMap, name) {
    return [...folderMap.values()].find(f => f.name === name);
  }
  function putFile(folderMap, name, content) {
    let entry = fileEntry(folderMap, name);
    if (entry) { entry.content = content; entry.modifiedTime = new Date().toISOString(); return 'updated'; }
    entry = { id: 'file-' + (nextFileSeq++), name, content, modifiedTime: new Date().toISOString() };
    folderMap.set(entry.id, entry);
    return 'created';
  }

  // ── CDN scripts (vendored copies — byte-identical to what index.html pins via SRI) ──────────
  for (const [url, filename] of Object.entries(CDN_FILES)) {
    const body = fs.readFileSync(path.join(VENDOR_DIR, filename));
    await page.route(url, route => route.fulfill({ status: 200, contentType: 'application/javascript', body }));
  }
  // Google Identity Services — not used unless a test sets googleClientId; serve a harmless stub
  // either way so the page never issues a real request for it.
  await page.route('https://accounts.google.com/gsi/client', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* gsi stub: sign-in not exercised by this test */' }));

  // ── Sheets API: the products sheet, and the single-cell cost-rate read ──────────────────────
  await page.route(`https://sheets.googleapis.com/v4/spreadsheets/${FAKE_SHEET_ID}/values/*`, route => {
    const url = new URL(route.request().url());
    const range = decodeURIComponent(url.pathname.split('/values/')[1]);
    if (range.includes('I2')) {
      route.fulfill({ json: { range, majorDimension: 'ROWS', values: costRate != null ? [[String(costRate)]] : [] } });
    } else {
      route.fulfill({ json: { range, majorDimension: 'ROWS', values: rows } });
    }
  });

  // ── Drive API: file listing ─────────────────────────────────────────────────────────────────
  await page.route('https://www.googleapis.com/drive/v3/files?*', route => {
    const url = route.request().url();
    const folderId = driveQueryFolderId(url);
    const folder = drive[folderId];
    if (!folder) { route.fulfill({ json: { files: [] } }); return; }
    const filter = driveQueryNameFilter(url);
    let files = [...folder.values()];
    if (filter && filter.type === 'eq') files = files.filter(f => f.name === filter.value);
    if (filter && filter.type === 'contains') files = files.filter(f => f.name.includes(filter.value));
    route.fulfill({ json: { files: files.map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })) } });
  });
  // ── Drive API: file content (alt=media) ─────────────────────────────────────────────────────
  await page.route('https://www.googleapis.com/drive/v3/files/*?*', route => {
    const url = route.request().url();
    const id = decodeURIComponent(new URL(url).pathname.split('/files/')[1]);
    for (const folder of Object.values(drive)) {
      const entry = folder.get(id);
      if (entry) {
        const isImage = folder === drive[FAKE_IMAGES_FOLDER];
        if (isImage) route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(entry.content || '', 'base64') });
        else route.fulfill({ status: 200, contentType: 'application/json', body: entry.content });
        return;
      }
    }
    route.fulfill({ status: 404, json: { error: { message: 'Not found' } } });
  });
  // Drive thumbnail links (catalog/contract product images) — a 1x1 PNG is enough to render.
  const onePx = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.route('https://drive.google.com/thumbnail?*', route => route.fulfill({ status: 200, contentType: 'image/png', body: onePx }));

  // ── Apps Script endpoint: save / nextNumber / saveSettings ──────────────────────────────────
  await page.route(FAKE_APPS_SCRIPT_URL, route => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    if (body.action === 'nextNumber') {
      if (body.docType === 'quote') {
        const key = body.prefix;
        const seq = (counters.quote.get(key) || 0) + 1;
        if (!body.peek) counters.quote.set(key, seq);
        route.fulfill({ json: { success: true, number: key + seq, seq } });
        return;
      }
      if (body.docType === 'contract') {
        const seq = counters.contract + 1;
        if (!body.peek) counters.contract = seq;
        route.fulfill({ json: { success: true, number: 'MMCT-' + seq, seq } });
        return;
      }
      if (body.docType === 'invoice') {
        const prevNumber = counters.invoiceLastNumber || null;
        const prevSeq = prevNumber ? parseInt(/(\d+)$/.exec(prevNumber)[1], 10) : 0;
        const nextSeq = prevSeq + 1;
        const number = 'MMC-INV-' + String(nextSeq).padStart(5, '0');
        if (!body.peek) counters.invoiceLastNumber = number;
        route.fulfill({ json: { success: true, number, seq: nextSeq, prevNumber, serverTime: { date: '2026-10-05', time: '12:34:56' } } });
        return;
      }
      route.fulfill({ json: { success: false, error: 'unknown docType' } });
      return;
    }
    if (body.action === 'saveSettings') {
      const action = putFile(drive[FAKE_QUOTES_FOLDER], 'settings.json', JSON.stringify(body.state));
      route.fulfill({ json: { success: true, action } });
      return;
    }
    // Plain save — {fileName, state, folderId}. The folder is resolved the same way Code.gs does:
    // by the file-name pattern, never by the folderId the page sent.
    const name = body.fileName || '';
    let folder = null;
    if (/^MMC-\d{7,}\.json$/.test(name)) folder = drive[FAKE_QUOTES_FOLDER];
    else if (/^MMCT-\d+\.json$/.test(name)) folder = drive[FAKE_CONTRACTS_FOLDER];
    else if (/^MMC-INV-\d{5,}\.json$/.test(name)) folder = drive[FAKE_INVOICES_FOLDER];
    if (!folder) { route.fulfill({ json: { success: false, error: 'bad file name: ' + name } }); return; }
    if (folder === drive[FAKE_INVOICES_FOLDER] && fileEntry(folder, name)) {
      route.fulfill({ json: { success: false, error: 'invoice already exists' } });
      return;
    }
    const action = putFile(folder, name, JSON.stringify(body.state));
    route.fulfill({ json: { success: true, action } });
  });

  return {
    drive, calls,
    apiKey: FAKE_API_KEY,
    sheetId: FAKE_SHEET_ID,
    imagesFolder: FAKE_IMAGES_FOLDER,
    quotesFolder: FAKE_QUOTES_FOLDER,
    contractsFolder: FAKE_CONTRACTS_FOLDER,
    invoicesFolder: FAKE_INVOICES_FOLDER,
    appsScriptUrl: FAKE_APPS_SCRIPT_URL,
    // Test helper: read back a saved file's parsed JSON by name, from any folder.
    readSaved(name) {
      for (const folder of Object.values(drive)) {
        const entry = fileEntry(folder, name);
        if (entry) return JSON.parse(entry.content);
      }
      return null;
    },
  };
}

module.exports = { installGoogleMocks, FAKE_APPS_SCRIPT_URL };
