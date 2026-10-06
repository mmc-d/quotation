export interface Product {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  description: string;
  categoryId: string | null;
  brandId: string | null;
  type: 'stock' | 'non_stock' | 'service' | 'labor' | 'kit';
  uom: string;
  listPrice: string;
  installCost: string;
  costPrice: string | null;
  costCurrency: 'USD' | 'SAR' | 'CNY';
  costRateToSar: string | null;
  warrantyMonths: number | null;
  serialTracked: boolean;
  imageUrl: string | null;
  datasheetUrl: string | null;
  status: 'active' | 'discontinued';
  archivedAt: string | null;
}

export const PRODUCT_TYPES: Record<Product['type'], string> = {
  stock: 'صنف مخزني',
  non_stock: 'صنف غير مخزني',
  service: 'خدمة',
  labor: 'أعمال / تركيب',
  kit: 'باقة (مجموعة أصناف)',
};

export const PRODUCT_TYPES_EN: Record<Product['type'], string> = {
  stock: 'Stock item',
  non_stock: 'Non-stock item',
  service: 'Service',
  labor: 'Labor / installation',
  kit: 'Package (kit of items)',
};

export const CURRENCY_AR: Record<Product['costCurrency'], string> = { USD: 'دولار', SAR: 'ريال', CNY: 'يوان' };
export const CURRENCY_EN: Record<Product['costCurrency'], string> = { USD: 'US dollar', SAR: 'Riyal', CNY: 'Yuan' };

/** Plain decimal display (no currency) for NUMERIC strings. */
export function num(v: string | number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
