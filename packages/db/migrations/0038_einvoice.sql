CREATE TABLE "einvoice_document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"egs_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"number" text NOT NULL,
	"type_code" text NOT NULL,
	"subtype" text NOT NULL,
	"icv" integer NOT NULL,
	"uuid" text NOT NULL,
	"pih" text NOT NULL,
	"invoice_hash" text NOT NULL,
	"issue_date" date NOT NULL,
	"issue_time" text NOT NULL,
	"xml" text NOT NULL,
	"qr" text NOT NULL,
	"submission" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"zatca_response" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"submitted_at" timestamp with time zone,
	"cleared_xml" text,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "einvoice_egs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"serial" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"private_key_enc" text,
	"csr" text,
	"compliance_request_id" text,
	"compliance_csid_enc" text,
	"compliance_secret_enc" text,
	"csid_enc" text,
	"csid_secret_enc" text,
	"compliance_certificate" text,
	"certificate" text,
	"compliance_results" jsonb,
	"icv_counter" integer DEFAULT 0 NOT NULL,
	"last_pih" text,
	"live_from" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_mirror" ADD COLUMN "einvoice_error" text;--> statement-breakpoint
ALTER TABLE "ledger_settings" ADD COLUMN "einvoice_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_settings" ADD COLUMN "einvoice_options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD CONSTRAINT "einvoice_document_egs_id_einvoice_egs_id_fk" FOREIGN KEY ("egs_id") REFERENCES "public"."einvoice_egs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoice_document" ADD CONSTRAINT "einvoice_document_invoice_id_invoice_mirror_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice_mirror"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "einvoice_document_icv_uq" ON "einvoice_document" USING btree ("tenant_id","egs_id","icv");--> statement-breakpoint
CREATE UNIQUE INDEX "einvoice_document_uuid_uq" ON "einvoice_document" USING btree ("tenant_id","uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "einvoice_document_invoice_uq" ON "einvoice_document" USING btree ("tenant_id","invoice_id") WHERE "einvoice_document"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "einvoice_document_status_idx" ON "einvoice_document" USING btree ("tenant_id","status","icv");