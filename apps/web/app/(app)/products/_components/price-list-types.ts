export interface PriceList {
  id: string;
  name: string;
  currency: string;
  validFrom: string | null;
  validTo: string | null;
  segment: string | null;
  isDefault: boolean;
  archivedAt: string | null;
  active: boolean;
  itemCount?: number;
  partyCount?: number;
}

export interface PriceListItem {
  id: string;
  productId: string;
  price: string;
  minQty: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  listPrice: string;
}

export type PriceListDetail = PriceList & { items: PriceListItem[] };

export const SEGMENT_FALLBACK: Record<string, string> = { contractor: 'مقاول', developer: 'مطور عقاري', building_owner: 'مالك مبنى', villa_owner: 'مالك فيلا', consultant: 'استشاري', government: 'جهة حكومية', hotel: 'فندق', office: 'مكاتب', other: 'أخرى' };
