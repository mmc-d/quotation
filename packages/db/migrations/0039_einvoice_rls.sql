-- Tenant isolation for the Phase 6D tables (0002_rls.sql pattern).
ALTER TABLE einvoice_egs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE einvoice_egs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON einvoice_egs;--> statement-breakpoint
CREATE POLICY tenant_isolation ON einvoice_egs USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON einvoice_egs TO mmc_app;--> statement-breakpoint
ALTER TABLE einvoice_document ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE einvoice_document FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON einvoice_document;--> statement-breakpoint
CREATE POLICY tenant_isolation ON einvoice_document USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON einvoice_document TO mmc_app;--> statement-breakpoint

-- A signed e-invoice document is part of the legal record: what was signed (XML, hash, QR, ICV, PIH, UUID, type, dates)
-- can never change and the row can never be deleted. Only the submission outcome moves.
CREATE OR REPLACE FUNCTION einvoice_document_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an e-invoice document cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'zatca_response' - 'attempts' - 'last_error' - 'submitted_at' - 'cleared_xml' - 'superseded_at' - 'updated_at' - 'updated_by' - 'version')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'zatca_response' - 'attempts' - 'last_error' - 'submitted_at' - 'cleared_xml' - 'superseded_at' - 'updated_at' - 'updated_by' - 'version') THEN
    RAISE EXCEPTION 'a signed e-invoice document is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.cleared_xml IS NOT NULL AND NEW.cleared_xml IS DISTINCT FROM OLD.cleared_xml THEN
    RAISE EXCEPTION 'the cleared XML of an e-invoice document cannot change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $fn$;--> statement-breakpoint
CREATE TRIGGER einvoice_document_guard BEFORE UPDATE OR DELETE ON einvoice_document FOR EACH ROW EXECUTE FUNCTION einvoice_document_guard();--> statement-breakpoint

-- An EGS unit's counter only goes forward (gapless ICV) and a unit is never deleted — it is revoked.
CREATE OR REPLACE FUNCTION einvoice_egs_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an EGS unit cannot be deleted — revoke it instead' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.icv_counter < OLD.icv_counter THEN
    RAISE EXCEPTION 'the invoice counter of an EGS unit cannot go backwards' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $fn$;--> statement-breakpoint
CREATE TRIGGER einvoice_egs_guard BEFORE UPDATE OR DELETE ON einvoice_egs FOR EACH ROW EXECUTE FUNCTION einvoice_egs_guard();
