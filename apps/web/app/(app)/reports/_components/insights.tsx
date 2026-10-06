'use client';
import { Info } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Badge } from '@/components/ui';

/** Shapes of /api/insights/* (finance & project profitability from MMC Core data). */
export type Bucket = 'current' | '1_30' | '31_60' | '61_90' | '90_plus';

export interface FinanceInsights {
  source: { ar: string; en: string };
  backOffice: 'erpnext' | 'fake';
  asOf: string;
  months: { month: string; collected: string; invoicedNet: string; invoicedGross: string }[];
  totals: { collected: string; invoicedNet: string };
  ar: { outstanding: string; invoices: number; buckets: Record<Bucket, string>; topDebtors: { partyId: string | null; name: string; outstanding: string }[] };
  dso: { days: number | null; revenue90Gross: string; formula: string };
  paymentRequests: { open: number; outstanding: string; overdueCount: number; overdue: string };
  costVisible: boolean;
  ap: { open: string; bills: number } | null;
  commitments: { open: string; orders: number } | null;
  stock: { value: string; products: number; withoutCost: number } | null;
}

export interface ProjectProfit {
  contractValue: string; invoiced: string; collected: string; labourHours: string; invoicedPct: number | null; costVisible: boolean;
  materialCost?: string; committedCost?: string; labourCost?: string; quoteCost?: string | null; costAtCompletion?: string; margin?: string; marginPct?: number | null; flags?: string[];
}

export interface ProjectProfitRow extends ProjectProfit {
  id: string; number: string; name: string; stage: string; status: string; contractId: string | null; contractNumber: string | null; customer: string | null;
}

export interface ProjectsInsights {
  source: { ar: string; en: string };
  assumptions: { labourRateSar: string; lowMarginPercent: number };
  costVisible: boolean;
  rows: ProjectProfitRow[];
  totals: { projects: number; contractValue: string; invoiced: string; collected: string; materialCost?: string; committedCost?: string; labourCost?: string; costAtCompletion?: string; margin?: string; marginPct?: number | null };
}

export interface ProjectInsight extends ProjectProfit {
  source: { ar: string; en: string };
  assumptions: { labourRateSar: string; lowMarginPercent: number };
  id: string; number: string; name: string;
  materials?: { productId: string; code: string; name: string; issuedQty: string; returnedQty: string; netQty: string; cost: string }[];
  committedLines?: { orderId: string; number: string; status: string; code: string; openQty: string; valueSar: string }[];
}

/** «من بيانات النظام — الدفاتر المحاسبية في ERPNext» — shown on every insights view. */
export function SourceNote({ className }: { className?: string }) {
  const { bi } = useI18n();
  return (
    <p className={`flex items-start gap-2 rounded-lg bg-tint/70 px-3 py-2 text-xs text-gold-dark ${className ?? ''}`}>
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>{bi('من بيانات النظام — الدفاتر المحاسبية في ERPNext', 'From MMC Core data — the books live in ERPNext')}</span>
    </p>
  );
}

/** Margin badge: red below the low-margin threshold, gold below 30%, green above. */
export function MarginBadge({ pct, low = 20 }: { pct: number | null | undefined; low?: number }) {
  if (pct === null || pct === undefined) return <Badge>—</Badge>;
  return <Badge tone={pct < low ? 'red' : pct < 30 ? 'gold' : 'green'}><span className="num">{pct.toFixed(1)}%</span></Badge>;
}

export function FlagBadges({ flags }: { flags?: string[] }) {
  const { bi } = useI18n();
  if (!flags?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.includes('low_margin') && <Badge tone="red">{bi('هامش منخفض', 'Low margin')}</Badge>}
      {flags.includes('cost_overrun') && <Badge tone="gold">{bi('تجاوز تكلفة العرض', 'Over quote cost')}</Badge>}
    </span>
  );
}
