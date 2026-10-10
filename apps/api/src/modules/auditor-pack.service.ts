import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { desc, sql, vatReturn, type Tx } from '@mmc/db';
import { fiscalYearOf, riyadhDate } from '@mmc/domain';
import type { ReportTable } from '@mmc/doc-templates';
import type { RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { loadCompany } from '../common/company.js';
import { assetRegister, registerTable } from './fixed-assets.controller.js';
import { reconciliationChecks } from './gl-posting.service.js';
import { journalReport, incomeTable, sheetTable, trialTable } from './ledger-reports.controller.js';
import { balanceSheet, incomeStatement, loadSettings, trialBalance } from './ledger.service.js';
import { previewEosb } from './accruals.service.js';
import { aging, agingTable, cashFlow, cashFlowTable, equityChanges, equityTable, zakat, zakatTable } from './statements.service.js';
import { H, renderPdf, renderXlsx } from './report-kit.js';
import { returnView } from './vat.service.js';

/**
 * The yearly "auditor pack" (Phase 6C, spec §1): every statement and supporting schedule for one
 * fiscal year as Excel files (+ PDF for the main statements), the audit trail as CSV and a SHA-256
 * manifest, in one zip. E-invoice XML is added when Phase 2 (6D) exists.
 */

const N = (x: string | number | null | undefined) => H(x);

function listTable(title: string, titleEn: string, subtitle: string, columns: ReportTable['columns'], rows: ReportTable['rows'], notes: string[] = []): ReportTable {
  return { title, titleEn, subtitle, columns, rows, notes };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function buildAuditorPack(actor: RequestActor, startParam: string | undefined): Promise<{ file: string; buf: Buffer }> {
  const data = await tenantTx(actor.tenantId, async (tx: Tx) => {
    const settings = await loadSettings(tx);
    const fy = fiscalYearOf(startParam ?? riyadhDate(), settings.fiscalYearStartMonth);
    const today = riyadhDate();
    const to = fy.end > today ? today : fy.end;
    const p = { from: fy.start, to };
    const co = await loadCompany(tx);
    const tb = await trialBalance(tx, { ...p, withZero: false });
    const is = await incomeStatement(tx, { ...p, by: 'month' });
    const bs = await balanceSheet(tx, to);
    const cf = await cashFlow(tx, p.from, p.to);
    const eq = await equityChanges(tx, p.from, p.to);
    const ar = await aging(tx, 'ar', to);
    const ap = await aging(tx, 'ap', to);
    const journal = await journalReport(tx, p);
    const assets = await assetRegister(tx);
    const returns = await tx.select().from(vatReturn).orderBy(desc(vatReturn.periodFrom));
    const returnViews = await Promise.all(returns.filter((r) => r.periodTo >= p.from && r.periodFrom <= p.to).map((r) => returnView(tx, r)));
    const eosb = await previewEosb(tx, to.slice(0, 7));
    const z = await zakat(tx, to, { rate: 'gregorian', profitAdjustments: 0 });
    const checks = await reconciliationChecks(tx);
    const stmts = await tx.execute<{ reference: string | null; code: string; name_ar: string; date_from: string; date_to: string; closing_balance: string; status: string }>(sql`
      select s.reference, a.code, a.name_ar, s.date_from::text, s.date_to::text, s.closing_balance::text, s.status
      from bank_statement s join account a on a.id = s.account_id where s.date_to >= ${p.from} and s.date_from <= ${p.to} order by s.date_to`);
    const invoices = await tx.execute<{ number: string; type_code: string; issue_date: string; party: string | null; taxable: string; vat_amount: string; total: string; balance_due: string; status: string; zatca_status: string }>(sql`
      select i.number, i.type_code, i.issue_date::text, pa.name_ar as party, i.taxable::text, i.vat_amount::text, i.total::text, i.balance_due::text, i.status, i.zatca_status
      from invoice_mirror i left join party pa on pa.id = i.party_id where i.issue_date >= ${p.from} and i.issue_date <= ${p.to} order by i.issue_date, i.number`);
    const bills = await tx.execute<{ number: string; supplier_invoice_no: string; bill_date: string; supplier: string | null; currency: string; subtotal: string; vat: string; total: string; paid_amount: string; status: string }>(sql`
      select b.number, b.supplier_invoice_no, b.bill_date::text, pa.name_ar as supplier, b.currency, b.subtotal::text, b.vat::text, b.total::text, b.paid_amount::text, b.status
      from supplier_bill b left join party pa on pa.id = b.supplier_id where b.bill_date >= ${p.from} and b.bill_date <= ${p.to} order by b.bill_date, b.number`);
    const payroll = await tx.execute<{ month: string; status: string; employee_count: number; gross: string; total_deductions: string; net: string }>(sql`
      select month, status, employee_count, gross::text, total_deductions::text, net::text from payroll_run
      where month >= ${p.from.slice(0, 7)} and month <= ${p.to.slice(0, 7)} order by month`);
    const trail = await tx.execute<{ id: number; at: string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; reason: string | null; hash: string }>(sql`
      select id, at::text, actor_id::text, action, entity_type, entity_id, reason, hash from audit_log
      where entity_type in ('journal_entry', 'account', 'ledger_settings', 'vat_return', 'fiscal_year', 'fixed_asset', 'bank_statement', 'cash_voucher', 'invoice')
        and at >= ${p.from}::date and at < (${p.to}::date + 1) order by id limit 50000`);
    return { p, fy, co, tb, is, bs, cf, eq, ar, ap, journal, assets, returnViews, eosb, z, checks, stmts, invoices, bills, payroll, trail };
  });

  const { p } = data;
  const sub = `السنة المالية ${data.fy.label} — من ${p.from} إلى ${p.to}`;
  const tables: { file: string; table: ReportTable; pdf?: boolean }[] = [
    { file: '01-trial-balance', table: trialTable(data.tb, p), pdf: true },
    { file: '02-income-statement', table: incomeTable(data.is, p), pdf: true },
    { file: '03-balance-sheet', table: sheetTable(data.bs, p.to), pdf: true },
    { file: '04-cash-flow', table: cashFlowTable(data.cf, p), pdf: true },
    { file: '05-equity-changes', table: equityTable(data.eq) },
    { file: '06-receivables-aging', table: agingTable(data.ar) },
    { file: '07-payables-aging', table: agingTable(data.ap) },
    { file: '08-general-journal', table: data.journal.table },
    { file: '09-fixed-assets', table: registerTable(data.assets, p.to) },
    {
      file: '10-vat-returns',
      table: listTable('إقرارات ضريبة القيمة المضافة', 'VAT returns', sub, [
        { key: 'label', label: 'الفترة', kind: 'text' }, { key: 'status', label: 'الحالة', kind: 'text' }, { key: 'filed', label: 'تاريخ التقديم', kind: 'date' },
        { key: 'out', label: 'ضريبة المخرجات', kind: 'money' }, { key: 'in', label: 'ضريبة المدخلات', kind: 'money' }, { key: 'net', label: 'الصافي', kind: 'money' }, { key: 'ledger', label: 'حركة الدفتر', kind: 'money' },
      ], data.returnViews.map((r) => ({ cells: { label: r.label, status: r.status === 'filed' ? 'مُقدَّم' : 'مسودة', filed: r.filedOn, out: N(r.outputVat), in: N(r.inputVat), net: N(r.netVat), ledger: N(r.ledgerNet) } }))),
    },
    {
      file: '11-eosb-schedule',
      table: listTable('جدول مخصص مكافأة نهاية الخدمة', 'End-of-service provision schedule', `كما في ${data.eosb.date}`, [
        { key: 'number', label: 'الرقم', kind: 'text' }, { key: 'name', label: 'الموظف', kind: 'text', width: 28 }, { key: 'hire', label: 'تاريخ التعيين', kind: 'date' }, { key: 'years', label: 'سنوات الخدمة', kind: 'number' },
        { key: 'wage', label: 'الأجر الشهري', kind: 'money' }, { key: 'target', label: 'الالتزام (م 84)', kind: 'money' }, { key: 'booked', label: 'المسجل بالدفاتر', kind: 'money' }, { key: 'delta', label: 'الفرق', kind: 'money' },
      ], [...data.eosb.rows.map((r) => ({ cells: { number: r.number, name: r.nameAr, hire: r.hireDate, years: r.years, wage: r.wage, target: r.target, booked: r.booked, delta: r.delta } })),
        { style: 'total' as const, cells: { name: 'الإجمالي', target: data.eosb.target, booked: data.eosb.balance, delta: data.eosb.toPost } }]),
    },
    {
      file: '12-bank-reconciliations',
      table: listTable('التسويات البنكية', 'Bank reconciliations', sub, [
        { key: 'acc', label: 'الحساب', kind: 'text', width: 28 }, { key: 'ref', label: 'كشف الحساب', kind: 'text' }, { key: 'from', label: 'من', kind: 'date' }, { key: 'to', label: 'إلى', kind: 'date' },
        { key: 'closing', label: 'الرصيد الختامي بالكشف', kind: 'money' }, { key: 'status', label: 'الحالة', kind: 'text' },
      ], data.stmts.map((s) => ({ cells: { acc: `${s.code} ${s.name_ar}`, ref: s.reference, from: s.date_from, to: s.date_to, closing: N(s.closing_balance), status: s.status === 'reconciled' ? 'مُسوّى' : 'قيد التسوية' } }))),
    },
    { file: '13-zakat-base', table: zakatTable(data.z) },
    {
      file: '14-reconciliation-checks',
      table: listTable('فحوصات المطابقة', 'Reconciliation checks', `كما في ${p.to}`, [
        { key: 'check', label: 'الفحص', kind: 'text', width: 60 }, { key: 'ledger', label: 'الدفتر', kind: 'money' }, { key: 'source', label: 'المصدر', kind: 'money' }, { key: 'ok', label: 'النتيجة', kind: 'text' },
      ], data.checks.map((c) => ({ cells: { check: c.labelAr, ledger: c.ledger ? N(c.ledger) : null, source: c.source ? N(c.source) : null, ok: c.ok ? 'مطابق' : 'يحتاج مراجعة' } }))),
    },
    {
      file: '15-invoices',
      table: listTable('الفواتير الصادرة', 'Issued invoices', sub, [
        { key: 'number', label: 'الرقم', kind: 'text' }, { key: 'type', label: 'النوع', kind: 'text' }, { key: 'date', label: 'التاريخ', kind: 'date' }, { key: 'party', label: 'العميل', kind: 'text', width: 28 },
        { key: 'taxable', label: 'الخاضع', kind: 'money' }, { key: 'vat', label: 'الضريبة', kind: 'money' }, { key: 'total', label: 'الإجمالي', kind: 'money' }, { key: 'due', label: 'المتبقي', kind: 'money' }, { key: 'status', label: 'الحالة', kind: 'text' }, { key: 'zatca', label: 'حالة الهيئة', kind: 'text' },
      ], data.invoices.map((i) => ({ cells: { number: i.number, type: i.type_code, date: i.issue_date, party: i.party, taxable: N(i.taxable), vat: N(i.vat_amount), total: N(i.total), due: N(i.balance_due), status: i.status, zatca: i.zatca_status } }))),
    },
    {
      file: '16-supplier-bills',
      table: listTable('فواتير الموردين', 'Supplier bills', sub, [
        { key: 'number', label: 'الرقم', kind: 'text' }, { key: 'inv', label: 'فاتورة المورد', kind: 'text' }, { key: 'date', label: 'التاريخ', kind: 'date' }, { key: 'supplier', label: 'المورد', kind: 'text', width: 28 },
        { key: 'cur', label: 'العملة', kind: 'text' }, { key: 'subtotal', label: 'قبل الضريبة', kind: 'money' }, { key: 'vat', label: 'الضريبة', kind: 'money' }, { key: 'total', label: 'الإجمالي', kind: 'money' }, { key: 'paid', label: 'المسدد (ر.س)', kind: 'money' }, { key: 'status', label: 'الحالة', kind: 'text' },
      ], data.bills.map((b) => ({ cells: { number: b.number, inv: b.supplier_invoice_no, date: b.bill_date, supplier: b.supplier, cur: b.currency, subtotal: N(b.subtotal), vat: N(b.vat), total: N(b.total), paid: N(b.paid_amount), status: b.status } }))),
    },
    {
      file: '17-payroll-summary',
      table: listTable('ملخص الرواتب والتأمينات', 'Payroll summary', sub, [
        { key: 'month', label: 'الشهر', kind: 'text' }, { key: 'status', label: 'الحالة', kind: 'text' }, { key: 'n', label: 'عدد الموظفين', kind: 'number' },
        { key: 'gross', label: 'الإجمالي', kind: 'money' }, { key: 'ded', label: 'الاستقطاعات', kind: 'money' }, { key: 'net', label: 'الصافي', kind: 'money' },
      ], data.payroll.map((r) => ({ cells: { month: r.month, status: r.status, n: r.employee_count, gross: N(r.gross), ded: N(r.total_deductions), net: N(r.net) } }))),
    },
  ];

  const zip = new JSZip();
  const manifest: { file: string; bytes: number; sha256: string }[] = [];
  const notes: string[] = [];
  const add = (name: string, buf: Buffer | string) => {
    const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
    zip.file(name, b);
    manifest.push({ file: name, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') });
  };
  for (const t of tables) {
    add(`${t.file}.xlsx`, await renderXlsx(actor, t.table));
    if (t.pdf) {
      try { add(`pdf/${t.file}.pdf`, await renderPdf(actor, t.table)); } catch { notes.push(`تعذّر إنشاء ${t.file}.pdf (خدمة PDF غير متاحة) — الملف الأصلي بصيغة Excel موجود.`); }
    }
  }
  const head = ['id', 'at', 'actor_id', 'action', 'entity_type', 'entity_id', 'reason', 'hash'];
  add('18-audit-trail.csv', '﻿' + [head.join(','), ...data.trail.map((r) => head.map((h) => csvCell((r as Record<string, unknown>)[h])).join(','))].join('\r\n'));
  add('README.txt', [
    `حزمة المراجع — ${data.co.legalNameAr}`, sub, `أُنشئت بتاريخ ${riyadhDate()}`, '',
    'المحتويات: القوائم المالية (ميزان المراجعة، الدخل، المركز المالي، التدفقات النقدية، حقوق الملكية)، أعمار الذمم، دفتر اليومية،',
    'سجل الأصول الثابتة، إقرارات ضريبة القيمة المضافة، جدول نهاية الخدمة، التسويات البنكية، ورقة الوعاء الزكوي، فحوصات المطابقة،',
    'الفواتير الصادرة وفواتير الموردين وملخص الرواتب، وسجل التدقيق (CSV). ملف manifest.json يحوي بصمة SHA-256 لكل ملف.',
    'ملاحظة: ملفات XML للفوترة الإلكترونية (المرحلة الثانية) تُضاف عند تفعيلها.', ...notes,
  ].join('\r\n'));
  zip.file('manifest.json', JSON.stringify({ company: data.co.legalNameAr, fiscalYear: data.fy.label, from: p.from, to: p.to, generatedAt: new Date().toISOString(), files: manifest }, null, 2));
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { file: `auditor-pack-${data.fy.label.replace('/', '-')}.zip`, buf };
}
