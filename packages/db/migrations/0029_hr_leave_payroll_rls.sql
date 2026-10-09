-- Tenant isolation for the leave and payroll tables (0002_rls.sql pattern).
ALTER TABLE leave_request ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE leave_request FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON leave_request;--> statement-breakpoint
CREATE POLICY tenant_isolation ON leave_request USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_request TO mmc_app;--> statement-breakpoint
ALTER TABLE pay_adjustment ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE pay_adjustment FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON pay_adjustment;--> statement-breakpoint
CREATE POLICY tenant_isolation ON pay_adjustment USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON pay_adjustment TO mmc_app;--> statement-breakpoint
ALTER TABLE payroll_run ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE payroll_run FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_run;--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_run USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_run TO mmc_app;--> statement-breakpoint
ALTER TABLE payroll_line ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE payroll_line FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON payroll_line;--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_line USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_line TO mmc_app;--> statement-breakpoint
-- existing employees: Saudis default to the 9.75 % GOSI employee share
UPDATE employee SET gosi_employee_percent = 9.75 WHERE lower(trim(coalesce(nationality, ''))) IN ('sa', 'sau', 'saudi', 'saudi arabia', 'سعودي', 'سعودية', 'السعودية');
