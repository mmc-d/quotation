-- Phase 4 tenant tables get the same tenant-isolation policy as everything else (see 0002_rls.sql).
ALTER TABLE site_location ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE site_location FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON site_location;--> statement-breakpoint
CREATE POLICY tenant_isolation ON site_location USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON site_location TO mmc_app;--> statement-breakpoint
ALTER TABLE project ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE project FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON project;--> statement-breakpoint
CREATE POLICY tenant_isolation ON project USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON project TO mmc_app;--> statement-breakpoint
ALTER TABLE project_stage_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE project_stage_log FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON project_stage_log;--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_stage_log USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON project_stage_log TO mmc_app;--> statement-breakpoint
ALTER TABLE project_clock_pause ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE project_clock_pause FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON project_clock_pause;--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_clock_pause USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON project_clock_pause TO mmc_app;--> statement-breakpoint
ALTER TABLE project_task ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE project_task FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON project_task;--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_task USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON project_task TO mmc_app;--> statement-breakpoint
ALTER TABLE project_approval ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE project_approval FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON project_approval;--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_approval USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON project_approval TO mmc_app;--> statement-breakpoint
ALTER TABLE snag ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE snag FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON snag;--> statement-breakpoint
CREATE POLICY tenant_isolation ON snag USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON snag TO mmc_app;--> statement-breakpoint
ALTER TABLE installed_asset ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE installed_asset FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON installed_asset;--> statement-breakpoint
CREATE POLICY tenant_isolation ON installed_asset USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON installed_asset TO mmc_app;--> statement-breakpoint
ALTER TABLE ticket ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ticket FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON ticket;--> statement-breakpoint
CREATE POLICY tenant_isolation ON ticket USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket TO mmc_app;--> statement-breakpoint
ALTER TABLE work_order ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE work_order FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON work_order;--> statement-breakpoint
CREATE POLICY tenant_isolation ON work_order USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON work_order TO mmc_app;--> statement-breakpoint
ALTER TABLE time_entry ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE time_entry FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON time_entry;--> statement-breakpoint
CREATE POLICY tenant_isolation ON time_entry USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON time_entry TO mmc_app;
