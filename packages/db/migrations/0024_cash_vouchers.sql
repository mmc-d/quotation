CREATE TABLE "cash_voucher" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"voucher_date" date NOT NULL,
	"party_id" uuid,
	"counterparty_name" text NOT NULL,
	"counterparty_id_number" text,
	"counterparty_mobile" text,
	"amount" numeric(18, 2) NOT NULL,
	"purpose" text NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"method_ref" text,
	"bank_name" text,
	"method_date" date,
	"project_id" uuid,
	"cost_center" text,
	"doc_ref" text,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_voucher_number_uq" ON "cash_voucher" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "cash_voucher_kind_date_idx" ON "cash_voucher" USING btree ("tenant_id","kind","voucher_date");