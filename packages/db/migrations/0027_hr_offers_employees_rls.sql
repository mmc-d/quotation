-- Tenant isolation for the HR tables (0002_rls.sql pattern).
ALTER TABLE job_offer ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE job_offer FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON job_offer;--> statement-breakpoint
CREATE POLICY tenant_isolation ON job_offer USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON job_offer TO mmc_app;--> statement-breakpoint
ALTER TABLE employee ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE employee FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON employee;--> statement-breakpoint
CREATE POLICY tenant_isolation ON employee USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON employee TO mmc_app;
