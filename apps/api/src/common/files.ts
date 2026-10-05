import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, file, type Tx } from '@mmc/db';
import { config } from '../config.js';

/**
 * File storage. Local disk in development; production swaps this for a private Google Cloud Storage
 * bucket in Dammam with signed URLs (same interface). Keys are tenant-prefixed.
 */
export async function storeFile(tx: Tx, tenantId: string, data: Buffer, filename: string, mime: string, actorId?: string | null) {
  const sha256 = createHash('sha256').update(data).digest('hex');
  const key = `${tenantId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${filename.replace(/[^\w.\-]+/g, '_').slice(0, 80)}`;
  const full = path.resolve(config.filesDir, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  const [row] = await tx.insert(file).values({ storageKey: key, filename, mime, size: data.length, sha256, createdBy: actorId ?? null }).returning();
  return row!;
}

export async function readStoredFile(tx: Tx, id: string) {
  const [row] = await tx.select().from(file).where(eq(file.id, id));
  if (!row) return null;
  const data = await readFile(path.resolve(config.filesDir, row.storageKey));
  return { ...row, data };
}
