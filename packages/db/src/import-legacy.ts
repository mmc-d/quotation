import { realpathSync } from 'node:fs';
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, sql } from 'drizzle-orm';
import {
  calculateQuote, halalasToFixed, normalizeArabic, normalizePhone, quoteSequence, syncInstallationLine, toHalalas, trailingSequence, type QuoteLineInput,
} from '@mmc/domain';
import * as s from './schema/index.js';
import { bumpCounterTo, withTenant, type Db, type Tx } from './index.js';

/**
 * Legacy migration (docs/erp-plan/05 §5): imports what the old single-page tool stored —
 *  - quote JSON files (Drive quotes folder, or `quote_*` entries of a browser backup),
 *  - contract JSON files (HTML snapshots: kept as an archived file, total extracted),
 *  - invoice JSON files (Drive invoices folder or `zinv_*` entries),
 *  - "export all local data" backups (mmc-local-backup-*.json).
 * Idempotent: a document already imported (same number) is skipped. Numbering continues after the
 * highest imported number so new documents never collide with old ones.
 *
 *   pnpm --filter @mmc/db import:legacy -- --dir ./legacy-archive [--tenant mmc] [--dry-run]
 */

interface LegacyItem { code?: string; desc?: string; price?: number; unitPrice?: number; qty?: number; installCost?: number; _isAuto?: boolean; _manualPrice?: boolean }
interface LegacyQuote {
  quoteNo: string; quoteDate?: string; clientName?: string; clientCo?: string; project?: string; salesRep?: string; crNumber?: string; taxCard?: string;
  clientAddress?: string; clientPhone?: string; items?: LegacyItem[]; discountPercent?: number; discountValue?: number; discMode?: 'pct' | 'value';
  vatEnabled?: boolean; techNotes?: string; terms?: string; savedBy?: string; savedAt?: string;
}
interface LegacyContract { html: string; contractNo: string; quoteNo?: string; savedBy?: string; savedAt?: string }
interface LegacyInvoice {
  number: string; icv?: number; issueDate: string; issueTime?: string; type?: string; taxInvoice?: boolean; quoteNo?: string; uuid?: string;
  buyer?: { name?: string; vat?: string; crn?: string }; lines?: { code: string; name: string; qty: number; unitPrice: number; net: number; vat: number; total: number }[];
  totals?: { taxable: number; vat: number; total: number }; qr?: string;
}

export type LegacyDoc = { kind: 'quote'; data: LegacyQuote; source: string } | { kind: 'contract'; data: LegacyContract; source: string } | { kind: 'invoice'; data: LegacyInvoice; source: string };

/** Classify one parsed JSON value (a file or a backup entry) into legacy documents. */
export function classify(value: unknown, source: string): LegacyDoc[] {
  if (!value || typeof value !== 'object') return [];
  const v = value as Record<string, unknown>;
  if (v.data && typeof v.data === 'object' && 'exportedAt' in v) {
    const out: LegacyDoc[] = [];
    for (const [k, raw] of Object.entries(v.data as Record<string, string>)) {
      if (!/^(quote_|zinv_)/.test(k)) continue;
      try { out.push(...classify(JSON.parse(raw), `${source}#${k}`)); } catch { /* not JSON */ }
    }
    return out;
  }
  if (v.state && typeof v.state === 'object') return classify(v.state, source);
  if (typeof v.quoteNo === 'string' && Array.isArray(v.items)) return [{ kind: 'quote', data: v as unknown as LegacyQuote, source }];
  if (typeof v.contractNo === 'string' && typeof v.html === 'string') return [{ kind: 'contract', data: v as unknown as LegacyContract, source }];
  if (typeof v.number === 'string' && v.totals && typeof v.issueDate === 'string') return [{ kind: 'invoice', data: v as unknown as LegacyInvoice, source }];
  return [];
}

/** Map a legacy quote to Core lines and totals with the same rules the old tool used. */
export function mapQuote(q: LegacyQuote, vatRegistered: boolean) {
  const lines: QuoteLineInput[] = (q.items ?? []).filter((it) => it.code).map((it) => ({
    code: String(it.code),
    description: String(it.desc ?? it.code),
    listPrice: String(Number(it.price ?? it.unitPrice) || 0),
    unitPrice: String(Number(it.unitPrice ?? it.price) || 0),
    qty: String(Math.max(0.01, Number(it.qty) || 1)),
    installCost: String(Number(it.installCost) || 0),
    manualPrice: it.code === 'INS' ? (!!it._manualPrice || !it._isAuto) : false,
  }));
  const hasIns = lines.some((l) => l.code === 'INS');
  // Keep exactly what was quoted: an INS line present in the file stays as priced (manual);
  // a file without INS means the user deleted it.
  const synced = hasIns ? lines.map((l) => (l.code === 'INS' ? { ...l, manualPrice: true } : l)) : syncInstallationLine(lines, { insDeleted: true });
  const discount = q.discMode === 'value' ? { type: 'amount' as const, value: String(q.discountValue ?? 0) } : { type: 'percent' as const, value: String(q.discountPercent ?? 0) };
  const calc = calculateQuote({ lines: synced, discount, vatRegistered, vatOn: q.vatEnabled !== false });
  return { lines: synced, discount, calc, insDeleted: !hasIns };
}

/** Grand total printed in a legacy contract snapshot (span#ctGrandText), as halalas. */
export function contractTotalFromHtml(html: string): number | null {
  const m = /id="ctGrandText"[^>]*>([^<]+)</.exec(html);
  if (!m) return null;
  const n = m[1]!.replace(/[^\d.]/g, '');
  return n ? toHalalas(n) : null;
}

async function findOrCreateParty(tx: Tx, q: { name: string; vat?: string | null; cr?: string | null; phone?: string | null }) {
  if (q.vat) {
    const [p] = await tx.select().from(s.party).where(eq(s.party.vatNumber, q.vat));
    if (p) return p.id;
  }
  const search = normalizeArabic(q.name);
  const [byName] = await tx.select().from(s.party).where(eq(s.party.searchText, search));
  if (byName) return byName.id;
  const vatOk = q.vat && /^3\d{13}3$/.test(q.vat) ? q.vat : null;
  const [p] = await tx.insert(s.party).values({ nameAr: q.name, vatNumber: vatOk, crNumber: q.cr || null, phone: normalizePhone(q.phone) ?? q.phone ?? null, searchText: search, source: 'legacy_import', b2b: !!(vatOk || q.cr) }).returning();
  return p!.id;
}

async function ownerFor(tx: Tx, who?: string) {
  if (!who) return null;
  const w = who.trim().toLowerCase();
  const [u] = await tx.select({ id: s.appUser.id }).from(s.appUser).where(sql`lower(${s.appUser.email}) = ${w} or ${s.appUser.userCode} = ${who.trim()}`);
  return u?.id ?? null;
}

export interface ImportReport { quotes: number; contracts: number; invoices: number; skipped: number; errors: string[] }

export async function importLegacy(db: Db, tenantId: string, docs: LegacyDoc[], opts: { dryRun?: boolean; filesDir?: string } = {}): Promise<ImportReport> {
  const report: ImportReport = { quotes: 0, contracts: 0, invoices: 0, skipped: 0, errors: [] };
  // Newest copy of each document wins (backups may contain older local copies).
  const latest = new Map<string, LegacyDoc>();
  for (const d of docs) {
    const key = `${d.kind}:${d.kind === 'quote' ? d.data.quoteNo : d.kind === 'contract' ? d.data.contractNo : d.data.number}`;
    const prev = latest.get(key);
    const at = (x: LegacyDoc) => ('savedAt' in x.data && x.data.savedAt ? String(x.data.savedAt) : '');
    if (!prev || at(d) > at(prev)) latest.set(key, d);
  }
  const ordered = [...latest.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'quote' ? -1 : b.kind === 'quote' ? 1 : a.kind === 'contract' ? -1 : 1));
  const today = new Date().toISOString().slice(0, 10);
  await withTenant(db, tenantId, async (tx) => {
    const [co] = await tx.select().from(s.company).limit(1);
    const vatRegistered = !!co?.vatRegistered;
    let maxContract = 0;
    let maxInvoice = 0;
    for (const d of ordered) {
      try {
        if (d.kind === 'quote') {
          const q = d.data;
          const number = q.quoteNo.trim();
          if (!/^MMC-\d{6}\d+$/.test(number)) { report.errors.push(`${d.source}: unexpected quote number ${number}`); continue; }
          const [exists] = await tx.select({ id: s.quote.id }).from(s.quote).where(and(eq(s.quote.number, number), eq(s.quote.revision, 0)));
          if (exists) { report.skipped++; continue; }
          const m = mapQuote(q, vatRegistered);
          const clientName = q.clientCo || q.clientName || 'عميل';
          const partyId = await findOrCreateParty(tx, { name: clientName, vat: q.taxCard, cr: q.crNumber, phone: q.clientPhone });
          const quoteDate = /^\d{4}-\d{2}-\d{2}$/.test(q.quoteDate ?? '') ? q.quoteDate! : (q.savedAt ?? today).slice(0, 10);
          const validUntil = new Date(`${quoteDate}T00:00:00Z`);
          validUntil.setUTCDate(validUntil.getUTCDate() + 15);
          const vu = validUntil.toISOString().slice(0, 10);
          const t = m.calc.totals;
          const [row] = await tx.insert(s.quote).values({
            number, revision: 0, partyId, clientName, clientPhone: normalizePhone(q.clientPhone) ?? q.clientPhone ?? null, projectName: q.project || null, projectLocation: q.clientAddress || null,
            ownerId: await ownerFor(tx, q.savedBy ?? q.salesRep), quoteDate, validUntil: vu, status: vu < today ? 'expired' : 'sent',
            discountType: m.discount.type, discountValue: m.discount.value, vatOn: t.vatApplied, insDeleted: m.insDeleted,
            subtotal: halalasToFixed(t.subtotal), discountAmount: halalasToFixed(t.discount), taxable: halalasToFixed(t.taxable), vatAmount: halalasToFixed(t.vat), total: halalasToFixed(t.total),
            notes: q.techNotes ?? null, terms: q.terms ?? null, legacySource: d.source,
          }).returning();
          await tx.update(s.quote).set({ rootQuoteId: row!.id }).where(eq(s.quote.id, row!.id));
          if (m.lines.length) await tx.insert(s.quoteLine).values(m.lines.map((l, i) => ({ quoteId: row!.id, sort: i, code: l.code, description: l.description, listPrice: String(l.listPrice), unitPrice: String(l.unitPrice), qty: String(l.qty), installCost: String(l.installCost ?? 0), lineTotal: halalasToFixed(m.calc.lines[i]!.amount), isLabor: l.code === 'INS', manualPrice: !!l.manualPrice })));
          const prefix = number.slice(0, 10);
          await bumpCounterTo(tx, 'quote', quoteSequence(number, prefix), new Date(`${quoteDate}T09:00:00Z`));
          report.quotes++;
        } else if (d.kind === 'contract') {
          const c = d.data;
          const number = c.contractNo.trim();
          const [exists] = await tx.select({ id: s.contract.id }).from(s.contract).where(eq(s.contract.number, number));
          if (exists) { report.skipped++; continue; }
          const [q] = c.quoteNo ? await tx.select().from(s.quote).where(eq(s.quote.number, c.quoteNo)).limit(1) : [];
          const total = contractTotalFromHtml(c.html) ?? (q ? toHalalas(q.total) : 0);
          const contractDate = (c.savedAt ?? today).slice(0, 10);
          const [row] = await tx.insert(s.contract).values({
            number, quoteId: q?.id ?? null, partyId: q?.partyId ?? null, ownerId: q?.ownerId ?? (await ownerFor(tx, c.savedBy)), title: 'عقد توريد وتركيب (مستورد)',
            clientBlock: { name: q?.clientName ?? '' }, status: 'signed', contractDate, total: halalasToFixed(total), vatOn: q?.vatOn ?? false, legacySource: d.source,
          }).returning();
          // The HTML snapshot is archived as a file (download only — never rendered inside the app).
          if (!opts.dryRun && opts.filesDir) {
            const buf = Buffer.from(c.html, 'utf8');
            const sha256 = createHash('sha256').update(buf).digest('hex');
            const key = `${tenantId}/legacy/${number}.html`;
            await mkdir(path.dirname(path.resolve(opts.filesDir, key)), { recursive: true });
            await writeFile(path.resolve(opts.filesDir, key), buf);
            const [f] = await tx.insert(s.file).values({ storageKey: key, filename: `${number}-legacy.html`, mime: 'application/octet-stream', size: buf.length, sha256 }).returning();
            await tx.insert(s.issuedDocument).values({ documentType: 'contract', entityId: row!.id, number, fileId: f!.id, sha256 });
          }
          maxContract = Math.max(maxContract, trailingSequence(number));
          report.contracts++;
        } else {
          const inv = d.data;
          const erpName = `LEGACY:${inv.number}`;
          const [exists] = await tx.select({ id: s.invoiceMirror.id }).from(s.invoiceMirror).where(eq(s.invoiceMirror.erpName, erpName));
          if (exists) { report.skipped++; continue; }
          const [q] = inv.quoteNo ? await tx.select().from(s.quote).where(eq(s.quote.number, inv.quoteNo)).limit(1) : [];
          const partyId = q?.partyId ?? (inv.buyer?.name ? await findOrCreateParty(tx, { name: inv.buyer.name, vat: inv.buyer.vat, cr: inv.buyer.crn }) : null);
          const totals = inv.totals ?? { taxable: 0, vat: 0, total: 0 };
          await tx.insert(s.invoiceMirror).values({
            erpName, number: inv.number, typeCode: '388', subtype: inv.buyer?.vat ? 'standard' : 'simplified', partyId, issueDate: inv.issueDate,
            taxable: halalasToFixed(toHalalas(totals.taxable)), vatAmount: halalasToFixed(toHalalas(totals.vat)), total: halalasToFixed(toHalalas(totals.total)),
            // Payment status was never recorded by the old tool: imported as settled so they don't distort AR aging.
            balanceDue: '0.00', lines: (inv.lines ?? []) as never, zatcaUuid: inv.uuid ?? null, zatcaStatus: inv.taxInvoice === false || inv.type === 'plain' ? 'not_applicable' : 'legacy_phase1', qrPayload: inv.qr ?? null, status: 'legacy',
          });
          maxInvoice = Math.max(maxInvoice, inv.icv ?? trailingSequence(inv.number));
          report.invoices++;
        }
      } catch (e) {
        report.errors.push(`${d.source}: ${(e as Error).message}`);
        throw e;
      }
    }
    if (maxContract) await bumpCounterTo(tx, 'contract', maxContract);
    if (maxInvoice) await bumpCounterTo(tx, 'invoice', maxInvoice);
    if (opts.dryRun) throw new DryRun();
  }).catch((e) => { if (!(e instanceof DryRun)) throw e; });
  return report;
}

class DryRun extends Error {}

async function collect(dir: string): Promise<LegacyDoc[]> {
  const out: LegacyDoc[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(p)));
    else if (entry.name.endsWith('.json')) {
      try { out.push(...classify(JSON.parse(await readFile(p, 'utf8')), path.relative(dir, p))); } catch (e) { console.warn(`skip ${p}: ${(e as Error).message}`); }
    }
  }
  return out;
}

// Real paths: inside the deployed image @mmc/db is reached through a pnpm symlink.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))) {
  const args = process.argv.slice(2);
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const dir = arg('--dir');
  if (!dir) { console.error('usage: import-legacy --dir <folder> [--tenant mmc] [--dry-run]'); process.exit(2); }
  const client = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema: s, casing: 'snake_case' }) as unknown as Db;
  const [t] = await db.select().from(s.tenant).where(eq(s.tenant.slug, arg('--tenant') ?? 'mmc'));
  if (!t) throw new Error('tenant not found — run the seed first');
  const docs = await collect(path.resolve(dir));
  const r = await importLegacy(db, t.id, docs, { dryRun: args.includes('--dry-run'), filesDir: process.env.FILES_DIR ?? path.resolve(process.cwd(), '../../apps/api/.data/files') });
  console.log(`${args.includes('--dry-run') ? '[dry run] ' : ''}found ${docs.length} documents → quotes ${r.quotes}, contracts ${r.contracts}, invoices ${r.invoices}, already imported ${r.skipped}`);
  for (const e of r.errors) console.warn(`  ! ${e}`);
  await client.end();
}
