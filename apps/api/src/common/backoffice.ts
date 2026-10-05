import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ErpNextBackOffice, FakeBackOffice, type BackOfficePort } from '@mmc/erp-connector';
import { nextNumber, withTenant } from '@mmc/db';
import { config } from '../config.js';
import { getDb } from './db.js';
import { loadCompany } from './company.js';

/**
 * The back office for a tenant: ERPNext + KSA compliance app when ERPNEXT_URL is set, otherwise
 * the development fake (JSON files on disk, numbers from Core's MMC-INV series).
 */
const cache = new Map<string, BackOfficePort>();

export function backOffice(tenantId: string): BackOfficePort {
  const hit = cache.get(tenantId);
  if (hit) return hit;
  let bo: BackOfficePort;
  if (config.erpnext.url) {
    bo = new ErpNextBackOffice({ url: config.erpnext.url, apiKey: config.erpnext.apiKey, apiSecret: config.erpnext.apiSecret, company: config.erpnext.company });
  } else {
    const dir = path.resolve(config.filesDir, 'fake-erp', tenantId);
    const fileOf = (kind: string, key: string) => path.join(dir, kind, `${key.replace(/[^\w.\-]+/g, '_')}.json`);
    bo = new FakeBackOffice({
      nextInvoiceNumber: () => withTenant(getDb(), tenantId, async (tx) => (await nextNumber(tx, 'invoice')).number),
      seller: () => withTenant(getDb(), tenantId, async (tx) => {
        const co = await loadCompany(tx);
        return { name: co.legalNameAr, vatNumber: co.vatNumber, vatRegistered: co.vatRegistered };
      }),
      store: {
        async load(kind, key) {
          try { return JSON.parse(await readFile(fileOf(kind, key), 'utf8')); } catch { return null; }
        },
        async save(kind, key, value) {
          await mkdir(path.join(dir, kind), { recursive: true });
          await writeFile(fileOf(kind, key), JSON.stringify(value));
        },
        async list(kind) {
          try {
            const names = (await readdir(path.join(dir, kind))).filter((n) => !n.startsWith('idem_'));
            return Promise.all(names.map(async (n) => JSON.parse(await readFile(path.join(dir, kind, n), 'utf8'))));
          } catch { return []; }
        },
      },
    });
  }
  cache.set(tenantId, bo);
  return bo;
}
