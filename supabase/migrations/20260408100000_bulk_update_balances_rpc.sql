-- ============================================================
-- Migration: Bulk update employee balances in a single transaction
-- Prevents partial updates when updating multiple category balances
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_update_employee_balances(
  p_employee_id  uuid,
  p_workspace_id uuid,
  p_updates      jsonb  -- Array of { "category_id": uuid, "remaining_days": double precision }
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_update jsonb;
BEGIN
  -- Auth guard
  IF NOT is_workspace_admin() THEN
    RAISE EXCEPTION 'Permission denied: only workspace admins can update balances';
  END IF;

  -- Verify employee belongs to workspace
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_employee_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Employee not found in this workspace';
  END IF;

  -- Apply all updates within this transaction
  FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE employee_balances
    SET remaining_days = (v_update->>'remaining_days')::double precision,
        updated_at = now()
    WHERE employee_id = p_employee_id
      AND category_id = (v_update->>'category_id')::uuid
      AND workspace_id = p_workspace_id;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
