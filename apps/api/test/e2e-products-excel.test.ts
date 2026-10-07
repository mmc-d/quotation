import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/** Products ⇄ Excel: the download is the template; the upload previews, then creates / updates by code. */
let base = '';
let owner: Client;
let sales: Client;
const codes = ['XL-A1', 'XL-B2', 'XL-C3'];

async function workbookFrom(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}
const b64 = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const users = await owner.get('/api/users');
  if (!users.some((u: any) => u.email === 'xl-sales@e2e.test')) await owner.post('/api/users/invite', { email: 'xl-sales@e2e.test', nameAr: 'مندوب', roleKeys: ['sales_rep'] });
  sales = await signInOrUp(base, 'xl-sales@e2e.test');
  await owner.put('/api/products/new', { code: 'XL-A1', nameAr: 'منتج إكسل أ', listPrice: '100', costPrice: '20', costCurrency: 'USD' });
});

afterAll(async () => {
  try {
    const sql = ADMIN_SQL();
    await sql`update product set archived_at = now() where code in ${sql(codes)}`;
    await sql.end();
  } finally { await stopServer(); }
});

describe('products Excel', () => {
  it('downloads every product with labels, keys and drop-downs; hides cost columns without the cost permission', async () => {
    const buf = await owner.get<Buffer>('/api/products/excel/export', { raw: true });
    const wb = await workbookFrom(buf);
    const ws = wb.getWorksheet('المنتجات')!;
    expect(ws.getRow(1).getCell(1).value).toBe('الكود *');
    expect(ws.getRow(2).getCell(1).value).toBe('code');
    const keys = (ws.getRow(2).values as unknown[]).filter(Boolean);
    expect(keys).toContain('costPrice');
    let found = false;
    ws.eachRow((r, i) => { if (i > 2 && r.getCell(1).value === 'XL-A1') found = true; });
    expect(found).toBe(true);
    expect(wb.getWorksheet('تعليمات')).toBeTruthy();
    const ws2 = (await workbookFrom(await sales.get<Buffer>('/api/products/excel/export', { raw: true }))).getWorksheet('المنتجات')!;
    expect((ws2.getRow(2).values as unknown[]).filter(Boolean)).not.toContain('costPrice');
  });

  it('previews, refuses errors, then creates and updates by code', async () => {
    const wb = await workbookFrom(await owner.get<Buffer>('/api/products/excel/export', { raw: true }));
    const ws = wb.getWorksheet('المنتجات')!;
    const keys = (ws.getRow(2).values as unknown[]);
    const col = (k: string) => keys.indexOf(k);
    ws.eachRow((r, i) => { if (i > 2 && r.getCell(1).value === 'XL-A1') { r.getCell(col('listPrice')).value = 150; r.getCell(col('category')).value = 'مجموعة إكسل'; } });
    const add = (vals: Record<string, unknown>) => { const r = ws.addRow([]); for (const [k, v] of Object.entries(vals)) r.getCell(col(k)).value = v as ExcelJS.CellValue; };
    add({ code: 'XL-B2', nameAr: 'منتج إكسل ب', listPrice: 200, type: 'صنف مخزني', status: 'نشط', serialTracked: 'نعم', costPrice: 30, costCurrency: 'USD' });
    add({ code: 'XL-C3', nameAr: 'منتج إكسل ج', listPrice: 'abc' });
    add({ code: 'XL-B2', nameAr: 'مكرر', listPrice: 1 });

    const pre = await owner.post('/api/products/excel/import', { data: await b64(wb) });
    expect(pre.applied).toBe(false);
    expect(pre.errors.map((e: any) => e.en).join('|')).toMatch(/invalid value.*appears twice/);
    await owner.post('/api/products/excel/import', { data: await b64(wb), apply: true }, { expect: 400 });
    await sales.post('/api/products/excel/import', { data: await b64(wb) }, { expect: 403 });

    // fix the bad rows
    ws.eachRow((r, i) => { if (i > 2 && r.getCell(1).value === 'XL-C3') r.getCell(col('listPrice')).value = 300; });
    const dupRow = [] as number[];
    ws.eachRow((r, i) => { if (i > 2 && r.getCell(1).value === 'XL-B2' && r.getCell(col('nameAr')).value === 'مكرر') dupRow.push(i); });
    ws.spliceRows(dupRow[0]!, 1);
    const ok = await owner.post('/api/products/excel/import', { data: await b64(wb) });
    expect(ok.errors).toEqual([]);
    expect(ok.created).toBe(2);
    expect(ok.updates.find((u: any) => u.code === 'XL-A1').changes.map((c: any) => c.field).sort()).toEqual(['category', 'listPrice']);
    const done = await owner.post('/api/products/excel/import', { data: await b64(wb), apply: true });
    expect(done).toMatchObject({ applied: true, created: 2 });

    const list = await owner.get('/api/products?q=XL-');
    const a = list.rows.find((p: any) => p.code === 'XL-A1');
    const b = list.rows.find((p: any) => p.code === 'XL-B2');
    expect(Number(a.listPrice)).toBe(150);
    expect(b).toMatchObject({ nameAr: 'منتج إكسل ب', serialTracked: true, costCurrency: 'USD' });
    // the same file again changes nothing
    const again = await owner.post('/api/products/excel/import', { data: await b64(wb) });
    expect(again).toMatchObject({ created: 0, updated: 0 });
  });

  it('refuses a file that is not Excel or has no code column', async () => {
    await owner.post('/api/products/excel/import', { data: Buffer.from('hello').toString('base64') }, { expect: 400 });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['name', 'price']);
    await owner.post('/api/products/excel/import', { data: await b64(wb) }, { expect: 400 });
  });
});
