import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import postgres from 'postgres';

export default async function setup() {
  const admin = postgres('postgres://mmc:mmc_dev_only@localhost:5433/postgres', { max: 1, onnotice: () => {} });
  await admin.unsafe('DROP DATABASE IF EXISTS mmc_e2e WITH (FORCE)');
  await admin.unsafe('CREATE DATABASE mmc_e2e');
  await admin.end();
  rmSync('/tmp/mmc-e2e-files', { recursive: true, force: true });
  const env = { ...process.env, DATABASE_ADMIN_URL: 'postgres://mmc:mmc_dev_only@localhost:5433/mmc_e2e', APP_DB_PASSWORD: 'mmc_app_dev_only', SEED_OWNER_EMAIL: 'owner@e2e.test' };
  const db = new URL('../../../packages/db', import.meta.url).pathname;
  execSync('pnpm exec tsx src/migrate.ts && pnpm exec tsx src/seed.ts', { cwd: db, env, stdio: 'inherit' });
}
