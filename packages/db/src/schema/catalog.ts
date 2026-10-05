import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, date } from 'drizzle-orm/pg-core';
import { archivedAt, audit, custom, id, qty, rate, tenantId, unitPrice } from './_common.js';

export const productCategory = pgTable('product_category', {
  id: id(),
  tenantId: tenantId(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  parentId: uuid('parent_id'),
  sort: integer('sort').notNull().default(0),
  ...audit,
});

export const brand = pgTable('brand', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  ...audit,
});

/**
 * Product — imported from the legacy Google Sheet: A code · B description · C price ·
 * D installation · E purchase price in USD (sheet: CNY ÷ I2). Kept bilingual.
 */
export const product = pgTable('product', {
  id: id(),
  tenantId: tenantId(),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  /** the legacy single bilingual description "عربي | English" */
  description: text('description').notNull().default(''),
  searchText: text('search_text').notNull().default(''),
  categoryId: uuid('category_id').references(() => productCategory.id),
  brandId: uuid('brand_id').references(() => brand.id),
  type: text('type').notNull().default('stock'),
  uom: text('uom').notNull().default('Nos'),
  listPrice: unitPrice('list_price').notNull().default('0'),
  installCost: unitPrice('install_cost').notNull().default('0'),
  costPrice: unitPrice('cost_price'),
  costCurrency: text('cost_currency').notNull().default('USD'),
  costRateToSar: rate('cost_rate_to_sar').notNull().default('3.75'),
  warrantyMonths: integer('warranty_months'),
  serialTracked: boolean('serial_tracked').notNull().default(false),
  hsCode: text('hs_code'),
  imageFileId: uuid('image_file_id'),
  imageUrl: text('image_url'),
  datasheetUrl: text('datasheet_url'),
  status: text('status').notNull().default('active'),
  erpName: text('erp_name'),
  custom: custom(),
  archivedAt: archivedAt(),
  ...audit,
}, (t) => [uniqueIndex('product_code_uq').on(t.tenantId, t.code), index('product_search_idx').on(t.tenantId, t.searchText)]);

/** Packages (kits), e.g. "Villa intercom package". */
export const kitComponent = pgTable('kit_component', {
  id: id(),
  tenantId: tenantId(),
  kitId: uuid('kit_id').notNull().references(() => product.id),
  componentId: uuid('component_id').notNull().references(() => product.id),
  qty: qty('qty').notNull().default('1'),
  optional: boolean('optional').notNull().default(false),
  ...audit,
});

export const priceList = pgTable('price_list', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('SAR'),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  segment: text('segment'),
  isDefault: boolean('is_default').notNull().default(false),
  archivedAt: archivedAt(),
  ...audit,
});

export const priceListItem = pgTable('price_list_item', {
  id: id(),
  tenantId: tenantId(),
  priceListId: uuid('price_list_id').notNull().references(() => priceList.id),
  productId: uuid('product_id').notNull().references(() => product.id),
  price: unitPrice('price').notNull(),
  minQty: qty('min_qty').notNull().default('1'),
  ...audit,
}, (t) => [uniqueIndex('price_list_item_uq').on(t.priceListId, t.productId, t.minQty)]);

/** Exchange rates used for costing (CNY per USD from sheet cell I2; USD→SAR peg 3.75). */
export const exchangeRate = pgTable('exchange_rate', {
  id: id(),
  tenantId: tenantId(),
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  rate: rate('rate').notNull(),
  asOf: date('as_of').notNull(),
  source: text('source'),
  meta: jsonb('meta'),
  ...audit,
});
