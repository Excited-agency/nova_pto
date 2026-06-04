-- Composite index on balance_adjustment_log for the common query pattern:
-- filter by employee_id + workspace_id, order by created_at DESC
CREATE INDEX IF NOT EXISTS idx_balance_log_employee_workspace_created
  ON balance_adjustment_log(employee_id, workspace_id, created_at DESC);
