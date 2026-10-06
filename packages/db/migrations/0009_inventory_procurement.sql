CREATE TABLE "compliance_cert" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"issued_on" date,
	"expires_on" date,
	"file_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"shipment_id" uuid,
	"received_on" date NOT NULL,
	"notes" text,
	"erp_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"product_id" uuid,
	"qty" numeric(14, 3) NOT NULL,
	"unit_cost_sar" numeric(18, 4) NOT NULL,
	"landed_per_unit_sar" numeric(18, 4) DEFAULT '0' NOT NULL,
	"serials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_shipment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid,
	"order_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mode" text DEFAULT 'sea' NOT NULL,
	"status" text DEFAULT 'ordered' NOT NULL,
	"bl_number" text,
	"containers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vessel" text,
	"etd" date,
	"eta" date,
	"broker" text,
	"fasah_number" text,
	"fasah_date" date,
	"cif_sar" numeric(18, 2),
	"duty_sar" numeric(18, 2),
	"import_vat_sar" numeric(18, 2),
	"charges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"docs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"landed_basis" text,
	"landed_posted_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid,
	"contract_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"needed_by" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_request_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"qty" numeric(14, 3) NOT NULL,
	"ordered_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"rate_to_sar" numeric(18, 6) DEFAULT '3.75' NOT NULL,
	"incoterm" text,
	"deposit_percent" integer DEFAULT 0 NOT NULL,
	"order_date" date,
	"expected_on" date,
	"project_id" uuid,
	"material_request_id" uuid,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_sar" numeric(18, 2) DEFAULT '0' NOT NULL,
	"approver_role" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"compliance_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"owner_id" uuid,
	"erp_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"product_id" uuid,
	"code" text NOT NULL,
	"description" text,
	"qty" numeric(14, 3) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"received_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"billed_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"material_request_line_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serial_number" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"macs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"warehouse_id" uuid,
	"project_id" uuid,
	"purchase_order_id" uuid,
	"receipt_id" uuid,
	"supplier_id" uuid,
	"supplier_warranty_end" date,
	"installed_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_balance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"reserved_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_count" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accuracy" numeric(18, 6),
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_move" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"kind" text NOT NULL,
	"product_id" uuid NOT NULL,
	"from_warehouse_id" uuid,
	"to_warehouse_id" uuid,
	"qty" numeric(14, 3) NOT NULL,
	"unit_cost_sar" numeric(18, 4) DEFAULT '0' NOT NULL,
	"serials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_id" uuid,
	"work_order_id" uuid,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid,
	"erp_name" text
);
--> statement-breakpoint
CREATE TABLE "stock_reservation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"project_id" uuid,
	"contract_id" uuid,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"project_id" uuid,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shipped_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_bill" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"order_id" uuid,
	"supplier_invoice_no" text NOT NULL,
	"bill_date" date NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"rate_to_sar" numeric(18, 6) DEFAULT '1' NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_status" text DEFAULT 'matched' NOT NULL,
	"match_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"erp_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"vendor_sku" text,
	"price" numeric(18, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"moq" numeric(14, 3),
	"lead_time_days" integer,
	"valid_until" date,
	"preferred" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"kind" text DEFAULT 'main' NOT NULL,
	"custodian_id" uuid,
	"project_id" uuid,
	"branch_id" uuid,
	"erp_name" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "origin_country" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "radio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "avg_cost_sar" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "reorder_level" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "reorder_qty" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "weight_kg" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "compliance_cert" ADD CONSTRAINT "compliance_cert_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_cert" ADD CONSTRAINT "compliance_cert_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_receipt_id_goods_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_order_line_id_purchase_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."purchase_order_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_shipment" ADD CONSTRAINT "import_shipment_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request" ADD CONSTRAINT "material_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request" ADD CONSTRAINT "material_request_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_line" ADD CONSTRAINT "material_request_line_request_id_material_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."material_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_line" ADD CONSTRAINT "material_request_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_material_request_id_material_request_id_fk" FOREIGN KEY ("material_request_id") REFERENCES "public"."material_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_material_request_line_id_material_request_line_id_fk" FOREIGN KEY ("material_request_line_id") REFERENCES "public"."material_request_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_number" ADD CONSTRAINT "serial_number_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_number" ADD CONSTRAINT "serial_number_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_number" ADD CONSTRAINT "serial_number_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_number" ADD CONSTRAINT "serial_number_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_number" ADD CONSTRAINT "serial_number_installed_asset_id_installed_asset_id_fk" FOREIGN KEY ("installed_asset_id") REFERENCES "public"."installed_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_from_warehouse_id_warehouse_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_to_warehouse_id_warehouse_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_work_order_id_work_order_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move" ADD CONSTRAINT "stock_move_posted_by_app_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_warehouse_id_warehouse_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_warehouse_id_warehouse_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD CONSTRAINT "supplier_bill_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD CONSTRAINT "supplier_bill_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill" ADD CONSTRAINT "supplier_bill_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_item" ADD CONSTRAINT "supplier_item_supplier_id_party_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_item" ADD CONSTRAINT "supplier_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_custodian_id_app_user_id_fk" FOREIGN KEY ("custodian_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_cert_product_idx" ON "compliance_cert" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipt_number_uq" ON "goods_receipt" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "goods_receipt_line_idx" ON "goods_receipt_line" USING btree ("tenant_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_shipment_number_uq" ON "import_shipment" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "import_shipment_status_idx" ON "import_shipment" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "material_request_number_uq" ON "material_request" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "material_request_line_idx" ON "material_request_line" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_number_uq" ON "purchase_order" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "purchase_order_status_idx" ON "purchase_order" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "purchase_order_line_idx" ON "purchase_order_line" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "serial_number_uq" ON "serial_number" USING btree ("tenant_id","product_id","serial");--> statement-breakpoint
CREATE INDEX "serial_number_wh_idx" ON "serial_number" USING btree ("tenant_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_balance_uq" ON "stock_balance" USING btree ("tenant_id","warehouse_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_number_uq" ON "stock_count" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "stock_move_product_idx" ON "stock_move" USING btree ("tenant_id","product_id","posted_at");--> statement-breakpoint
CREATE INDEX "stock_move_ref_idx" ON "stock_move" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "stock_move_project_idx" ON "stock_move" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "stock_reservation_project_idx" ON "stock_reservation" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "stock_reservation_product_idx" ON "stock_reservation" USING btree ("tenant_id","product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfer_number_uq" ON "stock_transfer" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_bill_number_uq" ON "supplier_bill" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_bill_ext_uq" ON "supplier_bill" USING btree ("tenant_id","supplier_id","supplier_invoice_no");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_item_uq" ON "supplier_item" USING btree ("tenant_id","supplier_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_code_uq" ON "warehouse" USING btree ("tenant_id","code");