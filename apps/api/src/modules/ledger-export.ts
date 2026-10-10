import ExcelJS from 'exceljs';
import type { ReportTable } from '@mmc/doc-templates';

const GREEN = 'FF0D4A2E';
const TINT = 'FFF8F4EA';
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00;0.00';

/** A ReportTable as an RTL workbook: frozen header, money in SAR with two decimals, totals emphasised. */
export async function tableToXlsx(t: ReportTable, company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MMC Core';
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }], pageSetup: { orientation: t.columns.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = t.columns.map((c) => ({ key: c.key, width: c.width ? Math.max(10, c.width * 0.9) : c.kind === 'money' ? 18 : c.kind === 'text' ? 42 : 14 }));
  const cols = t.columns.length;
  const title = ws.getRow(1);
  title.getCell(1).value = `${company} — ${t.title}`;
  title.font = { bold: true, size: 14, color: { argb: GREEN } };
  ws.mergeCells(1, 1, 1, cols);
  ws.getRow(2).getCell(1).value = t.subtitle ?? '';
  ws.mergeCells(2, 1, 2, cols);
  const head = ws.getRow(4);
  t.columns.forEach((c, i) => { head.getCell(i + 1).value = c.label; });
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 24;
  t.columns.forEach((_, i) => { head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; });
  for (const r of t.rows) {
    const row = ws.addRow(t.columns.map((c) => {
      const v = r.cells[c.key];
      if (v === null || v === undefined || v === '') return null;
      return c.kind === 'money' && typeof v === 'number' ? v / 100 : v;
    }));
    t.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.kind === 'money') cell.numFmt = MONEY_FMT;
      if (i === 0 && r.depth) cell.alignment = { indent: r.depth };
      if (c.kind === 'date' || c.kind === 'number') cell.alignment = { horizontal: 'center' };
    });
    if (r.style === 'group') { row.font = { bold: true }; row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT } }; }); }
    else if (r.style === 'heading') row.font = { bold: true, color: { argb: GREEN } };
    else if (r.style === 'subtotal') { row.font = { bold: true }; row.eachCell((c) => { c.border = { top: { style: 'thin' } }; }); }
    else if (r.style === 'total') { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; }); }
  }
  (t.notes ?? []).forEach((n) => { ws.addRow([]); ws.addRow([n]); });
  ws.autoFilter = undefined;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
