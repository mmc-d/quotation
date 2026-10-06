-- Phase 7b tenant tables (0002_rls.sql pattern) + portal session → tenant lookup for the cookie (SECURITY DEFINER, like tenant_for_public_token).
ALTER TABLE service_agreement ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE service_agreement FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON service_agreement;--> statement-breakpoint
CREATE POLICY tenant_isolation ON service_agreement USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON service_agreement TO mmc_app;--> statement-breakpoint
ALTER TABLE agreement_visit ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agreement_visit FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON agreement_visit;--> statement-breakpoint
CREATE POLICY tenant_isolation ON agreement_visit USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON agreement_visit TO mmc_app;--> statement-breakpoint
ALTER TABLE portal_account ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE portal_account FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON portal_account;--> statement-breakpoint
CREATE POLICY tenant_isolation ON portal_account USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_account TO mmc_app;--> statement-breakpoint
ALTER TABLE portal_otp ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE portal_otp FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON portal_otp;--> statement-breakpoint
CREATE POLICY tenant_isolation ON portal_otp USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_otp TO mmc_app;--> statement-breakpoint
ALTER TABLE portal_session ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE portal_session FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON portal_session;--> statement-breakpoint
CREATE POLICY tenant_isolation ON portal_session USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_session TO mmc_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION tenant_for_portal_session(token_hash text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM portal_session WHERE portal_session.token_hash = tenant_for_portal_session.token_hash AND revoked_at IS NULL AND expires_at > now() LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_for_portal_session(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenant_for_portal_session(text) TO mmc_app;
