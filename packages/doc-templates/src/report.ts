import { formatSar2 } from '@mmc/domain';
import { esc, footer, header, page, type CompanyBlock } from './base.js';

/**
 * Generic tabular report (trial balance, ledger, statements …): the same ReportTable renders to
 * PDF here and to Excel in the API, so every report exports identically. `money` cells are integer
 * halalas; `text`/`date`/`number` cells are shown as given.
 */
export interface ReportColumn { key: string; label: string; kind: 'text' | 'money' | 'date' | 'number'; width?: number }
export type ReportRowStyle = 'normal' | 'group' | 'subtotal' | 'total' | 'heading';
export interface ReportRow { cells: Record<string, string | number | null | undefined>; style?: ReportRowStyle; /** indent level for tree reports */ depth?: number }
export interface ReportTable {
  title: string;
  titleEn?: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  notes?: string[];
}

const CSS = `
table.rep{width:100%;border-collapse:collapse;margin-top:6px;font-size:10.5px}
table.rep th{background:var(--primary);color:#fff;font-weight:700;padding:5px 6px;font-size:10.5px}
table.rep td{border-bottom:1px solid var(--line);padding:3.5px 6px;vertical-align:top}
table.rep td.m{text-align:left;white-space:nowrap;direction:ltr;font-variant-numeric:tabular-nums}
table.rep td.n,table.rep td.d{text-align:center;white-space:nowrap}
table.rep tr.group td{font-weight:800;background:var(--tint)}
table.rep tr.heading td{font-weight:800;color:var(--primary);border-bottom:2px solid var(--gold);padding-top:9px}
table.rep tr.subtotal td{font-weight:800;border-top:1px solid var(--ink)}
table.rep tr.total td{font-weight:800;background:var(--primary);color:#fff}
table.rep thead{display:table-header-group}
table.rep tr{page-break-inside:avoid}
.repnote{color:var(--muted);font-size:9.5px;margin-top:8px}
`;

const cell = (col: ReportColumn, v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === '') return '';
  if (col.kind === 'money') return typeof v === 'number' ? (v === 0 ? '0.00' : formatSar2(v)) : esc(v);
  return esc(v);
};

export function renderReportHtml(company: CompanyBlock, t: ReportTable, generatedAt: string): string {
  const landscape = t.columns.length > 6;
  const head = t.columns.map((c) => `<th${c.width ? ` style="width:${c.width}%"` : ''}>${esc(c.label)}</th>`).join('');
  const body = t.rows.map((r) => {
    const cls = r.style && r.style !== 'normal' ? ` class="${r.style}"` : '';
    const tds = t.columns.map((c, i) => {
      const k = c.kind === 'money' ? 'm' : c.kind === 'number' ? 'n' : c.kind === 'date' ? 'd' : '';
      const pad = i === 0 && r.depth ? ` style="padding-inline-start:${6 + r.depth * 14}px"` : '';
      return `<td${k ? ` class="${k}"` : ''}${pad}>${cell(c, r.cells[c.key])}</td>`;
    }).join('');
    return `<tr${cls}>${tds}</tr>`;
  }).join('');
  const html = `${landscape ? '<style>@page{size:A4 landscape}</style>' : ''}<style>${CSS}</style>${header(company)}
<h1 class="doc">${esc(t.title)}</h1>${t.titleEn ? `<div class="doc-en">${esc(t.titleEn)}</div>` : ''}${t.subtitle ? `<div style="color:var(--muted);margin-bottom:4px">${esc(t.subtitle)}</div>` : ''}
<div class="accent"></div>
<table class="rep"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
${(t.notes ?? []).map((n) => `<div class="repnote">${esc(n)}</div>`).join('')}
${footer(company, `<span>${esc(generatedAt)}</span>`)}`;
  return page(t.title, html);
}
