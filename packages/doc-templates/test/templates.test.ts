import { describe, expect, it } from 'vitest';
import { renderContractHtml, renderInvoiceHtml, renderQuoteHtml } from '../src/index.js';

const company = { legalNameAr: 'المدى المبارك', vatRegistered: true, vatNumber: '310122393500003' };

describe('templates', () => {
  it('escapes user content (XSS)', () => {
    const html = renderQuoteHtml({ company, number: 'MMC-1', revision: 0, date: '2026-10-05', clientName: '<script>alert(1)</script>', lines: [{ code: '<b>', description: '"x"', qty: '1', unitPrice: 100, amount: 100, listAmount: 100, isFree: false, struck: false, isOptional: false, isIns: false }], totals: { subtotal: 100, discount: 0, taxable: 100, vat: 15, total: 115, vatApplied: true, vatRate: 15, optionalTotal: 0 } });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('ريال سعودي');
  });
  it('renders contract articles in order with payments after scope', () => {
    const html = renderContractHtml({ company, number: 'MMCT-1', date: '2026-10-05', title: 'عقد توريد وتركيب', client: { name: 'عميل' },
      clauses: [{ titleAr: 'تمهيد', bodyAr: 'p' }, { titleAr: 'مرفقات العقد', bodyAr: 'a' }, { titleAr: 'المواصفات الفنية والأسعار', bodyAr: 's' }, { titleAr: 'نطاق الأعمال', bodyAr: 'n' }, { titleAr: 'مدة التوريد', bodyAr: 'd' }],
      lines: [], totals: { subtotal: 100000, discount: 0, vat: 15000, total: 115000, vatOn: true }, milestones: [{ nameAr: 'دفعة', percent: 100, amount: 115000 }], applyStamp: false });
    const order = ['المادة (1): مرفقات العقد', 'المادة (2): المواصفات', 'المادة (3): نطاق الأعمال', 'المادة (4): الدفعات', 'المادة (5): مدة التوريد'].map((s) => html.indexOf(s));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
  });
  it('plain invoice has no QR and says seller not registered', async () => {
    const html = await renderInvoiceHtml({ company: { legalNameAr: 'x', vatRegistered: false }, number: 'MMC-INV-00001', typeCode: '388', subtype: 'standard', issueDate: '2026-10-05', buyer: { name: 'b' }, lines: [], taxable: 100, vat: 0, total: 100, prepaid: 0, balanceDue: 100, qrPayload: 'AQ==' });
    expect(html).not.toContain('ZATCA QR');
    expect(html).toContain('غير مسجل');
  });
});
