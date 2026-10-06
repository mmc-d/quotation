CREATE TABLE "installed_asset" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"site_id" uuid,
	"party_id" uuid,
	"location_id" uuid,
	"project_id" uuid,
	"parent_asset_id" uuid,
	"product_id" uuid,
	"code" text NOT NULL,
	"description" text,
	"serial" text,
	"mac" text,
	"ip" text,
	"firmware" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_on" date,
	"test_passed" boolean,
	"tested_on" date,
	"test_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labour_warranty_end" date,
	"parts_warranty_end" date,
	"manufacturer_warranty_end" date,
	"status" text DEFAULT 'active' NOT NULL,
	"work_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"contract_id" uuid,
	"party_id" uuid,
	"site_id" uuid,
	"template_key" text DEFAULT 'villa_intercom' NOT NULL,
	"stage" text DEFAULT 'kickoff' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"manager_id" uuid,
	"owner_id" uuid,
	"team_id" uuid,
	"branch_id" uuid,
	"required_approvals" jsonb DEFAULT '["specs","door_directions","room_numbers","design"]'::jsonb NOT NULL,
	"materials_ready" boolean DEFAULT false NOT NULL,
	"clock_min_days" integer DEFAULT 45 NOT NULL,
	"clock_max_days" integer DEFAULT 60 NOT NULL,
	"clock_extension_days" integer DEFAULT 0 NOT NULL,
	"clock_started_on" date,
	"delivered_on" date,
	"accepted_on" date,
	"accepted_by_name" text,
	"acceptance_file_id" uuid,
	"warranty_labour_months" integer DEFAULT 12 NOT NULL,
	"warranty_parts_months" integer DEFAULT 24 NOT NULL,
	"planned_start" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_approval" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_on" date,
	"approved_by_name" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_clock_pause" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"kind" text DEFAULT 'client_delay' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_stage_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"from_stage" text NOT NULL,
	"to_stage" text NOT NULL,
	"overridden_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_task" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"title" text NOT NULL,
	"location_id" uuid,
	"assignee_id" uuid,
	"due_date" date,
	"status" text DEFAULT 'todo' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_location" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" text DEFAULT 'unit' NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snag" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"location_id" uuid,
	"description" text NOT NULL,
	"photo_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignee_id" uuid,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"fixed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"channel" text DEFAULT 'phone' NOT NULL,
	"party_id" uuid,
	"site_id" uuid,
	"location_id" uuid,
	"asset_id" uuid,
	"contact_name" text,
	"contact_phone" text,
	"subject" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"coverage" text NOT NULL,
	"coverage_reason" text NOT NULL,
	"owner_id" uuid,
	"team_id" uuid,
	"branch_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'work' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"hours" numeric(14, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"project_id" uuid,
	"ticket_id" uuid,
	"party_id" uuid,
	"site_id" uuid,
	"location_id" uuid,
	"asset_id" uuid,
	"coverage" text DEFAULT 'project' NOT NULL,
	"coverage_reason" text,
	"technician_id" uuid,
	"crew_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"check_in_at" timestamp with time zone,
	"check_in_lat" text,
	"check_in_lng" text,
	"check_out_at" timestamp with time zone,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photo_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parts_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"findings" text,
	"signature_name" text,
	"signature_file_id" uuid,
	"report_file_id" uuid,
	"completed_at" timestamp with time zone,
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
ALTER TABLE "installed_asset" ADD CONSTRAINT "installed_asset_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_asset" ADD CONSTRAINT "installed_asset_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_asset" ADD CONSTRAINT "installed_asset_location_id_site_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."site_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_asset" ADD CONSTRAINT "installed_asset_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_asset" ADD CONSTRAINT "installed_asset_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_manager_id_app_user_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_acceptance_file_id_file_id_fk" FOREIGN KEY ("acceptance_file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_approval" ADD CONSTRAINT "project_approval_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_clock_pause" ADD CONSTRAINT "project_clock_pause_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_log" ADD CONSTRAINT "project_stage_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_log" ADD CONSTRAINT "project_stage_log_by_app_user_id_fk" FOREIGN KEY ("by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_location_id_site_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."site_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_location" ADD CONSTRAINT "site_location_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snag" ADD CONSTRAINT "snag_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snag" ADD CONSTRAINT "snag_location_id_site_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."site_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snag" ADD CONSTRAINT "snag_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snag" ADD CONSTRAINT "snag_verified_by_app_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_location_id_site_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."site_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_asset_id_installed_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."installed_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_location_id_site_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."site_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_asset_id_installed_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."installed_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_technician_id_app_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_signature_file_id_file_id_fk" FOREIGN KEY ("signature_file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_report_file_id_file_id_fk" FOREIGN KEY ("report_file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "installed_asset_site_idx" ON "installed_asset" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "installed_asset_project_idx" ON "installed_asset" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installed_asset_serial_uq" ON "installed_asset" USING btree ("tenant_id","code","serial");--> statement-breakpoint
CREATE UNIQUE INDEX "project_number_uq" ON "project" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "project_contract_uq" ON "project" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX "project_stage_idx" ON "project" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE INDEX "project_approval_idx" ON "project_approval" USING btree ("tenant_id","project_id","kind");--> statement-breakpoint
CREATE INDEX "project_clock_pause_idx" ON "project_clock_pause" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "project_stage_log_idx" ON "project_stage_log" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "project_task_idx" ON "project_task" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "site_location_site_idx" ON "site_location" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "site_location_parent_idx" ON "site_location" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "snag_project_idx" ON "snag" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_number_uq" ON "ticket" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "ticket_status_idx" ON "ticket" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "time_entry_wo_idx" ON "time_entry" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_number_uq" ON "work_order" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "work_order_status_idx" ON "work_order" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "work_order_tech_idx" ON "work_order" USING btree ("tenant_id","technician_id","scheduled_start");--> statement-breakpoint
CREATE INDEX "work_order_project_idx" ON "work_order" USING btree ("tenant_id","project_id");