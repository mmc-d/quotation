ALTER TABLE "pay_adjustment" ADD COLUMN "pay_method" text DEFAULT 'payroll' NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_adjustment" ADD COLUMN "voucher_id" uuid;