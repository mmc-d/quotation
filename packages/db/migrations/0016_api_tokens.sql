CREATE TABLE "api_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '["mcp:read"]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_token_hash_uq" ON "api_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_token_user_idx" ON "api_token" USING btree ("tenant_id","user_id");--> statement-breakpoint
ALTER TABLE api_token ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE api_token FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON api_token;--> statement-breakpoint
CREATE POLICY tenant_isolation ON api_token USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON api_token TO mmc_app;--> statement-breakpoint
-- token → tenant + user lookup before the tenant is known (like tenant_for_portal_session)
CREATE OR REPLACE FUNCTION tenant_for_api_token(token_hash text) RETURNS TABLE(tenant_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id, user_id FROM api_token WHERE api_token.token_hash = tenant_for_api_token.token_hash AND revoked_at IS NULL AND expires_at > now() LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_for_api_token(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenant_for_api_token(text) TO mmc_app;
