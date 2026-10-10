-- Tenant isolation for the Phase 6C tables (0002_rls.sql pattern).
ALTER TABLE fiscal_year ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fiscal_year FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON fiscal_year;--> statement-breakpoint
CREATE POLICY tenant_isolation ON fiscal_year USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_year TO mmc_app;--> statement-breakpoint
ALTER TABLE vat_return ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE vat_return FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON vat_return;--> statement-breakpoint
CREATE POLICY tenant_isolation ON vat_return USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON vat_return TO mmc_app;--> statement-breakpoint
ALTER TABLE bank_statement ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE bank_statement FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON bank_statement;--> statement-breakpoint
CREATE POLICY tenant_isolation ON bank_statement USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_statement TO mmc_app;--> statement-breakpoint
ALTER TABLE bank_statement_line ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE bank_statement_line FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON bank_statement_line;--> statement-breakpoint
CREATE POLICY tenant_isolation ON bank_statement_line USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_statement_line TO mmc_app;--> statement-breakpoint
ALTER TABLE fixed_asset ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fixed_asset FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON fixed_asset;--> statement-breakpoint
CREATE POLICY tenant_isolation ON fixed_asset USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON fixed_asset TO mmc_app;--> statement-breakpoint
ALTER TABLE gl_run ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gl_run FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON gl_run;--> statement-breakpoint
CREATE POLICY tenant_isolation ON gl_run USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON gl_run TO mmc_app;--> statement-breakpoint
ALTER TABLE fixed_asset_dep ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE fixed_asset_dep FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON fixed_asset_dep;--> statement-breakpoint
CREATE POLICY tenant_isolation ON fixed_asset_dep USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON fixed_asset_dep TO mmc_app;
