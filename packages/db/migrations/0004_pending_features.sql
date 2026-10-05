CREATE TABLE "business_holiday" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"date" date NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
DROP INDEX "clause_key_ver_uq";--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "working_days" jsonb DEFAULT '[0,1,2,3,4]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "party" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "subtotal_delta" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "vat_delta" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "change_order" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "clause_template" ADD COLUMN "template_set" text DEFAULT 'supply_install' NOT NULL;--> statement-breakpoint
ALTER TABLE "contract" ADD COLUMN "template_set" text DEFAULT 'supply_install' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "business_holiday_date_uq" ON "business_holiday" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "change_order_number_uq" ON "change_order" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "change_order_contract_idx" ON "change_order" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clause_key_ver_uq" ON "clause_template" USING btree ("tenant_id","template_set","key","clause_version");