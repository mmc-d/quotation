import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, party, priceList, priceListItem, product, sql, type Tx } from '@mmc/db';
import { dec, riyadhDate } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { badRequest, notFound } from '../common/errors.js';
import { ZodPipe, zDate, zMoney, zQty } from '../common/zod.js';

export interface ResolvedPrice {
  /** catalog list price (stays the quote line's listPrice) */
  listPrice: string;
  /** effective price for this customer (price-list price, else the list price) */
  price: string;
  source: 'price_list' | 'list';
}

type PriceListRow = typeof priceList.$inferSelect;

function validOn(pl: PriceListRow, day: string): boolean {
  if (pl.archivedAt) return false;
  if (pl.validFrom && pl.validFrom > day) return false;
  if (pl.validTo && pl.validTo < day) return false;
  return true;
}

/**
 * The price list that applies to a customer today: the party's own list, else the default list of
 * the party's segment. Archived or out-of-validity lists do not apply.
 */
export async function effectivePriceList(tx: Tx, partyId: string | null | undefined): Promise<PriceListRow | null> {
  if (!partyId) return null;
  const [p] = await tx.select({ priceListId: party.priceListId, segment: party.segment }).from(party).where(eq(party.id, partyId));
  if (!p) return null;
  const day = riyadhDate();
  if (p.priceListId) {
    const [pl] = await tx.select().from(priceList).where(eq(priceList.id, p.priceListId));
    return pl && validOn(pl, day) ? pl : null;
  }
  if (!p.segment) return null;
  const defaults = await tx.select().from(priceList).where(and(eq(priceList.segment, p.segment), eq(priceList.isDefault, true), isNull(priceList.archivedAt))).orderBy(desc(priceList.createdAt));
  return defaults.find((pl) => validOn(pl, day)) ?? null;
}

/** Effective price per product for a customer (price-list item with the highest min qty ≤ qty, else the list price). */
export async function resolvePrices(tx: Tx, partyId: string | null | undefined, productIds: string[], qty = '1'): Promise<{ priceList: PriceListRow | null; prices: Record<string, ResolvedPrice> }> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return { priceList: await effectivePriceList(tx, partyId), prices: {} };
  const products = await tx.select({ id: product.id, listPrice: product.listPrice }).from(product).where(inArray(product.id, ids));
  const pl = await effectivePriceList(tx, partyId);
  const items = pl ? await tx.select().from(priceListItem).where(and(eq(priceListItem.priceListId, pl.id), inArray(priceListItem.productId, ids))) : [];
  const q = dec(qty);
  const prices: Record<string, ResolvedPrice> = {};
  for (const p of products) {
    const best = items
      .filter((i) => i.productId === p.id && dec(i.minQty).lte(q))
      .sort((a, b) => dec(b.minQty).comparedTo(dec(a.minQty)))[0];
    prices[p.id] = best ? { listPrice: p.listPrice, price: best.price, source: 'price_list' } : { listPrice: p.listPrice, price: p.listPrice, source: 'list' };
  }
  return { priceList: pl, prices };
}

const priceListSchema = z.object({
  name: z.string().trim().min(1),
  currency: z.string().trim().length(3).default('SAR'),
  validFrom: zDate.nullish(),
  validTo: zDate.nullish(),
  segment: z.string().trim().nullish().transform((v) => v || null),
  isDefault: z.boolean().default(false),
}).refine((b) => !b.validFrom || !b.validTo || b.validFrom <= b.validTo, { message: 'valid-from must be on or before valid-to', path: ['validTo'] });
type PriceListInput = z.infer<typeof priceListSchema>;

const itemSchema = z.object({ productId: z.string().uuid(), price: zMoney.refine((v) => Number(v) >= 0, 'price must be ≥ 0'), minQty: zQty.optional() });
const itemsSchema = z.union([z.array(itemSchema).max(5000), z.object({ items: z.array(itemSchema).max(5000) }).transform((o) => o.items)]);
type ItemInput = z.infer<typeof itemSchema>;

const resolveQuery = z.object({ partyId: z.string().uuid().optional(), productIds: z.string().default(''), qty: zQty.optional() });

@Controller('price-lists')
export class PriceListsController {
  @Get()
  @Perm('product.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ includeArchived: z.coerce.boolean().optional() }))) q: { includeArchived?: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({
        list: priceList,
        items: sql<number>`(select count(*)::int from price_list_item i where i.price_list_id = price_list.id)`,
        parties: sql<number>`(select count(*)::int from party p where p.price_list_id = price_list.id and p.archived_at is null)`,
      }).from(priceList).where(q.includeArchived ? undefined : isNull(priceList.archivedAt)).orderBy(desc(priceList.isDefault), asc(priceList.name));
      const day = riyadhDate();
      return rows.map((r) => ({ ...r.list, itemCount: r.items, partyCount: r.parties, active: validOn(r.list, day) }));
    });
  }

  /** Effective price per product for a customer: GET /price-lists/resolve?partyId=&productIds=a,b */
  @Get('resolve')
  @Perm('product.read')
  async resolve(@Actor() actor: RequestActor, @Query(new ZodPipe(resolveQuery)) q: z.infer<typeof resolveQuery>) {
    const ids = q.productIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length > 500) throw badRequest('at most 500 products');
    if (ids.some((id) => !z.string().uuid().safeParse(id).success)) throw badRequest('productIds: invalid id');
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await resolvePrices(tx, q.partyId, ids, q.qty ?? '1');
      return { priceList: r.priceList ? { id: r.priceList.id, name: r.priceList.name, currency: r.priceList.currency } : null, prices: r.prices };
    });
  }

  @Get(':id')
  @Perm('product.read')
  async get(@Actor() actor: RequestActor, @Param('id') id: string) {
    if (!z.string().uuid().safeParse(id).success) throw notFound('price list');
    return tenantTx(actor.tenantId, async (tx) => {
      const [pl] = await tx.select().from(priceList).where(eq(priceList.id, id));
      if (!pl) throw notFound('price list');
      const items = await tx.select({
        id: priceListItem.id, productId: priceListItem.productId, price: priceListItem.price, minQty: priceListItem.minQty,
        code: product.code, nameAr: product.nameAr, nameEn: product.nameEn, listPrice: product.listPrice,
      }).from(priceListItem).innerJoin(product, eq(product.id, priceListItem.productId)).where(eq(priceListItem.priceListId, id)).orderBy(asc(product.code), asc(priceListItem.minQty));
      return { ...pl, active: validOn(pl, riyadhDate()), items };
    });
  }

  @Put(':id')
  @Perm('product.write')
  async put(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(priceListSchema)) b: PriceListInput) {
    if (id !== 'new' && !z.string().uuid().safeParse(id).success) throw notFound('price list');
    return tenantTx(actor.tenantId, async (tx) => {
      const values = { name: b.name, currency: b.currency.toUpperCase(), validFrom: b.validFrom ?? null, validTo: b.validTo ?? null, segment: b.segment, isDefault: b.isDefault };
      let row: PriceListRow | undefined;
      if (id === 'new') {
        [row] = await tx.insert(priceList).values({ ...values, createdBy: actor.userId }).returning();
        await audit(tx, actor, 'create', 'price_list', row!.id, null, values);
      } else {
        const [before] = await tx.select().from(priceList).where(eq(priceList.id, id));
        if (!before) throw notFound('price list');
        [row] = await tx.update(priceList).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(priceList.id, id)).returning();
        const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
        if (d) await audit(tx, actor, 'update', 'price_list', id, d.before, d.after);
      }
      // One default list per segment.
      if (values.isDefault) {
        await tx.update(priceList).set({ isDefault: false }).where(and(
          sql`${priceList.id} <> ${row!.id}`,
          values.segment ? eq(priceList.segment, values.segment) : isNull(priceList.segment),
        ));
      }
      return row;
    }, actor.userId);
  }

  @Delete(':id')
  @Perm('product.write')
  async archive(@Actor() actor: RequestActor, @Param('id') id: string) {
    if (!z.string().uuid().safeParse(id).success) throw notFound('price list');
    return tenantTx(actor.tenantId, async (tx) => {
      const [row] = await tx.update(priceList).set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(priceList.id, id)).returning();
      if (!row) throw notFound('price list');
      await audit(tx, actor, 'archive', 'price_list', id);
      return { ok: true };
    }, actor.userId);
  }

  /** Replace all items: [{ productId, price, minQty? }] (or { items: [...] }). */
  @Put(':id/items')
  @Perm('product.write')
  async putItems(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(itemsSchema)) items: ItemInput[]) {
    if (!z.string().uuid().safeParse(id).success) throw notFound('price list');
    return tenantTx(actor.tenantId, async (tx) => {
      const [pl] = await tx.select().from(priceList).where(eq(priceList.id, id));
      if (!pl) throw notFound('price list');
      const rows = items.map((i) => ({ productId: i.productId, price: i.price, minQty: dec(i.minQty ?? '1').toString() }));
      const seen = new Set<string>();
      for (const r of rows) {
        const k = `${r.productId}:${r.minQty}`;
        if (seen.has(k)) throw badRequest('the same product and min qty appear twice', { productId: r.productId, minQty: r.minQty });
        seen.add(k);
      }
      const ids = [...new Set(rows.map((r) => r.productId))];
      if (ids.length) {
        const found = await tx.select({ id: product.id }).from(product).where(inArray(product.id, ids));
        const missing = ids.filter((x) => !found.some((f) => f.id === x));
        if (missing.length) throw badRequest('unknown products', { missing });
      }
      await tx.delete(priceListItem).where(eq(priceListItem.priceListId, id));
      if (rows.length) await tx.insert(priceListItem).values(rows.map((r) => ({ ...r, priceListId: id, createdBy: actor.userId })));
      await tx.update(priceList).set({ updatedAt: new Date(), updatedBy: actor.userId }).where(eq(priceList.id, id));
      await audit(tx, actor, 'items', 'price_list', id, null, { count: rows.length });
      return { ok: true, count: rows.length };
    }, actor.userId);
  }
}
