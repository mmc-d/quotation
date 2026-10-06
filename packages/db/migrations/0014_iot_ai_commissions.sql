CREATE TABLE "ai_call" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"user_id" uuid,
	"feature" text NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(18, 6),
	"status" text NOT NULL,
	"input_summary" text,
	"output" jsonb,
	"error" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_draft" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"feature" text NOT NULL,
	"call_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"applied_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid,
	"invoice_id" uuid NOT NULL,
	"contract_id" uuid,
	"earned" numeric(18, 2) NOT NULL,
	"payable" numeric(18, 2) DEFAULT '0' NOT NULL,
	"paid" numeric(18, 2) DEFAULT '0' NOT NULL,
	"period" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_plan" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"basis" text DEFAULT 'revenue' NOT NULL,
	"rate_percent" numeric(18, 6) NOT NULL,
	"category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_alarm" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"external_id" text NOT NULL,
	"device_id" text NOT NULL,
	"dedup_key" text NOT NULL,
	"alarm_type" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"asset_id" uuid,
	"ticket_id" uuid,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "installed_asset" ADD COLUMN "iot_device_id" text;--> statement-breakpoint
ALTER TABLE "installed_asset" ADD COLUMN "iot_online" boolean;--> statement-breakpoint
ALTER TABLE "installed_asset" ADD COLUMN "iot_last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_call" ADD CONSTRAINT "ai_call_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft" ADD CONSTRAINT "ai_draft_call_id_ai_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."ai_call"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_draft" ADD CONSTRAINT "ai_draft_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entry" ADD CONSTRAINT "commission_entry_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entry" ADD CONSTRAINT "commission_entry_plan_id_commission_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."commission_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarm" ADD CONSTRAINT "iot_alarm_asset_id_installed_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."installed_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarm" ADD CONSTRAINT "iot_alarm_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_feature_idx" ON "ai_call" USING btree ("tenant_id","feature","created_at");--> statement-breakpoint
CREATE INDEX "ai_draft_status_idx" ON "ai_draft" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_entry_uq" ON "commission_entry" USING btree ("tenant_id","user_id","invoice_id","plan_id");--> statement-breakpoint
CREATE INDEX "commission_entry_user_idx" ON "commission_entry" USING btree ("tenant_id","user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "iot_alarm_external_uq" ON "iot_alarm" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE INDEX "iot_alarm_dedup_idx" ON "iot_alarm" USING btree ("tenant_id","dedup_key","status");