import { calculateQuote, INS_CODE, INS_DESC, syncInstallationLine, type QuoteLineInput, type QuoteTotals, type QuoteLineResult } from '@mmc/domain';
import { today } from '@/lib/format';

/** A quote line as returned by GET /quotes/:id (NUMERIC fields are strings). */
export interface ApiQuoteLine {
  id: string;
  sort: number;
  productId: string | null;
  code: string;
  description: string;
  listPrice: string;
  unitPrice: string;
  qty: string;
  installCost: string;
  unitCost: string | null;
  lineTotal: string;
  isOptional: boolean;
  isLabor: boolean;
  isAutoLabor: boolean;
  manualPrice: boolean;
  imageUrl: string | null;
}

export interface ApprovalRow { id: string; status: string; reasons: string[]; comment: string | null; requestedBy: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string }
export interface IssuedDoc { id: string; number: string; revision: number; fileId: string; sha256: string; issuedAt: string; language: string }
export interface RevisionRow { id: string; revision: number; status: string; total: string; createdAt: string }

export interface QuoteView {
  id: string;
  number: string;
  revision: number;
  status: string;
  version: number;
  partyId: string | null;
  contactId: string | null;
  siteId: string | null;
  opportunityId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  projectName: string | null;
  projectLocation: string | null;
  quoteDate: string;
  validUntil: string | null;
  discountType: 'percent' | 'amount';
  discountValue: string;
  vatOn: boolean;
  insDeleted: boolean;
  notes: string | null;
  terms: string | null;
  total: string;
  costTotal?: string;
  marginTotal?: string;
  lostReason: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  publicToken: string | null;
  ownerId: string | null;
  lines: ApiQuoteLine[];
  computed: { lines: QuoteLineResult[]; totals: QuoteTotals };
  approvalReasons: string[];
  needsApproval: boolean;
  editable: boolean;
  approvals: ApprovalRow[];
  documents: IssuedDoc[];
  revisions: RevisionRow[];
  owner: { id: string; nameAr: string | null; email: string } | null;
  vatRegistered: boolean;
}

export interface Product {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  description: string;
  listPrice: string;
  installCost: string;
  costPrice: string | null;
  costCurrency: string;
  costRateToSar: string | null;
  imageUrl: string | null;
  status: string;
}

/** Editor line (client state). `key` is a stable React key. */
export interface EditLine {
  key: string;
  productId: string | null;
  code: string;
  description: string;
  listPrice: string;
  unitPrice: string;
  qty: string;
  installCost: string;
  unitCost: string | null;
  isOptional: boolean;
  manualPrice: boolean;
  imageUrl: string | null;
}

export interface QuoteDraft {
  partyId: string | null;
  contactId: string | null;
  siteId: string | null;
  opportunityId: string | null;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  projectName: string;
  projectLocation: string;
  quoteDate: string;
  validUntil: string;
  discountType: 'percent' | 'amount';
  discountValue: string;
  vatOn: boolean;
  insDeleted: boolean;
  notes: string;
  terms: string;
  lines: EditLine[];
}

let seq = 0;
export const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyDraft(vatRegistered: boolean): QuoteDraft {
  return {
    partyId: null, contactId: null, siteId: null, opportunityId: null,
    clientName: '', clientPhone: '', clientEmail: '', projectName: '', projectLocation: '',
    quoteDate: today(), validUntil: '', discountType: 'percent', discountValue: '', vatOn: vatRegistered, insDeleted: false,
    notes: '', terms: '', lines: [],
  };
}

export function draftFromView(v: QuoteView): QuoteDraft {
  return {
    partyId: v.partyId, contactId: v.contactId, siteId: v.siteId, opportunityId: v.opportunityId,
    clientName: v.clientName ?? '', clientPhone: v.clientPhone ?? '', clientEmail: v.clientEmail ?? '',
    projectName: v.projectName ?? '', projectLocation: v.projectLocation ?? '',
    quoteDate: v.quoteDate, validUntil: v.validUntil ?? '',
    discountType: v.discountType, discountValue: Number(v.discountValue) ? trimNum(v.discountValue) : '', vatOn: v.vatOn && v.vatRegistered, insDeleted: v.insDeleted,
    notes: v.notes ?? '', terms: v.terms ?? '',
    lines: v.lines.map((l) => ({
      key: l.id, productId: l.productId, code: l.code, description: l.description,
      listPrice: trimNum(l.listPrice), unitPrice: trimNum(l.unitPrice), qty: trimNum(l.qty), installCost: trimNum(l.installCost),
      unitCost: l.unitCost === null ? null : trimNum(l.unitCost), isOptional: l.isOptional, manualPrice: l.manualPrice, imageUrl: l.imageUrl,
    })),
  };
}

/** "1234.5000" → "1234.5" (display-friendly, still a valid NUMERIC). */
export function trimNum(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '0';
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 10000) / 10000);
}

/** Free-typed amount → a value the API accepts (≥ 0, ≤ 4 decimals). */
export function cleanMoney(v: string): string {
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return '0';
  return String(Math.round(n * 10000) / 10000);
}

/** Free-typed quantity → > 0 with ≤ 3 decimals (falls back to 1). */
export function cleanQty(v: string): string {
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return '1';
  const r = Math.round(n * 1000) / 1000;
  return String(r > 0 ? r : 1);
}

export function productUnitCost(p: Product): string | null {
  if (!p.costPrice) return null;
  const rate = p.costCurrency === 'SAR' ? 1 : Number(p.costRateToSar ?? '3.75');
  return trimNum(Number(p.costPrice) * rate);
}

function toDomain(l: EditLine): QuoteLineInput {
  return {
    code: l.code, description: l.description,
    listPrice: cleanMoney(l.listPrice || l.unitPrice), unitPrice: cleanMoney(l.unitPrice), qty: cleanQty(l.qty),
    installCost: cleanMoney(l.installCost), unitCost: l.unitCost === null ? 0 : cleanMoney(l.unitCost),
    isOptional: l.isOptional, manualPrice: l.manualPrice,
  };
}

/** Re-sync the auto-managed INS line (legacy syncInsRow) and keep editor-only fields. */
export function syncLines(lines: EditLine[], insDeleted: boolean): EditLine[] {
  const rest = lines.filter((l) => l.code !== INS_CODE);
  const existing = lines.find((l) => l.code === INS_CODE);
  if (insDeleted) return existing ? [...rest, existing] : rest;
  const out = syncInstallationLine(lines.map(toDomain), { insDeleted });
  const ins = out.find((l) => l.code === INS_CODE);
  if (!ins) return rest;
  return [...rest, {
    key: existing?.key ?? newKey(), productId: null, code: INS_CODE,
    description: existing?.description || INS_DESC,
    // a manual price keeps the user's raw text (so typing "12." doesn't jump)
    listPrice: ins.manualPrice && existing ? existing.unitPrice : trimNum(String(ins.listPrice)),
    unitPrice: ins.manualPrice && existing ? existing.unitPrice : trimNum(String(ins.unitPrice)),
    qty: existing?.qty ?? '1',
    installCost: '0', unitCost: existing?.unitCost ?? null, isOptional: false, manualPrice: !!ins.manualPrice, imageUrl: null,
  }];
}

export function calcDraft(d: QuoteDraft, vatRegistered: boolean) {
  return calculateQuote({
    lines: d.lines.map(toDomain),
    discount: { type: d.discountType, value: cleanMoney(d.discountValue) },
    vatRegistered,
    vatOn: d.vatOn && vatRegistered,
  });
}

/** Body for POST /quotes and PUT /quotes/:id. */
export function draftToBody(d: QuoteDraft, vatRegistered: boolean) {
  const nn = (s: string) => (s.trim() ? s.trim() : null);
  let discountValue = cleanMoney(d.discountValue);
  if (d.discountType === 'percent' && Number(discountValue) > 100) discountValue = '100';
  return {
    partyId: d.partyId, contactId: d.contactId, siteId: d.siteId, opportunityId: d.opportunityId,
    clientName: nn(d.clientName), clientPhone: nn(d.clientPhone), clientEmail: nn(d.clientEmail),
    projectName: nn(d.projectName), projectLocation: nn(d.projectLocation),
    quoteDate: d.quoteDate || undefined, validUntil: d.validUntil || null,
    discountType: d.discountType, discountValue, vatOn: d.vatOn && vatRegistered, insDeleted: d.insDeleted,
    notes: d.notes.trim() ? d.notes : null, terms: d.terms.trim() ? d.terms : null,
    lines: d.lines.map((l) => ({
      productId: l.productId, code: l.code, description: l.description.trim() || l.code,
      listPrice: cleanMoney(l.listPrice || l.unitPrice), unitPrice: cleanMoney(l.unitPrice), qty: cleanQty(l.qty),
      installCost: cleanMoney(l.installCost), unitCost: l.unitCost === null ? null : cleanMoney(l.unitCost),
      isOptional: l.isOptional, manualPrice: l.code === INS_CODE ? l.manualPrice : false, imageUrl: l.imageUrl,
    })),
  };
}

export function quoteNo(number: string, revision: number) {
  return `${number}${revision ? `-R${revision}` : ''}`;
}

export { INS_CODE, INS_DESC };
