-- Tenant isolation for the auto-posting bookkeeping table (0002_rls.sql pattern).
ALTER TABLE gl_source_state ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gl_source_state FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON gl_source_state;--> statement-breakpoint
CREATE POLICY tenant_isolation ON gl_source_state USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON gl_source_state TO mmc_app;
