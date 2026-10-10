import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { amount, audit, id, tenantId } from './_common.js';

export interface AllowanceRow { label: string; amount: string }

/**
 * HR — job offers (عرض وظيفي) and the employee register. Salaries are visible only with hr.read.
 * Payroll itself stays out of Core (Frappe HR later); these are the master records and the offer
 * letter. An offer is a draft until someone with hr.approve issues it (company stamp); the
 * candidate's answer is recorded, and an accepted offer becomes an employee in one step.
 */
export const jobOffer = pgTable('job_offer', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  offerDate: date('offer_date').notNull(),
  validUntil: date('valid_until').notNull(),
  candidateNameAr: text('candidate_name_ar').notNull(),
  candidateNameEn: text('candidate_name_en'),
  nationality: text('nationality'),
  /** national_id | iqama | passport */
  idType: text('id_type'),
  idNumber: text('id_number'),
  mobile: text('mobile'),
  email: text('email'),
  jobTitleAr: text('job_title_ar').notNull(),
  jobTitleEn: text('job_title_en'),
  department: text('department'),
  reportsTo: text('reports_to'),
  workLocation: text('work_location'),
  /** unlimited | fixed */
  contractType: text('contract_type').notNull().default('unlimited'),
  durationMonths: integer('duration_months'),
  /** full_time | part_time | temporary */
  employmentType: text('employment_type').notNull().default('full_time'),
  startDate: date('start_date').notNull(),
  probationDays: integer('probation_days').notNull().default(90),
  weeklyHours: integer('weekly_hours').notNull().default(48),
  workDays: text('work_days'),
  annualLeaveDays: integer('annual_leave_days').notNull().default(21),
  noticeDays: integer('notice_days'),
  basicSalary: amount('basic_salary').notNull(),
  housingAllowance: amount('housing_allowance').notNull().default('0'),
  transportAllowance: amount('transport_allowance').notNull().default('0'),
  otherAllowances: jsonb('other_allowances').$type<AllowanceRow[]>().notNull().default([]),
  /** none | employee | family */
  medicalInsurance: text('medical_insurance').notNull().default('employee'),
  /** none | employee | family — yearly return ticket */
  annualTicket: text('annual_ticket').notNull().default('none'),
  otherBenefits: text('other_benefits'),
  /** extra conditions printed on the letter */
  termsAr: text('terms_ar'),
  /** internal, never printed */
  notes: text('notes'),
  /** draft → approved (issued) → accepted / rejected; cancelled. "expired" is derived from valid_until. */
  status: text('status').notNull().default('draft'),
  approvedBy: uuid('approved_by'),
  approvedByName: text('approved_by_name'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  respondedAt: date('responded_at'),
  responseNote: text('response_note'),
  cancelledBy: uuid('cancelled_by'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  /** set when the accepted offer was turned into an employee */
  employeeId: uuid('employee_id'),
  ...audit,
}, (t) => [
  uniqueIndex('job_offer_number_uq').on(t.tenantId, t.number),
  index('job_offer_status_idx').on(t.tenantId, t.status, t.offerDate),
]);

export const employee = pgTable('employee', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  nationality: text('nationality'),
  idType: text('id_type'),
  idNumber: text('id_number'),
  idExpiry: date('id_expiry'),
  birthDate: date('birth_date'),
  /** male | female */
  gender: text('gender'),
  mobile: text('mobile'),
  email: text('email'),
  jobTitleAr: text('job_title_ar').notNull(),
  jobTitleEn: text('job_title_en'),
  department: text('department'),
  /** direct manager (another employee) */
  managerId: uuid('manager_id'),
  /** the system login of this employee, when they have one */
  userId: uuid('user_id'),
  workLocation: text('work_location'),
  hireDate: date('hire_date').notNull(),
  contractType: text('contract_type').notNull().default('unlimited'),
  contractEndDate: date('contract_end_date'),
  employmentType: text('employment_type').notNull().default('full_time'),
  probationEndDate: date('probation_end_date'),
  annualLeaveDays: integer('annual_leave_days').notNull().default(21),
  basicSalary: amount('basic_salary').notNull().default('0'),
  housingAllowance: amount('housing_allowance').notNull().default('0'),
  transportAllowance: amount('transport_allowance').notNull().default('0'),
  otherAllowances: jsonb('other_allowances').$type<AllowanceRow[]>().notNull().default([]),
  bankName: text('bank_name'),
  iban: text('iban'),
  gosiNumber: text('gosi_number'),
  /** employee GOSI share in percent of basic + housing (Saudis 9.75 by default, others 0) */
  gosiEmployeePercent: numeric('gosi_employee_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  /** active | suspended | terminated */
  status: text('status').notNull().default('active'),
  terminationDate: date('termination_date'),
  terminationReason: text('termination_reason'),
  offerId: uuid('offer_id'),
  notes: text('notes'),
  ...audit,
}, (t) => [
  uniqueIndex('employee_number_uq').on(t.tenantId, t.number),
  uniqueIndex('employee_id_number_uq').on(t.tenantId, t.idNumber).where(sql`${t.idNumber} is not null`),
  index('employee_status_idx').on(t.tenantId, t.status),
]);

/**
 * Leave: annual / emergency (paid, from the annual balance), sick (Art. 117 tiers), unpaid.
 * An employee requests it (pending → approved / rejected by their manager or hr.approve), or HR
 * enters it directly for the employee (approved at once). Leave inside an approved payroll month
 * can no longer be cancelled.
 */
export const leaveRequest = pgTable('leave_request', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  employeeId: uuid('employee_id').notNull().references(() => employee.id),
  /** annual | emergency | sick | unpaid */
  type: text('type').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  days: integer('days').notNull(),
  reason: text('reason'),
  /** medical report etc. (stored file) */
  attachmentFileId: uuid('attachment_file_id'),
  /** employee (self-service request) | hr (entered by HR / the manager) */
  source: text('source').notNull().default('employee'),
  /** pending → approved / rejected; cancelled */
  status: text('status').notNull().default('pending'),
  decidedBy: uuid('decided_by'),
  decidedByName: text('decided_by_name'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  ...audit,
}, (t) => [
  uniqueIndex('leave_request_number_uq').on(t.tenantId, t.number),
  index('leave_request_employee_idx').on(t.tenantId, t.employeeId, t.startDate),
  index('leave_request_status_idx').on(t.tenantId, t.status),
]);

/** Bonus (مكافأة) or deduction (خصم) for one payroll month; locked once that month's payroll is approved. */
export const payAdjustment = pgTable('pay_adjustment', {
  id: id(),
  tenantId: tenantId(),
  employeeId: uuid('employee_id').notNull().references(() => employee.id),
  /** YYYY-MM */
  month: text('month').notNull(),
  /** bonus | deduction */
  kind: text('kind').notNull(),
  amount: amount('amount').notNull(),
  reason: text('reason').notNull(),
  /** payroll (added to / taken from the month's salary) | voucher (a bonus paid at once by a payment voucher, left out of payroll) */
  payMethod: text('pay_method').notNull().default('payroll'),
  voucherId: uuid('voucher_id'),
  /** deductions only — where the ledger credits it: advance (سلفة, employee advances) | penalty | other (both other income) */
  category: text('category').notNull().default('other'),
  ...audit,
}, (t) => [index('pay_adjustment_employee_month_idx').on(t.tenantId, t.employeeId, t.month)]);

/** Monthly payroll (مسير الرواتب): draft (recalculable) → approved (locks the month) → paid. */
export const payrollRun = pgTable('payroll_run', {
  id: id(),
  tenantId: tenantId(),
  /** YYYY-MM */
  month: text('month').notNull(),
  status: text('status').notNull().default('draft'),
  employeeCount: integer('employee_count').notNull().default(0),
  gross: amount('gross').notNull().default('0'),
  totalDeductions: amount('total_deductions').notNull().default('0'),
  net: amount('net').notNull().default('0'),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
  approvedByName: text('approved_by_name'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  paidAt: date('paid_at'),
  paidRef: text('paid_ref'),
  notes: text('notes'),
  ...audit,
}, (t) => [uniqueIndex('payroll_run_month_uq').on(t.tenantId, t.month)]);

export const payrollLine = pgTable('payroll_line', {
  id: id(),
  tenantId: tenantId(),
  runId: uuid('run_id').notNull().references(() => payrollRun.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employee.id),
  employeeNumber: text('employee_number').notNull(),
  nameAr: text('name_ar').notNull(),
  jobTitleAr: text('job_title_ar'),
  department: text('department'),
  iban: text('iban'),
  bankName: text('bank_name'),
  workedDays: integer('worked_days').notNull(),
  basic: amount('basic').notNull(),
  housing: amount('housing').notNull(),
  transport: amount('transport').notNull(),
  other: amount('other').notNull(),
  bonuses: amount('bonuses').notNull(),
  gross: amount('gross').notNull(),
  unpaidLeave: amount('unpaid_leave').notNull(),
  sickDeduction: amount('sick_deduction').notNull(),
  deductions: amount('deductions').notNull(),
  gosi: amount('gosi').notNull(),
  totalDeductions: amount('total_deductions').notNull(),
  net: amount('net').notNull(),
  /** leave days by type, sick bands, adjustment reasons, warnings */
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  uniqueIndex('payroll_line_run_employee_uq').on(t.runId, t.employeeId),
]);
