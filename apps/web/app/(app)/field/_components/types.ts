/** Shapes returned by /api/field/* (see apps/api/src/modules/field-service.controller.ts). */

export interface LocationNode { id: string; siteId: string; parentId: string | null; kind: string; name: string; sort: number; assetCount: number; children: LocationNode[] }
export interface LocationTreeResponse { site: { id: string; name: string; partyId: string | null; city: string | null }; tree: LocationNode[] }

export interface TestResult { key: string; ok: boolean; note?: string }

export interface AssetRow {
  id: string; code: string; description: string | null; serial: string | null; mac: string | null; ip: string | null; firmware: string | null;
  siteId: string | null; partyId: string | null; locationId: string | null; projectId: string | null; parentAssetId: string | null; productId: string | null; workOrderId: string | null;
  installedOn: string | null; testPassed: boolean | null; testedOn: string | null; testResults: TestResult[];
  labourWarrantyEnd: string | null; partsWarrantyEnd: string | null; manufacturerWarrantyEnd: string | null;
  status: string; version: number; attributes: Record<string, string>; locationPath: string | null;
}

export interface CoverageDecision { coverage: string; reasonAr: string; reasonEn: string }

export interface WoSummary {
  id: string; number: string; type: string; status: string; title: string; coverage: string;
  projectId: string | null; ticketId: string | null; partyId: string | null; siteId: string | null; locationId: string | null; assetId: string | null;
  technicianId: string | null; crewIds: string[]; scheduledStart: string | null; scheduledEnd: string | null; checkInAt: string | null; completedAt: string | null;
  partyName: string | null; siteName: string | null; siteCity: string | null; navUrl: string | null; locationPath: string | null;
  technicianName: string | null; crewNames: string[];
}

export interface AssetDetail extends AssetRow {
  site: { id: string; name: string; city: string | null; partyId: string | null } | null;
  party: { id: string; nameAr: string } | null;
  project: { id: string; number: string; name: string; stage: string } | null;
  parent: { id: string; code: string; serial: string | null } | null;
  children: { id: string; code: string; serial: string | null; mac: string | null; status: string }[];
  warranty: { labourEnd: string | null; partsEnd: string | null; manufacturerEnd: string | null };
  coverageToday: CoverageDecision & { date: string };
  workOrders: WoSummary[];
  tickets: { id: string; number: string; subject: string; status: string; coverage: string; createdAt: string }[];
  timeline: { kind: 'work_order' | 'ticket' | 'test' | 'installed'; id: string; at: string; number?: string; title?: string; status?: string; type?: string; coverage?: string; passed?: boolean | null; registeredHere?: boolean }[];
}

export interface TicketRow {
  id: string; number: string; channel: string; partyId: string | null; siteId: string | null; locationId: string | null; assetId: string | null;
  contactName: string | null; contactPhone: string | null; subject: string; description: string | null; priority: string; status: string;
  coverage: string; coverageReason: string; createdAt: string; resolvedAt: string | null; version: number;
  partyName: string | null; siteName: string | null; asset: { id: string; code: string; serial: string | null } | null; locationPath: string | null;
}
export interface TicketDetail extends TicketRow { workOrders: WoSummary[]; matchedBy?: 'phone' | null; coverageReasonEn?: string }

export interface ChecklistItem { key: string; labelAr: string; labelEn: string; required: boolean; done?: boolean; value?: string | null }

export interface WorkOrderView extends WoSummary {
  description: string | null; coverageReason: string | null; version: number;
  checklist: ChecklistItem[]; findings: string | null; signatureName: string | null; signatureFileId: string | null; checkOutAt: string | null;
  photos: { fileId: string; filename: string; mime: string; size: number; url: string }[];
  parts: { code: string; description?: string; qty: string; serial?: string | null }[];
  assets: AssetRow[];
  ticket: { id: string; number: string; subject: string; status: string; contactName: string | null; contactPhone: string | null; coverage: string } | null;
  project: { id: string; number: string; name: string; stage: string; status: string } | null;
  site: { id: string; name: string; city: string | null; district: string | null; street: string | null; buildingNumber: string | null; lat: string | null; lng: string | null; mapLink: string | null; accessNotes: string | null } | null;
  party: { id: string; nameAr: string; phone: string | null } | null;
  asset: { id: string; code: string; serial: string | null; mac: string | null } | null;
  timeEntries: { id: string; userId: string; userName: string | null; kind: string; startedAt: string; endedAt: string | null; hours: string | null }[];
  missing: { key: string; ar: string; en: string }[];
  allowedTransitions: string[];
  reportUrl: string | null;
  canDispatch: boolean;
}

export interface BoardWo extends WoSummary { role: 'lead' | 'crew' }
export interface DispatchBoard { from: string; to: string; technicians: { id: string; name: string | null; isTechnician: boolean; workOrders: BoardWo[] }[]; unscheduled: WoSummary[] }
