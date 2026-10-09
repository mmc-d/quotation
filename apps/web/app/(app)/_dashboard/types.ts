/** GET /api/dashboard/home — see apps/api/src/modules/dashboard.service.ts. Money is SAR (fixed-2 strings). */

export type Severity = 'critical' | 'warning' | 'info';
export interface ActionItem { key: string; severity: Severity; count: number; amount: string | null; sub: number | null; href: string }

export interface SalesFigures {
  count: number; value: string; accepted: number; acceptedValue: string; lost: number;
  winRate: number | null; avgDiscountPercent: number; marginPercent: number | null;
}

export type SeriesKey = 'quoted' | 'contracted' | 'collected';
export type TrendPoint = { from: string; to: string } & Partial<Record<SeriesKey, string>>;

export interface Home {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  asOf: string;
  visibility: { margin: boolean; payables: boolean };
  actions: ActionItem[];
  cash: {
    collected: { value: string; prev: string } | null;
    receivables: { outstanding: string; overdue: string; requests: string | null; invoices: string | null } | null;
    expected: { d14: string; d30: string; scheduled30: string } | null;
    payables: { owed: string; overdue: string; d14: string; d30: string } | null;
  };
  sales: (SalesFigures & { prev: SalesFigures; pipelineWeighted: string | null; openOpportunities: number | null; newLeads: number | null }) | null;
  funnel: { key: 'quoted' | 'accepted' | 'contracted' | 'invoiced' | 'collected'; value: string; fromPrev: number | null; ofQuoted: number | null }[] | null;
  projects: {
    total: number; byStage: Record<string, number>; onHold: number; clocks: Record<string, number>; openSnags: number; approvalsPending: number;
    atRisk: { id: string; number: string; name: string; customer: string | null; stage: string; level: 'warn70' | 'warn90' | 'overdue'; elapsed: number; maxDays: number; targetMax: string | null; paused: boolean }[];
  } | null;
  trend: { granularity: 'week' | 'month' | 'quarter'; series: SeriesKey[]; points: TrendPoint[] };
  team: { id: string; name: string; quotes: number; won: number; lost: number; winRate: number | null; value: string; wonValue: string; avgDiscountPercent: number; marginPercent: number | null }[] | null;
}
