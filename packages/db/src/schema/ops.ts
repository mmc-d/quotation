import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, audit, id, qty, tenantId } from './_common.js';
import { appUser, branch, file } from './platform.js';
import { party, site } from './parties.js';
import { product } from './catalog.js';
import { contract } from './sales.js';

/**
 * Phase 4 — projects & field operations (modules 05/06). One location tree per site and one asset
 * tree; projects, work orders and tickets all point at them (module 06 §4).
 */

/** Building → floor → unit/apartment → room/riser/rack under a customer site (FSM-01). */
export const siteLocation = pgTable('site_location', {
  id: id(),
  tenantId: tenantId(),
  siteId: uuid('site_id').notNull().references(() => site.id),
  parentId: uuid('parent_id'),
  /** building | floor | unit | room | riser | rack | gate | other */
  kind: text('kind').notNull().default('unit'),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
  archivedAt: archivedAt(),
  ...audit,
}, (t) => [index('site_location_site_idx').on(t.tenantId, t.siteId), index('site_location_parent_idx').on(t.tenantId, t.parentId)]);

/** A tracked project created from a signed contract (PRJ-01). */
export const project = pgTable('project', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  name: text('name').notNull(),
  contractId: uuid('contract_id').references(() => contract.id),
  partyId: uuid('party_id').references(() => party.id),
  siteId: uuid('site_id').references(() => site.id),
  /** villa_intercom | building_intercom | smart_home | smart_locks | iot | other (PRJ-02) */
  templateKey: text('template_key').notNull().default('villa_intercom'),
  /** kickoff | procurement | delivery | installation | commissioning | handover | warranty | closed */
  stage: text('stage').notNull().default('kickoff'),
  /** active | on_hold | closed | cancelled */
  status: text('status').notNull().default('active'),
  managerId: uuid('manager_id').references(() => appUser.id),
  ownerId: uuid('owner_id').references(() => appUser.id),
  teamId: uuid('team_id'),
  branchId: uuid('branch_id').references(() => branch.id),
  /** approval kinds that gate kick-off; [] waives them */
  requiredApprovals: jsonb('required_approvals').$type<string[]>().notNull().default(['specs', 'door_directions', 'room_numbers', 'design']),
  materialsReady: boolean('materials_ready').notNull().default(false),
  /** delivery clock (PRJ-04): working-day window, extensions from change orders / documented delays */
  clockMinDays: integer('clock_min_days').notNull().default(45),
  clockMaxDays: integer('clock_max_days').notNull().default(60),
  clockExtensionDays: integer('clock_extension_days').notNull().default(0),
  clockStartedOn: date('clock_started_on'),
  /** date the handover stage was reached (clock stops) */
  deliveredOn: date('delivered_on'),
  /** client acceptance = warranty start (PRJ-32) */
  acceptedOn: date('accepted_on'),
  acceptedByName: text('accepted_by_name'),
  acceptanceFileId: uuid('acceptance_file_id').references(() => file.id),
  warrantyLabourMonths: integer('warranty_labour_months').notNull().default(12),
  warrantyPartsMonths: integer('warranty_parts_months').notNull().default(24),
  plannedStart: date('planned_start'),
  notes: text('notes'),
  ...audit,
}, (t) => [
  uniqueIndex('project_number_uq').on(t.tenantId, t.number),
  uniqueIndex('project_contract_uq').on(t.tenantId, t.contractId),
  index('project_stage_idx').on(t.tenantId, t.stage),
]);

/** Logged stage moves, including gate overrides (who, why). */
export const projectStageLog = pgTable('project_stage_log', {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  fromStage: text('from_stage').notNull(),
  toStage: text('to_stage').notNull(),
  /** failed gate checks at the time of an override (empty for a normal move) */
  overriddenChecks: jsonb('overridden_checks').$type<string[]>().notNull().default([]),
  reason: text('reason'),
  by: uuid('by').references(() => appUser.id),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('project_stage_log_idx').on(t.tenantId, t.projectId)]);

/** Delivery-clock pauses (client / consultant delays) — evidence for every stopped day. */
export const projectClockPause = pgTable('project_clock_pause', {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date'),
  /** client_delay | consultant_delay | site_not_ready | other */
  kind: text('kind').notNull().default('client_delay'),
  reason: text('reason').notNull(),
  ...audit,
}, (t) => [index('project_clock_pause_idx').on(t.tenantId, t.projectId)]);

export const projectTask = pgTable('project_task', {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull(),
  title: text('title').notNull(),
  locationId: uuid('location_id').references(() => siteLocation.id),
  assigneeId: uuid('assignee_id').references(() => appUser.id),
  dueDate: date('due_date'),
  /** todo | doing | done */
  status: text('status').notNull().default('todo'),
  sort: integer('sort').notNull().default(0),
  doneAt: timestamp('done_at', { withTimezone: true }),
  ...audit,
}, (t) => [index('project_task_idx').on(t.tenantId, t.projectId)]);

/** Client approval packages (PRJ-20): versioned; approval locks the spec and can start the clock. */
export const projectApproval = pgTable('project_approval', {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  /** specs | door_directions | room_numbers | design | other */
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  revision: integer('revision').notNull().default(0),
  /** draft | sent | approved | rejected | superseded */
  status: text('status').notNull().default('draft'),
  notes: text('notes'),
  fileIds: jsonb('file_ids').$type<string[]>().notNull().default([]),
  approvedOn: date('approved_on'),
  approvedByName: text('approved_by_name'),
  rejectionReason: text('rejection_reason'),
  ...audit,
}, (t) => [index('project_approval_idx').on(t.tenantId, t.projectId, t.kind)]);

/** Punch / snag list (PRJ-24) — blocks handover until every item is verified. */
export const snag = pgTable('snag', {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').references(() => siteLocation.id),
  description: text('description').notNull(),
  photoFileIds: jsonb('photo_file_ids').$type<string[]>().notNull().default([]),
  assigneeId: uuid('assignee_id').references(() => appUser.id),
  dueDate: date('due_date'),
  /** open | fixed | verified */
  status: text('status').notNull().default('open'),
  fixedAt: timestamp('fixed_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedBy: uuid('verified_by').references(() => appUser.id),
  ...audit,
}, (t) => [index('snag_project_idx').on(t.tenantId, t.projectId)]);

/** Installed base (FSM-01..06): every device the company installs. */
export const installedAsset = pgTable('installed_asset', {
  id: id(),
  tenantId: tenantId(),
  siteId: uuid('site_id').references(() => site.id),
  partyId: uuid('party_id').references(() => party.id),
  locationId: uuid('location_id').references(() => siteLocation.id),
  projectId: uuid('project_id').references(() => project.id),
  /** door panel → lock → exit button (FSM-02) */
  parentAssetId: uuid('parent_asset_id'),
  productId: uuid('product_id').references(() => product.id),
  code: text('code').notNull(),
  description: text('description'),
  serial: text('serial'),
  mac: text('mac'),
  ip: text('ip'),
  firmware: text('firmware'),
  /** SIP extension, door direction, VLAN… (FSM-03) */
  attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
  installedOn: date('installed_on'),
  /** latest commissioning test result (PRJ-23): null = not tested */
  testPassed: boolean('test_passed'),
  testedOn: date('tested_on'),
  testResults: jsonb('test_results').$type<{ key: string; ok: boolean; note?: string }[]>().notNull().default([]),
  labourWarrantyEnd: date('labour_warranty_end'),
  partsWarrantyEnd: date('parts_warranty_end'),
  manufacturerWarrantyEnd: date('manufacturer_warranty_end'),
  /** active | replaced | removed */
  status: text('status').notNull().default('active'),
  /** work order that registered it */
  workOrderId: uuid('work_order_id'),
  ...audit,
}, (t) => [
  index('installed_asset_site_idx').on(t.tenantId, t.siteId),
  index('installed_asset_project_idx').on(t.tenantId, t.projectId),
  uniqueIndex('installed_asset_serial_uq').on(t.tenantId, t.code, t.serial),
]);

/** Helpdesk-lite (FSM-80..82): a service call from WhatsApp / phone / web. */
export const ticket = pgTable('ticket', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  /** whatsapp | phone | web | email | walk_in */
  channel: text('channel').notNull().default('phone'),
  partyId: uuid('party_id').references(() => party.id),
  siteId: uuid('site_id').references(() => site.id),
  locationId: uuid('location_id').references(() => siteLocation.id),
  assetId: uuid('asset_id').references(() => installedAsset.id),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  subject: text('subject').notNull(),
  description: text('description'),
  /** low | normal | high | urgent */
  priority: text('priority').notNull().default('normal'),
  /** open | in_progress | resolved | closed */
  status: text('status').notNull().default('open'),
  /** project | warranty | amc | chargeable — decided at creation, with reason (FSM-60) */
  coverage: text('coverage').notNull(),
  coverageReason: text('coverage_reason').notNull(),
  ownerId: uuid('owner_id').references(() => appUser.id),
  teamId: uuid('team_id'),
  branchId: uuid('branch_id').references(() => branch.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex('ticket_number_uq').on(t.tenantId, t.number), index('ticket_status_idx').on(t.tenantId, t.status)]);

/** Work orders (FSM-20..23, 40..47). */
export const workOrder = pgTable('work_order', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  /** survey | installation | commissioning | corrective | preventive | warranty | inspection */
  type: text('type').notNull(),
  /** new | scheduled | dispatched | en_route | on_site | awaiting_parts | completed | closed | cancelled */
  status: text('status').notNull().default('new'),
  title: text('title').notNull(),
  description: text('description'),
  projectId: uuid('project_id').references(() => project.id),
  ticketId: uuid('ticket_id').references(() => ticket.id),
  partyId: uuid('party_id').references(() => party.id),
  siteId: uuid('site_id').references(() => site.id),
  locationId: uuid('location_id').references(() => siteLocation.id),
  assetId: uuid('asset_id').references(() => installedAsset.id),
  coverage: text('coverage').notNull().default('project'),
  coverageReason: text('coverage_reason'),
  /** lead technician (scope "own" for technicians) + crew */
  technicianId: uuid('technician_id').references(() => appUser.id),
  crewIds: jsonb('crew_ids').$type<string[]>().notNull().default([]),
  scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
  scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
  checkInAt: timestamp('check_in_at', { withTimezone: true }),
  checkInLat: text('check_in_lat'),
  checkInLng: text('check_in_lng'),
  checkOutAt: timestamp('check_out_at', { withTimezone: true }),
  checklist: jsonb('checklist').$type<{ key: string; labelAr: string; labelEn: string; required: boolean; done?: boolean; value?: string | null }[]>().notNull().default([]),
  photoFileIds: jsonb('photo_file_ids').$type<string[]>().notNull().default([]),
  /** parts used from van stock — data only until Phase 5 posts stock moves (FSM-45) */
  partsUsed: jsonb('parts_used').$type<{ code: string; description?: string; qty: string; serial?: string | null }[]>().notNull().default([]),
  findings: text('findings'),
  signatureName: text('signature_name'),
  signatureFileId: uuid('signature_file_id').references(() => file.id),
  reportFileId: uuid('report_file_id').references(() => file.id),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ownerId: uuid('owner_id').references(() => appUser.id),
  teamId: uuid('team_id'),
  branchId: uuid('branch_id').references(() => branch.id),
  ...audit,
}, (t) => [
  uniqueIndex('work_order_number_uq').on(t.tenantId, t.number),
  index('work_order_status_idx').on(t.tenantId, t.status),
  index('work_order_tech_idx').on(t.tenantId, t.technicianId, t.scheduledStart),
  index('work_order_project_idx').on(t.tenantId, t.projectId),
]);

/** Time on a work order (FSM-41) — travel and work, from check-in/out. */
export const timeEntry = pgTable('time_entry', {
  id: id(),
  tenantId: tenantId(),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrder.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => appUser.id),
  /** travel | work */
  kind: text('kind').notNull().default('work'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  hours: qty('hours'),
  ...audit,
}, (t) => [index('time_entry_wo_idx').on(t.tenantId, t.workOrderId)]);
