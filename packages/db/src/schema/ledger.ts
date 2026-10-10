import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { amount, audit, id, tenantId } from './_common.js';
import { employee } from './hr.js';
import { project } from './ops.js';
import { party } from './parties.js';

/**
 * General ledger (Phase 6, docs/erp-plan/phase-6-accounting-implementation.md). Posted journal
 * entries are immutable — a trigger (migration 0032) refuses UPDATE/DELETE of posted rows; a
 * mistake is corrected by a reversing entry. Amounts are NUMERIC(18,2), computed in halalas.
 */

/** Chart of accounts. Group accounts (is_group) only structure the tree and take no lines. */
export const account = pgTable('account', {
  id: id(),
  tenantId: tenantId(),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  /** asset | liability | equity | income | expense */
  type: text('type').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => account.id),
  isGroup: boolean('is_group').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  /** the role auto-posting resolves to this account (e.g. 'ar', 'bank'); unique per tenant */
  postingKey: text('posting_key'),
  requiresParty: boolean('requires_party').notNull().default(false),
  description: text('description'),
  ...audit,
}, (t) => [
  uniqueIndex('account_code_uq').on(t.tenantId, t.code),
  uniqueIndex('account_posting_key_uq').on(t.tenantId, t.postingKey).where(sql`${t.postingKey} is not null`),
  index('account_parent_idx').on(t.tenantId, t.parentId),
]);

/** One row per tenant: fiscal calendar, period lock and the defaults auto-posting reads. */
export const ledgerSettings = pgTable('ledger_settings', {
  id: id(),
  tenantId: tenantId(),
  /** 1–12; the fiscal year starts on the 1st of this month */
  fiscalYearStartMonth: integer('fiscal_year_start_month').notNull().default(1),
  /** first day the books are kept in Core; opening balances are dated this day */
  goLiveDate: date('go_live_date'),
  /** entries dated on or before this day can no longer be posted, changed or reversed into */
  lockedThrough: date('locked_through'),
  /** wip | expense — where materials issued to a project go (decision D4) */
  wipPolicy: text('wip_policy').notNull().default('wip'),
  employerGosiSaudiPct: amount('employer_gosi_saudi_pct').notNull().default('11.75'),
  employerGosiOtherPct: amount('employer_gosi_other_pct').notNull().default('2.00'),
  defaultCashAccountId: uuid('default_cash_account_id').references(() => account.id),
  defaultBankAccountId: uuid('default_bank_account_id').references(() => account.id),
  /** payment method → account id (cash, cheque, bank_transfer, mada, credit_card, apple_pay, stc_pay, payment_link, card, other) */
  methodAccounts: jsonb('method_accounts').$type<Record<string, string>>().notNull().default({}),
  /** monthly | quarterly */
  vatReturnFrequency: text('vat_return_frequency').notNull().default('quarterly'),
  ...audit,
}, (t) => [uniqueIndex('ledger_settings_tenant_uq').on(t.tenantId)]);

export const journalEntry = pgTable('journal_entry', {
  id: id(),
  tenantId: tenantId(),
  /** JV-000123, from the `journal_entry` series — assigned when the entry is created, never reused */
  number: text('number').notNull(),
  entryDate: date('entry_date').notNull(),
  /** YYYY-MM of entry_date */
  period: text('period').notNull(),
  memo: text('memo'),
  /** manual | auto | opening | reversal | closing | adjustment */
  kind: text('kind').notNull().default('manual'),
  /** set by auto-posting (invoice, payment, voucher, bill, stock_move, payroll …); null for manual entries */
  sourceType: text('source_type'),
  sourceId: uuid('source_id'),
  /** human document number of the source, e.g. MMC-INV-00012 */
  sourceRef: text('source_ref'),
  /** post | cancel | delta:<n> … — with the source, makes auto-posting idempotent */
  sourceEvent: text('source_event'),
  /** draft | posted */
  status: text('status').notNull().default('draft'),
  reversesId: uuid('reverses_id').references((): AnyPgColumn => journalEntry.id),
  reversedById: uuid('reversed_by_id').references((): AnyPgColumn => journalEntry.id),
  total: amount('total').notNull().default('0'),
  postedBy: uuid('posted_by'),
  postedByName: text('posted_by_name'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  /** ids of attached files (invoice scans, contracts …) */
  attachments: jsonb('attachments').$type<string[]>().notNull().default([]),
  ...audit,
}, (t) => [
  uniqueIndex('journal_entry_number_uq').on(t.tenantId, t.number),
  uniqueIndex('journal_entry_source_uq').on(t.tenantId, t.sourceType, t.sourceId, t.sourceEvent).where(sql`${t.sourceType} is not null`),
  index('journal_entry_date_idx').on(t.tenantId, t.entryDate),
  index('journal_entry_status_idx').on(t.tenantId, t.status, t.entryDate),
  index('journal_entry_reverses_idx').on(t.reversesId),
]);

export const journalLine = pgTable('journal_line', {
  id: id(),
  tenantId: tenantId(),
  entryId: uuid('entry_id').notNull().references(() => journalEntry.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  accountId: uuid('account_id').notNull().references(() => account.id),
  /** copy of journal_entry.entry_date so account reports need no join to filter by date */
  entryDate: date('entry_date').notNull(),
  debit: amount('debit').notNull().default('0'),
  credit: amount('credit').notNull().default('0'),
  partyId: uuid('party_id').references(() => party.id),
  employeeId: uuid('employee_id').references(() => employee.id),
  projectId: uuid('project_id').references(() => project.id),
  /** department / cost centre */
  costCenter: text('cost_center'),
  /** S | Z | E | O | X | IM | RC — VAT return classification (Phase 6C) */
  vatCode: text('vat_code'),
  /** taxable base the VAT on this line relates to */
  vatBase: amount('vat_base'),
  memo: text('memo'),
}, (t) => [
  index('journal_line_entry_idx').on(t.entryId, t.lineNo),
  index('journal_line_account_idx').on(t.tenantId, t.accountId, t.entryDate),
  index('journal_line_party_idx').on(t.tenantId, t.partyId, t.entryDate),
  index('journal_line_project_idx').on(t.tenantId, t.projectId),
  check('journal_line_one_side', sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND (${t.debit} = 0 OR ${t.credit} = 0) AND (${t.debit} + ${t.credit}) > 0`),
]);

/**
 * Auto-posting bookkeeping per source record (spec §5): a hash of the amounts that were posted
 * (so a later in-place change is flagged instead of silently re-posted), supplier-payment ids
 * already posted, and the last error. Idempotency itself comes from journal_entry_source_uq.
 */
export const glSourceState = pgTable('gl_source_state', {
  id: id(),
  tenantId: tenantId(),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  postedHash: text('posted_hash'),
  postedPaymentIds: jsonb('posted_payment_ids').$type<string[]>().notNull().default([]),
  lastPostedAt: timestamp('last_posted_at', { withTimezone: true }),
  error: text('error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('gl_source_state_uq').on(t.tenantId, t.sourceType, t.sourceId)]);

// ─────────────────────────────── Phase 6C ───────────────────────────────

/** A closed (or open) fiscal year; closing posts one `closing` entry that moves income/expense into retained earnings. */
export const fiscalYear = pgTable('fiscal_year', {
  id: id(),
  tenantId: tenantId(),
  /** "2026" or "2026/2027" */
  label: text('label').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  /** open | closed */
  status: text('status').notNull().default('open'),
  closingEntryId: uuid('closing_entry_id').references(() => journalEntry.id),
  closedBy: uuid('closed_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex('fiscal_year_label_uq').on(t.tenantId, t.label)]);

/** One VAT return: the boxes are a snapshot of the ledger when it was prepared; filing posts the settlement entry. */
export const vatReturn = pgTable('vat_return', {
  id: id(),
  tenantId: tenantId(),
  /** 2026-Q1 / 2026-03 */
  label: text('label').notNull(),
  periodFrom: date('period_from').notNull(),
  periodTo: date('period_to').notNull(),
  boxes: jsonb('boxes').$type<Record<string, unknown>>().notNull().default({}),
  outputVat: amount('output_vat').notNull().default('0'),
  inputVat: amount('input_vat').notNull().default('0'),
  netVat: amount('net_vat').notNull().default('0'),
  /** output − input movement on the VAT accounts in the period (excluding settlements) when the return was prepared */
  ledgerNet: amount('ledger_net').notNull().default('0'),
  /** draft | filed */
  status: text('status').notNull().default('draft'),
  filedOn: date('filed_on'),
  filedBy: uuid('filed_by'),
  settlementEntryId: uuid('settlement_entry_id').references(() => journalEntry.id),
  notes: text('notes'),
  ...audit,
}, (t) => [uniqueIndex('vat_return_period_uq').on(t.tenantId, t.periodFrom, t.periodTo)]);

/** A bank statement for one GL bank account; lines are matched to ledger lines of that account. */
export const bankStatement = pgTable('bank_statement', {
  id: id(),
  tenantId: tenantId(),
  accountId: uuid('account_id').notNull().references(() => account.id),
  reference: text('reference'),
  dateFrom: date('date_from').notNull(),
  dateTo: date('date_to').notNull(),
  openingBalance: amount('opening_balance').notNull().default('0'),
  closingBalance: amount('closing_balance').notNull().default('0'),
  /** open | reconciled */
  status: text('status').notNull().default('open'),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  reconciledBy: uuid('reconciled_by'),
  notes: text('notes'),
  ...audit,
}, (t) => [index('bank_statement_account_idx').on(t.tenantId, t.accountId, t.dateTo)]);

/** debit = money into the bank (a debit to the GL bank account), credit = money out. */
export const bankStatementLine = pgTable('bank_statement_line', {
  id: id(),
  tenantId: tenantId(),
  statementId: uuid('statement_id').notNull().references(() => bankStatement.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  date: date('date').notNull(),
  description: text('description'),
  ref: text('ref'),
  debit: amount('debit').notNull().default('0'),
  credit: amount('credit').notNull().default('0'),
  matchedLineId: uuid('matched_line_id').references(() => journalLine.id),
  /** auto | manual */
  matchedBy: text('matched_by'),
  matchedAt: timestamp('matched_at', { withTimezone: true }),
}, (t) => [
  index('bank_statement_line_stmt_idx').on(t.statementId, t.lineNo),
  uniqueIndex('bank_statement_line_match_uq').on(t.tenantId, t.matchedLineId).where(sql`${t.matchedLineId} is not null`),
  check('bank_statement_line_side', sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND (${t.debit} = 0 OR ${t.credit} = 0)`),
]);

/** Fixed-asset register (decision D8: straight line, monthly). The acquisition itself is booked by a bill or a journal entry. */
export const fixedAsset = pgTable('fixed_asset', {
  id: id(),
  tenantId: tenantId(),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  /** cost account, accumulated-depreciation account, depreciation-expense account */
  accountId: uuid('account_id').notNull().references(() => account.id),
  accumAccountId: uuid('accum_account_id').notNull().references(() => account.id),
  expenseAccountId: uuid('expense_account_id').notNull().references(() => account.id),
  acquiredOn: date('acquired_on').notNull(),
  /** YYYY-MM — first month depreciated */
  startMonth: text('start_month').notNull(),
  cost: amount('cost').notNull(),
  salvage: amount('salvage').notNull().default('0'),
  lifeMonths: integer('life_months').notNull(),
  /** accumulated depreciation already in the opening balances */
  openingAccumulated: amount('opening_accumulated').notNull().default('0'),
  /** active | disposed */
  status: text('status').notNull().default('active'),
  disposedOn: date('disposed_on'),
  disposalProceeds: amount('disposal_proceeds'),
  disposalEntryId: uuid('disposal_entry_id').references(() => journalEntry.id),
  sourceBillId: uuid('source_bill_id'),
  projectId: uuid('project_id').references(() => project.id),
  costCenter: text('cost_center'),
  notes: text('notes'),
  ...audit,
}, (t) => [uniqueIndex('fixed_asset_code_uq').on(t.tenantId, t.code), index('fixed_asset_status_idx').on(t.tenantId, t.status)]);

/** One monthly accrual run (depreciation / EOSB provision); its entry has source_type = kind, source_id = this row. */
export const glRun = pgTable('gl_run', {
  id: id(),
  tenantId: tenantId(),
  /** depreciation | eosb */
  kind: text('kind').notNull(),
  /** YYYY-MM */
  period: text('period').notNull(),
  seq: integer('seq').notNull().default(1),
  entryId: uuid('entry_id').references(() => journalEntry.id),
  total: amount('total').notNull().default('0'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('gl_run_uq').on(t.tenantId, t.kind, t.period, t.seq)]);

/** What each depreciation run charged each asset (the register's accumulated depreciation = opening + Σ these). */
export const fixedAssetDep = pgTable('fixed_asset_dep', {
  id: id(),
  tenantId: tenantId(),
  assetId: uuid('asset_id').notNull().references(() => fixedAsset.id),
  runId: uuid('run_id').notNull().references(() => glRun.id),
  month: text('month').notNull(),
  amount: amount('amount').notNull(),
}, (t) => [index('fixed_asset_dep_asset_idx').on(t.assetId), index('fixed_asset_dep_run_idx').on(t.runId)]);
