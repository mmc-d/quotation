import { LOGO_DATA_URL } from './logo.generated.js';
import { RIYAL_DATA_URL } from './riyal.generated.js';

/** Escape for HTML text and attribute contexts. Every interpolated value goes through this. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Multi-line text → escaped HTML with <br>. */
export function escLines(v: unknown): string {
  return esc(v).replace(/\r?\n/g, '<br>');
}

export const riyal = `<img class="sar" src="${RIYAL_DATA_URL}" alt="ريال">`;

export interface CompanyBlock {
  legalNameAr: string;
  legalNameEn?: string | null;
  crNumber?: string | null;
  unifiedNumber?: string | null;
  vatNumber?: string | null;
  vatRegistered: boolean;
  addressLine?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  bankName?: string | null;
  iban?: string | null;
  representativeName?: string | null;
  representativeMobile?: string | null;
  stampDataUrl?: string | null;
}

/** Emerald + gold palette shared with the legacy tool and the PDF API. */
export const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
:root{--primary:#0D4A2E;--gold:#C2A04A;--gold2:#D8BD72;--gold-dk:#8A6F2C;--ink:#1d2722;--muted:#6b7570;--line:#e5e1d6;--tint:#F8F4EA}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'Tajawal','Noto Sans Arabic','DejaVu Sans',sans-serif;color:var(--ink);font-size:11.5px;line-height:1.55;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:12mm 11mm 16mm}
.top{border-top:4px solid var(--gold);padding-top:8px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.top img.logo{height:62px;width:auto}
.top .co{text-align:left;font-size:10px;color:var(--muted)}
.top .co b{display:block;color:var(--primary);font-size:12.5px}
h1.doc{margin:10px 0 2px;color:var(--primary);font-size:20px;font-weight:800;letter-spacing:.2px}
.doc-en{color:var(--gold-dk);font-size:11px;font-weight:700;margin-bottom:8px}
.accent{height:3px;background:linear-gradient(90deg,var(--gold),var(--gold2));border-radius:2px;margin:6px 0 10px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-bottom:10px}
.cell{padding:6px 8px;border-left:1px solid var(--line);border-bottom:1px solid var(--line)}
.cell .k{display:block;color:var(--gold-dk);font-size:9.5px;font-weight:700}
.cell .v{font-weight:700}
table.items{width:100%;border-collapse:collapse;margin-top:4px}
table.items th{background:var(--primary);color:#fff;font-weight:700;padding:6px 5px;font-size:10.5px}
table.items td{border-bottom:1px solid var(--line);padding:5px;vertical-align:middle}
table.items tr:nth-child(even) td{background:#fbfaf6}
table.items tr.ins td{background:var(--tint);border-top:2px solid var(--gold)}
table.items tr.optional td{color:var(--muted);font-style:italic}
td.num,th.num{text-align:center;white-space:nowrap}
td.money{text-align:left;white-space:nowrap;font-weight:700}
.code{font-family:monospace;color:var(--gold-dk);font-weight:700;font-size:10px}
.pic{width:44px;height:44px;object-fit:contain}
.strike{text-decoration:line-through;color:var(--muted);font-weight:500;font-size:9.5px;display:block}
.free{color:#c0392b;font-weight:800}
.totals{margin:10px 0 0 auto;width:46%;border:1px solid var(--line);border-radius:6px;overflow:hidden;page-break-inside:avoid}
.totals .row{display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--line)}
.totals .row.grand{background:var(--primary);color:#fff;font-size:13.5px;font-weight:800;border:0}
.totals .row.grand .sar{filter:brightness(10)}
img.sar{height:.85em;width:auto;vertical-align:middle;margin-inline-start:.15em;filter:brightness(0)}
.words{color:var(--muted);font-size:10.5px;margin-top:4px}
.box{border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin-top:10px;page-break-inside:avoid}
.box h3{margin:0 0 4px;color:var(--primary);font-size:12px}
.section{margin-top:9px;page-break-inside:avoid}
.section .t{color:var(--primary);font-weight:800;font-size:12.5px;border-inline-start:3px solid var(--gold);padding-inline-start:7px;margin-bottom:3px}
.section .b{text-align:justify}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:22px;page-break-inside:avoid}
.sig .col{text-align:center}
.sig .line{border-bottom:1px solid var(--ink);height:48px;margin:6px 20px}
.stamp{width:150px;height:150px;object-fit:contain;opacity:.92;transform:rotate(-7deg)}
.foot{margin-top:14px;padding-top:6px;border-top:2px solid var(--primary);display:flex;justify-content:space-between;color:var(--muted);font-size:9.5px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;background:var(--tint);color:var(--gold-dk);font-weight:700;font-size:10px}
.ltr{direction:ltr;unicode-bidi:embed}
.qr{width:120px;height:120px}
`;

export function header(c: CompanyBlock): string {
  const reg = [c.unifiedNumber ? `الرقم الموحد: ${esc(c.unifiedNumber)}` : c.crNumber ? `س.ت: ${esc(c.crNumber)}` : '', c.vatRegistered && c.vatNumber ? `الرقم الضريبي: ${esc(c.vatNumber)}` : ''].filter(Boolean).join(' · ');
  return `<div class="top">
  <img class="logo" src="${LOGO_DATA_URL}" alt="">
  <div class="co"><b>${esc(c.legalNameAr)}</b>${c.legalNameEn ? `<span class="ltr">${esc(c.legalNameEn)}</span><br>` : ''}${reg}${c.addressLine ? `<br>${esc(c.addressLine)}` : ''}</div>
</div>`;
}

export function footer(c: CompanyBlock, extra = ''): string {
  return `<div class="foot"><span>${esc(c.legalNameAr)}${c.phone ? ` · <span class="ltr">${esc(c.phone)}</span>` : ''}${c.email ? ` · <span class="ltr">${esc(c.email)}</span>` : ''}</span><span>${extra}</span></div>`;
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${body}</body></html>`;
}
