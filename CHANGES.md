# المدى المبارك — Quotation & Contract Platform
Cloned from the MTQ platform. Layout/logic unchanged; only brand, theme, names, and data-source defaults were swapped.

## Theme (emerald primary + gold accent — matches the poster)
- `--primary` #2b2b2b → **#0D4A2E** (emerald): nav, sidebar head, table headers, CTA buttons, print/PDF footer band
- `--orange` #e55a00 → **#C2A04A** (gold): top border, accent bar, focus rings, badges, hairline accents
- `--orng2` #ff7820 → **#D8BD72** (light gold, gradients)
- Added `--gold-dk` #8A6F2C for small gold text on light (product codes, info labels) so it stays legible
- Excel export palette + Node PDF template palette updated to match

## Brand
- Logo (header, contract header, PDF) → your المدى المبارك logo, embedded as base64 (assets/mada_logo.jpg = source, ~35 KB)
- Titles, print footer, Excel watermark/creator → "المدى المبارك للتجارة والحلول الذكية"
- Contract number prefix `MTQCT-` → `MMCT-`
- Old MTQ stamp image in the contract removed (transparent placeholder — drop your own stamp URL in its place)

## Placeholders to edit (you said you'd do the contract text yourself)
In `mada-quotations/index.html`, the **second-party (المورد)** block + signature block now read:
- اسم الممثل: «اسم الممثل»
- العنوان: «العنوان»
- سجل تجاري: «••••••••••»   جوال: «••••••••••»
Search the file for « » to find them fast. Print-footer phone is set to `+966 50 000 0000`.

## Data source (left blank — set in Settings)
Default Google Sheet ID + Drive folder IDs (catalog, images, quotes, contracts) are now empty.
Open the app → ⚙ Settings → paste: API key, Sheet ID, Apps Script URL, and the four folder IDs.
`sheetName` default kept as "المنتجات".

## Files
- `mada-quotations/index.html` — the app (quotation builder + contract generator)
- `mada-quotations/contract.txt` — old MTQ sample contract, kept only as a text reference (not used by the app)
- `quotation-api/` — Node/Express + Puppeteer PDF API (re-themed). Set BASE_URL env on deploy; update server URL in openapi.json.
