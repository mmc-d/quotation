-- Tenant isolation for the general-ledger tables (0002_rls.sql pattern), then the immutability rules for posted journal entries.
ALTER TABLE account ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE account FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON account;--> statement-breakpoint
CREATE POLICY tenant_isolation ON account USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON account TO mmc_app;--> statement-breakpoint
ALTER TABLE ledger_settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ledger_settings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON ledger_settings;--> statement-breakpoint
CREATE POLICY tenant_isolation ON ledger_settings USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ledger_settings TO mmc_app;--> statement-breakpoint
ALTER TABLE journal_entry ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE journal_entry FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON journal_entry;--> statement-breakpoint
CREATE POLICY tenant_isolation ON journal_entry USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entry TO mmc_app;--> statement-breakpoint
ALTER TABLE journal_line ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE journal_line FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON journal_line;--> statement-breakpoint
CREATE POLICY tenant_isolation ON journal_line USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_line TO mmc_app;--> statement-breakpoint

-- Lines can only be added to / changed in / removed from a DRAFT entry. (A draft entry's delete cascades to its lines.)
CREATE OR REPLACE FUNCTION journal_line_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE st text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO st FROM journal_entry WHERE id = NEW.entry_id;
    IF st IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'journal lines can only be added to a draft entry' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO st FROM journal_entry WHERE id = OLD.entry_id;
  IF st = 'posted' THEN
    RAISE EXCEPTION 'posted journal lines are immutable — reverse the entry instead' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;--> statement-breakpoint
CREATE TRIGGER journal_line_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_line FOR EACH ROW EXECUTE FUNCTION journal_line_guard();--> statement-breakpoint

-- Entries are created as drafts. A posted entry cannot be changed or deleted (only the link to its reversal, attachments and
-- bookkeeping columns move); posting itself requires at least two lines and equal debits and credits.
CREATE OR REPLACE FUNCTION journal_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE d numeric; c numeric; n integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'create the entry as a draft, add its lines, then post it' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'a posted journal entry cannot be deleted — reverse it instead' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.status <> 'posted'
       OR (to_jsonb(NEW) - 'reversed_by_id' - 'attachments' - 'updated_at' - 'updated_by' - 'version')
          IS DISTINCT FROM (to_jsonb(OLD) - 'reversed_by_id' - 'attachments' - 'updated_at' - 'updated_by' - 'version')
       OR (OLD.reversed_by_id IS NOT NULL AND NEW.reversed_by_id IS DISTINCT FROM OLD.reversed_by_id) THEN
      RAISE EXCEPTION 'a posted journal entry is immutable — reverse it instead' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'posted' THEN
    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM journal_line WHERE entry_id = NEW.id;
    IF n < 2 OR d <> c THEN
      RAISE EXCEPTION 'an entry can be posted only with at least two lines and equal debits and credits' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.total <> d THEN
      RAISE EXCEPTION 'the entry total does not match its lines' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;--> statement-breakpoint
CREATE TRIGGER journal_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entry FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();
