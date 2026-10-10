import type { Halalas } from './money.js';

/**
 * General ledger — pure rules (docs/erp-plan/phase-6-accounting-implementation.md). Amounts are
 * integer halalas. A balance is carried as a *net debit* (debit − credit): positive = debit side,
 * negative = credit side; statements flip the sign to each account's natural side.
 */

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, { ar: string; en: string }> = {
  asset: { ar: 'أصول', en: 'Asset' },
  liability: { ar: 'خصوم', en: 'Liability' },
  equity: { ar: 'حقوق ملكية', en: 'Equity' },
  income: { ar: 'إيرادات', en: 'Income' },
  expense: { ar: 'مصروفات', en: 'Expense' },
};

/** Assets and expenses grow with debits; everything else with credits. */
export const isDebitNormal = (t: AccountType): boolean => t === 'asset' || t === 'expense';

/** Net debit (debit − credit) → balance on the account's natural side. */
export const naturalBalance = (t: AccountType, netDebit: Halalas): Halalas => (isDebitNormal(t) ? netDebit : -netDebit);

export const ENTRY_KINDS = ['manual', 'auto', 'opening', 'reversal', 'closing', 'adjustment'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_STATUSES = ['draft', 'posted'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

// ─────────────────────────────── chart of accounts ───────────────────────────────

export interface ChartAccount {
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  /** group (header) rows take no journal lines */
  isGroup?: boolean;
  /** the role auto-posting resolves to this account (unique per tenant) */
  postingKey?: string;
  /** a customer/supplier must be named on every line */
  requiresParty?: boolean;
}

const g = (code: string, nameAr: string, nameEn: string, type: AccountType): ChartAccount => ({ code, nameAr, nameEn, type, isGroup: true });
const a = (code: string, nameAr: string, nameEn: string, type: AccountType, postingKey?: string, requiresParty?: boolean): ChartAccount => ({ code, nameAr, nameEn, type, ...(postingKey ? { postingKey } : {}), ...(requiresParty ? { requiresParty } : {}) });

/** The Saudi starter chart (spec Appendix A). Hierarchy follows the code prefix; the accountant edits it afterwards. */
export const CHART_OF_ACCOUNTS: readonly ChartAccount[] = [
  g('1', 'الأصول', 'Assets', 'asset'),
  g('11', 'الأصول المتداولة', 'Current assets', 'asset'),
  a('1101', 'الصندوق (النقدية)', 'Cash on hand', 'asset', 'cash'),
  a('1102', 'العهد النقدية', 'Petty cash & custody', 'asset'),
  a('1103', 'البنك — الحساب الجاري', 'Bank — current account', 'asset', 'bank'),
  a('1104', 'مدفوعات بوابة الدفع تحت التسوية', 'Payment gateway clearing', 'asset', 'gateway_clearing'),
  a('1110', 'العملاء (الذمم المدينة)', 'Accounts receivable', 'asset', 'ar', true),
  a('1120', 'سلف وعهد الموظفين', 'Employee advances', 'asset', 'employee_advances'),
  a('1130', 'المخزون', 'Inventory', 'asset', 'inventory'),
  a('1131', 'بضاعة في الطريق', 'Goods in transit', 'asset', 'goods_in_transit'),
  a('1132', 'أعمال تحت التنفيذ (المشاريع)', 'Work in progress (projects)', 'asset', 'wip'),
  a('1140', 'ضريبة القيمة المضافة — المدخلات', 'VAT input (recoverable)', 'asset', 'vat_input'),
  a('1150', 'دفعات مقدمة للموردين', 'Advances to suppliers', 'asset', 'supplier_advances', true),
  a('1160', 'مصروفات مدفوعة مقدمًا', 'Prepaid expenses', 'asset'),
  g('12', 'الأصول غير المتداولة', 'Non-current assets', 'asset'),
  a('1201', 'الأجهزة والمعدات', 'Equipment', 'asset'),
  a('1202', 'السيارات', 'Vehicles', 'asset'),
  a('1203', 'الأثاث والتجهيزات المكتبية', 'Furniture & fixtures', 'asset'),
  a('1204', 'أجهزة الحاسب الآلي', 'Computers', 'asset'),
  a('1209', 'مجمع الإهلاك', 'Accumulated depreciation', 'asset', 'accumulated_depreciation'),
  g('2', 'الخصوم', 'Liabilities', 'liability'),
  g('21', 'الخصوم المتداولة', 'Current liabilities', 'liability'),
  a('2101', 'الموردون (الذمم الدائنة)', 'Accounts payable', 'liability', 'ap', true),
  a('2102', 'دفعات مقدمة من العملاء', 'Customer advances', 'liability', 'customer_advances', true),
  a('2103', 'بضائع مستلمة لم تُفوتر', 'Goods received not invoiced', 'liability', 'grni'),
  a('2104', 'الجمارك والتخليص المستحق', 'Customs & clearing payable', 'liability', 'customs_payable'),
  a('2110', 'ضريبة القيمة المضافة — المخرجات', 'VAT output', 'liability', 'vat_output'),
  a('2111', 'ضريبة القيمة المضافة — التسوية مع الهيئة', 'VAT settlement (ZATCA)', 'liability', 'vat_settlement'),
  a('2120', 'رواتب مستحقة', 'Salaries payable', 'liability', 'salaries_payable'),
  a('2121', 'التأمينات الاجتماعية المستحقة', 'GOSI payable', 'liability', 'gosi_payable'),
  a('2122', 'عمولات مستحقة', 'Commissions payable', 'liability', 'commissions_payable'),
  a('2130', 'مصروفات مستحقة', 'Accrued expenses', 'liability', 'accrued_expenses'),
  a('2140', 'الزكاة المستحقة', 'Zakat payable', 'liability', 'zakat_payable'),
  g('22', 'الخصوم غير المتداولة', 'Non-current liabilities', 'liability'),
  a('2201', 'مخصص مكافأة نهاية الخدمة', 'End-of-service provision', 'liability', 'eos_provision'),
  a('2202', 'قروض طويلة الأجل', 'Long-term loans', 'liability'),
  g('3', 'حقوق الملكية', 'Equity', 'equity'),
  a('3101', 'رأس المال', 'Capital', 'equity', 'capital'),
  a('3102', 'جاري المالك', "Owner's current account", 'equity', 'owner_current'),
  a('3201', 'الأرباح المبقاة (المرحّلة)', 'Retained earnings', 'equity', 'retained_earnings'),
  a('3301', 'أرصدة افتتاحية — حساب وسيط', 'Opening balance equity', 'equity', 'opening_balance_equity'),
  g('4', 'الإيرادات', 'Revenue', 'income'),
  a('4101', 'مبيعات الأجهزة والأنظمة', 'Sales — devices & systems', 'income', 'sales_devices'),
  a('4102', 'إيرادات التركيب', 'Installation revenue', 'income', 'sales_installation'),
  a('4103', 'إيرادات الصيانة والخدمات', 'Maintenance & service revenue', 'income', 'sales_service'),
  a('4190', 'خصومات ومردودات المبيعات', 'Sales discounts & returns', 'income', 'sales_discounts'),
  a('4201', 'إيرادات أخرى', 'Other income', 'income', 'other_income'),
  g('5', 'تكلفة المبيعات', 'Cost of sales', 'expense'),
  a('5101', 'تكلفة البضاعة المباعة', 'Cost of goods sold', 'expense', 'cogs'),
  a('5102', 'فروقات الجرد والتسويات المخزنية', 'Stock adjustments', 'expense', 'stock_adjustments'),
  a('5103', 'مصروفات مشتريات مباشرة', 'Direct purchase expenses', 'expense', 'purchase_expenses'),
  a('5104', 'الرسوم الجمركية', 'Customs duty', 'expense', 'customs_duty'),
  a('5105', 'فروقات أسعار وعملة المشتريات', 'Purchase price & FX variance', 'expense', 'price_fx_variance'),
  g('6', 'المصروفات التشغيلية', 'Operating expenses', 'expense'),
  a('6101', 'الرواتب والأجور', 'Salaries & wages', 'expense', 'salaries'),
  a('6102', 'البدلات', 'Allowances', 'expense', 'allowances'),
  a('6103', 'التأمينات الاجتماعية (حصة المنشأة)', 'GOSI — employer share', 'expense', 'gosi_expense'),
  a('6104', 'المكافآت والحوافز', 'Bonuses & incentives', 'expense', 'bonuses'),
  a('6105', 'العمولات', 'Commissions', 'expense', 'commissions'),
  a('6106', 'مصروف مكافأة نهاية الخدمة', 'End-of-service expense', 'expense', 'eos_expense'),
  a('6107', 'رسوم حكومية وإقامات', 'Government fees & iqamas', 'expense'),
  a('6201', 'الإيجارات', 'Rent', 'expense'),
  a('6202', 'الكهرباء والمياه', 'Utilities', 'expense'),
  a('6203', 'الاتصالات والإنترنت', 'Telecom & internet', 'expense'),
  a('6204', 'المحروقات والنقل', 'Fuel & transport', 'expense'),
  a('6205', 'الصيانة والإصلاحات', 'Repairs & maintenance', 'expense'),
  a('6206', 'التسويق والإعلان', 'Marketing & advertising', 'expense'),
  a('6207', 'القرطاسية واللوازم المكتبية', 'Office supplies', 'expense'),
  a('6208', 'الرسوم البنكية', 'Bank charges', 'expense', 'bank_charges'),
  a('6209', 'الإهلاك', 'Depreciation', 'expense', 'depreciation'),
  a('6210', 'الاشتراكات والبرمجيات', 'Subscriptions & software', 'expense'),
  a('6211', 'الأتعاب المهنية والقانونية', 'Professional fees', 'expense'),
  a('6290', 'مصروفات عمومية متنوعة', 'General expenses', 'expense', 'general_expenses'),
  a('6301', 'الزكاة', 'Zakat', 'expense', 'zakat_expense'),
  g('9', 'حسابات وسيطة', 'Clearing accounts', 'asset'),
  a('9101', 'حساب تحت التسوية (بانتظار التوجيه)', 'Suspense (to classify)', 'asset', 'suspense'),
];

export const POSTING_KEYS: readonly string[] = CHART_OF_ACCOUNTS.flatMap((c) => (c.postingKey ? [c.postingKey] : []));

/** Parent code of `code` = the longest *other* group code that is a prefix of it. */
export function parentCode(code: string, groupCodes: Iterable<string>): string | null {
  let best: string | null = null;
  for (const g of groupCodes) if (g !== code && code.startsWith(g) && (!best || g.length > best.length)) best = g;
  return best;
}

/** Payment method → posting key of the account the money lands in (spec §6.1, customer payments). */
export const DEFAULT_METHOD_KEYS: Record<string, string> = {
  cash: 'cash', cheque: 'bank', bank_transfer: 'bank', transfer: 'bank', mada: 'gateway_clearing', credit_card: 'gateway_clearing',
  apple_pay: 'gateway_clearing', stc_pay: 'gateway_clearing', payment_link: 'gateway_clearing', card: 'bank', other: 'suspense',
};

// ─────────────────────────────── dates & periods ───────────────────────────────

export const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
/** YYYY-MM of a YYYY-MM-DD date. */
export const periodOf = (date: string): string => date.slice(0, 7);
export const lastDayOfMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');

export interface FiscalYear { label: string; start: string; end: string }

/**
 * The fiscal year containing `date`. With a January start the label is the calendar year ("2026");
 * with another start month it is "2026/2027" (start year / end year).
 */
export function fiscalYearOf(date: string, startMonth = 1): FiscalYear {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const sm = Math.min(12, Math.max(1, Math.trunc(startMonth) || 1));
  const startYear = m >= sm ? y : y - 1;
  const start = `${startYear}-${pad(sm)}-01`;
  const endMonth = sm === 1 ? 12 : sm - 1;
  const endYear = sm === 1 ? startYear : startYear + 1;
  const end = `${endYear}-${pad(endMonth)}-${pad(lastDayOfMonth(endYear, endMonth))}`;
  return { label: sm === 1 ? String(startYear) : `${startYear}/${endYear}`, start, end };
}

/** Day before a YYYY-MM-DD date. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────── journal validation ───────────────────────────────

export interface JournalLineIn {
  accountId: string;
  debit: Halalas;
  credit: Halalas;
  partyId?: string | null;
}

export interface AccountInfo {
  id: string;
  code: string;
  isGroup: boolean;
  isActive: boolean;
  requiresParty: boolean;
}

export interface JournalProblem {
  code: 'bad_date' | 'period_locked' | 'before_go_live' | 'too_few_lines' | 'bad_amount' | 'both_sides' | 'no_amount' | 'unknown_account' | 'group_account' | 'inactive_account' | 'party_required' | 'unbalanced';
  /** 1-based line number, absent for entry-level problems */
  line?: number;
  message: string;
  messageAr: string;
}

export const totalsOf = (lines: readonly { debit: Halalas; credit: Halalas }[]): { debit: Halalas; credit: Halalas } =>
  lines.reduce((t, l) => ({ debit: t.debit + l.debit, credit: t.credit + l.credit }), { debit: 0, credit: 0 });

/**
 * Everything wrong with a journal entry. An entry may be saved as a draft with problems only if the
 * caller chooses; posting requires an empty list.
 */
export function journalProblems(input: {
  entryDate: string;
  lines: readonly JournalLineIn[];
  accounts: ReadonlyMap<string, AccountInfo>;
  lockedThrough?: string | null;
  /** opening entries are dated *on* the go-live date; others must not precede it */
  goLiveDate?: string | null;
  allowBeforeGoLive?: boolean;
}): JournalProblem[] {
  const out: JournalProblem[] = [];
  if (!isDate(input.entryDate)) out.push({ code: 'bad_date', message: 'the entry date is not a valid date', messageAr: 'تاريخ القيد غير صالح' });
  else {
    if (input.lockedThrough && input.entryDate <= input.lockedThrough) out.push({ code: 'period_locked', message: `the period is locked through ${input.lockedThrough}`, messageAr: `الفترة مقفلة حتى ${input.lockedThrough}` });
    if (!input.allowBeforeGoLive && input.goLiveDate && input.entryDate < input.goLiveDate) out.push({ code: 'before_go_live', message: `the entry is dated before the ledger go-live date (${input.goLiveDate})`, messageAr: `تاريخ القيد قبل تاريخ بدء النظام المحاسبي (${input.goLiveDate})` });
  }
  if (input.lines.length < 2) out.push({ code: 'too_few_lines', message: 'a journal entry needs at least two lines', messageAr: 'القيد يحتاج سطرين على الأقل' });
  input.lines.forEach((l, i) => {
    const n = i + 1;
    if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit) || l.debit < 0 || l.credit < 0) out.push({ code: 'bad_amount', line: n, message: `line ${n}: amounts must be non-negative`, messageAr: `السطر ${n}: المبالغ يجب ألا تكون سالبة` });
    else if (l.debit > 0 && l.credit > 0) out.push({ code: 'both_sides', line: n, message: `line ${n}: a line is either debit or credit, not both`, messageAr: `السطر ${n}: السطر إما مدين أو دائن وليس كليهما` });
    else if (l.debit === 0 && l.credit === 0) out.push({ code: 'no_amount', line: n, message: `line ${n}: enter a debit or a credit amount`, messageAr: `السطر ${n}: أدخل مبلغًا مدينًا أو دائنًا` });
    const acc = input.accounts.get(l.accountId);
    if (!acc) out.push({ code: 'unknown_account', line: n, message: `line ${n}: unknown account`, messageAr: `السطر ${n}: حساب غير معروف` });
    else {
      if (acc.isGroup) out.push({ code: 'group_account', line: n, message: `line ${n}: ${acc.code} is a group account — pick a postable account`, messageAr: `السطر ${n}: الحساب ${acc.code} حساب رئيسي لا يقبل قيودًا` });
      if (!acc.isActive) out.push({ code: 'inactive_account', line: n, message: `line ${n}: account ${acc.code} is inactive`, messageAr: `السطر ${n}: الحساب ${acc.code} غير نشط` });
      if (acc.requiresParty && !l.partyId) out.push({ code: 'party_required', line: n, message: `line ${n}: account ${acc.code} needs a customer/supplier`, messageAr: `السطر ${n}: الحساب ${acc.code} يتطلب تحديد العميل/المورد` });
    }
  });
  const t = totalsOf(input.lines);
  if (t.debit !== t.credit) out.push({ code: 'unbalanced', message: `debits (${t.debit / 100}) do not equal credits (${t.credit / 100})`, messageAr: `مجموع المدين (${t.debit / 100}) لا يساوي مجموع الدائن (${t.credit / 100})` });
  return out;
}

/**
 * Lines of the reversing entry: every line with its sides swapped. A VAT base is negated too, so the
 * VAT return nets a reversed document to zero.
 */
export function reverseLines<T extends { debit: Halalas; credit: Halalas; vatBase?: Halalas | null }>(lines: readonly T[]): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, ...(l.vatBase != null ? { vatBase: -l.vatBase } : {}) }));
}

// ─────────────────────────────── trial balance ───────────────────────────────

export interface AccountRef {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  type: AccountType;
  isGroup: boolean;
  parentId: string | null;
  isActive?: boolean;
}

/** Posted movement of one account: before the period, and within it. */
export interface AccountSums {
  accountId: string;
  openDebit: Halalas;
  openCredit: Halalas;
  debit: Halalas;
  credit: Halalas;
}

export interface TrialRow {
  accountId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  type: AccountType;
  isGroup: boolean;
  depth: number;
  /** net debit before the period (>0 debit, <0 credit) */
  opening: Halalas;
  debit: Halalas;
  credit: Halalas;
  /** net debit at the end of the period */
  closing: Halalas;
}

export interface TrialBalance {
  rows: TrialRow[];
  totals: { openingDebit: Halalas; openingCredit: Halalas; debit: Halalas; credit: Halalas; closingDebit: Halalas; closingCredit: Halalas };
  balanced: boolean;
}

/** Depth of each account in the tree (roots = 1), tolerant of cycles/missing parents. */
export function depthMap(accounts: readonly AccountRef[]): Map<string, number> {
  const byId = new Map(accounts.map((x) => [x.id, x]));
  const depth = new Map<string, number>();
  const walk = (acc: AccountRef, seen: Set<string>): number => {
    const known = depth.get(acc.id);
    if (known) return known;
    const parent = acc.parentId ? byId.get(acc.parentId) : undefined;
    const d = parent && !seen.has(parent.id) ? walk(parent, new Set(seen).add(acc.id)) + 1 : 1;
    depth.set(acc.id, d);
    return d;
  };
  accounts.forEach((x) => walk(x, new Set()));
  return depth;
}

/** Tree order: sort by code as text (codes are hierarchical by prefix, so parents precede children). */
export const byCode = <T extends { code: string }>(x: readonly T[]): T[] => [...x].sort((p, q) => (p.code < q.code ? -1 : p.code > q.code ? 1 : 0));

/**
 * Trial balance with group accounts rolled up from their descendants. `level` limits the depth shown
 * (1 = top groups only); totals always come from the postable accounts so they never double count.
 */
export function buildTrialBalance(accounts: readonly AccountRef[], sums: readonly AccountSums[], opts: { level?: number; withZero?: boolean } = {}): TrialBalance {
  const depth = depthMap(accounts);
  const own = new Map<string, { opening: Halalas; debit: Halalas; credit: Halalas }>();
  for (const s of sums) own.set(s.accountId, { opening: s.openDebit - s.openCredit, debit: s.debit, credit: s.credit });
  const byId = new Map(accounts.map((x) => [x.id, x]));
  // roll postable movement up the tree
  const rolled = new Map<string, { opening: Halalas; debit: Halalas; credit: Halalas }>();
  for (const [accountId, v] of own) {
    let cur: AccountRef | undefined = byId.get(accountId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const r = rolled.get(cur.id) ?? { opening: 0, debit: 0, credit: 0 };
      r.opening += v.opening; r.debit += v.debit; r.credit += v.credit;
      rolled.set(cur.id, r);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  const rows: TrialRow[] = [];
  for (const acc of byCode(accounts)) {
    const d = depth.get(acc.id) ?? 1;
    if (opts.level && d > opts.level) continue;
    const v = rolled.get(acc.id) ?? { opening: 0, debit: 0, credit: 0 };
    const closing = v.opening + v.debit - v.credit;
    if (!opts.withZero && v.opening === 0 && v.debit === 0 && v.credit === 0) continue;
    rows.push({ accountId: acc.id, code: acc.code, nameAr: acc.nameAr, nameEn: acc.nameEn, type: acc.type, isGroup: acc.isGroup, depth: d, opening: v.opening, debit: v.debit, credit: v.credit, closing });
  }
  const t = { openingDebit: 0, openingCredit: 0, debit: 0, credit: 0, closingDebit: 0, closingCredit: 0 };
  for (const [, v] of own) {
    if (v.opening > 0) t.openingDebit += v.opening; else t.openingCredit -= v.opening;
    t.debit += v.debit; t.credit += v.credit;
    const c = v.opening + v.debit - v.credit;
    if (c > 0) t.closingDebit += c; else t.closingCredit -= c;
  }
  // per-account closing split above can differ from the aggregate only by presentation; balance is on net
  const net = [...own.values()].reduce((s, v) => s + v.opening + v.debit - v.credit, 0);
  return { rows, totals: t, balanced: net === 0 && t.debit === t.credit };
}

// ─────────────────────────────── account statement ───────────────────────────────

export interface LedgerLine {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  memo: string | null;
  debit: Halalas;
  credit: Halalas;
  [k: string]: unknown;
}

/** Statement of one account: running balance on the account's natural side, from the opening balance. */
export function withRunningBalance<T extends { debit: Halalas; credit: Halalas }>(type: AccountType, openingNetDebit: Halalas, lines: readonly T[]): { opening: Halalas; rows: (T & { balance: Halalas })[]; totalDebit: Halalas; totalCredit: Halalas; closing: Halalas } {
  let net = openingNetDebit;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = lines.map((l) => {
    net += l.debit - l.credit;
    totalDebit += l.debit;
    totalCredit += l.credit;
    return { ...l, balance: naturalBalance(type, net) };
  });
  return { opening: naturalBalance(type, openingNetDebit), rows, totalDebit, totalCredit, closing: naturalBalance(type, net) };
}

// ─────────────────────────────── income statement ───────────────────────────────

/** Movement of one account for one reporting column (`dim` = month / project / department key; '' = whole period). */
export interface DimSums { accountId: string; dim: string; debit: Halalas; credit: Halalas }

export type IncomeSection = 'revenue' | 'cost_of_sales' | 'operating_expenses' | 'other_income';
export const INCOME_SECTIONS: { key: IncomeSection; ar: string; en: string }[] = [
  { key: 'revenue', ar: 'الإيرادات', en: 'Revenue' },
  { key: 'cost_of_sales', ar: 'تكلفة المبيعات', en: 'Cost of sales' },
  { key: 'operating_expenses', ar: 'المصروفات التشغيلية', en: 'Operating expenses' },
  { key: 'other_income', ar: 'إيرادات أخرى', en: 'Other income' },
];

/** Section of an income/expense account by chart code: 41xx revenue, other income elsewhere in 4xxx, 5xxx cost of sales, rest operating. */
export function incomeSection(acc: Pick<AccountRef, 'code' | 'type'>): IncomeSection | null {
  if (acc.type === 'income') return acc.code.startsWith('41') ? 'revenue' : 'other_income';
  if (acc.type === 'expense') return acc.code.startsWith('5') ? 'cost_of_sales' : 'operating_expenses';
  return null;
}

export interface StatementRow { accountId: string; code: string; nameAr: string; nameEn: string | null; values: Record<string, Halalas>; total: Halalas }
export interface IncomeStatement {
  columns: string[];
  sections: { key: IncomeSection; ar: string; en: string; rows: StatementRow[]; values: Record<string, Halalas>; total: Halalas }[];
  grossProfit: { values: Record<string, Halalas>; total: Halalas };
  operatingProfit: { values: Record<string, Halalas>; total: Halalas };
  netProfit: { values: Record<string, Halalas>; total: Halalas };
}

/** Income statement (قائمة الدخل): revenue − cost of sales = gross profit; − operating expenses = operating profit; + other income = net profit. */
export function buildIncomeStatement(accounts: readonly AccountRef[], sums: readonly DimSums[]): IncomeStatement {
  const byId = new Map(accounts.map((x) => [x.id, x]));
  const columns = [...new Set(sums.map((s) => s.dim).filter((d) => d !== ''))].sort();
  const rowsBySection = new Map<IncomeSection, Map<string, StatementRow>>(INCOME_SECTIONS.map((s) => [s.key, new Map()]));
  for (const s of sums) {
    const acc = byId.get(s.accountId);
    const sec = acc && !acc.isGroup ? incomeSection(acc) : null;
    if (!acc || !sec) continue;
    const net = acc.type === 'income' ? s.credit - s.debit : s.debit - s.credit; // natural side → positive = normal
    const rows = rowsBySection.get(sec)!;
    const row = rows.get(acc.id) ?? { accountId: acc.id, code: acc.code, nameAr: acc.nameAr, nameEn: acc.nameEn, values: {}, total: 0 };
    row.values[s.dim] = (row.values[s.dim] ?? 0) + net;
    if (s.dim !== '') row.total += net;
    rows.set(acc.id, row);
  }
  // when no dimension is requested every sum has dim '' — make that the single "total" column
  const dimLess = columns.length === 0;
  const sections = INCOME_SECTIONS.map((def) => {
    const rows = byCode([...rowsBySection.get(def.key)!.values()]);
    if (dimLess) rows.forEach((r) => { r.total = r.values[''] ?? 0; });
    const values: Record<string, Halalas> = {};
    for (const r of rows) for (const [k, v] of Object.entries(r.values)) if (k !== '') values[k] = (values[k] ?? 0) + v;
    const total = rows.reduce((t, r) => t + r.total, 0);
    return { ...def, rows, values, total };
  });
  const sec = (k: IncomeSection) => sections.find((s) => s.key === k)!;
  const combine = (parts: { sec: IncomeSection; sign: 1 | -1 }[]) => {
    const values: Record<string, Halalas> = {};
    let total = 0;
    for (const p of parts) {
      const s = sec(p.sec);
      for (const c of columns) values[c] = (values[c] ?? 0) + p.sign * (s.values[c] ?? 0);
      total += p.sign * s.total;
    }
    return { values, total };
  };
  return {
    columns,
    sections,
    grossProfit: combine([{ sec: 'revenue', sign: 1 }, { sec: 'cost_of_sales', sign: -1 }]),
    operatingProfit: combine([{ sec: 'revenue', sign: 1 }, { sec: 'cost_of_sales', sign: -1 }, { sec: 'operating_expenses', sign: -1 }]),
    netProfit: combine([{ sec: 'revenue', sign: 1 }, { sec: 'cost_of_sales', sign: -1 }, { sec: 'operating_expenses', sign: -1 }, { sec: 'other_income', sign: 1 }]),
  };
}

// ─────────────────────────────── balance sheet ───────────────────────────────

export interface BalanceRow { accountId: string | null; code: string; nameAr: string; nameEn: string | null; amount: Halalas; depth: number; isGroup: boolean }
export interface BalanceSheet {
  assets: { rows: BalanceRow[]; total: Halalas };
  liabilities: { rows: BalanceRow[]; total: Halalas };
  equity: { rows: BalanceRow[]; total: Halalas };
  /** income − expense from the beginning through the date, split into the current fiscal year and earlier years not yet closed */
  currentYearProfit: Halalas;
  priorYearsProfit: Halalas;
  liabilitiesAndEquity: Halalas;
  balanced: boolean;
}

/**
 * Balance sheet at a date. `cumulative` holds each account's net debit from the start of the books;
 * `currentYear` holds only the fiscal year containing the date (income/expense accounts matter).
 * Open income/expense balances roll into equity as profit, so the sheet balances before and after
 * the year-end close.
 */
export function buildBalanceSheet(accounts: readonly AccountRef[], cumulative: ReadonlyMap<string, Halalas>, currentYear: ReadonlyMap<string, Halalas>): BalanceSheet {
  const depth = depthMap(accounts);
  const byId = new Map(accounts.map((x) => [x.id, x]));
  const rolled = new Map<string, Halalas>();
  for (const [accountId, v] of cumulative) {
    let cur = byId.get(accountId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      rolled.set(cur.id, (rolled.get(cur.id) ?? 0) + v);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  const section = (type: AccountType): { rows: BalanceRow[]; total: Halalas } => {
    const rows: BalanceRow[] = [];
    let total = 0;
    for (const acc of byCode(accounts.filter((x) => x.type === type))) {
      const net = rolled.get(acc.id) ?? 0;
      if (net === 0) continue;
      rows.push({ accountId: acc.id, code: acc.code, nameAr: acc.nameAr, nameEn: acc.nameEn, amount: naturalBalance(type, net), depth: depth.get(acc.id) ?? 1, isGroup: acc.isGroup });
      if (!acc.isGroup) total += naturalBalance(type, net);
    }
    return { rows, total };
  };
  const profitOf = (m: ReadonlyMap<string, Halalas>) => {
    let p = 0;
    for (const [accountId, net] of m) {
      const acc = byId.get(accountId);
      if (acc && !acc.isGroup && (acc.type === 'income' || acc.type === 'expense')) p -= net; // credit-heavy = profit
    }
    return p;
  };
  const totalProfit = profitOf(cumulative);
  const currentYearProfit = profitOf(currentYear);
  const priorYearsProfit = totalProfit - currentYearProfit;
  const assets = section('asset');
  const liabilities = section('liability');
  const equity = section('equity');
  const liabilitiesAndEquity = liabilities.total + equity.total + totalProfit;
  return { assets, liabilities, equity, currentYearProfit, priorYearsProfit, liabilitiesAndEquity, balanced: assets.total === liabilitiesAndEquity };
}
