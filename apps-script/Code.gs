/**
 * MMC quotation tool — Apps Script save / numbering / settings endpoint.
 * Phase 0 item 7 (R4). See README.md for deployment, Script Properties and rollback.
 *
 * Compatibility: a plain save (no "action", or action:"save") still accepts and returns exactly
 * what index.html has always sent/expected — {fileName, state, folderId} in,
 * {success, action:"created"|"updated", error} out. Everything else is new:
 *   action:"nextNumber"   {docType, prefix?, peek?}        -> {success, number, seq, prevNumber?, serverTime?}
 *   action:"saveSettings" {fileName:"settings.json", state} -> {success, action, error?}
 * Every request may also carry {actorId, idToken} — see resolveActor_().
 *
 * Apps Script web apps do not support CORS preflight, so the browser keeps using
 * Content-Type: text/plain for all of these and the server parses the body as JSON itself.
 */

// ── Script Properties (Project Settings -> Script properties) ───────────────────────────────────
function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? fallback : v;
}
function csvProp_(key) {
  return prop_(key, '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
// Document type -> Drive folder ID. The browser's own folderId is deliberately never used (R4):
// only this mapping decides where a file actually lands. settings.json defaults to the quotes
// folder so no extra folder has to be shared out just for it.
function folderFor_(docType) {
  switch (docType) {
    case 'quote': return prop_('FOLDER_QUOTES', '');
    case 'contract': return prop_('FOLDER_CONTRACTS', '');
    case 'invoice': return prop_('FOLDER_INVOICES', '');
    case 'settings': return prop_('FOLDER_SETTINGS', prop_('FOLDER_QUOTES', ''));
    default: return '';
  }
}

var FILENAME_RULES_ = {
  quote: /^MMC-\d{7,}\.json$/,
  contract: /^MMCT-\d+\.json$/,
  invoice: /^MMC-INV-\d{5,}\.json$/,
  settings: /^settings\.json$/,
};
function docTypeFor_(fileName) {
  for (var type in FILENAME_RULES_) {
    if (FILENAME_RULES_[type].test(fileName)) return type;
  }
  return null;
}

// ── HTTP entry points ────────────────────────────────────────────────────────────────────────────
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ success: false, error: 'طلب غير صالح (JSON)' });
  }
  try {
    if (body.action === 'nextNumber') return jsonOut_(handleNextNumber_(body));
    if (body.action === 'saveSettings') return jsonOut_(handleSaveSettings_(body));
    return jsonOut_(handleSave_(body));
  } catch (err) {
    return jsonOut_({ success: false, error: String((err && err.message) || err) });
  }
}
// Health check only (GET https://.../exec) — the app itself never calls this.
function doGet(e) {
  return jsonOut_({ ok: true, service: 'mmc-quotation-apps-script' });
}
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Identity (R3/R4) ─────────────────────────────────────────────────────────────────────────────
// Verifies a Google ID token against Google's own tokeninfo endpoint — simpler and more robust
// inside Apps Script than checking the JWT signature by hand, and the token is short-lived anyway.
// Returns null (never throws) on anything that doesn't check out, so a forged/garbled token is
// silently treated as "not signed in" rather than blocking the request outright — see handleSave_().
function verifyIdToken_(idToken) {
  if (!idToken) return null;
  try {
    var res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    var payload = JSON.parse(res.getContentText());
    var clientId = prop_('GOOGLE_CLIENT_ID', '');
    if (clientId && payload.aud !== clientId) return null;
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    if (!payload.exp || Number(payload.exp) * 1000 < Date.now()) return null;
    return { email: String(payload.email || '').toLowerCase() };
  } catch (err) {
    return null;
  }
}
function resolveActor_(body) {
  var verified = verifyIdToken_(body.idToken);
  return { actorId: String(body.actorId || ''), email: verified ? verified.email : '' };
}
// Admin allow-list = Script Properties (owner-controlled, independent of the app) UNION the admin
// list inside the currently published settings.json, if one exists — so an admin can be added either
// way. User numbers now, Google e-mails once sign-in is adopted (item 6) — both are checked always.
function adminAllowList_() {
  var ids = csvProp_('ADMIN_USER_IDS');
  var emails = csvProp_('ADMIN_EMAILS').map(function (e) { return e.toLowerCase(); });
  var settings = readJsonFile_(folderFor_('settings'), 'settings.json');
  if (settings) {
    (settings.adminIds || []).forEach(function (id) {
      var s = String(id);
      if (ids.indexOf(s) === -1) ids.push(s);
    });
    (settings.adminEmails || []).forEach(function (em) {
      var l = String(em).toLowerCase();
      if (emails.indexOf(l) === -1) emails.push(l);
    });
  }
  return { ids: ids, emails: emails };
}
function isAdmin_(actor) {
  var list = adminAllowList_();
  if (actor.email && list.emails.indexOf(actor.email) !== -1) return true;
  if (actor.actorId && list.ids.indexOf(actor.actorId) !== -1) return true;
  return false;
}

// ── Drive helpers ────────────────────────────────────────────────────────────────────────────────
function findFile_(folderId, fileName) {
  if (!folderId) return null;
  var it = DriveApp.getFolderById(folderId).getFilesByName(fileName);
  return it.hasNext() ? it.next() : null;
}
function readJsonFile_(folderId, fileName) {
  var file = findFile_(folderId, fileName);
  if (!file) return null;
  try {
    return JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  } catch (err) {
    return null;
  }
}
function getOrCreateHistoryFolder_(parentFolder) {
  var name = prop_('HISTORY_SUBFOLDER_NAME', '_history');
  var it = parentFolder.getFoldersByName(name);
  return it.hasNext() ? it.next() : parentFolder.createFolder(name);
}
function timestamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Riyadh', "yyyyMMdd'T'HHmmss");
}
function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

// ── Audit log (append-only sheet: time, actor, action, file, SHA-256) ──────────────────────────────
// Optional — if AUDIT_SHEET_ID isn't set, saves still work, just unaudited. Never blocks a save.
function appendAudit_(actor, action, fileName, hash) {
  var sheetId = prop_('AUDIT_SHEET_ID', '');
  if (!sheetId) return;
  try {
    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    sheet.appendRow([new Date(), actor.email || actor.actorId || '(غير معروف)', action, fileName, hash]);
  } catch (err) { /* audit failures must never block the underlying save */ }
}

// ── Numbering (R7): LockService-protected counters in Script Properties ────────────────────────────
// Seeded from the existing files the first time each counter is used, then held entirely in Script
// Properties from there on (fast — no repeated folder scans). peek:true reads the next value without
// reserving it (used only for the invoice-preview dialog); everything else reserves on every call,
// including a page load or an opened contract draft that is never actually saved — gaps in the
// sequence are expected and accepted, the same way they are in any real invoicing system.
function handleNextNumber_(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: 'الخادم مزدحم، أعد المحاولة' };
  try {
    if (body.docType === 'quote') return nextQuoteNumber_(body);
    if (body.docType === 'contract') return nextContractNumber_(body);
    if (body.docType === 'invoice') return nextInvoiceNumber_(body);
    return { success: false, error: 'نوع مستند غير معروف: ' + body.docType };
  } finally {
    lock.releaseLock();
  }
}
function seedMaxSeq_(folderId, extractSeq) {
  if (!folderId) return 0;
  var files = DriveApp.getFolderById(folderId).getFiles();
  var max = 0;
  while (files.hasNext()) {
    var seq = extractSeq(files.next().getName());
    if (seq !== null && seq > max) max = seq;
  }
  return max;
}
function nextQuoteNumber_(body) {
  var prefix = String(body.prefix || '');
  if (!prefix) return { success: false, error: 'prefix مطلوب لعروض الأسعار' };
  var key = 'CTR_Q_' + prefix;
  var seq = parseInt(prop_(key, '0'), 10);
  if (!seq) {
    // No delimiter before the sequence digits (MMC-YYWWDDn) — strip the prefix itself, not just
    // trailing digits, or a 2026 date prefix would be read back in as part of the sequence.
    seq = seedMaxSeq_(folderFor_('quote'), function (name) {
      if (!name.endsWith('.json')) return null;
      var stem = name.slice(0, -5);
      if (stem.indexOf(prefix) !== 0) return null;
      var rest = stem.slice(prefix.length);
      return /^\d+$/.test(rest) ? parseInt(rest, 10) : null;
    });
  }
  seq += 1;
  if (!body.peek) PropertiesService.getScriptProperties().setProperty(key, String(seq));
  return { success: true, number: prefix + seq, seq: seq };
}
function nextContractNumber_(body) {
  var key = 'CTR_CONTRACT';
  var seq = parseInt(prop_(key, '0'), 10);
  if (!seq) {
    seq = seedMaxSeq_(folderFor_('contract'), function (name) {
      var m = /^MMCT-(\d+)\.json$/.exec(name);
      return m ? parseInt(m[1], 10) : null;
    });
  }
  seq += 1;
  if (!body.peek) PropertiesService.getScriptProperties().setProperty(key, String(seq));
  return { success: true, number: 'MMCT-' + seq, seq: seq };
}
function nextInvoiceNumber_(body) {
  var key = 'CTR_INVOICE_LAST_NUMBER';
  var lastNumber = prop_(key, '');
  if (!lastNumber) {
    // Same rule the client used to apply itself: the highest trailing-digit sequence across every
    // file in the folder, whatever its prefix or digit width — that file's own prefix/width then
    // carries forward (so an owner who starts mid-sequence keeps whatever padding they already used).
    lastNumber = seedMaxInvoiceNumber_(folderFor_('invoice'));
  }
  var prevNumber = lastNumber || null;
  var m = lastNumber ? /(\d+)$/.exec(lastNumber) : null;
  var prevSeq = m ? parseInt(m[1], 10) : 0;
  var prefix = (m && lastNumber) ? lastNumber.slice(0, lastNumber.length - m[1].length) : prop_('INVOICE_PREFIX', 'MMC-INV-');
  var width = m ? m[1].length : 5;
  var startAt = Math.max(1, parseInt(prop_('INVOICE_START', '1'), 10) || 1);
  var nextSeq = Math.max(startAt, prevSeq + 1);
  var number = prefix + String(nextSeq).padStart(width, '0');
  var now = new Date();
  var serverTime = {
    date: Utilities.formatDate(now, 'Asia/Riyadh', 'yyyy-MM-dd'),
    time: Utilities.formatDate(now, 'Asia/Riyadh', 'HH:mm:ss'),
  };
  if (!body.peek) {
    PropertiesService.getScriptProperties().setProperty(key, number);
    appendAudit_(resolveActor_(body), 'reserve-invoice-number', number, '');
  }
  return { success: true, number: number, seq: nextSeq, prevNumber: prevNumber, serverTime: serverTime };
}
function seedMaxInvoiceNumber_(folderId) {
  if (!folderId) return '';
  var files = DriveApp.getFolderById(folderId).getFiles();
  var best = '', bestSeq = -1;
  while (files.hasNext()) {
    var name = files.next().getName().replace(/\.json$/, '');
    var m = /(\d+)$/.exec(name);
    if (!m) continue;
    var seq = parseInt(m[1], 10);
    if (seq > bestSeq) { bestSeq = seq; best = name; }
  }
  return best;
}

// ── Save (default action — back-compatible shape) ───────────────────────────────────────────────
function handleSave_(body) {
  var fileName = String(body.fileName || '');
  var docType = docTypeFor_(fileName);
  if (!docType) return { success: false, error: 'اسم ملف غير صالح أو غير متوقع: ' + fileName };
  if (docType === 'settings') return { success: false, error: 'استخدم action:"saveSettings" لحفظ الإعدادات' };

  var folderId = folderFor_(docType);
  if (!folderId) return { success: false, error: 'مجلد ' + docType + ' غير مُعد في خصائص المشروع' };

  var actor = resolveActor_(body);
  var folder = DriveApp.getFolderById(folderId);
  var existing = findFile_(folderId, fileName);
  var content = JSON.stringify(body.state || {});

  // Invoices are create-only (R4, R9) — never overwritten, never renumbered.
  if (docType === 'invoice') {
    if (existing) {
      return { success: false, error: 'الرقم ' + fileName.replace(/\.json$/, '') + ' مُصدر مسبقاً — الفواتير الصادرة لا تُستبدل' };
    }
    folder.createFile(fileName, content, 'application/json');
    appendAudit_(actor, 'create', fileName, sha256Hex_(content));
    return { success: true, action: 'created' };
  }

  // Quotes & contracts: keep the previous version in _history before overwriting (R9). History is
  // best-effort — a failure there must never turn into a lost save.
  if (existing) {
    try {
      var historyFolder = getOrCreateHistoryFolder_(folder);
      existing.makeCopy(fileName.replace(/\.json$/, '') + '.' + timestamp_() + '.json', historyFolder);
    } catch (err) { /* ignore — see comment above */ }
    existing.setContent(content);
    appendAudit_(actor, 'update', fileName, sha256Hex_(content));
    return { success: true, action: 'updated' };
  }
  folder.createFile(fileName, content, 'application/json');
  appendAudit_(actor, 'create', fileName, sha256Hex_(content));
  return { success: true, action: 'created' };
}

// ── Shared company settings (R8/R10, item 4) ────────────────────────────────────────────────────
// Admin-gated once a settings.json already exists; the very first publish bootstraps it for anyone
// (set ADMIN_USER_IDS/ADMIN_EMAILS in Script Properties right after deploying to close that window).
function handleSaveSettings_(body) {
  var fileName = String(body.fileName || 'settings.json');
  if (fileName !== 'settings.json') return { success: false, error: 'اسم ملف غير صالح لـ saveSettings' };

  var folderId = folderFor_('settings');
  if (!folderId) return { success: false, error: 'مجلد الإعدادات غير مُعد (FOLDER_SETTINGS أو FOLDER_QUOTES)' };

  var actor = resolveActor_(body);
  var folder = DriveApp.getFolderById(folderId);
  var existing = findFile_(folderId, fileName);
  if (existing && !isAdmin_(actor)) {
    return { success: false, error: 'نشر الإعدادات المشتركة للمدراء فقط — أضف رقم المستخدم أو البريد في ADMIN_USER_IDS/ADMIN_EMAILS (خصائص المشروع) أو في settings.json الحالي' };
  }

  var content = JSON.stringify(body.state || {});
  if (existing) {
    try {
      var historyFolder = getOrCreateHistoryFolder_(folder);
      existing.makeCopy('settings.' + timestamp_() + '.json', historyFolder);
    } catch (err) { /* best-effort, see handleSave_() */ }
    existing.setContent(content);
  } else {
    folder.createFile(fileName, content, 'application/json');
  }
  appendAudit_(actor, existing ? 'update-settings' : 'create-settings', fileName, sha256Hex_(content));
  return { success: true, action: existing ? 'updated' : 'created' };
}
