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
