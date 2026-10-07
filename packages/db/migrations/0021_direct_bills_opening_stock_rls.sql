-- Tenant isolation for stock_opening (0002_rls.sql pattern).
ALTER TABLE stock_opening ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE stock_opening FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON stock_opening;--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_opening USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_opening TO mmc_app;
