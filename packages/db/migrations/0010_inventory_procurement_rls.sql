-- Phase 5 tenant tables: tenant isolation as everywhere (0002_rls.sql). stock_move is an append-only ledger.
ALTER TABLE warehouse ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE warehouse FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON warehouse;--> statement-breakpoint
CREATE POLICY tenant_isolation ON warehouse USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON warehouse TO mmc_app;--> statement-breakpoint
ALTER TABLE stock_balance ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE stock_balance FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON stock_balance;--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_balance USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_balance TO mmc_app;--> statement-breakpoint
ALTER TABLE stock_move ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE stock_move FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON stock_move;--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_move USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON stock_move TO mmc_app;--> statement-breakpoint
ALTER TABLE serial_number ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE serial_number FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON serial_number;--> statement-breakpoint
CREATE POLICY tenant_isolation ON serial_number USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON serial_number TO mmc_app;--> statement-breakpoint
ALTER TABLE stock_reservation ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE stock_reservation FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON stock_reservation;--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_reservation USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_reservation TO mmc_app;--> statement-breakpoint
ALTER TABLE supplier_item ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE supplier_item FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON supplier_item;--> statement-breakpoint
CREATE POLICY tenant_isolation ON supplier_item USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_item TO mmc_app;--> statement-breakpoint
ALTER TABLE compliance_cert ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE compliance_cert FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON compliance_cert;--> statement-breakpoint
CREATE POLICY tenant_isolation ON compliance_cert USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_cert TO mmc_app;--> statement-breakpoint
ALTER TABLE material_request ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE material_request FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON material_request;--> statement-breakpoint
CREATE POLICY tenant_isolation ON material_request USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON material_request TO mmc_app;--> statement-breakpoint
ALTER TABLE material_request_line ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE material_request_line FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON material_request_line;--> statement-breakpoint
CREATE POLICY tenant_isolation ON material_request_line USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON material_request_line TO mmc_app;--> statement-breakpoint
ALTER TABLE purchase_order ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE purchase_order FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON purchase_order;--> statement-breakpoint
CREATE POLICY tenant_isolation ON purchase_order USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order TO mmc_app;--> statement-breakpoint
ALTER TABLE purchase_order_line ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE purchase_order_line FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON purchase_order_line;--> statement-breakpoint
CREATE POLICY tenant_isolation ON purchase_order_line USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order_line TO mmc_app;--> statement-breakpoint
ALTER TABLE goods_receipt ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE goods_receipt FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON goods_receipt;--> statement-breakpoint
CREATE POLICY tenant_isolation ON goods_receipt USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON goods_receipt TO mmc_app;--> statement-breakpoint
ALTER TABLE goods_receipt_line ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE goods_receipt_line FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON goods_receipt_line;--> statement-breakpoint
CREATE POLICY tenant_isolation ON goods_receipt_line USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON goods_receipt_line TO mmc_app;--> statement-breakpoint
ALTER TABLE import_shipment ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE import_shipment FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON import_shipment;--> statement-breakpoint
CREATE POLICY tenant_isolation ON import_shipment USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON import_shipment TO mmc_app;--> statement-breakpoint
ALTER TABLE stock_transfer ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE stock_transfer FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON stock_transfer;--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_transfer USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_transfer TO mmc_app;--> statement-breakpoint
ALTER TABLE stock_count ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE stock_count FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON stock_count;--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_count USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_count TO mmc_app;--> statement-breakpoint
ALTER TABLE supplier_bill ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE supplier_bill FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON supplier_bill;--> statement-breakpoint
CREATE POLICY tenant_isolation ON supplier_bill USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_bill TO mmc_app;
