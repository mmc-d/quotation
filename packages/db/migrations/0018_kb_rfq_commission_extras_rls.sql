-- Tenant isolation for the KB / replies / RFQ / commission-extras tables (0002_rls.sql pattern).
ALTER TABLE kb_article ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE kb_article FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON kb_article;--> statement-breakpoint
CREATE POLICY tenant_isolation ON kb_article USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_article TO mmc_app;--> statement-breakpoint
ALTER TABLE canned_reply ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE canned_reply FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON canned_reply;--> statement-breakpoint
CREATE POLICY tenant_isolation ON canned_reply USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON canned_reply TO mmc_app;--> statement-breakpoint
ALTER TABLE ticket_message ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ticket_message FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON ticket_message;--> statement-breakpoint
CREATE POLICY tenant_isolation ON ticket_message USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_message TO mmc_app;--> statement-breakpoint
ALTER TABLE rfq ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE rfq FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON rfq;--> statement-breakpoint
CREATE POLICY tenant_isolation ON rfq USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON rfq TO mmc_app;--> statement-breakpoint
ALTER TABLE supplier_quote ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE supplier_quote FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON supplier_quote;--> statement-breakpoint
CREATE POLICY tenant_isolation ON supplier_quote USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_quote TO mmc_app;--> statement-breakpoint
ALTER TABLE commission_split ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE commission_split FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON commission_split;--> statement-breakpoint
CREATE POLICY tenant_isolation ON commission_split USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON commission_split TO mmc_app;--> statement-breakpoint
ALTER TABLE sales_quota ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_quota FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON sales_quota;--> statement-breakpoint
CREATE POLICY tenant_isolation ON sales_quota USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_quota TO mmc_app;
