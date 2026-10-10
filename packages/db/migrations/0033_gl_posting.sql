CREATE TABLE "gl_source_state" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"posted_hash" text,
	"posted_payment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_posted_at" timestamp with time zone,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_voucher" ADD COLUMN "account_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "gl_source_state_uq" ON "gl_source_state" USING btree ("tenant_id","source_type","source_id");