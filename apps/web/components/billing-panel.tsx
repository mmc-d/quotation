'use client';
/** Contract billing panel (milestones → payment requests → 386/388 invoices → payments). Implemented by the finance UI. */
export function BillingPanel({ contractId }: { contractId: string }) {
  return <div data-contract={contractId} />;
}
