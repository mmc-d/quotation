CREATE TABLE "leave_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"reason" text,
	"attachment_file_id" uuid,
	"source" text DEFAULT 'employee' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"name_ar" text NOT NULL,
	"job_title_ar" text,
	"department" text,
	"iban" text,
	"bank_name" text,
	"worked_days" integer NOT NULL,
	"basic" numeric(18, 2) NOT NULL,
	"housing" numeric(18, 2) NOT NULL,
	"transport" numeric(18, 2) NOT NULL,
	"other" numeric(18, 2) NOT NULL,
	"bonuses" numeric(18, 2) NOT NULL,
	"gross" numeric(18, 2) NOT NULL,
	"unpaid_leave" numeric(18, 2) NOT NULL,
	"sick_deduction" numeric(18, 2) NOT NULL,
	"deductions" numeric(18, 2) NOT NULL,
	"gosi" numeric(18, 2) NOT NULL,
	"total_deductions" numeric(18, 2) NOT NULL,
	"net" numeric(18, 2) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"gross" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"calculated_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"paid_at" date,
	"paid_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee" ADD COLUMN "gosi_employee_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_adjustment" ADD CONSTRAINT "pay_adjustment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_request_number_uq" ON "leave_request" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "leave_request_employee_idx" ON "leave_request" USING btree ("tenant_id","employee_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_request_status_idx" ON "leave_request" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "pay_adjustment_employee_month_idx" ON "pay_adjustment" USING btree ("tenant_id","employee_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_line_run_employee_uq" ON "payroll_line" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_month_uq" ON "payroll_run" USING btree ("tenant_id","month");