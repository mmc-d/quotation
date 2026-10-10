import { realpathSync } from 'node:fs';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DEFAULT_LOST_REASONS, DEFAULT_PIPELINE, DEFAULT_SERIES, fixedSaudiHolidays, ROLE_TEMPLATES } from '@mmc/domain';
import * as s from './schema/index.js';
import { withTenant, type Db } from './index.js';
import { seedLedger } from './seed-ledger.js';
import { DEFAULT_MESSAGE_TEMPLATES, DEFAULT_TECH_NOTES, DEFAULT_TERMS } from './seed-data/defaults.js';

/**
 * Idempotent seed: tenant, company (public registration data only — the representative's name and
 * mobile, bank and stamp are entered by an admin in Settings, never committed), Jeddah head-office
 * branch, role templates, numbering series continuing the legacy formats, pipeline, lost reasons,
 * contract clause library (verbatim legacy articles), message templates, the starter chart of accounts
 * and ledger settings (only when the tenant has no accounts), and the owner invitation.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export async function seed(db: Db, opts: { ownerEmail: string; tenantSlug?: string }) {
  const slug = opts.tenantSlug ?? 'mmc';
  let [tenant] = await db.select().from(s.tenant).where(eq(s.tenant.slug, slug));
  if (!tenant) [tenant] = await db.insert(s.tenant).values({ slug, name: 'المدى المبارك للتجارة والحلول الذكية' }).returning();
  const tenantId = tenant!.id;

  await withTenant(db, tenantId, async (tx) => {
    let [co] = await tx.select().from(s.company).limit(1);
    if (!co) {
      [co] = await tx.insert(s.company).values({
        legalNameAr: 'المدى المبارك للتجارة والحلول الذكية',
        legalNameEn: 'Al-Mada Al-Mubarak for Trading and Smart Solutions',
        unifiedNumber: '7054249128',
        crNumber: '7054249128',
        // VAT lookup by CR returned no registration as of 2026-09-25 (owner to confirm on FATOORA).
        vatRegistered: false,
        address: { city: 'جدة', district: 'النخيل', country: 'SA' },
        quoteDefaults: { validityDays: 15, notesAr: DEFAULT_TECH_NOTES, termsAr: DEFAULT_TERMS },
      }).returning();
    }
    const [br] = await tx.select().from(s.branch).limit(1);
    if (!br) await tx.insert(s.branch).values({ companyId: co!.id, code: 'JED', nameAr: 'جدة — المكتب الرئيسي', nameEn: 'Jeddah — Head office', isHeadOffice: true, address: { city: 'جدة', district: 'النخيل' } });

    for (const [key, r] of Object.entries(ROLE_TEMPLATES)) {
      await tx.insert(s.role).values({ key, nameAr: r.name_ar, nameEn: r.name_en, grants: r.grants as Record<string, string>, maxDiscountPercent: r.maxDiscountPercent ?? 0, isSystem: true })
        .onConflictDoUpdate({ target: [s.role.tenantId, s.role.key], set: { grants: r.grants as Record<string, string>, nameAr: r.name_ar, nameEn: r.name_en, maxDiscountPercent: r.maxDiscountPercent ?? 0 } });
    }

    for (const [documentType, spec] of Object.entries(DEFAULT_SERIES)) {
      await tx.insert(s.numberingSeries).values({ documentType, pattern: spec.pattern, reset: spec.reset }).onConflictDoNothing();
    }

    let [pl] = await tx.select().from(s.pipeline).limit(1);
    if (!pl) {
      [pl] = await tx.insert(s.pipeline).values({ name: 'المبيعات / Sales', isDefault: true }).returning();
      await tx.insert(s.pipelineStage).values(DEFAULT_PIPELINE.map((st, i) => ({ pipelineId: pl!.id, key: st.key, nameAr: st.name_ar, nameEn: st.name_en, probability: st.probability, kind: st.kind, sort: i })));
    }
    const lr = await tx.select().from(s.lostReason).limit(1);
    if (!lr.length) await tx.insert(s.lostReason).values(DEFAULT_LOST_REASONS.map((r) => ({ key: r.key, nameAr: r.name_ar, nameEn: r.name_en })));

    // Clause libraries per contract template set (supply_install | supply_only | maintenance); sort is the order within the set.
    const clauses = JSON.parse(readFileSync(path.resolve(here, 'seed-data/clauses.json'), 'utf8')) as { templateSet?: string; key: string; category: string; titleAr: string; bodyAr: string }[];
    const perSet = new Map<string, number>();
    for (const c of clauses) {
      const templateSet = c.templateSet ?? 'supply_install';
      const sort = perSet.get(templateSet) ?? 0;
      perSet.set(templateSet, sort + 1);
      await tx.insert(s.clauseTemplate).values({ templateSet, key: c.key, category: c.category, titleAr: c.titleAr, bodyAr: c.bodyAr, sort }).onConflictDoNothing();
    }

    // Fixed-date Saudi public holidays for this year and next (Eid dates follow Umm al-Qura and are entered per year).
    const year = new Date().getUTCFullYear();
    for (const h of [...fixedSaudiHolidays(year), ...fixedSaudiHolidays(year + 1)]) {
      await tx.insert(s.businessHoliday).values({ date: h.date, nameAr: h.name_ar, nameEn: h.name_en }).onConflictDoNothing();
    }

    for (const m of DEFAULT_MESSAGE_TEMPLATES) {
      await tx.insert(s.messageTemplate).values({ ...m, variables: m.variables }).onConflictDoNothing();
    }

    await seedLedger(tx);

    const email = opts.ownerEmail.toLowerCase();
    let [owner] = await tx.select().from(s.appUser).where(eq(s.appUser.email, email));
    if (!owner) [owner] = await tx.insert(s.appUser).values({ email, nameAr: 'المالك', status: 'invited', invitedAt: new Date() }).returning();
    const [ownerRole] = await tx.select().from(s.role).where(eq(s.role.key, 'owner'));
    await tx.insert(s.userRole).values({ userId: owner!.id, roleId: ownerRole!.id }).onConflictDoNothing();
  });
  return tenantId;
}

// Real paths: inside the deployed image @mmc/db is reached through a pnpm symlink.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is not set');
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema: s, casing: 'snake_case' }) as unknown as Db;
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'owner@mmc.local';
  const id = await seed(db, { ownerEmail });
  console.log(`seeded tenant ${id}; owner invitation: ${ownerEmail}`);
  await client.end();
}
