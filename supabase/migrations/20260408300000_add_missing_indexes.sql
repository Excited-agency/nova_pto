-- ============================================================
-- Migration: Add indexes for common query patterns
-- ============================================================

-- Filtered request lists (by workspace + status + created_at)
CREATE INDEX IF NOT EXISTS idx_requests_workspace_status_created
  ON time_off_requests (workspace_id, status, created_at DESC);

-- Employee-specific request lookups
CREATE INDEX IF NOT EXISTS idx_requests_profile_workspace
  ON time_off_requests (profile_id, workspace_id);

-- Balance lookups by employee + category
CREATE INDEX IF NOT EXISTS idx_balances_employee_category
  ON employee_balances (employee_id, category_id);
