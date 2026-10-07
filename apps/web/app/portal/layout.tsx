import type { Metadata } from 'next';
import { PortalShell } from './_components/portal-shell';

/** Customer portal (module 11 §3.2) — outside the staff app; signed in with the `mmc_portal` cookie only. */
export const metadata: Metadata = { title: { default: 'بوابة العملاء · Customer portal', template: '%s · بوابة العملاء' } };

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
