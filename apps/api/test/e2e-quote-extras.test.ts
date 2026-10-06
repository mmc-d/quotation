import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, gotenbergUp, signInOrUp, startServer, stopServer } from './helpers.js';

// Sections with subtotals (CPQ-13), packages / kits (CPQ-14), price lists per segment (CPQ-05).
let base = '';
let owner: Client;
let pdfs = false;
const P: Record<string, any> = {};
const S: Record<string, any> = {};

const line = (code: string, extra: Record<string, unknown> = {}) => ({ productId: P[code].id, code, description: P[code].description, qty: '1', ...extra });
const h = (sar: number) => Math.round(sar * 100);

beforeAll(async () => {
  base = await startServer();
  pdfs = await gotenbergUp();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const mk = async (code: string, listPrice: string, installCost: string) => {
    const p = await owner.put('/api/products/new', { code, nameAr: `منتج ${code}`, description: `منتج ${code} | Product ${code}`, listPrice, installCost });
    P[code] = p;
  };
  await mk('QX-A', '100', '10');
  await mk('QX-B', '200', '0');
  await mk('QX-KIT', '250', '0');
  await mk('QX-KIT2', '400', '0');
});

afterAll(async () => {
  // archived products drop out of the catalog, so other test files see their own counts
  for (const p of Object.values(P)) await owner?.req('DELETE', `/api/products/${p.id}`).catch(() => {});
  // the contractor-segment default list must not leak into other test files
  if (S.pl) await owner.req('DELETE', `/api/price-lists/${S.pl.id}`).catch(() => {});
  await stopServer();
});

describe('CPQ-13 — quote sections with subtotals', () => {
  it('creates a quote with sections and returns section subtotals keyed by section id', async () => {
    const q = await owner.post('/api/quotes', {
      clientName: 'عميل الأقسام',
      discountType: 'percent', discountValue: '0', vatOn: true,
      sections: [{ key: 'a', title: 'المبنى أ' }, { key: 'g', title: 'البوابة' }],
      lines: [
        line('QX-A', { unitPrice: '100', qty: '2', sectionKey: 'a' }),
        line('QX-B', { unitPrice: '200', qty: '1', sectionKey: 'g' }),
        line('QX-B', { unitPrice: '200', qty: '3', sectionKey: 'a', isOptional: true }),
        line('QX-KIT', { unitPrice: '250', qty: '1' }),
      ],
    });
    expect(q.sections.map((s: any) => s.title)).toEqual(['المبنى أ', 'البوابة']);
    const [a, g] = q.sections;
    const byCode = (code: string, opt = false) => q.lines.find((l: any) => l.code === code && l.isOptional === opt);
    expect(byCode('QX-A').sectionId).toBe(a.id);
    expect(byCode('QX-B').sectionId).toBe(g.id);
    expect(byCode('QX-B', true).sectionId).toBe(a.id);
    expect(byCode('QX-KIT').sectionId).toBeNull();
    // INS (2 × 10) is added automatically, last and outside every section
    const ins = q.lines[q.lines.length - 1];
    expect(ins.code).toBe('INS');
    expect(ins.sectionId).toBeNull();
    const subs = Object.fromEntries(q.computed.totals.sections.map((s: any) => [s.key, s.subtotal]));
    expect(subs[a.id]).toBe(h(200)); // optional line excluded
    expect(subs[g.id]).toBe(h(200));
    expect(subs['']).toBe(h(250 + 20)); // no section: KIT + INS
    expect(q.computed.totals.subtotal).toBe(h(670));
    S.q = q;
  });

  it('keeps sections across an update (row ids as keys, rename + reorder)', async () => {
    const q = S.q;
    const [a, g] = q.sections;
    const body = {
      clientName: q.clientName, discountType: 'percent', discountValue: '0', vatOn: true, version: q.version,
      sections: [{ key: g.id, title: 'البوابة الرئيسية' }, { key: a.id, title: 'المبنى أ' }, { key: 'new-v3', title: 'فيلا 3' }],
      lines: [
        ...q.lines.filter((l: any) => !l.isAutoLabor).map((l: any) => ({ productId: l.productId, code: l.code, description: l.description, listPrice: l.listPrice, unitPrice: l.unitPrice, qty: l.qty, isOptional: l.isOptional, sectionKey: l.sectionId })),
        line('QX-A', { unitPrice: '90', qty: '1', sectionKey: 'new-v3' }),
      ],
    };
    const u = await owner.put(`/api/quotes/${q.id}`, body);
    expect(u.sections.map((s: any) => s.title)).toEqual(['البوابة الرئيسية', 'المبنى أ', 'فيلا 3']);
    const t = Object.fromEntries(u.sections.map((s: any) => [s.title, s.id]));
    const subs = Object.fromEntries(u.computed.totals.sections.map((s: any) => [s.key, s.subtotal]));
    expect(subs[t['البوابة الرئيسية']]).toBe(h(200));
    expect(subs[t['المبنى أ']]).toBe(h(200));
    expect(subs[t['فيلا 3']]).toBe(h(90));
    expect(u.lines.find((l: any) => l.code === 'INS').sectionId).toBeNull();
    S.q = u;
  });

  it('rejects duplicate section keys', async () => {
    await owner.post('/api/quotes', { discountType: 'percent', discountValue: '0', vatOn: true, sections: [{ key: 'x', title: '1' }, { key: 'x', title: '2' }], lines: [line('QX-B', { unitPrice: '200' })] }, { expect: 400 });
  });

  it('duplicate keeps sections and line assignments', async () => {
    const d = await owner.post(`/api/quotes/${S.q.id}/duplicate`);
    expect(d.id).not.toBe(S.q.id);
    expect(d.sections.map((s: any) => s.title)).toEqual(S.q.sections.map((s: any) => s.title));
    expect(d.sections.every((s: any) => !S.q.sections.some((o: any) => o.id === s.id))).toBe(true);
    const title = (q: any, l: any) => q.sections.find((s: any) => s.id === l.sectionId)?.title ?? null;
    expect(d.lines.map((l: any) => [l.code, l.isOptional, title(d, l)])).toEqual(S.q.lines.map((l: any) => [l.code, l.isOptional, title(S.q, l)]));
    expect(d.computed.totals.sections.map((s: any) => s.subtotal)).toEqual(S.q.computed.totals.sections.map((s: any) => s.subtotal));
  });

  it('a revision keeps sections and line assignments', async () => {
    await owner.post(`/api/quotes/${S.q.id}/status`, { status: 'sent' });
    const r = await owner.post(`/api/quotes/${S.q.id}/revise`);
    expect(r.revision).toBe(1);
    expect(r.sections.map((s: any) => s.title)).toEqual(S.q.sections.map((s: any) => s.title));
    const title = (q: any, l: any) => q.sections.find((s: any) => s.id === l.sectionId)?.title ?? null;
    expect(r.lines.map((l: any) => [l.code, title(r, l)])).toEqual(S.q.lines.map((l: any) => [l.code, title(S.q, l)]));
    expect(r.computed.totals.sections.map((s: any) => s.subtotal)).toEqual(S.q.computed.totals.sections.map((s: any) => s.subtotal));
    S.rev = r;
  });

  it('prints section headers and subtotal rows in the quote HTML', async () => {
    const { quoteDocFrom } = await import('../src/modules/quotes.service.js');
    const { renderQuoteHtml } = await import('@mmc/doc-templates');
    const doc = quoteDocFrom(S.rev, 'مندوب');
    expect(doc.sections.map((s) => s.title)).toEqual(['البوابة الرئيسية', 'المبنى أ', 'فيلا 3']);
    expect(doc.sections.map((s) => s.subtotal)).toEqual([h(200), h(200), h(90)]);
    const html = renderQuoteHtml({ company: { legalNameAr: 'شركة <اختبار>', vatRegistered: true }, ...doc });
    expect((html.match(/class="section-head"/g) ?? []).length).toBe(3);
    expect((html.match(/class="section-sub"/g) ?? []).length).toBe(3);
    expect(html).toContain('البوابة الرئيسية');
    // INS row is printed after the last section's subtotal
    expect(html.lastIndexOf('class="section-sub"')).toBeLessThan(html.lastIndexOf('class="ins'));
  });

  it('groups the Excel export by section like the PDF', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await owner.get(`/api/quotes/${S.rev.id}/excel`, { raw: true }));
    const rows: string[] = [];
    wb.worksheets[0]!.eachRow((r, i) => { if (i > 1) rows.push(`${r.getCell(2).text}|${r.getCell(3).text}|${r.getCell(6).text}`); });
    const at = (prefix: string) => rows.findIndex((r) => r.startsWith(prefix));
    expect(at('|البوابة الرئيسية|')).toBeGreaterThan(-1);
    expect(rows).toContain('|المجموع الفرعي — البوابة الرئيسية|200');
    expect(rows).toContain('|المجموع الفرعي — فيلا 3|90');
    // section order follows the quote; INS comes after the last subtotal
    expect(at('|البوابة الرئيسية|')).toBeLessThan(at('|المبنى أ|'));
    expect(at('INS|')).toBeGreaterThan(at('|المجموع الفرعي — فيلا 3|'));
    expect(rows.some((r) => r.startsWith('QX-B|') && r.includes('(اختياري)'))).toBe(true);
  });

  it('renders the quote PDF with sections (Gotenberg)', async () => {
    if (!pdfs) return;
    const pdf = await owner.get<Buffer>(`/api/quotes/${S.rev.id}/pdf`, { raw: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('CPQ-14 — packages (kits)', () => {
  it('stores kit components and turns the product into a kit', async () => {
    await owner.put(`/api/products/${P['QX-KIT'].id}/kit`, { components: [{ componentId: P['QX-A'].id, qty: '2' }, { componentId: P['QX-B'].id, qty: 1, optional: true }] });
    const kit = await owner.get(`/api/products/${P['QX-KIT'].id}/kit`);
    expect(kit).toHaveLength(2);
    const a = kit.find((k: any) => k.product.code === 'QX-A');
    expect(Number(a.qty)).toBe(2);
    expect(a.optional).toBe(false);
    expect(kit.find((k: any) => k.product.code === 'QX-B').optional).toBe(true);
    expect((await owner.get(`/api/products/${P['QX-KIT'].id}`)).type).toBe('kit');
  });

  it('rejects a package that contains itself, directly or through another package', async () => {
    await owner.put(`/api/products/${P['QX-KIT'].id}/kit`, { components: [{ componentId: P['QX-KIT'].id, qty: '1' }] }, { expect: 400 });
    await owner.put(`/api/products/${P['QX-KIT2'].id}/kit`, { components: [{ componentId: P['QX-KIT'].id, qty: '1' }] });
    await owner.put(`/api/products/${P['QX-A'].id}/kit`, { components: [{ componentId: P['QX-KIT2'].id, qty: '1' }] }, { expect: 400 });
    await owner.put(`/api/products/${P['QX-KIT'].id}/kit`, { components: [{ componentId: P['QX-A'].id, qty: '1' }, { componentId: P['QX-A'].id, qty: '2' }] }, { expect: 400 });
    expect((await owner.get(`/api/products/${P['QX-A'].id}`)).type).toBe('stock');
    expect(await owner.get(`/api/products/${P['QX-KIT'].id}/kit`)).toHaveLength(2);
  });
});

describe('CPQ-05 — price lists per segment', () => {
  it('forbids price-list writes without product.write', async () => {
    const r = await owner.post('/api/users/invite', { email: 'qx-rep@e2e.test', nameAr: 'مندوب الأسعار', roleKeys: ['sales_rep'] });
    expect(r.id).toBeTruthy();
    const rep = await signInOrUp(base, 'qx-rep@e2e.test');
    S.rep = rep;
    await rep.put('/api/price-lists/new', { name: 'x' }, { expect: 403 });
    expect(Array.isArray(await rep.get('/api/price-lists'))).toBe(true);
  });

  it('creates, edits, lists and archives price lists', async () => {
    const pl = await owner.put('/api/price-lists/new', { name: 'قائمة المقاولين', segment: 'contractor', isDefault: true });
    expect(pl).toMatchObject({ name: 'قائمة المقاولين', currency: 'SAR', segment: 'contractor', isDefault: true });
    await owner.put('/api/price-lists/new', { name: 'x', validFrom: '2026-02-01', validTo: '2026-01-01' }, { expect: 400 });
    await owner.put(`/api/price-lists/${pl.id}/items`, [
      { productId: P['QX-A'].id, price: '80' },
      { productId: P['QX-A'].id, price: '70', minQty: '10' },
      { productId: P['QX-B'].id, price: 150 },
    ]);
    await owner.put(`/api/price-lists/${pl.id}/items`, [{ productId: P['QX-A'].id, price: '80' }, { productId: P['QX-A'].id, price: '75' }], { expect: 400 });
    await owner.put(`/api/price-lists/${pl.id}/items`, [{ productId: '00000000-0000-7000-8000-000000000000', price: '1' }], { expect: 400 });
    const got = await owner.get(`/api/price-lists/${pl.id}`);
    expect(got.items).toHaveLength(3);
    expect(got.items[0]).toMatchObject({ code: 'QX-A' });
    expect(got.items.some((i: any) => i.code === 'QX-B' && Number(i.price) === 150 && Number(i.listPrice) === 200)).toBe(true);
    const renamed = await owner.put(`/api/price-lists/${pl.id}`, { name: 'المقاولون 2026', segment: 'contractor', isDefault: true });
    expect(renamed.name).toBe('المقاولون 2026');
    const other = await owner.put('/api/price-lists/new', { name: 'مؤقتة' });
    await owner.req('DELETE', `/api/price-lists/${other.id}`);
    const list = await owner.get('/api/price-lists');
    expect(list.find((l: any) => l.id === pl.id)).toMatchObject({ itemCount: 3, active: true });
    expect(list.some((l: any) => l.id === other.id)).toBe(false);
    S.pl = pl;
  });

  it('resolves the effective price per product for a customer', async () => {
    const party = await owner.post('/api/parties', { nameAr: 'مقاولات الأسعار الخاصة', priceListId: S.pl.id });
    expect(party.priceListId).toBe(S.pl.id);
    await owner.post('/api/parties', { nameAr: 'قائمة غير موجودة', priceListId: '00000000-0000-7000-8000-000000000000' }, { expect: 400 });
    S.party = party;
    const ids = [P['QX-A'].id, P['QX-B'].id, P['QX-KIT'].id].join(',');
    const r = await owner.get(`/api/price-lists/resolve?partyId=${party.id}&productIds=${ids}`);
    expect(r.priceList.id).toBe(S.pl.id);
    expect(r.prices[P['QX-A'].id]).toMatchObject({ source: 'price_list' });
    expect(Number(r.prices[P['QX-A'].id].price)).toBe(80);
    expect(Number(r.prices[P['QX-A'].id].listPrice)).toBe(100);
    expect(Number(r.prices[P['QX-B'].id].price)).toBe(150);
    expect(r.prices[P['QX-KIT'].id]).toMatchObject({ source: 'list' });
    expect(Number(r.prices[P['QX-KIT'].id].price)).toBe(250);
    // quantity breaks
    const r10 = await owner.get(`/api/price-lists/resolve?partyId=${party.id}&productIds=${P['QX-A'].id}&qty=10`);
    expect(Number(r10.prices[P['QX-A'].id].price)).toBe(70);
    // a customer without a list (and no segment default) pays list prices
    const plain = await owner.post('/api/parties', { nameAr: 'عميل بدون قائمة' });
    const rp = await S.rep.get(`/api/price-lists/resolve?partyId=${plain.id}&productIds=${ids}`);
    expect(rp.priceList).toBeNull();
    expect(Number(rp.prices[P['QX-A'].id].price)).toBe(100);
    // the segment's default list applies to customers of that segment
    const seg = await owner.post('/api/parties', { nameAr: 'مقاول الشريحة', segment: 'contractor' });
    const rs = await owner.get(`/api/price-lists/resolve?partyId=${seg.id}&productIds=${P['QX-B'].id}`);
    expect(rs.priceList.id).toBe(S.pl.id);
    // an expired list no longer applies
    await owner.put(`/api/price-lists/${S.pl.id}`, { name: 'المقاولون 2026', segment: 'contractor', isDefault: true, validTo: '2020-01-01' });
    const rx = await owner.get(`/api/price-lists/resolve?partyId=${party.id}&productIds=${P['QX-A'].id}`);
    expect(rx.priceList).toBeNull();
    expect(Number(rx.prices[P['QX-A'].id].price)).toBe(100);
    await owner.put(`/api/price-lists/${S.pl.id}`, { name: 'المقاولون 2026', segment: 'contractor', isDefault: true, validTo: null });
  });

  it('a quote for a customer on a price list takes the list price as unit price and keeps the catalog list price', async () => {
    const q = await owner.post('/api/quotes', {
      partyId: S.party.id, clientName: S.party.nameAr, discountType: 'percent', discountValue: '0', vatOn: true,
      lines: [line('QX-A', { qty: '2' }), line('QX-KIT'), line('QX-B', { unitPrice: '190' })],
    });
    expect(q.priceListId).toBe(S.pl.id);
    expect(q.priceList).toMatchObject({ id: S.pl.id, name: 'المقاولون 2026' });
    const a = q.lines.find((l: any) => l.code === 'QX-A');
    expect(Number(a.unitPrice)).toBe(80);
    expect(Number(a.listPrice)).toBe(100);
    const ai = q.lines.indexOf(a);
    expect(q.computed.lines[ai]).toMatchObject({ amount: h(160), listAmount: h(200), struck: true });
    const kit = q.lines.find((l: any) => l.code === 'QX-KIT');
    expect(Number(kit.unitPrice)).toBe(250); // not on the list → catalog price
    expect(Number(q.lines.find((l: any) => l.code === 'QX-B').unitPrice)).toBe(190); // an explicit price wins
    // "discount from list" still sees the price-list discount
    expect(q.computed.totals.discountFromListPercent).toBeGreaterThan(0);
    // a quote without a party has no price list
    const plain = await owner.post('/api/quotes', { discountType: 'percent', discountValue: '0', vatOn: true, lines: [line('QX-A')] });
    expect(plain.priceListId).toBeNull();
    expect(Number(plain.lines.find((l: any) => l.code === 'QX-A').unitPrice)).toBe(100);
  });
});
