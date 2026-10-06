-- Phase 7a/7c tenant tables (0002_rls.sql pattern). ai_call is an append-only log (UPDATE/DELETE also revoked in migrate.ts).
ALTER TABLE iot_alarm ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE iot_alarm FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON iot_alarm;--> statement-breakpoint
CREATE POLICY tenant_isolation ON iot_alarm USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON iot_alarm TO mmc_app;--> statement-breakpoint
ALTER TABLE ai_call ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_call FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON ai_call;--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_call USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON ai_call TO mmc_app;--> statement-breakpoint
ALTER TABLE ai_draft ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_draft FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON ai_draft;--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_draft USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_draft TO mmc_app;--> statement-breakpoint
ALTER TABLE commission_plan ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE commission_plan FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON commission_plan;--> statement-breakpoint
CREATE POLICY tenant_isolation ON commission_plan USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON commission_plan TO mmc_app;--> statement-breakpoint
ALTER TABLE commission_entry ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE commission_entry FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON commission_entry;--> statement-breakpoint
CREATE POLICY tenant_isolation ON commission_entry USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON commission_entry TO mmc_app;
