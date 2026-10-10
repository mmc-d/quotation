import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { amount, archivedAt, audit, id, qty, rate, tenantId, unitPrice } from './_common.js';
import { appUser, branch, file } from './platform.js';
import { party } from './parties.js';
import { product } from './catalog.js';
import { contract } from './sales.js';
import { installedAsset, project, workOrder } from './ops.js';

/**
 * Phase 5 — inventory, procurement & imports (module 07). MMC Core keeps the stock ledger until the
 * ERPNext back office is connected; every move carries an `erpName` slot for that sync.
 */

/** Jeddah main store, technician vans (custodian), project sites, transit, quarantine (INV-30). */
export const warehouse = pgTable('warehouse', {
  id: id(),
  tenantId: tenantId(),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  /** main | van | site | transit | quarantine */
  kind: text('kind').notNull().default('main'),
  custodianId: uuid('custodian_id').references(() => appUser.id),
  projectId: uuid('project_id').references(() => project.id),
  branchId: uuid('branch_id').references(() => branch.id),
  erpName: text('erp_name'),
  archivedAt: archivedAt(),
  ...audit,
}, (t) => [uniqueIndex('warehouse_code_uq').on(t.tenantId, t.code)]);

/** Quantity per warehouse and product (derived from moves, kept in step inside the same transaction). */
export const stockBalance = pgTable('stock_balance', {
  id: id(),
  tenantId: tenantId(),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouse.id),
  productId: uuid('product_id').notNull().references(() => product.id),
  qty: qty('qty').notNull().default('0'),
  /** reserved for projects (INV-21) */
  reservedQty: qty('reserved_qty').notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('stock_balance_uq').on(t.tenantId, t.warehouseId, t.productId)]);

/** Append-only stock ledger (I3). */
export const stockMove = pgTable('stock_move', {
  id: id(),
  tenantId: tenantId(),
  /** receipt | transfer | issue_project | consume_wo | return | adjust | count | rma_out | scrap */
  kind: text('kind').notNull(),
  productId: uuid('product_id').notNull().references(() => product.id),
  fromWarehouseId: uuid('from_warehouse_id').references(() => warehouse.id),
  toWarehouseId: uuid('to_warehouse_id').references(() => warehouse.id),
  qty: qty('qty').notNull(),
  /** SAR unit cost at the time of the move (receipts: landed unit cost; issues: average cost) */
  unitCostSar: unitPrice('unit_cost_sar').notNull().default('0'),
  serials: jsonb('serials').$type<string[]>().notNull().default([]),
  projectId: uuid('project_id').references(() => project.id),
  workOrderId: uuid('work_order_id').references(() => workOrder.id),
  /** document that caused the move: goods_receipt | stock_transfer | work_order | stock_count | landed_cost … */
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  note: text('note'),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  postedBy: uuid('posted_by').references(() => appUser.id),
  erpName: text('erp_name'),
}, (t) => [
  index('stock_move_product_idx').on(t.tenantId, t.productId, t.postedAt),
  index('stock_move_ref_idx').on(t.tenantId, t.refType, t.refId),
  index('stock_move_project_idx').on(t.tenantId, t.projectId),
]);

/** One row per serialised device from receipt to installation (INV-50..53). */
export const serialNumber = pgTable('serial_number', {
  id: id(),
  tenantId: tenantId(),
  productId: uuid('product_id').notNull().references(() => product.id),
  serial: text('serial').notNull(),
  macs: jsonb('macs').$type<string[]>().notNull().default([]),
  /** in_stock | reserved | in_transit | consumed | installed | rma | scrapped */
  status: text('status').notNull().default('in_stock'),
  warehouseId: uuid('warehouse_id').references(() => warehouse.id),
  projectId: uuid('project_id').references(() => project.id),
  purchaseOrderId: uuid('purchase_order_id'),
  receiptId: uuid('receipt_id'),
  supplierId: uuid('supplier_id').references(() => party.id),
  supplierWarrantyEnd: date('supplier_warranty_end'),
  installedAssetId: uuid('installed_asset_id').references(() => installedAsset.id),
  ...audit,
}, (t) => [uniqueIndex('serial_number_uq').on(t.tenantId, t.productId, t.serial), index('serial_number_wh_idx').on(t.tenantId, t.warehouseId)]);

/** Stock reserved for a project/contract when the advance is received (INV-21). */
export const stockReservation = pgTable('stock_reservation', {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid('project_id').references(() => project.id),
  contractId: uuid('contract_id').references(() => contract.id),
  productId: uuid('product_id').notNull().references(() => product.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouse.id),
  qty: qty('qty').notNull(),
  /** active | released | consumed */
  status: text('status').notNull().default('active'),
  ...audit,
}, (t) => [index('stock_reservation_project_idx').on(t.tenantId, t.projectId), index('stock_reservation_product_idx').on(t.tenantId, t.productId, t.status)]);

/** Supplier catalogue per item (INV-04). */
export const supplierItem = pgTable('supplier_item', {
  id: id(),
  tenantId: tenantId(),
  supplierId: uuid('supplier_id').notNull().references(() => party.id),
  productId: uuid('product_id').notNull().references(() => product.id),
  vendorSku: text('vendor_sku'),
  price: unitPrice('price').notNull(),
  currency: text('currency').notNull().default('USD'),
  moq: qty('moq'),
  leadTimeDays: integer('lead_time_days'),
  validUntil: date('valid_until'),
  preferred: boolean('preferred').notNull().default(false),
  ...audit,
}, (t) => [uniqueIndex('supplier_item_uq').on(t.tenantId, t.supplierId, t.productId)]);

/** SABER / CST / IECEE certificates per model (INV-08). */
export const complianceCert = pgTable('compliance_cert', {
  id: id(),
  tenantId: tenantId(),
  productId: uuid('product_id').notNull().references(() => product.id),
  /** saber_pcoc | saber_scoc | cst | iecee | other */
  kind: text('kind').notNull(),
  number: text('number').notNull(),
  issuedOn: date('issued_on'),
  expiresOn: date('expires_on'),
  fileId: uuid('file_id').references(() => file.id),
  notes: text('notes'),
  ...audit,
}, (t) => [index('compliance_cert_product_idx').on(t.tenantId, t.productId)]);

/** Material request from a contract BOQ minus reserved stock (INV-60). */
export const materialRequest = pgTable('material_request', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  projectId: uuid('project_id').references(() => project.id),
  contractId: uuid('contract_id').references(() => contract.id),
  /** draft | approved | ordered | closed | cancelled */
  status: text('status').notNull().default('draft'),
  neededBy: date('needed_by'),
  notes: text('notes'),
  ...audit,
}, (t) => [uniqueIndex('material_request_number_uq').on(t.tenantId, t.number)]);

export const materialRequestLine = pgTable('material_request_line', {
  id: id(),
  tenantId: tenantId(),
  requestId: uuid('request_id').notNull().references(() => materialRequest.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => product.id),
  code: text('code').notNull(),
  description: text('description'),
  qty: qty('qty').notNull(),
  orderedQty: qty('ordered_qty').notNull().default('0'),
  ...audit,
}, (t) => [index('material_request_line_idx').on(t.tenantId, t.requestId)]);

/** Purchase orders (INV-61..64): multi-currency, Incoterms, deposits, approval by amount. */
export const purchaseOrder = pgTable('purchase_order', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  supplierId: uuid('supplier_id').notNull().references(() => party.id),
  /** draft | pending_approval | approved | sent | partially_received | received | closed | cancelled */
  status: text('status').notNull().default('draft'),
  currency: text('currency').notNull().default('USD'),
  /** SAR per 1 unit of currency at order time */
  rateToSar: rate('rate_to_sar').notNull().default('3.75'),
  incoterm: text('incoterm'),
  depositPercent: integer('deposit_percent').notNull().default(0),
  orderDate: date('order_date'),
  expectedOn: date('expected_on'),
  projectId: uuid('project_id').references(() => project.id),
  materialRequestId: uuid('material_request_id').references(() => materialRequest.id),
  subtotal: amount('subtotal').notNull().default('0'),
  vat: amount('vat').notNull().default('0'),
  total: amount('total').notNull().default('0'),
  totalSar: amount('total_sar').notNull().default('0'),
  /** role key that must approve (purchaser / general_manager / owner) */
  approverRole: text('approver_role'),
  approvedBy: uuid('approved_by').references(() => appUser.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  /** compliance issues acknowledged when the PO was approved despite warnings */
  complianceNotes: jsonb('compliance_notes').$type<{ productId: string; key: string; en: string }[]>().notNull().default([]),
  notes: text('notes'),
  ownerId: uuid('owner_id').references(() => appUser.id),
  erpName: text('erp_name'),
  ...audit,
}, (t) => [uniqueIndex('purchase_order_number_uq').on(t.tenantId, t.number), index('purchase_order_status_idx').on(t.tenantId, t.status)]);

export const purchaseOrderLine = pgTable('purchase_order_line', {
  id: id(),
  tenantId: tenantId(),
  orderId: uuid('order_id').notNull().references(() => purchaseOrder.id, { onDelete: 'cascade' }),
  sort: integer('sort').notNull().default(0),
  productId: uuid('product_id').references(() => product.id),
  code: text('code').notNull(),
  description: text('description'),
  qty: qty('qty').notNull(),
  /** in the PO currency */
  unitPrice: unitPrice('unit_price').notNull(),
  receivedQty: qty('received_qty').notNull().default('0'),
  billedQty: qty('billed_qty').notNull().default('0'),
  materialRequestLineId: uuid('material_request_line_id').references(() => materialRequestLine.id),
  projectId: uuid('project_id').references(() => project.id),
  ...audit,
}, (t) => [index('purchase_order_line_idx').on(t.tenantId, t.orderId)]);

/** Goods receipt (purchase receipt) with serial + MAC capture (INV-51, INV-64). */
export const goodsReceipt = pgTable('goods_receipt', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  orderId: uuid('order_id').notNull().references(() => purchaseOrder.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouse.id),
  shipmentId: uuid('shipment_id'),
  receivedOn: date('received_on').notNull(),
  notes: text('notes'),
  erpName: text('erp_name'),
  ...audit,
}, (t) => [uniqueIndex('goods_receipt_number_uq').on(t.tenantId, t.number)]);

export const goodsReceiptLine = pgTable('goods_receipt_line', {
  id: id(),
  tenantId: tenantId(),
  receiptId: uuid('receipt_id').notNull().references(() => goodsReceipt.id, { onDelete: 'cascade' }),
  orderLineId: uuid('order_line_id').notNull().references(() => purchaseOrderLine.id),
  productId: uuid('product_id').references(() => product.id),
  qty: qty('qty').notNull(),
  /** SAR unit cost at receipt (PO price × rate) before landed costs */
  unitCostSar: unitPrice('unit_cost_sar').notNull(),
  /** landed cost added per unit after allocation (INV-72) */
  landedPerUnitSar: unitPrice('landed_per_unit_sar').notNull().default('0'),
  serials: jsonb('serials').$type<{ serial: string; macs: string[] }[]>().notNull().default([]),
  ...audit,
}, (t) => [index('goods_receipt_line_idx').on(t.tenantId, t.receiptId)]);

/** Import shipment (INV-70/71/74): B/L, containers, ETA, FASAH declaration, documents. */
export const importShipment = pgTable('import_shipment', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  supplierId: uuid('supplier_id').references(() => party.id),
  orderIds: jsonb('order_ids').$type<string[]>().notNull().default([]),
  /** sea | air | land | courier */
  mode: text('mode').notNull().default('sea'),
  /** ordered | shipped | arrived | clearing | released | received */
  status: text('status').notNull().default('ordered'),
  blNumber: text('bl_number'),
  containers: jsonb('containers').$type<string[]>().notNull().default([]),
  vessel: text('vessel'),
  etd: date('etd'),
  eta: date('eta'),
  broker: text('broker'),
  fasahNumber: text('fasah_number'),
  fasahDate: date('fasah_date'),
  cifSar: amount('cif_sar'),
  dutySar: amount('duty_sar'),
  importVatSar: amount('import_vat_sar'),
  /** clearance, port, transport, insurance… (landed-cost charges) */
  charges: jsonb('charges').$type<{ kind: string; amountSar: string; note?: string }[]>().notNull().default([]),
  docs: jsonb('docs').$type<Record<string, { done: boolean; fileId?: string | null }>>().notNull().default({}),
  /** landed-cost allocation once posted */
  landedBasis: text('landed_basis'),
  landedPostedAt: timestamp('landed_posted_at', { withTimezone: true }),
  /** how the allocated duty + charges split when posted: onto stock still on hand vs cost of sales (the ledger reads these) */
  landedCapitalisedSar: amount('landed_capitalised_sar'),
  landedExpensedSar: amount('landed_expensed_sar'),
  /** the broker / customs party that is owed the duty, charges and import VAT (credit side in the ledger) */
  customsPayablePartyId: uuid('customs_payable_party_id').references(() => party.id),
  notes: text('notes'),
  ...audit,
}, (t) => [uniqueIndex('import_shipment_number_uq').on(t.tenantId, t.number), index('import_shipment_status_idx').on(t.tenantId, t.status)]);

/** Transfer between warehouses (store ↔ vans ↔ project sites) with an in-transit step (INV-31). */
export const stockTransfer = pgTable('stock_transfer', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  fromWarehouseId: uuid('from_warehouse_id').notNull().references(() => warehouse.id),
  toWarehouseId: uuid('to_warehouse_id').notNull().references(() => warehouse.id),
  /** draft | in_transit | received | cancelled */
  status: text('status').notNull().default('draft'),
  projectId: uuid('project_id').references(() => project.id),
  lines: jsonb('lines').$type<{ productId: string; code: string; qty: string; serials?: string[] }[]>().notNull().default([]),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  notes: text('notes'),
  ...audit,
}, (t) => [uniqueIndex('stock_transfer_number_uq').on(t.tenantId, t.number)]);

/** Stock count / cycle count (INV-35, INV-37). */
export const stockCount = pgTable('stock_count', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouse.id),
  /** open | submitted | posted | cancelled */
  status: text('status').notNull().default('open'),
  lines: jsonb('lines').$type<{ productId: string; code: string; expected: string; counted: string | null }[]>().notNull().default([]),
  accuracy: rate('accuracy'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex('stock_count_number_uq').on(t.tenantId, t.number)]);

export interface SupplierBillLine {
  orderLineId?: string; productId?: string | null; code?: string; description?: string | null;
  qty: string; unitPrice: string; vatPercent?: string; serials?: string[];
}

/** A payment to the supplier against a bill (bank transfer, cash, cheque…). */
export interface SupplierPayment { id: string; paidOn: string; amount: string; method: string; reference?: string | null; note?: string | null; by: string | null; at: string }

/** Supplier bill (purchase invoice) for 3-way match; supplier ZATCA XML kept as a file (INV-64/66). */
export const supplierBill = pgTable('supplier_bill', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  supplierId: uuid('supplier_id').notNull().references(() => party.id),
  orderId: uuid('order_id').references(() => purchaseOrder.id),
  supplierInvoiceNo: text('supplier_invoice_no').notNull(),
  billDate: date('bill_date').notNull(),
  currency: text('currency').notNull().default('SAR'),
  rateToSar: rate('rate_to_sar').notNull().default('1'),
  subtotal: amount('subtotal').notNull(),
  vat: amount('vat').notNull().default('0'),
  total: amount('total').notNull(),
  /**
   * PO bills: `orderLineId` per line. Direct bills (no PO): `productId` (stock lines) or a free-text
   * expense line (`code`/`description` only); `vatPercent` per line.
   */
  lines: jsonb('lines').$type<SupplierBillLine[]>().notNull().default([]),
  /** po (3-way match against a purchase order) | direct (local purchase entered straight from the invoice) */
  kind: text('kind').notNull().default('po'),
  /** direct bills: where the goods were received (null = expense-only bill, nothing received) */
  warehouseId: uuid('warehouse_id').references(() => warehouse.id),
  projectId: uuid('project_id').references(() => project.id),
  dueDate: date('due_date'),
  /** SAR paid to the supplier so far (sum of `payments`) */
  paidAmount: amount('paid_amount').notNull().default('0'),
  payments: jsonb('payments').$type<SupplierPayment[]>().notNull().default([]),
  notes: text('notes'),
  /** matched | exception | direct */
  matchStatus: text('match_status').notNull().default('matched'),
  matchIssues: jsonb('match_issues').$type<{ line: number; ar: string; en: string }[]>().notNull().default([]),
  fileId: uuid('file_id').references(() => file.id),
  /** draft | approved | partially_paid | paid | cancelled */
  status: text('status').notNull().default('draft'),
  erpName: text('erp_name'),
  ...audit,
}, (t) => [index('supplier_bill_status_idx').on(t.tenantId, t.status, t.dueDate), uniqueIndex('supplier_bill_number_uq').on(t.tenantId, t.number), uniqueIndex('supplier_bill_ext_uq').on(t.tenantId, t.supplierId, t.supplierInvoiceNo)]);

/**
 * Opening stock (رصيد افتتاحي): the quantities and unit costs on hand when the company starts using
 * the system. Posted once as `opening` moves; corrections go through a stock count.
 */
export const stockOpening = pgTable('stock_opening', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouse.id),
  openedOn: date('opened_on').notNull(),
  lines: jsonb('lines').$type<{ productId: string; code: string; qty: string; unitCostSar: string; serials?: string[] }[]>().notNull().default([]),
  totalSar: amount('total_sar').notNull().default('0'),
  notes: text('notes'),
  ...audit,
}, (t) => [uniqueIndex('stock_opening_number_uq').on(t.tenantId, t.number)]);
