/**
 * AI-01 BOQ → draft quote: input parsing (XLSX / CSV / pasted text), the frozen catalog context,
 * the deterministic sandbox matcher and the post-model validation (unknown codes are dropped).
 */
import ExcelJS from 'exceljs';
import { and, asc, eq, isNull, ne, product, productCategory, type Tx } from '@mmc/db';
import { INS_CODE, normalizeArabic } from '@mmc/domain';
import { parseCsv } from '../modules/parties.controller.js';

export const BOQ_MAX_ROWS = 300;
export const CATALOG_MAX = 3000;

export interface BoqRow { ref: string; description: string; qty: number; unit: string; code: string }
export interface BoqMatch { productCode: string; confidence: number; reason: string }
export interface BoqResultRow { ref: string; description: string; qty: number; unit?: string; matches: BoqMatch[]; suggestedLabour?: boolean; notes: string }
export interface CatalogItem { id: string; code: string; nameAr: string; nameEn: string | null; description: string; category: string | null; listPrice: string; uom: string }

// ───────────────────────────── parsing ─────────────────────────────

const HEAD = {
  ref: /^(ref|item|no\.?|#|s\.?n\.?|sr\.?|serial|بند|البند|رقم البند|م|الرقم|ر\.?م)$/i,
  code: /(code|model|part|sku|p\/?n|الموديل|الكود|رمز|رقم القطعة)/i,
  description: /(desc|description|item description|specification|الوصف|البيان|وصف|المواصفات|الصنف)/i,
  qty: /^(qty|quantity|qnty|q'ty|الكمية|العدد|كمية)$/i,
  unit: /^(unit|uom|u\/m|الوحدة|وحدة)$/i,
};

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/,/g, '').trim();
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String((v as { text: unknown }).text ?? '');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

/** Rows (array of cells) → BOQ rows, using a header row when there is one, else column heuristics. */
export function rowsFromTable(table: string[][]): BoqRow[] {
  const cleaned = table.map((r) => r.map((c) => (c ?? '').toString().replace(/\s+/g, ' ').trim())).filter((r) => r.some(Boolean));
  if (!cleaned.length) return [];
  // header: the first row (within the first 15) with a description-like and a qty-like cell
  let headerIdx = -1;
  let cols = { ref: -1, code: -1, description: -1, qty: -1, unit: -1 };
  for (let i = 0; i < Math.min(15, cleaned.length); i++) {
    const r = cleaned[i]!;
    const find = (re: RegExp) => r.findIndex((c) => re.test(c));
    const d = find(HEAD.description);
    const q = find(HEAD.qty);
    if (d >= 0 && q >= 0) { headerIdx = i; cols = { ref: find(HEAD.ref), code: find(HEAD.code), description: d, qty: q, unit: find(HEAD.unit) }; break; }
  }
  const body = headerIdx >= 0 ? cleaned.slice(headerIdx + 1) : cleaned;
  if (headerIdx < 0) {
    // no header: description = the column with the longest average text, qty = the first mostly-numeric column after it
    const width = Math.max(...body.map((r) => r.length));
    const avg = (j: number) => body.reduce((s, r) => s + (toNumber(r[j]) === null ? (r[j]?.length ?? 0) : 0), 0) / body.length;
    let d = 0;
    for (let j = 1; j < width; j++) if (avg(j) > avg(d)) d = j;
    const numeric = (j: number) => body.filter((r) => toNumber(r[j]) !== null).length >= body.length / 2;
    let q = -1;
    for (let j = d + 1; j < width && q < 0; j++) if (numeric(j)) q = j;
    if (q < 0) for (let j = 0; j < d && q < 0; j++) if (numeric(j) && j !== 0) q = j;
    cols = { ref: d > 0 ? 0 : -1, code: -1, description: d, qty: q, unit: q >= 0 && q + 1 < width && toNumber(body[0]?.[q + 1]) === null && (body[0]?.[q + 1]?.length ?? 99) <= 8 ? q + 1 : -1 };
  }
  const out: BoqRow[] = [];
  for (const r of body) {
    const description = r[cols.description] ?? '';
    const code = cols.code >= 0 ? r[cols.code] ?? '' : '';
    if (!description && !code) continue;
    const qty = cols.qty >= 0 ? toNumber(r[cols.qty]) : null;
    // section titles / subtotals have no quantity — skip them
    if (qty === null || qty <= 0) continue;
    out.push({ ref: cols.ref >= 0 ? r[cols.ref] ?? '' : '', code, description: description || code, qty, unit: cols.unit >= 0 ? r[cols.unit] ?? '' : '' });
    if (out.length >= BOQ_MAX_ROWS) break;
  }
  return out;
}

/** Pasted text: tab/CSV tables go through the table parser; free lines get "qty" pulled from the text. */
export function rowsFromText(text: string): BoqRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const tabbed = lines.filter((l) => l.includes('\t')).length >= lines.length / 2;
  const csv = !tabbed && lines.filter((l) => l.includes(',')).length >= lines.length / 2;
  if (tabbed) { const t = rowsFromTable(lines.map((l) => l.split('\t'))); if (t.length) return t; }
  if (csv) { const t = rowsFromTable(parseCsv(lines.join('\n'))); if (t.length) return t; }
  const out: BoqRow[] = [];
  for (const [i, l] of lines.entries()) {
    // "3 x Camera …", "Camera … x 3", "Camera … - 3 pcs", "كاميرا … العدد 3"
    let m = /^(\d+(?:\.\d+)?)\s*(?:x|×|pcs|nos|عدد)?\s+(.+)$/i.exec(l);
    let qty: number | null = null;
    let description = l;
    let unit = '';
    if (m) { qty = Number(m[1]); description = m[2]!; } else if ((m = /^(.+?)[\s\-–:|]+(?:x|×|qty|العدد|الكمية)?\s*(\d+(?:\.\d+)?)\s*(pcs|nos|no|set|sets|lot|m|عدد|قطعة|حبة|م)?\.?$/i.exec(l))) {
      description = m[1]!; qty = Number(m[2]); unit = m[3] ?? '';
    }
    if (!qty || qty <= 0) qty = 1;
    const refM = /^([A-Z]?\d+(?:\.\d+)*)[).\-]\s+(.+)$/i.exec(description);
    out.push({ ref: refM ? refM[1]! : String(i + 1), code: '', description: (refM ? refM[2]! : description).trim(), qty, unit });
    if (out.length >= BOQ_MAX_ROWS) break;
  }
  return out;
}

export async function rowsFromXlsx(data: Buffer): Promise<BoqRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  let best: BoqRow[] = [];
  wb.eachSheet((ws) => {
    const table: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellText(cell.value); });
      table.push(Array.from(cells, (c) => c ?? ''));
    });
    const rows = rowsFromTable(table);
    if (rows.length > best.length) best = rows;
  });
  return best;
}

// ───────────────────────────── catalog ─────────────────────────────

/** Active catalog, sorted by code — deterministic so the cached prompt prefix stays identical. No costs. */
export async function loadCatalog(tx: Tx): Promise<CatalogItem[]> {
  const rows = await tx.select({
    id: product.id, code: product.code, nameAr: product.nameAr, nameEn: product.nameEn, description: product.description, category: productCategory.nameAr, listPrice: product.listPrice, uom: product.uom,
  }).from(product).leftJoin(productCategory, eq(productCategory.id, product.categoryId))
    .where(and(isNull(product.archivedAt), eq(product.status, 'active'), ne(product.code, INS_CODE))).orderBy(asc(product.code)).limit(CATALOG_MAX);
  return rows;
}

const clean = (s: string | null | undefined, n: number) => (s ?? '').replace(/[\t\r\n]+/g, ' ').trim().slice(0, n);

export function catalogText(items: CatalogItem[]): string {
  const lines = items.map((p) => [p.code, clean(p.nameAr, 120), clean(p.nameEn, 120), clean(p.category, 60), p.listPrice, p.uom, clean(p.description, 300)].join('\t'));
  return `CATALOG (${items.length} active products; tab-separated: code, name_ar, name_en, category, list_price_sar, uom, description)\n${lines.join('\n')}`;
}

// ───────────────────────────── matching ─────────────────────────────

const LABOUR_RE = /(install|installation|labou?r|commission|programm|config|testing|تركيب|تمديد|برمجة|تشغيل|اختبار|أعمال)/i;
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const tokens = (s: string) => new Set(normalizeArabic(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2));

/** Deterministic sandbox matcher: exact/fuzzy code, then normalized Arabic/English name overlap. */
export function sandboxMatch(rows: BoqRow[], catalog: CatalogItem[]): BoqResultRow[] {
  const prepared = catalog.map((p) => ({ p, code: normCode(p.code), words: tokens(`${p.nameAr} ${p.nameEn ?? ''} ${p.description}`) }));
  return rows.map((r) => {
    const text = `${r.code} ${r.description}`;
    const rowCodes = text.split(/\s+/).map(normCode).filter((c) => c.length >= 3);
    const rowWords = tokens(r.description);
    const scored: BoqMatch[] = [];
    for (const { p, code, words } of prepared) {
      let score = 0;
      let reason = '';
      if (code && rowCodes.includes(code)) { score = 0.97; reason = `exact code ${p.code}`; }
      else if (code.length >= 4 && normCode(text).includes(code)) { score = 0.9; reason = `code ${p.code} in the row text`; }
      else if (rowWords.size && words.size) {
        let common = 0;
        for (const w of rowWords) if (words.has(w)) common++;
        const s = common / Math.max(rowWords.size, 1);
        if (common >= 1 && s >= 0.3) { score = Math.round(Math.min(0.85, s * 0.85) * 100) / 100; reason = `${common} matching word(s) in the name`; }
      }
      if (score > 0) scored.push({ productCode: p.code, confidence: score, reason });
    }
    scored.sort((a, b) => b.confidence - a.confidence || a.productCode.localeCompare(b.productCode));
    const matches = scored.slice(0, 3);
    return { ref: r.ref, description: r.description, qty: r.qty, unit: r.unit || undefined, matches, suggestedLabour: LABOUR_RE.test(r.description), notes: matches.length ? '' : 'no catalog match' };
  });
}

/** After the model: keep only codes that exist in the active catalog, clamp confidence, ≤ 3 per row. */
export function validateMatches(rows: BoqResultRow[], catalog: Pick<CatalogItem, 'code'>[]): { rows: BoqResultRow[]; dropped: string[] } {
  const known = new Map(catalog.map((p) => [p.code.toUpperCase(), p.code]));
  const dropped: string[] = [];
  const out = rows.map((r) => {
    const seen = new Set<string>();
    const matches: BoqMatch[] = [];
    for (const m of r.matches ?? []) {
      const code = known.get(String(m.productCode ?? '').trim().toUpperCase());
      if (!code) { dropped.push(String(m.productCode)); continue; }
      if (seen.has(code)) continue;
      seen.add(code);
      matches.push({ productCode: code, confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)), reason: String(m.reason ?? '').slice(0, 300) });
    }
    matches.sort((a, b) => b.confidence - a.confidence);
    return { ...r, qty: Number(r.qty) > 0 ? Number(r.qty) : 1, matches: matches.slice(0, 3), notes: String(r.notes ?? '').slice(0, 500) };
  });
  return { rows: out, dropped };
}
