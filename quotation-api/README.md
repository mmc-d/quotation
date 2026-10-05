# Al-Mada Al-Mubarak — Quotation API

Generate professional Arabic PDF quotations via API. Designed to be used as an AI tool by Claude, ChatGPT, or any assistant that supports OpenAPI-compatible tools.

---

## How it works

1. You describe a quotation in natural language to your AI tool
2. The AI extracts structured data and calls `POST /generate`
3. The API renders the quotation as HTML, exports it to PDF via Puppeteer
4. Returns a download URL valid for 1 hour

---

## Deploy to Railway (free)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create mada-quotation-api --public --push
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select `mada-quotation-api`
3. Railway auto-detects the Dockerfile and deploys
4. Go to **Settings → Networking → Generate Domain**
5. Copy your domain, e.g. `https://mada-quotation-api.up.railway.app`

### 3. Set environment variable

In Railway project settings → **Variables**:
```
BASE_URL = https://mada-quotation-api.up.railway.app
```

---

## API Reference

### `POST /generate`

Generate a PDF quotation.

**Request body:**
```json
{
  "client":    "أحمد الغامدي",
  "company":   "شركة الأفق",
  "project":   "فندق الرياض",
  "salesRep":  "محمد علي",
  "quoteNo":   "Q-2026-042",
  "date":      "2026-03-13",
  "items": [
    {
      "code":      "DL-701",
      "desc":      "قفل فندقي إلكتروني يدعم بطاقات M1",
      "unitPrice": 450,
      "qty":       10,
      "imageUrl":  ""
    }
  ],
  "discount":  10,
  "vat":       true,
  "techNotes": "يتطلب توصيل كهربائي 220V",
  "terms":     "50% مقدمة، 50% عند التسليم",
  "validity":  "هذا العرض صالح لمدة 30 يوماً"
}
```

**Response:**
```json
{
  "success":     true,
  "quoteNo":     "Q-2026-042",
  "downloadUrl": "https://mada-quotation-api.up.railway.app/download/abc-123",
  "expiresIn":   "1 hour",
  "message":     "Quotation Q-2026-042 generated successfully."
}
```

### `GET /download/:id`

Download the generated PDF. Link is valid for 1 hour.

### `GET /health`

Health check endpoint.

### `GET /openapi.json`

Full OpenAPI spec (for AI tool registration).

---

## Connect to Claude as a Tool

1. Deploy the API and get your Railway URL
2. In Claude.ai → **Settings → Integrations** (or wherever tool configuration is)
3. Add a custom tool pointing to `https://your-api.railway.app/openapi.json`

**Or use this system prompt** to make any Claude conversation use the API:

```
You have access to the Al-Mada Al-Mubarak Quotation API at https://your-api.railway.app

When the user asks you to create a quotation or price offer:
1. Extract all information from their message: client name, company, project, 
   sales rep, items (with codes, descriptions, prices, quantities), 
   discount %, VAT preference, notes, terms, validity
2. Call POST /generate with the structured JSON
3. Return the downloadUrl to the user so they can download the PDF

If information is missing (like item codes or prices), ask the user before calling the API.
Always confirm: "تم إنشاء عرض السعر! يمكنك تحميله من: [URL]"
```

## Connect to ChatGPT as a Custom GPT

1. Go to [chat.openai.com](https://chat.openai.com) → **Explore GPTs** → **Create**
2. In the **Configure** tab → **Actions** → **Add action**
3. Import from URL: `https://your-api.railway.app/openapi.json`
4. Set the GPT instructions:

```
You are a sales assistant for Al-Mada Al-Mubarak. When users describe a quotation,
extract the data and call the generateQuotation action. Return the download URL.
Always respond in Arabic. Ask for missing information before generating.
```

---

## Local development

```bash
npm install
BASE_URL=http://localhost:3000 node server.js
```

Test with curl:
```bash
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "client": "Test Client",
    "items": [
      {"code": "DL-701", "desc": "Electronic Lock", "unitPrice": 450, "qty": 2}
    ],
    "vat": true
  }'
```

---

## Files

| File | Description |
|------|-------------|
| `server.js` | Express API server |
| `template.js` | HTML quotation template with embedded logo |
| `openapi.json` | OpenAPI 3.1 spec for AI tool discovery |
| `Dockerfile` | Container config (Chromium + Node.js) |
| `railway.toml` | Railway deployment config |

---

## Notes

- PDFs are stored in `/tmp` and auto-deleted after 1 hour
- Railway free tier sleeps after inactivity — first request may take ~5s to wake up
- Puppeteer uses system Chromium (installed in Docker) for Arabic font rendering
