import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import postgres from 'postgres';

export default async function setup() {
  const DB = process.env.E2E_DB ?? 'mmc_e2e';
  const admin = postgres('postgres://mmc:mmc_dev_only@localhost:5433/postgres', { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${DB}`);
  await admin.end();
  rmSync(`/tmp/${DB}-files`, { recursive: true, force: true });
  const env = { ...process.env, DATABASE_ADMIN_URL: `postgres://mmc:mmc_dev_only@localhost:5433/${DB}`, APP_DB_PASSWORD: 'mmc_app_dev_only', SEED_OWNER_EMAIL: 'owner@e2e.test' };
  const db = new URL('../../../packages/db', import.meta.url).pathname;
  execSync('pnpm exec tsx src/migrate.ts && pnpm exec tsx src/seed.ts', { cwd: db, env, stdio: 'inherit' });
  // A second invited (never verified) user for the e-mail-verification test.
  const sql = postgres(`postgres://mmc:mmc_dev_only@localhost:5433/${DB}`, { max: 1, onnotice: () => {} });
  await sql`insert into app_user (tenant_id, email, name_ar, status) select id, 'pending@e2e.test', 'معلّق', 'invited' from tenant limit 1`;
  await sql.end();
}
