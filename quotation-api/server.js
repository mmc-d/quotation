const express  = require('express');
const cors     = require('cors');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const fs       = require('fs');
const { buildQuotationHTML } = require('./template');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const quoteStoreDir = path.join(__dirname, 'store', 'quotes');
const contractStoreDir = path.join(__dirname, 'store', 'contracts');
fs.mkdirSync(quoteStoreDir, { recursive: true });
fs.mkdirSync(contractStoreDir, { recursive: true });

const pdfStore = new Map(); // id → { filePath, createdAt }

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') return '';
  const base = path.basename(name.trim());
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getStoreFile(storeDir, fileName) {
  const safeName = sanitizeFileName(fileName);
  return path.join(storeDir, safeName.endsWith('.json') ? safeName : safeName + '.json');
}

function listStoreFiles(storeDir, search = '') {
  const allFiles = fs.readdirSync(storeDir).filter(f => f.endsWith('.json'));
  const normalized = search.trim().toLowerCase();
  const matched = normalized
    ? allFiles.filter(f => f.toLowerCase().includes(normalized))
    : allFiles;
  return matched.map(name => {
    const filePath = path.join(storeDir, name);
    const stats = fs.statSync(filePath);
    return {
      name,
      modifiedTime: stats.mtime.toISOString()
    };
  }).sort((a,b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
}

// ── Cleanup old PDFs (> 1 hour) ───────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pdfStore.entries()) {
    if (now - entry.createdAt > 60 * 60 * 1000) {
      try { fs.unlinkSync(entry.filePath); } catch {}
      pdfStore.delete(id);
    }
  }
}, 10 * 60 * 1000); // run every 10 min

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Al-Mada Al-Mubarak Quotation API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// OpenAPI spec (served as JSON for AI tool discovery)
app.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'openapi.json'));
});

// ── POST /generate ─────────────────────────────────────────────────────────
// Accepts quotation JSON, returns { success, downloadUrl, quoteNo, expiresIn }
app.post('/generate', async (req, res) => {
  try {
    const data = req.body;

    // Validate required fields
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'items array is required and must not be empty'
      });
    }

    // Validate each item
    for (const [i, item] of data.items.entries()) {
      if (!item.code)       return res.status(400).json({ success: false, error: `items[${i}].code is required` });
      if (!item.desc)       return res.status(400).json({ success: false, error: `items[${i}].desc is required` });
      if (item.unitPrice === undefined) return res.status(400).json({ success: false, error: `items[${i}].unitPrice is required` });
      if (!item.qty)        item.qty = 1;
    }

    // Auto-generate quote number if not provided
    if (!data.quoteNo) {
      const year = new Date().getFullYear();
      data.quoteNo = `Q-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    // Build HTML
    const html = buildQuotationHTML(data);

    // Launch Puppeteer and generate PDF
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    });

    const page = await browser.newPage();

    // Set content and wait for fonts/images to load
    await page.setContent(html, { waitUntil: ['networkidle0', 'domcontentloaded'] });

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1cm', right: '1cm', bottom: '1.7cm', left: '1cm' }
    });

    await browser.close();

    // Save PDF to /tmp with UUID filename
    const id = uuidv4();
    const fileName = `quotation-${data.quoteNo}-${id}.pdf`;
    const filePath = path.join('/tmp', fileName);
    fs.writeFileSync(filePath, pdfBuffer);

    pdfStore.set(id, { filePath, createdAt: Date.now(), quoteNo: data.quoteNo });

    const downloadUrl = `${BASE_URL}/download/${id}`;

    res.json({
      success: true,
      quoteNo: data.quoteNo,
      downloadUrl,
      expiresIn: '1 hour',
      message: `Quotation ${data.quoteNo} generated successfully. Download at: ${downloadUrl}`
    });

  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to generate PDF'
    });
  }
});

// ── GET /download/:id ─────────────────────────────────────────────────────────
// Download the generated PDF by ID
app.get('/download/:id', (req, res) => {
  const entry = pdfStore.get(req.params.id);

  if (!entry) {
    return res.status(404).json({ success: false, error: 'PDF not found or expired' });
  }

  if (!fs.existsSync(entry.filePath)) {
    pdfStore.delete(req.params.id);
    return res.status(404).json({ success: false, error: 'PDF file not found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="quotation-${entry.quoteNo}.pdf"`);
  res.sendFile(entry.filePath);
});

// ── GET /list ─────────────────────────────────────────────────────────────────
// List recent PDFs (useful for testing)
app.get('/list', (req, res) => {
  const list = [];
  for (const [id, entry] of pdfStore.entries()) {
    list.push({
      id,
      quoteNo: entry.quoteNo,
      createdAt: new Date(entry.createdAt).toISOString(),
      downloadUrl: `${BASE_URL}/download/${id}`
    });
  }
  res.json({ count: list.length, items: list });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Al-Mada Al-Mubarak Quotation API running on port ${PORT}`);
  console.log(`   Health: ${BASE_URL}/health`);
  console.log(`   Generate: POST ${BASE_URL}/generate`);
});
