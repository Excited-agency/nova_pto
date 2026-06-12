-- ============================================================
-- Migration: Validate category workspace ownership in bulk_update_employee_balances
-- The prior version filtered by workspace_id in WHERE (preventing cross-workspace
-- writes) but silently ignored updates for category_ids not in the workspace.
-- This version adds an explicit check so callers get a clear error instead of
-- a silent no-op when passing invalid or foreign-workspace category IDs.
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_update_employee_balances(
  p_employee_id  uuid,
  p_workspace_id uuid,
  p_updates      jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_update         jsonb;
  v_category_id    uuid;
  v_balance_before double precision;
  v_new_balance    double precision;
BEGIN
  IF NOT is_workspace_admin() THEN
    RAISE EXCEPTION 'Permission denied: only workspace admins can update balances';
  END IF;

  -- Verify caller belongs to the target workspace (workspace isolation)
  IF get_user_workspace_id() <> p_workspace_id THEN
    RAISE EXCEPTION 'Permission denied: workspace mismatch';
  END IF;

  -- Verify employee belongs to workspace
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_employee_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Employee not found in this workspace';
  END IF;

  -- Validate all category IDs belong to the workspace before making any changes
  FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_category_id := (v_update->>'category_id')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM time_off_categories
      WHERE id = v_category_id AND workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'Category % does not belong to workspace %', v_category_id, p_workspace_id;
    END IF;
  END LOOP;

  -- Apply all updates within this transaction
  FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_category_id := (v_update->>'category_id')::uuid;
    v_new_balance := (v_update->>'remaining_days')::double precision;

    SELECT remaining_days INTO v_balance_before
    FROM employee_balances
    WHERE employee_id = p_employee_id
      AND category_id = v_category_id
      AND workspace_id = p_workspace_id;

    UPDATE employee_balances
    SET remaining_days = v_new_balance,
        updated_at     = now()
    WHERE employee_id  = p_employee_id
      AND category_id  = v_category_id
      AND workspace_id = p_workspace_id;

    IF v_balance_before IS NOT NULL THEN
      INSERT INTO balance_adjustment_log (
        employee_id, category_id, workspace_id,
        delta, balance_before, balance_after,
        reason, adjusted_by
      ) VALUES (
        p_employee_id,
        v_category_id,
        p_workspace_id,
        v_new_balance - v_balance_before,
        v_balance_before,
        v_new_balance,
        'manual_adjustment',
        auth.uid()
      );
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
