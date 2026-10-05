-- New tenant tables get the same tenant-isolation policy as everything else (see 0002_rls.sql).
ALTER TABLE business_holiday ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE business_holiday FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON business_holiday;--> statement-breakpoint
CREATE POLICY tenant_isolation ON business_holiday USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON business_holiday TO mmc_app;
