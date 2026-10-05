import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Runs as the owner role (DATABASE_ADMIN_URL); then sets the runtime role's password. */
const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('DATABASE_ADMIN_URL is not set');

const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: path.resolve(here, '../migrations') });
const pw = process.env.APP_DB_PASSWORD;
if (pw) await client.unsafe(`ALTER ROLE mmc_app PASSWORD '${pw.replace(/'/g, "''")}'`);
// Tables created by later migrations must stay reachable for the runtime role.
await client.unsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mmc_app');
await client.unsafe('REVOKE UPDATE, DELETE ON audit_log, issued_document FROM mmc_app');
await client.unsafe('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mmc_app');
await client.end();
console.log('migrations applied');
