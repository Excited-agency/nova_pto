-- ============================================================
-- Migration: restore the workspace-ownership guard on
--            create_time_off_record + drop a stale overload
--
-- Problem 1 (cross-workspace write — critical)
--   20260320200000_security_hardening.sql added an explicit
--   "p_workspace_id must equal get_user_workspace_id()" guard,
--   commented in that file as a CRITICAL FIX.
--   20260323000000_validate_employee_status_on_create_record.sql
--   recreated the function to add an employee-status check and
--   silently dropped that guard; 20260604500000_add_balance_
--   adjustment_log.sql carried the gap forward.
--   Verified missing in the live schema before writing this.
--
--   Impact: is_workspace_admin() only proves the caller is an
--   admin of *their own* workspace. Without the guard, an admin
--   of workspace A could pass workspace B's workspace_id +
--   employee_id + category_id and create an 'approved' record
--   that deducts a balance in workspace B. The employee_id /
--   category_id checks below only prove those IDs are consistent
--   with the *supplied* p_workspace_id, not with the caller's.
--
-- Problem 2 (stale overload)
--   The live schema has TWO create_time_off_record functions:
--     (uuid,uuid,uuid,date,date,text)                -- stale
--     (uuid,uuid,uuid,date,date,text,text,text)      -- current
--   The 6-arg version predates 20260323000000: it has no
--   employee-status check and no balance_adjustment_log insert,
--   yet EXECUTE is still granted to `authenticated`, so it is
--   reachable over REST. Because the 8-arg version supplies
--   defaults for the last two params, a 6-argument call is also
--   an overload-resolution hazard.
--   The client always sends all 8 named params
--   (src/lib/time-off-request-service.ts), so dropping the 6-arg
--   version is safe.
--
-- Business logic is reproduced verbatim from the current 8-arg
-- body; the only additions are the guard and the drop.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Remove the stale, unguarded overload.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_time_off_record(uuid, uuid, uuid, date, date, text);

-- ------------------------------------------------------------
-- 2. Recreate the current overload with the workspace guard.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_time_off_record(
  p_workspace_id  uuid,
  p_employee_id   uuid,
  p_category_id   uuid,
  p_start_date    date,
  p_end_date      date,
  p_comment       text DEFAULT NULL,
  p_start_period  text DEFAULT 'morning',
  p_end_period    text DEFAULT 'end_of_day'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_days      double precision;
  v_start_portion   double precision;
  v_end_portion     double precision;
  v_date_diff       integer;
  v_balance         double precision;
  v_employee        record;
  v_category_name   text;
  v_accrual_method  text;
  v_request_type    text;
  v_request_id      uuid;
BEGIN
  IF NOT is_workspace_admin() THEN
    RAISE EXCEPTION 'Permission denied: only workspace admins can create time-off records';
  END IF;

  -- RESTORED GUARD: the caller may only write into their own workspace.
  IF p_workspace_id IS DISTINCT FROM get_user_workspace_id() THEN
    RAISE EXCEPTION 'Permission denied: workspace does not belong to the current user';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after start date';
  END IF;

  IF p_start_period NOT IN ('morning', 'midday') THEN
    RAISE EXCEPTION 'Invalid start_period: must be morning or midday';
  END IF;
  IF p_end_period NOT IN ('midday', 'end_of_day') THEN
    RAISE EXCEPTION 'Invalid end_period: must be midday or end_of_day';
  END IF;

  v_date_diff     := (p_end_date - p_start_date);
  v_start_portion := CASE p_start_period WHEN 'morning' THEN 1.0 ELSE 0.5 END;
  v_end_portion   := CASE p_end_period   WHEN 'end_of_day' THEN 1.0 ELSE 0.5 END;
  v_total_days    := v_start_portion + (v_date_diff - 1) + v_end_portion;

  IF v_total_days <= 0 THEN
    RAISE EXCEPTION 'Invalid period combination: total days must be greater than zero';
  END IF;

  SELECT id, first_name, last_name, email, avatar_url, status
  INTO v_employee
  FROM profiles
  WHERE id = p_employee_id AND workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found in this workspace';
  END IF;

  IF v_employee.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot create time-off for inactive or deleted employees';
  END IF;

  SELECT name, accrual_method INTO v_category_name, v_accrual_method
  FROM time_off_categories
  WHERE id = p_category_id AND workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found in this workspace';
  END IF;

  v_request_type := CASE lower(v_category_name)
    WHEN 'vacation' THEN 'vacation'
    WHEN 'sick leave' THEN 'sick_leave'
    WHEN 'personal' THEN 'personal'
    WHEN 'bereavement' THEN 'bereavement'
    ELSE 'other'
  END;

  IF v_accrual_method <> 'unlimited' THEN
    SELECT remaining_days INTO v_balance
    FROM employee_balances
    WHERE employee_id = p_employee_id AND category_id = p_category_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No balance allocated for this employee and category';
    END IF;

    IF v_balance < v_total_days THEN
      RAISE EXCEPTION 'Insufficient balance: % days available, % days requested', v_balance, v_total_days;
    END IF;

    UPDATE employee_balances
    SET remaining_days = remaining_days - v_total_days
    WHERE employee_id = p_employee_id AND category_id = p_category_id;
  END IF;

  INSERT INTO time_off_requests (
    profile_id, workspace_id, category_id,
    start_date, end_date, start_period, end_period, total_days,
    request_type, status, comment,
    employee_name, employee_email, employee_avatar_url,
    reviewed_by, reviewed_at
  ) VALUES (
    p_employee_id, p_workspace_id, p_category_id,
    p_start_date, p_end_date, p_start_period, p_end_period, v_total_days,
    v_request_type, 'approved', p_comment,
    coalesce(trim(concat(v_employee.first_name, ' ', v_employee.last_name)), ''),
    v_employee.email,
    v_employee.avatar_url,
    auth.uid(), now()
  )
  RETURNING id INTO v_request_id;

  IF v_accrual_method <> 'unlimited' THEN
    INSERT INTO balance_adjustment_log (
      employee_id, category_id, workspace_id,
      delta, balance_before, balance_after,
      reason, request_id, adjusted_by
    ) VALUES (
      p_employee_id, p_category_id, p_workspace_id,
      -v_total_days, v_balance, v_balance - v_total_days,
      'record_created', v_request_id, auth.uid()
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_request_id,
    'total_days', v_total_days,
    'remaining_balance', CASE
      WHEN v_accrual_method = 'unlimited' THEN NULL
      ELSE v_balance - v_total_days
    END
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. Re-assert grants explicitly.
--    CREATE OR REPLACE preserves the existing ACL, but state it
--    outright so the intended privilege set is visible here and
--    survives any future recreation of the function.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_time_off_record(uuid, uuid, uuid, date, date, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_time_off_record(uuid, uuid, uuid, date, date, text, text, text)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
