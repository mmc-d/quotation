/** Shapes returned by /api/service/* (see apps/api/src/modules/service.controller.ts). */

export interface SlaPart { due: string; doneAt: string | null; state: 'ok' | 'at_risk' | 'breached' | 'met' }
export interface TicketSla { response: SlaPart | null; resolution: SlaPart | null }

export interface AgreementRow {
  id: string; number: string; partyId: string; siteIds: string[]; assetIds: string[]; tier: string;
  startDate: string; endDate: string; visitsPerYear: number; responseHours: number; resolutionHours: number; coverage: 'business' | '24x7';
  partsIncluded: boolean; price: string; billingFrequency: string; vatOn: boolean; status: string; autoRenew: boolean; upliftPercent: number;
  renewalOfId: string | null; renewalNotifiedAt: string | null; cancelledAt: string | null; notes: string | null; ownerId: string | null; version: number; createdAt: string;
  tierLabel: { key: string; ar: string; en: string };
  partyName: string | null;
  sites: { id: string; name: string; city: string | null }[];
  assetCount: number; nextVisit: string | null; openBalance: string; annualValue: string;
}

export interface ChainLink { id: string; number: string; startDate: string; endDate: string; status: string; price: string }

export interface AgreementView extends AgreementRow {
  party: { id: string; nameAr: string; nameEn: string | null; phone: string | null } | null;
  assets: { id: string; code: string; description: string | null; serial: string | null; mac: string | null; siteId: string | null; locationPath: string | null; status: string; labourWarrantyEnd: string | null; partsWarrantyEnd: string | null }[];
  visits: {
    id: string; siteId: string | null; siteName: string | null; dueDate: string; status: string;
    workOrder: { id: string; number: string; status: string; scheduledStart: string | null; completedAt: string | null; technicianId: string | null; technicianName: string | null; csatScore: number | null } | null;
  }[];
  billing: {
    vatApplies: boolean;
    schedule: { from: string; to: string; net: string; vat: string; gross: string }[];
    requests: {
      id: string; number: string; periodFrom: string | null; periodTo: string | null; amount: string; paidAmount: string; status: string; dueDate: string | null; sentAt: string | null; payUrl: string | null;
      invoices: { id: string; number: string; typeCode: string; total: string; balanceDue: string; status: string; issueDate: string; paymentRequestId: string }[];
    }[];
    total: string; paid: string;
  };
  tickets: {
    rows: { id: string; number: string; subject: string; status: string; coverage: string; priority: string; createdAt: string; sla: TicketSla }[];
    stats: { count: number; open: number; responseMet: number; responseBreached: number; resolutionMet: number; resolutionBreached: number };
  };
  renewalChain: ChainLink[];
  renewal: ChainLink | null;
}

export interface AgreementsReport {
  activeCount: number; annualValue: string; byTier: Record<string, number>;
  renewalsDue: { id: string; number: string; partyId: string; partyName: string | null; endDate: string; price: string; autoRenew: boolean; renewalDrafted: boolean; notifiedAt: string | null }[];
}

export interface CsatReport {
  count: number; average: number | null; distribution: Record<string, number>;
  byTechnician: { technicianId: string | null; name: string | null; average: number | null; count: number }[];
}

export interface SlaReport {
  months: { month: string; tickets: number; response: { met: number; breached: number; open: number }; resolution: { met: number; breached: number; open: number }; responseMetPct: number | null; resolutionMetPct: number | null }[];
}

export interface CsatInfo { url: string; token: string; score: number | null; comment: string | null; at: string | null; available: boolean }

export interface PortalAccount { id: string; partyId: string; partyName: string; contactId: string | null; phone: string; name: string | null; status: string; lastLoginAt: string | null; createdAt: string }
