import { execSync } from 'node:child_process';
import postgres from 'postgres';

/** Fresh `mmc_test` database migrated with the real migrations (RLS included). */
export default async function setup() {
  const admin = postgres('postgres://mmc:mmc_dev_only@localhost:5433/postgres', { max: 1, onnotice: () => {} });
  await admin.unsafe('DROP DATABASE IF EXISTS mmc_test WITH (FORCE)');
  await admin.unsafe('CREATE DATABASE mmc_test');
  await admin.end();
  execSync('pnpm exec tsx src/migrate.ts', {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_ADMIN_URL: 'postgres://mmc:mmc_dev_only@localhost:5433/mmc_test', APP_DB_PASSWORD: 'mmc_app_dev_only' },
    stdio: 'inherit',
  });
}
