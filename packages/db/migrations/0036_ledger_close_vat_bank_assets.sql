CREATE TABLE "bank_statement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"reference" text,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"closing_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reconciled_at" timestamp with time zone,
	"reconciled_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"date" date NOT NULL,
	"description" text,
	"ref" text,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"matched_line_id" uuid,
	"matched_by" text,
	"matched_at" timestamp with time zone,
	CONSTRAINT "bank_statement_line_side" CHECK ("bank_statement_line"."debit" >= 0 AND "bank_statement_line"."credit" >= 0 AND ("bank_statement_line"."debit" = 0 OR "bank_statement_line"."credit" = 0))
);
--> statement-breakpoint
CREATE TABLE "fiscal_year" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closing_entry_id" uuid,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_asset" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"account_id" uuid NOT NULL,
	"accum_account_id" uuid NOT NULL,
	"expense_account_id" uuid NOT NULL,
	"acquired_on" date NOT NULL,
	"start_month" text NOT NULL,
	"cost" numeric(18, 2) NOT NULL,
	"salvage" numeric(18, 2) DEFAULT '0' NOT NULL,
	"life_months" integer NOT NULL,
	"opening_accumulated" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"disposed_on" date,
	"disposal_proceeds" numeric(18, 2),
	"disposal_entry_id" uuid,
	"source_bill_id" uuid,
	"project_id" uuid,
	"cost_center" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_asset_dep" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"month" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"entry_id" uuid,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vat_return" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"label" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"boxes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"input_vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ledger_net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"filed_on" date,
	"filed_by" uuid,
	"settlement_entry_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_statement_id_bank_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_matched_line_id_journal_line_id_fk" FOREIGN KEY ("matched_line_id") REFERENCES "public"."journal_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year" ADD CONSTRAINT "fiscal_year_closing_entry_id_journal_entry_id_fk" FOREIGN KEY ("closing_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_accum_account_id_account_id_fk" FOREIGN KEY ("accum_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_expense_account_id_account_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_disposal_entry_id_journal_entry_id_fk" FOREIGN KEY ("disposal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_dep" ADD CONSTRAINT "fixed_asset_dep_asset_id_fixed_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_dep" ADD CONSTRAINT "fixed_asset_dep_run_id_gl_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."gl_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_run" ADD CONSTRAINT "gl_run_entry_id_journal_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_return" ADD CONSTRAINT "vat_return_settlement_entry_id_journal_entry_id_fk" FOREIGN KEY ("settlement_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_statement_account_idx" ON "bank_statement" USING btree ("tenant_id","account_id","date_to");--> statement-breakpoint
CREATE INDEX "bank_statement_line_stmt_idx" ON "bank_statement_line" USING btree ("statement_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_line_match_uq" ON "bank_statement_line" USING btree ("tenant_id","matched_line_id") WHERE "bank_statement_line"."matched_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_year_label_uq" ON "fiscal_year" USING btree ("tenant_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_code_uq" ON "fixed_asset" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "fixed_asset_status_idx" ON "fixed_asset" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "fixed_asset_dep_asset_idx" ON "fixed_asset_dep" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "fixed_asset_dep_run_idx" ON "fixed_asset_dep" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_run_uq" ON "gl_run" USING btree ("tenant_id","kind","period","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "vat_return_period_uq" ON "vat_return" USING btree ("tenant_id","period_from","period_to");