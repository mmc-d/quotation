ALTER TABLE "import_shipment" ADD COLUMN "landed_capitalised_sar" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "import_shipment" ADD COLUMN "landed_expensed_sar" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "import_shipment" ADD COLUMN "customs_payable_party_id" uuid;--> statement-breakpoint
ALTER TABLE "pay_adjustment" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_shipment" ADD CONSTRAINT "import_shipment_customs_payable_party_id_party_id_fk" FOREIGN KEY ("customs_payable_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;