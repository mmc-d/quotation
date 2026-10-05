import { company, type Tx } from '@mmc/db';
import { formatNationalAddress } from '@mmc/domain';
import type { CompanyBlock } from '@mmc/doc-templates';
import { readStoredFile } from './files.js';

export async function loadCompany(tx: Tx) {
  const [co] = await tx.select().from(company).limit(1);
  if (!co) throw new Error('company profile missing — run the seed');
  return co;
}

/** Company block for documents; the stamp image is loaded only when it will be applied. */
export async function companyBlock(tx: Tx, withStamp = false): Promise<CompanyBlock> {
  const co = await loadCompany(tx);
  let stampDataUrl: string | null = null;
  if (withStamp && co.stampFileId) {
    const f = await readStoredFile(tx, co.stampFileId);
    if (f) stampDataUrl = `data:${f.mime};base64,${f.data.toString('base64')}`;
  }
  return {
    legalNameAr: co.legalNameAr,
    legalNameEn: co.legalNameEn,
    crNumber: co.crNumber,
    unifiedNumber: co.unifiedNumber,
    vatNumber: co.vatNumber,
    vatRegistered: co.vatRegistered,
    addressLine: formatNationalAddress(co.address ?? {}) || null,
    phone: co.phone,
    email: co.email,
    website: co.website,
    bankName: co.bankName,
    iban: co.iban,
    representativeName: co.representativeName,
    representativeMobile: co.representativeMobile,
    stampDataUrl,
  };
}
