-- Tenant isolation for cash_voucher (0002_rls.sql pattern).
ALTER TABLE cash_voucher ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE cash_voucher FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON cash_voucher;--> statement-breakpoint
CREATE POLICY tenant_isolation ON cash_voucher USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON cash_voucher TO mmc_app;
