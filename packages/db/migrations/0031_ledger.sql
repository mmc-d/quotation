CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"type" text NOT NULL,
	"parent_id" uuid,
	"is_group" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"posting_key" text,
	"requires_party" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"entry_date" date NOT NULL,
	"period" text NOT NULL,
	"memo" text,
	"kind" text DEFAULT 'manual' NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"source_ref" text,
	"source_event" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"reverses_id" uuid,
	"reversed_by_id" uuid,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"posted_by" uuid,
	"posted_by_name" text,
	"posted_at" timestamp with time zone,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"party_id" uuid,
	"employee_id" uuid,
	"project_id" uuid,
	"cost_center" text,
	"vat_code" text,
	"vat_base" numeric(18, 2),
	"memo" text,
	CONSTRAINT "journal_line_one_side" CHECK ("journal_line"."debit" >= 0 AND "journal_line"."credit" >= 0 AND ("journal_line"."debit" = 0 OR "journal_line"."credit" = 0) AND ("journal_line"."debit" + "journal_line"."credit") > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
	"go_live_date" date,
	"locked_through" date,
	"wip_policy" text DEFAULT 'wip' NOT NULL,
	"employer_gosi_saudi_pct" numeric(18, 2) DEFAULT '11.75' NOT NULL,
	"employer_gosi_other_pct" numeric(18, 2) DEFAULT '2.00' NOT NULL,
	"default_cash_account_id" uuid,
	"default_bank_account_id" uuid,
	"method_accounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vat_return_frequency" text DEFAULT 'quarterly' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_parent_id_account_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_reverses_id_journal_entry_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."journal_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_reversed_by_id_journal_entry_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."journal_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entry_id_journal_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_settings" ADD CONSTRAINT "ledger_settings_default_cash_account_id_account_id_fk" FOREIGN KEY ("default_cash_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_settings" ADD CONSTRAINT "ledger_settings_default_bank_account_id_account_id_fk" FOREIGN KEY ("default_bank_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_code_uq" ON "account" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "account_posting_key_uq" ON "account" USING btree ("tenant_id","posting_key") WHERE "account"."posting_key" is not null;--> statement-breakpoint
CREATE INDEX "account_parent_idx" ON "account" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_number_uq" ON "journal_entry" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_source_uq" ON "journal_entry" USING btree ("tenant_id","source_type","source_id","source_event") WHERE "journal_entry"."source_type" is not null;--> statement-breakpoint
CREATE INDEX "journal_entry_date_idx" ON "journal_entry" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entry_status_idx" ON "journal_entry" USING btree ("tenant_id","status","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entry_reverses_idx" ON "journal_entry" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "journal_line_entry_idx" ON "journal_line" USING btree ("entry_id","line_no");--> statement-breakpoint
CREATE INDEX "journal_line_account_idx" ON "journal_line" USING btree ("tenant_id","account_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_line_party_idx" ON "journal_line" USING btree ("tenant_id","party_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_line_project_idx" ON "journal_line" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_settings_tenant_uq" ON "ledger_settings" USING btree ("tenant_id");