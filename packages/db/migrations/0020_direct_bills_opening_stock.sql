CREATE TABLE "stock_opening" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"opened_on" date NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_sar" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD COLUMN "kind" text DEFAULT 'po' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD COLUMN "paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD COLUMN "payments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "stock_opening" ADD CONSTRAINT "stock_opening_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_opening_number_uq" ON "stock_opening" USING btree ("tenant_id","number");--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD CONSTRAINT "supplier_bill_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD CONSTRAINT "supplier_bill_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_bill_status_idx" ON "supplier_bill" USING btree ("tenant_id","status","due_date");