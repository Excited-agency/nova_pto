-- ============================================================
-- Migration: bring the Slack-bot review RPCs to parity with
--            their web-UI siblings
--
-- The web-UI RPCs gained two things the bot RPCs never received:
--   * reviewed_by / reviewed_at  (20260604400000)
--   * balance_adjustment_log row (20260604500000, approve only)
--
-- Consequences before this migration:
--   * A request approved or rejected from a Slack button showed
--     no reviewer and no review timestamp in the UI, the
--     time_off_requests_safe view, or exported reports.
--   * A Slack approval deducted employee_balances without
--     writing the audit-log row its web-UI sibling writes, so
--     balance history had unexplained gaps.
--
-- Third fix — owner role:
--   is_workspace_admin() resolves to role IN ('admin','owner')
--   (20260513120000_add_owner_role.sql), and every web-UI RPC
--   gates on that helper. Both bot RPCs instead hard-coded
--   `v_admin_role <> 'admin'`, so a workspace OWNER clicking a
--   Slack button was rejected with "Permission denied" while the
--   same action succeeded in the web UI. The bot RPCs cannot call
--   is_workspace_admin() (it reads auth.uid(), and these run under
--   service_role with the admin passed as a parameter), so the
--   role set is matched explicitly instead.
--
-- Bodies are reproduced from the live definitions, verified via
-- pg_get_functiondef before writing. Only the changes described
-- above are introduced; day-counting and balance logic are
-- untouched.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. approve_time_off_request_bot
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_time_off_request_bot(
  p_request_id       uuid,
  p_admin_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_role      text;
  v_admin_workspace uuid;
  v_request         record;
  v_total_days      double precision;
  v_start_portion   double precision;
  v_end_portion     double precision;
  v_balance         double precision;
  v_accrual_method  text;
  v_employee_status text;
  v_admin_status    text;
BEGIN
  SELECT role, workspace_id, status
  INTO v_admin_role, v_admin_workspace, v_admin_status
  FROM profiles
  WHERE id = p_admin_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin profile not found';
  END IF;

  -- Mirrors is_workspace_admin(): admins AND owners may review.
  -- The status check has no web-UI equivalent to copy, but it is required here:
  -- soft-deleting an employee keeps their profiles row (role intact) and their
  -- slack_user_mappings row, so without it a deactivated or deleted admin could
  -- still approve from a Slack button indefinitely.
  IF v_admin_role NOT IN ('admin', 'owner') OR v_admin_status <> 'active' THEN
    RAISE EXCEPTION 'Permission denied: only active workspace admins can approve time-off requests';
  END IF;

  SELECT * INTO v_request
  FROM time_off_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.workspace_id <> v_admin_workspace THEN
    RAISE EXCEPTION 'Request does not belong to your workspace';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Lock and check employee is still active
  SELECT status INTO v_employee_status
  FROM profiles
  WHERE id = v_request.profile_id
  FOR UPDATE;

  IF v_employee_status IS NULL OR v_employee_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot approve: employee is no longer active';
  END IF;

  v_start_portion := CASE v_request.start_period WHEN 'morning' THEN 1.0 ELSE 0.5 END;
  v_end_portion   := CASE v_request.end_period   WHEN 'end_of_day' THEN 1.0 ELSE 0.5 END;

  SELECT COALESCE(SUM(
    CASE
      WHEN EXTRACT(DOW FROM d::date) IN (0, 6) THEN 0
      WHEN d::date IN (SELECT date FROM holidays WHERE workspace_id = v_request.workspace_id) THEN 0
      WHEN d::date = v_request.start_date AND d::date = v_request.end_date THEN v_start_portion + v_end_portion - 1.0
      WHEN d::date = v_request.start_date THEN v_start_portion
      WHEN d::date = v_request.end_date THEN v_end_portion
      ELSE 1.0
    END
  ), 0) INTO v_total_days
  FROM generate_series(v_request.start_date::timestamp, v_request.end_date::timestamp, '1 day'::interval) AS d;

  IF v_request.category_id IS NOT NULL THEN
    SELECT accrual_method INTO v_accrual_method
    FROM time_off_categories
    WHERE id = v_request.category_id;

    IF v_accrual_method IS NOT NULL AND v_accrual_method <> 'unlimited' THEN
      SELECT remaining_days INTO v_balance
      FROM employee_balances
      WHERE employee_id = v_request.profile_id
        AND category_id = v_request.category_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No balance allocated for this employee and category';
      END IF;

      IF v_balance < v_total_days THEN
        RAISE EXCEPTION 'Insufficient balance: % days available, % days requested', v_balance, v_total_days;
      END IF;

      UPDATE employee_balances
      SET remaining_days = remaining_days - v_total_days
      WHERE employee_id = v_request.profile_id
        AND category_id = v_request.category_id;

      -- Parity with approve_time_off_request: record the adjustment.
      -- adjusted_by is the reviewing admin passed in by the Slack
      -- edge function; auth.uid() is NULL under service_role.
      INSERT INTO balance_adjustment_log (
        employee_id, category_id, workspace_id,
        delta, balance_before, balance_after,
        reason, request_id, adjusted_by
      ) VALUES (
        v_request.profile_id, v_request.category_id, v_request.workspace_id,
        -v_total_days, v_balance, v_balance - v_total_days,
        'request_approved', p_request_id, p_admin_profile_id
      );
    END IF;
  END IF;

  UPDATE time_off_requests
  SET status      = 'approved',
      total_days  = v_total_days,
      reviewed_by = p_admin_profile_id,
      reviewed_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'id', p_request_id,
    'total_days', v_total_days,
    'remaining_balance', CASE
      WHEN v_request.category_id IS NULL THEN NULL
      WHEN v_accrual_method = 'unlimited' THEN NULL
      ELSE v_balance - v_total_days
    END
  );
END;
$$;

-- ------------------------------------------------------------
-- 2. reject_time_off_request_bot
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_time_off_request_bot(
  p_request_id       uuid,
  p_admin_profile_id uuid,
  p_rejection_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_role      text;
  v_admin_workspace uuid;
  v_admin_status    text;
  v_request         record;
BEGIN
  -- Verify the admin profile exists and is actually an admin
  SELECT role, workspace_id, status
  INTO v_admin_role, v_admin_workspace, v_admin_status
  FROM profiles
  WHERE id = p_admin_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin profile not found';
  END IF;

  -- Mirrors is_workspace_admin(): admins AND owners may review.
  -- Status is checked for the same reason as in the approve variant above
  -- (symmetric fix -- CLAUDE.md rule 2).
  IF v_admin_role NOT IN ('admin', 'owner') OR v_admin_status <> 'active' THEN
    RAISE EXCEPTION 'Permission denied: only active workspace admins can reject time-off requests';
  END IF;

  -- Load and lock the request
  SELECT * INTO v_request
  FROM time_off_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- Verify the request belongs to the admin's workspace
  IF v_request.workspace_id <> v_admin_workspace THEN
    RAISE EXCEPTION 'Request does not belong to your workspace';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Reject the request
  UPDATE time_off_requests
  SET status           = 'rejected',
      rejection_reason = p_rejection_reason,
      reviewed_by      = p_admin_profile_id,
      reviewed_at      = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'id', p_request_id,
    'status', 'rejected'
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. Re-assert the lockdown from 20260723000000.
--    These RPCs are only ever invoked by the slack-events edge
--    function via service_role. CREATE OR REPLACE preserves the
--    existing ACL, but re-stating it keeps the intent local to
--    the file and safe against future recreation.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.approve_time_off_request_bot(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_time_off_request_bot(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.approve_time_off_request_bot(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_time_off_request_bot(uuid, uuid, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
