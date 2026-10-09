import { company, type Tx } from '@mmc/db';
import { formatNationalAddress } from '@mmc/domain';
import type { CompanyBlock } from '@mmc/doc-templates';
import { readStoredFile } from './files.js';

export async function loadCompany(tx: Tx) {
  const [co] = await tx.select().from(company).limit(1);
  if (!co) throw new Error('company profile missing — run the seed');
  return co;
}

const dataUrl = async (tx: Tx, fileId: string) => {
  const f = await readStoredFile(tx, fileId);
  return f ? `data:${f.mime};base64,${f.data.toString('base64')}` : null;
};

/** Company block for documents; the stamp image is loaded only when it will be applied, the bank QR only for payment documents. */
export async function companyBlock(tx: Tx, withStamp = false, withBankQr = false): Promise<CompanyBlock> {
  const co = await loadCompany(tx);
  const stampDataUrl = withStamp && co.stampFileId ? await dataUrl(tx, co.stampFileId) : null;
  const bankQrDataUrl = withBankQr && co.bankQrFileId ? await dataUrl(tx, co.bankQrFileId) : null;
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
    bankAccountName: co.bankAccountName,
    bankAccountNumber: co.bankAccountNumber,
    bankQrDataUrl,
    representativeName: co.representativeName,
    representativeMobile: co.representativeMobile,
    stampDataUrl,
  };
}
