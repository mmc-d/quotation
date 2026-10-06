CREATE TABLE "agreement_visit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"site_id" uuid,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"work_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"contact_id" uuid,
	"phone" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_otp" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_agreement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"party_id" uuid NOT NULL,
	"site_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"visits_per_year" integer DEFAULT 4 NOT NULL,
	"response_hours" integer DEFAULT 8 NOT NULL,
	"resolution_hours" integer DEFAULT 48 NOT NULL,
	"coverage" text DEFAULT 'business' NOT NULL,
	"parts_included" boolean DEFAULT false NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"billing_frequency" text DEFAULT 'annual' NOT NULL,
	"vat_on" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"uplift_percent" integer DEFAULT 0 NOT NULL,
	"renewal_of_id" uuid,
	"renewal_notified_at" timestamp with time zone,
	"cancelled_at" date,
	"notes" text,
	"owner_id" uuid,
	"team_id" uuid,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_request" ADD COLUMN "agreement_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_request" ADD COLUMN "period_from" date;--> statement-breakpoint
ALTER TABLE "payment_request" ADD COLUMN "period_to" date;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "agreement_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "sla_response_due" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "sla_resolution_due" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "first_response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "sla_escalations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "portal_account_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "agreement_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "csat_score" integer;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "csat_comment" text;--> statement-breakpoint
ALTER TABLE "work_order" ADD COLUMN "csat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agreement_visit" ADD CONSTRAINT "agreement_visit_agreement_id_service_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."service_agreement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_visit" ADD CONSTRAINT "agreement_visit_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_account" ADD CONSTRAINT "portal_account_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_account" ADD CONSTRAINT "portal_account_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_account_id_portal_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."portal_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD CONSTRAINT "service_agreement_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD CONSTRAINT "service_agreement_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD CONSTRAINT "service_agreement_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_visit_due_idx" ON "agreement_visit" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_account_phone_uq" ON "portal_account" USING btree ("tenant_id","phone","party_id");--> statement-breakpoint
CREATE INDEX "portal_otp_phone_idx" ON "portal_otp" USING btree ("tenant_id","phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_session_token_uq" ON "portal_session" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "service_agreement_number_uq" ON "service_agreement" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "service_agreement_party_idx" ON "service_agreement" USING btree ("tenant_id","party_id");