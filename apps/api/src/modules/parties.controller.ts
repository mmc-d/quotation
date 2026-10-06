import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  activity, and, asc, brand, consent, contact, contract, desc, eq, exchangeRate, ilike, inArray, invoiceMirror, isNull, kitComponent, or, party, priceList, product, productCategory, quote, site, sql, opportunity, type Tx,
} from '@mmc/db';
import { isValidUnifiedNumber, isValidVatNumber, normalizeArabic, normalizePhone, normalizeSaudiMobile, toHalalas } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { assertCan, scopeFilter } from '../common/scope.js';
import { ZodPipe, zMoney, zPage, zQty } from '../common/zod.js';

const partySchema = z.object({
  kind: z.enum(['organization', 'individual']).default('organization'),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  unifiedNumber: z.string().nullish().refine((v) => !v || isValidUnifiedNumber(v), 'unified number: 10 digits starting with 7'),
  crNumber: z.string().nullish(),
  vatNumber: z.string().nullish().refine((v) => !v || isValidVatNumber(v), 'VAT number: 15 digits, starts and ends with 3'),
  segment: z.string().nullish(),
  source: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  tags: z.array(z.string()).default([]),
  isCustomer: z.boolean().default(true),
  isSupplier: z.boolean().default(false),
  isPartner: z.boolean().default(false),
  b2b: z.boolean().default(true),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  notes: z.string().nullish(),
  ownerId: z.string().uuid().nullish(),
  /** customer price list (CPQ-05); null = catalog list prices (or the segment's default list) */
  priceListId: z.string().uuid().nullish(),
});
type PartyInput = z.infer<typeof partySchema>;

const contactSchema = z.object({ name: z.string().min(1), jobTitle: z.string().nullish(), mobile: z.string().nullish(), whatsapp: z.string().nullish(), email: z.string().email().nullish().or(z.literal('')), preferredLanguage: z.enum(['ar', 'en']).default('ar'), preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'phone']).default('whatsapp'), isPrimary: z.boolean().default(false) });
const siteSchema = z.object({ type: z.enum(['billing', 'project', 'site']).default('project'), name: z.string().min(1), buildingNumber: z.string().nullish(), street: z.string().nullish(), district: z.string().nullish(), city: z.string().nullish(), postalCode: z.string().nullish(), additionalNumber: z.string().nullish(), lat: z.string().nullish(), lng: z.string().nullish(), mapLink: z.string().nullish(), accessNotes: z.string().nullish() });

function partyValues(full: PartyInput) {
  // leave the price list untouched when the caller does not send it
  const { priceListId, ...b } = full;
  return { ...b, ...(priceListId !== undefined ? { priceListId } : {}), email: b.email || null, phone: b.phone ? normalizePhone(b.phone) ?? b.phone : null, searchText: normalizeArabic([b.nameAr, b.nameEn, b.unifiedNumber, b.crNumber, b.vatNumber, b.phone].filter(Boolean).join(' ')) };
}

async function assertPriceList(tx: Tx, id: string | null | undefined) {
  if (!id) return;
  const [pl] = await tx.select({ id: priceList.id, archivedAt: priceList.archivedAt }).from(priceList).where(eq(priceList.id, id));
  if (!pl || pl.archivedAt) throw badRequest('unknown or archived price list');
}

@Controller('parties')
export class PartiesController {
  @Get()
  @Perm('party.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ role: z.enum(['customer', 'supplier', 'partner']).optional(), archived: z.coerce.boolean().optional() }))) q: { q?: string; limit: number; offset: number; role?: string; archived?: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q ? `%${normalizeArabic(q.q)}%` : null;
      const where = and(
        scopeFilter(actor, 'party.read', { owner: party.ownerId }),
        q.archived ? undefined : isNull(party.archivedAt),
        term ? ilike(party.searchText, term) : undefined,
        q.role === 'customer' ? eq(party.isCustomer, true) : q.role === 'supplier' ? eq(party.isSupplier, true) : q.role === 'partner' ? eq(party.isPartner, true) : undefined,
      );
      const rows = await tx.select().from(party).where(where).orderBy(asc(party.nameAr)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(party).where(where)) as [{ n: number }];
      return { rows, total: n };
    });
  }

  @Get(':id')
  @Perm('party.read')
  async get(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [p] = await tx.select().from(party).where(eq(party.id, id));
      if (!p) throw notFound('party');
      assertCan(actor, 'party.read', { ownerId: p.ownerId });
      const [contacts, sites, consents, quotes, contracts, opps, activities, invoices] = await Promise.all([
        tx.select().from(contact).where(and(eq(contact.partyId, id), isNull(contact.archivedAt))).orderBy(desc(contact.isPrimary), asc(contact.name)),
        tx.select().from(site).where(and(eq(site.partyId, id), isNull(site.archivedAt))),
        tx.select().from(consent).innerJoin(contact, eq(contact.id, consent.contactId)).where(eq(contact.partyId, id)),
        actor.grants['quote.read'] ? tx.select({ id: quote.id, number: quote.number, revision: quote.revision, status: quote.status, total: quote.total, quoteDate: quote.quoteDate }).from(quote).where(and(eq(quote.partyId, id), scopeFilter(actor, 'quote.read', { owner: quote.ownerId, team: quote.teamId }))).orderBy(desc(quote.createdAt)).limit(50) : [],
        actor.grants['contract.read'] ? tx.select({ id: contract.id, number: contract.number, status: contract.status, total: contract.total, contractDate: contract.contractDate }).from(contract).where(and(eq(contract.partyId, id), scopeFilter(actor, 'contract.read', { owner: contract.ownerId, team: contract.teamId }))).orderBy(desc(contract.createdAt)) : [],
        actor.grants['opportunity.read'] ? tx.select().from(opportunity).where(and(eq(opportunity.partyId, id), scopeFilter(actor, 'opportunity.read', { owner: opportunity.ownerId, team: opportunity.teamId }))).orderBy(desc(opportunity.createdAt)) : [],
        actor.grants['activity.read'] ? tx.select().from(activity).where(and(eq(activity.entityType, 'party'), eq(activity.entityId, id))).orderBy(desc(activity.createdAt)).limit(100) : [],
        actor.grants['invoice.read'] ? tx.select({ id: invoiceMirror.id, number: invoiceMirror.number, typeCode: invoiceMirror.typeCode, total: invoiceMirror.total, balanceDue: invoiceMirror.balanceDue, issueDate: invoiceMirror.issueDate, zatcaStatus: invoiceMirror.zatcaStatus }).from(invoiceMirror).where(eq(invoiceMirror.partyId, id)).orderBy(desc(invoiceMirror.issueDate)) : [],
      ]);
      const balance = invoices.reduce((s, i) => s + toHalalas(i.balanceDue), 0);
      return { ...p, contacts, sites, consents: consents.map((c) => c.consent), quotes, contracts, opportunities: opps, activities, invoices, balanceDue: balance / 100 };
    });
  }

  @Post()
  @Perm('party.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(partySchema.extend({ contacts: z.array(contactSchema).default([]), sites: z.array(siteSchema).default([]) }))) body: PartyInput & { contacts: z.infer<typeof contactSchema>[]; sites: z.infer<typeof siteSchema>[] }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { contacts, sites, ...p } = body;
      await assertPriceList(tx, p.priceListId);
      if (p.vatNumber) {
        const [dupe] = await tx.select({ id: party.id }).from(party).where(eq(party.vatNumber, p.vatNumber));
        if (dupe) throw badRequest('a party with this VAT number already exists', { id: dupe.id });
      }
      const [row] = await tx.insert(party).values({ ...partyValues(p), ownerId: p.ownerId ?? actor.userId, createdBy: actor.userId }).returning();
      for (const c of contacts) await tx.insert(contact).values({ ...c, partyId: row!.id, email: c.email || null, mobile: c.mobile ? normalizeSaudiMobile(c.mobile) ?? c.mobile : null, whatsapp: c.whatsapp ? normalizeSaudiMobile(c.whatsapp) ?? c.whatsapp : (c.mobile ? normalizeSaudiMobile(c.mobile) : null) });
      for (const s of sites) await tx.insert(site).values({ ...s, partyId: row!.id });
      await audit(tx, actor, 'create', 'party', row!.id, null, p);
      return row;
    }, actor.userId);
  }

  @Put(':id')
  @Perm('party.write')
  async update(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(partySchema)) body: PartyInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(party).where(eq(party.id, id));
      if (!before) throw notFound('party');
      assertCan(actor, 'party.write', { ownerId: before.ownerId });
      await assertPriceList(tx, body.priceListId);
      const values = partyValues(body);
      const [row] = await tx.update(party).set({ ...values, ownerId: body.ownerId ?? before.ownerId, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(party.id, id)).returning();
      const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'party', id, d.before, d.after);
      return row;
    }, actor.userId);
  }

  @Delete(':id')
  @Perm('party.write')
  async archive(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(party).where(eq(party.id, id));
      if (!before) throw notFound('party');
      assertCan(actor, 'party.write', { ownerId: before.ownerId });
      await tx.update(party).set({ archivedAt: new Date() }).where(eq(party.id, id));
      await audit(tx, actor, 'archive', 'party', id);
      return { ok: true };
    });
  }

  @Put(':id/contacts/:contactId')
  @Perm('party.write')
  async putContact(@Actor() actor: RequestActor, @Param('id') id: string, @Param('contactId') contactId: string, @Body(new ZodPipe(contactSchema)) c: z.infer<typeof contactSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const values = { ...c, partyId: id, email: c.email || null, mobile: c.mobile ? normalizeSaudiMobile(c.mobile) ?? c.mobile : null, whatsapp: c.whatsapp ? normalizeSaudiMobile(c.whatsapp) ?? c.whatsapp : null };
      if (c.isPrimary) await tx.update(contact).set({ isPrimary: false }).where(eq(contact.partyId, id));
      const row = contactId === 'new' ? (await tx.insert(contact).values(values).returning())[0] : (await tx.update(contact).set({ ...values, updatedAt: new Date() }).where(and(eq(contact.id, contactId), eq(contact.partyId, id))).returning())[0];
      if (!row) throw notFound('contact');
      await audit(tx, actor, contactId === 'new' ? 'create' : 'update', 'contact', row.id, null, values);
      return row;
    });
  }

  @Delete(':id/contacts/:contactId')
  @Perm('party.write')
  async archiveContact(@Actor() actor: RequestActor, @Param('contactId') contactId: string) {
    await tenantTx(actor.tenantId, (tx) => tx.update(contact).set({ archivedAt: new Date() }).where(eq(contact.id, contactId)));
    return { ok: true };
  }

  @Put(':id/sites/:siteId')
  @Perm('party.write')
  async putSite(@Actor() actor: RequestActor, @Param('id') id: string, @Param('siteId') siteId: string, @Body(new ZodPipe(siteSchema)) s: z.infer<typeof siteSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const row = siteId === 'new' ? (await tx.insert(site).values({ ...s, partyId: id }).returning())[0] : (await tx.update(site).set({ ...s, updatedAt: new Date() }).where(and(eq(site.id, siteId), eq(site.partyId, id))).returning())[0];
      if (!row) throw notFound('site');
      return row;
    });
  }

  /** PDPL consent capture/withdrawal per contact × channel × purpose. */
  @Post(':id/consents')
  @Perm('party.write')
  async addConsent(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ contactId: z.string().uuid(), channel: z.enum(['whatsapp', 'sms', 'email']), purpose: z.enum(['marketing', 'service']), status: z.enum(['granted', 'withdrawn']), source: z.string().nullish(), wordingVersion: z.string().nullish() }))) b: { contactId: string; channel: string; purpose: string; status: string; source?: string | null; wordingVersion?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [c] = await tx.insert(consent).values({ ...b, withdrawnAt: b.status === 'withdrawn' ? new Date() : null }).returning();
      await audit(tx, actor, `consent_${b.status}`, 'contact', b.contactId, null, b);
      return c;
    });
  }
}

const productSchema = z.object({
  code: z.string().min(1).max(64),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  description: z.string().default(''),
  categoryId: z.string().uuid().nullish(),
  brandId: z.string().uuid().nullish(),
  type: z.enum(['stock', 'non_stock', 'service', 'labor', 'kit']).default('stock'),
  uom: z.string().default('Nos'),
  listPrice: zMoney,
  installCost: zMoney.default('0'),
  costPrice: zMoney.nullish(),
  costCurrency: z.enum(['USD', 'SAR', 'CNY']).default('USD'),
  costRateToSar: zMoney.default('3.75'),
  warrantyMonths: z.number().int().nullish(),
  // inventory fields are optional so a form that doesn't send them leaves them unchanged (Phase 5)
  serialTracked: z.boolean().optional(),
  radio: z.boolean().optional(),
  hsCode: z.string().trim().max(20).nullish(),
  originCountry: z.string().trim().length(2).toUpperCase().nullish(),
  reorderLevel: zQty.nullish(),
  reorderQty: zQty.nullish(),
  weightKg: zQty.nullish(),
  imageUrl: z.string().nullish(),
  datasheetUrl: z.string().nullish(),
  status: z.enum(['active', 'discontinued']).default('active'),
});
type ProductInput = z.infer<typeof productSchema>;

function splitDescription(desc: string): { nameAr: string; nameEn: string | null } {
  const [a, ...rest] = desc.split('|');
  return { nameAr: (a ?? desc).trim() || desc.trim(), nameEn: rest.join('|').trim() || null };
}

/** Minimal RFC-4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true; // a quote only opens at the start of a field (7" Indoor…)
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

@Controller('products')
export class ProductsController {
  @Get()
  @Perm('product.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ categoryId: z.string().uuid().optional(), includeArchived: z.coerce.boolean().optional() }))) q: { q?: string; limit: number; offset: number; categoryId?: string; includeArchived?: boolean }) {
    const showCost = !!actor.grants['product.cost.read'];
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q ? `%${normalizeArabic(q.q)}%` : null;
      const where = and(q.includeArchived ? undefined : isNull(product.archivedAt), term ? or(ilike(product.searchText, term), ilike(product.code, term)) : undefined, q.categoryId ? eq(product.categoryId, q.categoryId) : undefined);
      const rows = await tx.select().from(product).where(where).orderBy(asc(product.code)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(product).where(where)) as [{ n: number }];
      return { rows: rows.map((r) => (showCost ? r : { ...r, costPrice: null, costRateToSar: null })), total: n };
    });
  }

  @Get('meta')
  @Perm('product.read')
  async meta(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => ({
      categories: await tx.select().from(productCategory).orderBy(asc(productCategory.sort)),
      brands: await tx.select().from(brand).orderBy(asc(brand.name)),
      rates: await tx.select().from(exchangeRate).orderBy(desc(exchangeRate.asOf)).limit(10),
    }));
  }

  @Get(':id')
  @Perm('product.read')
  async get(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [p] = await tx.select().from(product).where(eq(product.id, id));
      if (!p) throw notFound('product');
      return actor.grants['product.cost.read'] ? p : { ...p, costPrice: null };
    });
  }

  @Put(':id')
  @Perm('product.write')
  async put(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(productSchema)) b: ProductInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      const values = { ...b, searchText: normalizeArabic(`${b.code} ${b.nameAr} ${b.nameEn ?? ''} ${b.description}`) };
      if (id === 'new') {
        const [row] = await tx.insert(product).values({ ...values, createdBy: actor.userId }).onConflictDoNothing().returning();
        if (!row) throw badRequest(`product code ${b.code} already exists`);
        await audit(tx, actor, 'create', 'product', row.id, null, values);
        return row;
      }
      const [before] = await tx.select().from(product).where(eq(product.id, id));
      if (!before) throw notFound('product');
      if (b.serialTracked !== undefined && b.serialTracked !== before.serialTracked) {
        const held = await tx.execute(sql`select 1 from stock_balance where product_id = ${id} and qty <> 0 limit 1`);
        if ([...held].length) throw conflict('serial tracking cannot change while the product is in stock');
      }
      const [row] = await tx.update(product).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(product.id, id)).returning();
      const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'product', id, d.before, d.after);
      return row;
    }, actor.userId);
  }

  @Delete(':id')
  @Perm('product.write')
  async archive(@Actor() actor: RequestActor, @Param('id') id: string) {
    await tenantTx(actor.tenantId, async (tx) => {
      await tx.update(product).set({ archivedAt: new Date(), status: 'discontinued' }).where(eq(product.id, id));
      await audit(tx, actor, 'archive', 'product', id);
    });
    return { ok: true };
  }

  /**
   * Import the legacy Products sheet: A part number · B description ("عربي | English") · C price ·
   * D installation · E purchase price in USD. Paste CSV (File → Download → CSV) or rows.
   * Existing codes are updated, new ones created; the INS row is skipped (it is computed).
   */
  @Post('import')
  @Perm('product.write')
  async import(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ csv: z.string().optional(), rows: z.array(z.array(z.string())).optional(), cnyPerUsd: zMoney.optional(), hasHeader: z.boolean().default(true), dryRun: z.boolean().default(false) }))) b: { csv?: string; rows?: string[][]; cnyPerUsd?: string; hasHeader: boolean; dryRun: boolean }) {
    let rows = b.rows ?? (b.csv ? parseCsv(b.csv) : []);
    if (b.hasHeader) rows = rows.slice(1);
    const num = (v: string | undefined) => {
      const s = (v ?? '').replace(/[^\d.\-]/g, '');
      return s && !Number.isNaN(Number(s)) ? s : '0';
    };
    const parsed = rows
      .map((r) => ({ code: (r[0] ?? '').trim(), description: (r[1] ?? '').trim(), price: num(r[2]), install: num(r[3]), costUsd: (r[4] ?? '').trim() ? num(r[4]) : null }))
      .filter((r) => r.code && r.code.toUpperCase() !== 'INS');
    const errors = parsed.filter((r) => !r.description).map((r) => `${r.code}: missing description`);
    if (b.dryRun) return { count: parsed.length, errors, sample: parsed.slice(0, 10) };
    return tenantTx(actor.tenantId, async (tx) => {
      let created = 0;
      let updated = 0;
      for (const r of parsed) {
        const { nameAr, nameEn } = splitDescription(r.description || r.code);
        const values = { code: r.code, nameAr, nameEn, description: r.description, listPrice: r.price, installCost: r.install, costPrice: r.costUsd, costCurrency: 'USD', searchText: normalizeArabic(`${r.code} ${r.description}`), archivedAt: null, status: 'active' };
        const [existing] = await tx.select({ id: product.id }).from(product).where(eq(product.code, r.code));
        if (existing) {
          await tx.update(product).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(product.id, existing.id));
          updated++;
        } else {
          await tx.insert(product).values({ ...values, createdBy: actor.userId });
          created++;
        }
      }
      if (b.cnyPerUsd) await tx.insert(exchangeRate).values({ fromCurrency: 'USD', toCurrency: 'CNY', rate: b.cnyPerUsd, asOf: new Date().toISOString().slice(0, 10), source: 'products sheet I2' });
      await audit(tx, actor, 'import', 'product', null, null, { created, updated, total: parsed.length });
      return { created, updated, errors };
    }, actor.userId);
  }

  /** Package (kit) components, e.g. "Villa intercom package" → its products and quantities. */
  @Get(':id/kit')
  @Perm('product.read')
  async kit(@Actor() actor: RequestActor, @Param('id') id: string) {
    const showCost = !!actor.grants['product.cost.read'];
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({ k: kitComponent, p: product }).from(kitComponent).innerJoin(product, eq(product.id, kitComponent.componentId)).where(eq(kitComponent.kitId, id));
      return rows.map((r) => ({ id: r.k.id, qty: r.k.qty, optional: r.k.optional, product: showCost ? r.p : { ...r.p, costPrice: null } }));
    });
  }

  @Put(':id/kit')
  @Perm('product.write')
  async putKit(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ components: z.array(z.object({ componentId: z.string().uuid(), qty: zQty, optional: z.boolean().default(false) })).max(100).refine((cs) => new Set(cs.map((c) => c.componentId)).size === cs.length, 'a component appears twice') }))) b: { components: { componentId: string; qty: string; optional: boolean }[] }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [kit] = await tx.select().from(product).where(eq(product.id, id));
      if (!kit) throw notFound('product');
      if (b.components.some((c) => c.componentId === id)) throw badRequest('a package cannot contain itself');
      // nor a package that (directly or deeper) contains this one
      let frontier = [...new Set(b.components.map((c) => c.componentId))];
      const seen = new Set<string>(frontier);
      for (let depth = 0; frontier.length && depth < 10; depth++) {
        const sub = await tx.select({ componentId: kitComponent.componentId }).from(kitComponent).where(inArray(kitComponent.kitId, frontier));
        if (sub.some((r) => r.componentId === id)) throw badRequest('a package cannot contain itself (through another package)');
        frontier = sub.map((r) => r.componentId).filter((x) => !seen.has(x));
        frontier.forEach((x) => seen.add(x));
      }
      const found = b.components.length ? await tx.select({ id: product.id }).from(product).where(inArray(product.id, [...new Set(b.components.map((c) => c.componentId))])) : [];
      if (found.length !== new Set(b.components.map((c) => c.componentId)).size) throw badRequest('unknown component product');
      await tx.delete(kitComponent).where(eq(kitComponent.kitId, id));
      if (b.components.length) await tx.insert(kitComponent).values(b.components.map((c) => ({ kitId: id, componentId: c.componentId, qty: c.qty, optional: c.optional })));
      if (kit.type !== 'kit' && b.components.length) await tx.update(product).set({ type: 'kit' }).where(eq(product.id, id));
      await audit(tx, actor, 'kit', 'product', id, null, { components: b.components.length });
      return { ok: true, count: b.components.length };
    });
  }

  @Put('meta/categories/:id')
  @Perm('product.write')
  async putCategory(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ nameAr: z.string().min(1), nameEn: z.string().nullish(), parentId: z.string().uuid().nullish(), sort: z.number().int().default(0) }))) b: { nameAr: string; nameEn?: string | null; parentId?: string | null; sort: number }) {
    return tenantTx(actor.tenantId, async (tx) => (id === 'new' ? (await tx.insert(productCategory).values(b).returning())[0] : (await tx.update(productCategory).set(b).where(eq(productCategory.id, id)).returning())[0]));
  }
}

export { toHalalas };
