/** Saudi identifiers, phone numbers, addresses and Arabic search normalisation. */

/** VAT number: 15 digits, starts and ends with 3. */
export function isValidVatNumber(v: string | null | undefined): boolean {
  return !!v && /^3\d{13}3$/.test(v.trim());
}

/** Unified (national) number: 10 digits starting with 7 (Commercial Register Law 2025). */
export function isValidUnifiedNumber(v: string | null | undefined): boolean {
  return !!v && /^7\d{9}$/.test(v.trim());
}

/** Legacy CR number: 10 digits. */
export function isValidCrNumber(v: string | null | undefined): boolean {
  return !!v && /^\d{10}$/.test(v.trim());
}

const AR_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

export function westernDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => AR_DIGITS[c] ?? c);
}

/**
 * Normalise a Saudi mobile to E.164 (+9665XXXXXXXX). Accepts 05XXXXXXXX, 5XXXXXXXX, 9665…, 009665…,
 * +966 5…, Arabic-Indic digits and separators. Returns null when it is not a Saudi mobile.
 */
export function normalizeSaudiMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = westernDigits(input).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? `+966${d}` : null;
}

/** Any E.164-ish phone: Saudi mobile normalised, others kept as +digits. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const sa = normalizeSaudiMobile(input);
  if (sa) return sa;
  const d = westernDigits(input).replace(/[^\d]/g, '');
  return d.length >= 8 ? `+${d.replace(/^00/, '')}` : null;
}

export interface NationalAddress {
  buildingNumber?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  postalCode?: string | null;
  additionalNumber?: string | null;
}

/** ZATCA requires building no. (4 digits) and postal code (5 digits) for B2B buyers. */
export function nationalAddressProblems(a: NationalAddress): string[] {
  const p: string[] = [];
  if (!a.street) p.push('street');
  if (!a.city) p.push('city');
  if (!a.district) p.push('district');
  if (!a.buildingNumber || !/^\d{4}$/.test(a.buildingNumber)) p.push('buildingNumber');
  if (!a.postalCode || !/^\d{5}$/.test(a.postalCode)) p.push('postalCode');
  if (a.additionalNumber && !/^\d{4}$/.test(a.additionalNumber)) p.push('additionalNumber');
  return p;
}

export function formatNationalAddress(a: NationalAddress): string {
  return [a.buildingNumber, a.street, a.district, a.city, a.postalCode, a.additionalNumber && `(${a.additionalNumber})`].filter(Boolean).join('، ');
}

/**
 * Arabic search normalisation: alef variants → ا, ة → ه, ى → ي, ؤ/ئ → و/ي, strip tashkeel and
 * tatweel, Arabic-Indic digits → Western, lower-case Latin.
 */
export function normalizeArabic(s: string | null | undefined): string {
  if (!s) return '';
  return westernDigits(s)
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
