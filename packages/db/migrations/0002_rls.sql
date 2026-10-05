-- Row-level security tenant backstop (docs/erp-plan/modules/01 PLT-37, PLT-80).
-- The API connects as mmc_app (not owner, not superuser), sets app.tenant_id per transaction with
-- set_config(..., true), and every tenant table only shows/accepts that tenant's rows.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mmc_app') THEN
    CREATE ROLE mmc_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO mmc_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mmc_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mmc_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION uuidv7() TO mmc_app;--> statement-breakpoint
-- Audit log is append-only for the application.
REVOKE UPDATE, DELETE ON audit_log FROM mmc_app;--> statement-breakpoint
-- Issued documents are immutable.
REVOKE UPDATE, DELETE ON issued_document FROM mmc_app;--> statement-breakpoint
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('login_event', 'inbox_event')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t.table_name);
  END LOOP;
END $$;--> statement-breakpoint
-- Public quote/payment pages resolve a token before the tenant is known: a narrow SECURITY DEFINER
-- lookup returns only the tenant id for a token, nothing else.
CREATE OR REPLACE FUNCTION tenant_for_public_token(kind text, token text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE kind
    WHEN 'quote' THEN (SELECT tenant_id FROM quote WHERE public_token = token LIMIT 1)
    WHEN 'payment_request' THEN (SELECT tenant_id FROM payment_request WHERE public_token = token LIMIT 1)
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_for_public_token(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenant_for_public_token(text, text) TO mmc_app;--> statement-breakpoint
-- Same for the signed-in user → tenant resolution (auth_user id → app_user tenant).
CREATE OR REPLACE FUNCTION tenant_for_auth_user(auth_id text) RETURNS TABLE(tenant_id uuid, app_user_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id, id, status FROM app_user WHERE auth_user_id = auth_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_for_auth_user(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenant_for_auth_user(text) TO mmc_app;--> statement-breakpoint
-- Invitation check at sign-in: is this e-mail invited/active anywhere? Returns tenant + user.
CREATE OR REPLACE FUNCTION app_user_by_email(addr text) RETURNS TABLE(tenant_id uuid, app_user_id uuid, status text, auth_user_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id, id, status, auth_user_id FROM app_user WHERE lower(email) = lower(addr)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_user_by_email(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_by_email(text) TO mmc_app;--> statement-breakpoint
-- Webhook routing: provider ids (WhatsApp number, ERP site) map to one tenant today.
CREATE OR REPLACE FUNCTION default_tenant() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM tenant ORDER BY created_at LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION default_tenant() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION default_tenant() TO mmc_app;
