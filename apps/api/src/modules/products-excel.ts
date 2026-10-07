import ExcelJS from 'exceljs';
import { eq, product, productCategory, type Tx } from '@mmc/db';
import { normalizeArabic } from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { badRequest } from '../common/errors.js';

/**
 * Products ⇄ Excel. The download is also the template: every product in the app, one row each, with
 * drop-down lists. Users add rows / edit cells and upload it again: rows are matched by code, new
 * codes are created, changed cells are updated, nothing is ever deleted (use the status column).
 * A column that is missing from the uploaded sheet leaves that field unchanged.
 */

type Kind = 'text' | 'money' | 'rate' | 'int' | 'qty' | 'bool' | 'enum';
interface Col { key: string; ar: string; en: string; width: number; kind: Kind; required?: boolean; cost?: boolean; options?: Record<string, string> }

export const PRODUCT_TYPES_AR: Record<string, string> = { stock: 'صنف مخزني', non_stock: 'غير مخزني', service: 'خدمة', labor: 'عمالة', kit: 'باقة' };
const STATUS_AR: Record<string, string> = { active: 'نشط', discontinued: 'متوقف' };
const CURRENCY: Record<string, string> = { USD: 'USD', SAR: 'SAR', CNY: 'CNY' };

export const COLUMNS: Col[] = [
  { key: 'code', ar: 'الكود', en: 'Code', width: 16, kind: 'text', required: true },
  { key: 'nameAr', ar: 'الاسم بالعربية', en: 'Name (Arabic)', width: 34, kind: 'text', required: true },
  { key: 'nameEn', ar: 'الاسم بالإنجليزية', en: 'Name (English)', width: 28, kind: 'text' },
  { key: 'description', ar: 'الوصف (يظهر في العرض)', en: 'Description (shown on quotes)', width: 60, kind: 'text' },
  { key: 'category', ar: 'المجموعة', en: 'Group', width: 22, kind: 'text' },
  { key: 'type', ar: 'النوع', en: 'Type', width: 14, kind: 'enum', options: PRODUCT_TYPES_AR },
  { key: 'uom', ar: 'الوحدة', en: 'Unit', width: 9, kind: 'text' },
  { key: 'listPrice', ar: 'سعر البيع (ر.س)', en: 'Selling price (SAR)', width: 14, kind: 'money', required: true },
  { key: 'installCost', ar: 'تكلفة التركيب (ر.س)', en: 'Installation (SAR)', width: 14, kind: 'money' },
  { key: 'costPrice', ar: 'سعر الشراء', en: 'Purchase price', width: 13, kind: 'money', cost: true },
  { key: 'costCurrency', ar: 'عملة الشراء', en: 'Purchase currency', width: 11, kind: 'enum', cost: true, options: CURRENCY },
  { key: 'costRateToSar', ar: 'سعر التحويل للريال', en: 'Rate to SAR', width: 12, kind: 'rate', cost: true },
  { key: 'warrantyMonths', ar: 'الضمان (شهر)', en: 'Warranty (months)', width: 10, kind: 'int' },
  { key: 'serialTracked', ar: 'يُتتبع بالرقم التسلسلي', en: 'Serial tracked', width: 12, kind: 'bool' },
  { key: 'reorderLevel', ar: 'حد إعادة الطلب', en: 'Reorder level', width: 11, kind: 'qty' },
  { key: 'reorderQty', ar: 'كمية إعادة الطلب', en: 'Reorder qty', width: 11, kind: 'qty' },
  { key: 'status', ar: 'الحالة', en: 'Status', width: 10, kind: 'enum', options: STATUS_AR },
  { key: 'imageUrl', ar: 'رابط الصورة', en: 'Image URL', width: 30, kind: 'text' },
  { key: 'datasheetUrl', ar: 'رابط النشرة الفنية', en: 'Datasheet URL', width: 30, kind: 'text' },
];

const GREEN = 'FF0D4A2E';
const GOLD = 'FFC2A04A';
const num = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));

function columnsFor(actor: RequestActor) {
  return COLUMNS.filter((c) => !c.cost || actor.grants['product.cost.read']);
}

/** Workbook with every product (the template). */
export async function exportProductsXlsx(tx: Tx, actor: RequestActor): Promise<Buffer> {
  const cols = columnsFor(actor);
  const products = await tx.select().from(product).orderBy(product.code);
  const cats = await tx.select().from(productCategory);
  const catName = new Map(cats.map((c) => [c.id, c.nameAr]));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MMC Core';
  const ws = wb.addWorksheet('المنتجات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 2, xSplit: 1 }] });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  const head = ws.getRow(1);
  cols.forEach((c, i) => { head.getCell(i + 1).value = c.required ? `${c.ar} *` : c.ar; });
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 32;
  cols.forEach((c, i) => { head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.cost ? GOLD : GREEN } }; });
  // row 2: the machine keys — the upload reads them (do not edit)
  const keys = ws.getRow(2);
  cols.forEach((c, i) => { keys.getCell(i + 1).value = c.key; });
  keys.font = { italic: true, size: 8, color: { argb: 'FF888888' } };
  keys.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } };

  for (const p of products) {
    const values: Record<string, unknown> = {
      code: p.code, nameAr: p.nameAr, nameEn: p.nameEn ?? '', description: p.description ?? '', category: p.categoryId ? catName.get(p.categoryId) ?? '' : '',
      type: PRODUCT_TYPES_AR[p.type] ?? p.type, uom: p.uom, listPrice: num(p.listPrice), installCost: num(p.installCost),
      costPrice: num(p.costPrice), costCurrency: p.costCurrency, costRateToSar: num(p.costRateToSar), warrantyMonths: p.warrantyMonths ?? null,
      serialTracked: p.serialTracked ? 'نعم' : 'لا', reorderLevel: num(p.reorderLevel), reorderQty: num(p.reorderQty),
      status: p.archivedAt ? 'متوقف' : STATUS_AR[p.status] ?? p.status, imageUrl: p.imageUrl ?? '', datasheetUrl: p.datasheetUrl ?? '',
    };
    const row = ws.addRow(cols.map((c) => values[c.key] ?? null));
    row.alignment = { vertical: 'top', wrapText: false };
    // no selling price yet → highlight so it gets filled in
    if (!(Number(p.listPrice) > 0) && !['service', 'labor'].includes(p.type)) {
      row.getCell(cols.findIndex((c) => c.key === 'listPrice') + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    }
  }
  // drop-down lists on 2,000 rows below the header
  const last = Math.max(products.length + 2, 2000);
  cols.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    const list = c.kind === 'bool' ? ['نعم', 'لا'] : c.options ? Object.values(c.options) : null;
    for (let r = 3; r <= last; r++) {
      const cell = ws.getCell(`${letter}${r}`);
      if (list) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${list.join(',')}"`] };
      if (c.kind === 'money' || c.kind === 'rate' || c.kind === 'qty') cell.numFmt = c.kind === 'rate' ? '0.0000' : '#,##0.00';
    }
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.columns = [{ width: 110 }];
  const lines = [
    'طريقة الاستخدام',
    '1) هذا الملف يحتوي على كل المنتجات الموجودة في النظام الآن — صف لكل منتج.',
    '2) لإضافة منتج: أضف صفًا جديدًا في آخر الجدول بكود جديد. لتعديل منتج: عدّل خلاياه واترك الكود كما هو.',
    '3) لا تحذف الصفين الأول والثاني (العناوين والمفاتيح). يُطابَق كل صف مع النظام بالكود.',
    '4) حذف صف من الملف لا يحذف المنتج من النظام — لإيقاف منتج اختر «متوقف» في عمود الحالة.',
    '5) الأعمدة المطلوبة عليها *: الكود، الاسم بالعربية، سعر البيع. الأسعار بالريال بدون ضريبة.',
    '6) الخلايا الحمراء في سعر البيع = منتجات بدون سعر بيع بعد.',
    '7) الأعمدة الذهبية (سعر الشراء والعملة وسعر التحويل) تظهر فقط لمن لديه صلاحية رؤية التكلفة.',
    '8) بعد التعديل: المنتجات ← «رفع ملف Excel» ← تظهر معاينة بالإضافات والتعديلات والأخطاء ← «تطبيق».',
    '9) المجموعة: اكتب اسم المجموعة (مثل «إنتركوم» أو «كاميرات»)؛ تُنشأ تلقائيًا إن لم تكن موجودة.',
    '10) صورة المنتج: يمكن رفعها من صفحة المنتج في النظام، أو وضع رابط صورة عام في عمود «رابط الصورة».',
  ];
  lines.forEach((l, i) => { const r = help.addRow([l]); if (i === 0) r.font = { bold: true, size: 14, color: { argb: GREEN } }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ───────────────────────── upload ─────────────────────────

export interface ImportIssue { row: number; code?: string; ar: string; en: string }
interface Parsed { row: number; values: Record<string, unknown> }

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text; // hyperlink
    if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result); // formula
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

/** Read the sheet: header by key row (row 2) or by the Arabic / English labels. */
async function parseWorkbook(data: Buffer, cols: Col[]) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(data as unknown as ArrayBuffer); } catch { throw badRequest('the file is not a valid Excel (.xlsx) workbook'); }
  const ws = wb.worksheets.find((w) => w.name === 'المنتجات') ?? wb.worksheets[0];
  if (!ws) throw badRequest('the workbook has no sheet');
  const byLabel = new Map<string, Col>();
  for (const c of COLUMNS) for (const l of [c.key, c.ar, `${c.ar} *`, c.en]) byLabel.set(l.trim().toLowerCase(), c);
  let headerRow = 0;
  let map = new Map<number, Col>();
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const m = new Map<number, Col>();
    ws.getRow(r).eachCell((cell, col) => { const c = byLabel.get(cellText(cell.value).toLowerCase()); if (c) m.set(col, c); });
    if ([...m.values()].some((c) => c.key === 'code') && m.size >= map.size) { map = m; headerRow = r; }
  }
  if (!headerRow) throw badRequest('could not find the header row — use the template downloaded from the app');
  // a key row right below the labels is skipped
  let first = headerRow + 1;
  const next = ws.getRow(first);
  if (cellText(next.getCell([...map.entries()].find(([, c]) => c.key === 'code')![0]).value) === 'code') first++;
  const allowed = new Set(cols.map((c) => c.key));
  const present = [...map.values()].filter((c) => allowed.has(c.key)).map((c) => c.key);
  const rows: Parsed[] = [];
  for (let r = first; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values: Record<string, unknown> = {};
    let any = false;
    for (const [col, c] of map) {
      if (!allowed.has(c.key)) continue;
      const v = row.getCell(col).value;
      const t = typeof v === 'number' ? v : cellText(v);
      if (t !== '') any = true;
      values[c.key] = t;
    }
    if (any) rows.push({ row: r, values });
  }
  return { rows, present };
}

const FIELD_AR: Record<string, string> = Object.fromEntries(COLUMNS.map((c) => [c.key, c.ar]));
type Values = Partial<Record<string, string | number | boolean | null>>;

function toNumber(v: unknown, kind: Kind): number | null | 'bad' {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s٬]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  if (!Number.isFinite(n) || n < 0) return 'bad';
  if (kind === 'int' && !Number.isInteger(n)) return 'bad';
  // the database keeps 4 decimals for prices and quantities, 6 for exchange rates
  const dp = kind === 'rate' ? 6 : kind === 'int' ? 0 : kind === 'qty' ? 3 : 4;
  return Math.round(n * 10 ** dp) / 10 ** dp;
}

function fromLabel(v: unknown, options: Record<string, string>): string | null | 'bad' {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (options[s]) return s;
  const hit = Object.entries(options).find(([, ar]) => ar === s);
  return hit ? hit[0] : 'bad';
}

/**
 * Validate the upload and compare with the database. `apply` writes it (all or nothing — refused
 * while any row has an error).
 */
export async function importProductsXlsx(tx: Tx, actor: RequestActor, data: Buffer, apply: boolean) {
  const cols = columnsFor(actor);
  const { rows, present } = await parseWorkbook(data, cols);
  if (!present.includes('code')) throw badRequest('the sheet has no code column');
  if (rows.length > 5000) throw badRequest('at most 5,000 rows per upload');
  const existing = await tx.select().from(product);
  const byCode = new Map(existing.map((p) => [p.code.trim().toUpperCase(), p]));
  const cats = await tx.select().from(productCategory);
  const catByName = new Map(cats.map((c) => [normalizeArabic(c.nameAr), c]));

  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const creates: { row: number; code: string; values: Values }[] = [];
  const updates: { row: number; code: string; id: string; changes: { field: string; label: string; from: unknown; to: unknown }[]; values: Values }[] = [];
  let unchanged = 0;
  const seen = new Set<string>();
  const newCats = new Set<string>();

  for (const r of rows) {
    const code = String(r.values.code ?? '').trim();
    const issue = (ar: string, en: string, list = errors) => list.push({ row: r.row, code: code || undefined, ar, en });
    if (!code) { issue('الكود فارغ', 'Empty code'); continue; }
    if (code.toUpperCase() === 'INS') { issue('صف التركيب INS يُحسب تلقائيًا — تم تجاهله', 'The INS row is computed — skipped', warnings); continue; }
    if (code.length > 64) { issue('الكود أطول من 64 حرفًا', 'Code longer than 64 characters'); continue; }
    const key = code.toUpperCase();
    if (seen.has(key)) { issue('الكود مكرر في الملف', 'Code appears twice in the file'); continue; }
    seen.add(key);
    const current = byCode.get(key);
    const v: Values = {};
    let bad = false;
    for (const c of cols) {
      if (c.key === 'code' || !present.includes(c.key)) continue;
      const raw = r.values[c.key];
      if (c.kind === 'money' || c.kind === 'rate' || c.kind === 'int' || c.kind === 'qty') {
        const n = toNumber(raw, c.kind);
        if (n === 'bad') { issue(`${c.ar}: قيمة غير صحيحة «${String(raw)}»`, `${c.en}: invalid value "${String(raw)}"`); bad = true; continue; }
        v[c.key] = n;
      } else if (c.kind === 'bool') {
        const s = String(raw ?? '').trim().toLowerCase();
        v[c.key] = ['نعم', 'yes', 'true', '1', 'y'].includes(s) ? true : ['لا', 'no', 'false', '0', 'n', ''].includes(s) ? false : null;
        if (v[c.key] === null) { issue(`${c.ar}: اكتب نعم أو لا`, `${c.en}: write yes or no`); bad = true; }
      } else if (c.kind === 'enum') {
        const e = fromLabel(raw, c.options!);
        if (e === 'bad') { issue(`${c.ar}: «${String(raw)}» ليست من القائمة`, `${c.en}: "${String(raw)}" is not in the list`); bad = true; continue; }
        v[c.key] = e;
      } else {
        v[c.key] = String(raw ?? '').trim() || null;
      }
    }
    if (bad) continue;
    if (present.includes('nameAr') && !v.nameAr) { issue('الاسم بالعربية مطلوب', 'Arabic name is required'); continue; }
    if (!current && !present.includes('nameAr')) { issue('منتج جديد بدون اسم', 'New product without a name'); continue; }
    if (present.includes('listPrice') && v.listPrice === null) v.listPrice = 0;
    // empty cells mean the defaults the database stores
    if ('installCost' in v && v.installCost === null) v.installCost = 0;
    if ('costRateToSar' in v && v.costRateToSar === null) v.costRateToSar = (v.costCurrency ?? current?.costCurrency) === 'SAR' ? 1 : 3.75;
    if (present.includes('listPrice') && v.listPrice === 0 && !['service', 'labor'].includes(String(v.type ?? current?.type ?? 'stock'))) issue('بدون سعر بيع', 'No selling price', warnings);
    if (v.category) {
      const k = normalizeArabic(String(v.category));
      if (!catByName.has(k) && !newCats.has(k)) { newCats.add(k); warnings.push({ row: r.row, code, ar: `مجموعة جديدة ستُنشأ: ${String(v.category)}`, en: `New group will be created: ${String(v.category)}` }); }
    }
    if (current) {
      if (v.serialTracked !== undefined && v.serialTracked !== current.serialTracked) issue('تغيير تتبع الرقم التسلسلي يتم من صفحة المنتج (بشرط ألا يكون في المخزون)', 'Change serial tracking on the product page (only when not in stock)', warnings), delete v.serialTracked;
      const changes: { field: string; label: string; from: unknown; to: unknown }[] = [];
      const cmp = (field: string, from: unknown, to: unknown) => {
        const f = from === null || from === undefined || from === '' ? null : from;
        const t = to === null || to === undefined || to === '' ? null : to;
        const same = typeof t === 'number' || typeof f === 'number' ? (f === null && t === null) || (f !== null && t !== null && Number(f) === Number(t)) : f === t;
        if (!same) changes.push({ field, label: FIELD_AR[field] ?? field, from: f, to: t });
      };
      for (const [field, to] of Object.entries(v)) {
        if (field === 'category') cmp('category', current.categoryId ? cats.find((c) => c.id === current.categoryId)?.nameAr ?? null : null, to);
        else if (field === 'status') cmp('status', current.archivedAt ? 'discontinued' : current.status, to ?? 'active');
        else if (field === 'type') cmp('type', current.type, to ?? 'stock');
        else if (field === 'uom') cmp('uom', current.uom, to ?? 'Nos');
        else if (field === 'costCurrency') cmp('costCurrency', current.costCurrency, to ?? 'USD');
        else cmp(field, (current as Record<string, unknown>)[field], to);
      }
      if (changes.length) updates.push({ row: r.row, code: current.code, id: current.id, changes, values: v });
      else unchanged++;
    } else {
      creates.push({ row: r.row, code, values: v });
    }
  }

  const summary = {
    rows: rows.length, created: creates.length, updated: updates.length, unchanged, newGroups: [...newCats].length,
    errors, warnings,
    creates: creates.slice(0, 300).map((c) => ({ row: c.row, code: c.code, nameAr: c.values.nameAr ?? null, listPrice: c.values.listPrice ?? null })),
    updates: updates.slice(0, 300).map((u) => ({ row: u.row, code: u.code, changes: u.changes.map((c) => ({ ...c, from: c.field === 'costPrice' && !actor.grants['product.cost.read'] ? null : c.from })) })),
    applied: false,
  };
  if (!apply) return summary;
  if (errors.length) throw badRequest('the file has errors — fix them and upload again', { errors });

  // groups first
  const catId = new Map(cats.map((c) => [normalizeArabic(c.nameAr), c.id]));
  const ensureCat = async (name: unknown) => {
    if (!name) return null;
    const k = normalizeArabic(String(name));
    if (!catId.has(k)) {
      const [c] = await tx.insert(productCategory).values({ nameAr: String(name).trim(), createdBy: actor.userId }).returning();
      catId.set(k, c!.id);
    }
    return catId.get(k)!;
  };
  const toRow = async (v: Values, base?: typeof product.$inferSelect) => {
    const out: Record<string, unknown> = {};
    for (const [field, val] of Object.entries(v)) {
      if (field === 'category') out.categoryId = await ensureCat(val);
      else if (field === 'status') { out.status = val ?? 'active'; out.archivedAt = val === 'discontinued' ? base?.archivedAt ?? null : null; }
      else if (field === 'type') out.type = val ?? 'stock';
      else if (field === 'uom') out.uom = val ?? 'Nos';
      else if (field === 'costCurrency') out.costCurrency = val ?? 'USD';
      else if (field === 'costRateToSar') out.costRateToSar = val === null ? (v.costCurrency === 'SAR' ? '1' : '3.75') : String(val);
      else if (['listPrice', 'installCost', 'costPrice', 'reorderLevel', 'reorderQty'].includes(field)) out[field] = val === null ? (field === 'listPrice' || field === 'installCost' ? '0' : null) : String(val);
      else if (field === 'description') out.description = val ?? '';
      else out[field] = val;
    }
    const merged = { ...base, ...out } as Record<string, unknown>;
    out.searchText = normalizeArabic(`${merged.code ?? ''} ${merged.nameAr ?? ''} ${merged.nameEn ?? ''} ${merged.description ?? ''}`);
    return out;
  };
  for (const c of creates) {
    const values = await toRow(c.values);
    await tx.insert(product).values({ ...(values as object), code: c.code, nameAr: String(c.values.nameAr), createdBy: actor.userId, updatedBy: actor.userId } as typeof product.$inferInsert);
  }
  for (const u of updates) {
    const base = existing.find((p) => p.id === u.id)!;
    const values = await toRow(Object.fromEntries(u.changes.map((c) => [c.field, u.values[c.field] ?? null])), base);
    await tx.update(product).set({ ...(values as object), updatedAt: new Date(), updatedBy: actor.userId, version: base.version + 1 }).where(eq(product.id, u.id));
  }
  await audit(tx, actor, 'import_excel', 'product', null, null, { rows: rows.length, created: creates.length, updated: updates.length, unchanged, codesCreated: creates.map((c) => c.code).slice(0, 500), codesUpdated: updates.map((u) => u.code).slice(0, 500) });
  return { ...summary, applied: true };
}
