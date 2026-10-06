/** Shapes returned by /api/inventory (purchasing). Cost fields are null without purchase.cost.read. */
import type { ComplianceStatus } from './common';

export interface MrRow {
  id: string; number: string; status: string; projectId: string | null; contractId: string | null; neededBy: string | null; notes: string | null; createdAt: string;
  projectNumber: string | null; projectName: string | null; lineCount: number;
}

export interface MrLine { id: string; productId: string; code: string; description: string | null; qty: string; orderedQty: string; openQty: string }
export interface Reservation { id: string; productId: string; warehouseId: string; qty: string; status: string; code: string; warehouseCode: string }

export interface MrView extends Omit<MrRow, 'projectNumber' | 'projectName' | 'lineCount'> {
  project: { id: string; number: string; name: string } | null;
  lines: MrLine[];
  purchaseOrders: { id: string; number: string; status: string }[];
  reservations: Reservation[];
  reserved?: unknown[];
  unmatched?: string[];
}

export interface PoRow {
  id: string; number: string; supplierId: string; status: string; currency: string; rateToSar: string; incoterm: string | null; depositPercent: number;
  orderDate: string | null; expectedOn: string | null; projectId: string | null; materialRequestId: string | null;
  subtotal: string | null; vat: string | null; total: string | null; totalSar: string | null; approverRole: string | null; createdAt: string;
  supplierName: string; projectNumber: string | null;
}

export interface PoLine {
  id: string; sort: number; productId: string | null; code: string; description: string | null; qty: string; unitPrice: string | null; amount: string | null;
  receivedQty: string; billedQty: string; remainingQty: string; materialRequestLineId: string | null; projectId: string | null; compliance: ComplianceStatus | null;
}

export interface PoView extends Omit<PoRow, 'supplierName' | 'projectNumber'> {
  supplier: { id: string; nameAr: string; nameEn: string | null; vatNumber: string | null; phone: string | null; email: string | null } | null;
  project: { id: string; number: string; name: string } | null;
  notes: string | null; createdBy: string | null; approvedBy: string | null; approvedAt: string | null;
  createdByName: string | null; approvedByName: string | null; canApprove: boolean;
  complianceNotes: { productId: string; key: string; en: string }[];
  lines: PoLine[];
  receipts: { id: string; number: string; receivedOn: string; warehouseId: string; shipmentId: string | null }[];
  bills: { id: string; number: string; supplierInvoiceNo: string; billDate: string; matchStatus: string; status: string; total: string | null; currency: string }[];
  match: { status: 'matched' | 'exception'; issues: { line: number; ar: string; en: string }[] };
}

export interface ReceiptView {
  id: string; number: string; orderId: string; warehouseId: string; shipmentId: string | null; receivedOn: string; notes: string | null;
  order: { number: string; status: string } | null; warehouse: { code: string; nameAr: string } | null;
  lines: { id: string; orderLineId: string; productId: string | null; qty: string; unitCostSar: string | null; landedPerUnitSar: string | null; serials: { serial: string; macs: string[] }[]; code: string; description: string | null }[];
}

export interface BillRow {
  id: string; number: string; supplierId: string; orderId: string | null; supplierInvoiceNo: string; billDate: string; currency: string; rateToSar: string;
  subtotal: string | null; vat: string | null; total: string | null; lines: { orderLineId: string; qty: string; unitPrice: string | null }[];
  matchStatus: string; matchIssues: { line: number; ar: string; en: string }[]; fileId: string | null; status: string; supplierName: string; orderNumber: string | null;
}

export interface Warehouse { id: string; code: string; nameAr: string; nameEn: string | null; kind: string; archivedAt: string | null }

export interface ShipmentCharge { kind: string; amountSar: string | null; note?: string }

export interface ShipmentRow {
  id: string; number: string; supplierId: string | null; orderIds: string[]; mode: string; status: string; blNumber: string | null; containers: string[]; vessel: string | null;
  etd: string | null; eta: string | null; broker: string | null; fasahNumber: string | null; fasahDate: string | null; cifSar: string | null; dutySar: string | null; importVatSar: string | null;
  charges: ShipmentCharge[]; docs: Record<string, { done: boolean; fileId?: string | null }>; landedBasis: string | null; landedPostedAt: string | null; notes: string | null; createdAt: string;
  supplierName?: string | null;
}

export interface ShipmentView extends ShipmentRow {
  supplier: { id: string; nameAr: string } | null;
  orders: { id: string; number: string; status: string; currency: string }[];
  receipts: { id: string; number: string; receivedOn: string; orderId: string }[];
  checklist: { key: string; ar: string; en: string; done: boolean; fileId: string | null }[];
  landedMoves: { id: string; productId: string; unitCostSar: string | null; note: string | null; createdAt: string }[];
  warnings?: { key: string; ar: string; en: string }[];
}

export interface LandedResult {
  shipmentId: string; basis: string; chargeSar: string;
  lines: { receiptLineId: string; allocatedSar: string; perUnitSar: string }[];
  products: { productId: string; code: string; allocatedSar: string; perUnitSar: string; avgBefore: string | null; avgAfter: string | null }[];
}

export interface SupplierItem {
  id: string; supplierId: string; productId: string; vendorSku: string | null; price: string | null; currency: string; moq: string | null; leadTimeDays: number | null;
  validUntil: string | null; preferred: boolean; supplierName: string; productCode: string; productName: string;
}
