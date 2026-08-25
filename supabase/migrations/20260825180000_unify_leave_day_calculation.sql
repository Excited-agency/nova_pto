-- ============================================================
-- Migration: ONE implementation of "how many leave days is this?"
--
-- Business rule: weekends (Sat/Sun) and workspace holidays are
-- never leave days. An employee's balance must never be reduced
-- for a day they were not expected to work.
--
-- The rule was implemented four separate times and they disagreed:
--
--   approve_time_off_request       business days  (correct)
--   approve_time_off_request_bot   business days  (correct)
--   create_time_off_record         CALENDAR days  (WRONG)
--   src/lib/date-utils.ts          business days  (correct)
--
-- History of the wrong one: business-day counting was added to
-- create_time_off_record in 20260320100000_business_day_calculation
-- .sql and survived 20260320200000 and 20260323000000, then
-- 20260604500000_add_balance_adjustment_log.sql rebuilt the
-- function from an older body and silently restored the calendar
-- formula -- in the same file where approve_time_off_request kept
-- the correct one. 20260825140000 carried it forward.
--
-- Effect on employees: an admin recording Mon -> next Mon saw
-- "6 days" in the UI while the RPC deducted 8, and
-- balance_adjustment_log recorded the inflated delta as fact. Any
-- range containing a holiday drifted further. The existing test
-- missed it because it used a Wed-Fri range, where both formulas
-- agree.
--
-- Fix: extract count_leave_days() and have every RPC call it, so
-- the rule cannot drift again. Behaviour of the two approve RPCs
-- is unchanged -- their inline logic is what the helper now holds.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- The single source of truth.
--
-- Half-day handling: start_period/end_period only shrink a day
-- that is actually worked. A half day that lands on a weekend or
-- holiday contributes 0, which is correct -- there was no working
-- day to take half of.
--
-- A range with no working days returns 0. Callers decide whether
-- that is an error (create/submit reject it) or a no-op.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION count_leave_days(
  p_workspace_id uuid,
  p_start_date   date,
  p_end_date     date,
  p_start_period text DEFAULT 'morning',
  p_end_period   text DEFAULT 'end_of_day'
)
RETURNS double precision
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN EXTRACT(DOW FROM d::date) IN (0, 6) THEN 0
      WHEN d::date IN (SELECT date FROM holidays WHERE workspace_id = p_workspace_id) THEN 0
      WHEN d::date = p_start_date AND d::date = p_end_date
        THEN (CASE p_start_period WHEN 'morning'    THEN 1.0 ELSE 0.5 END)
           + (CASE p_end_period   WHEN 'end_of_day' THEN 1.0 ELSE 0.5 END)
           - 1.0
      WHEN d::date = p_start_date
        THEN CASE p_start_period WHEN 'morning'    THEN 1.0 ELSE 0.5 END
      WHEN d::date = p_end_date
        THEN CASE p_end_period   WHEN 'end_of_day' THEN 1.0 ELSE 0.5 END
      ELSE 1.0
    END
  ), 0)
  FROM generate_series(p_start_date::timestamp, p_end_date::timestamp, '1 day'::interval) AS d;
$$;

COMMENT ON FUNCTION count_leave_days(uuid, date, date, text, text) IS
  'Leave days between two dates, excluding weekends and the workspace''s holidays. The single implementation of this rule on the server -- approve_time_off_request, approve_time_off_request_bot and create_time_off_record all delegate here so they cannot drift apart. Mirrored client-side by calculateDays() in src/lib/date-utils.ts.';

-- Internal helper: only ever called from inside the RPCs (which run
-- as SECURITY DEFINER, i.e. as the owner), never from a browser.
REVOKE EXECUTE ON FUNCTION count_leave_days(uuid, date, date, text, text)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- create_time_off_record -- THE FIX.
-- Body reproduced from 20260825140000; the only change is the day
-- calculation and the resulting error message.
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

  -- Weekends and holidays excluded, exactly as the approve path does.
  v_total_days := count_leave_days(
    p_workspace_id, p_start_date, p_end_date, p_start_period, p_end_period
  );

  IF v_total_days <= 0 THEN
    RAISE EXCEPTION 'Selected dates contain no working days (weekends and holidays are not counted)';
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
    WHERE employee_id = p_employee_id
      AND category_id = p_category_id
      AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No balance allocated for this employee and category';
    END IF;

    IF v_balance < v_total_days THEN
      RAISE EXCEPTION 'Insufficient balance: % days available, % days requested', v_balance, v_total_days;
    END IF;

    UPDATE employee_balances
    SET remaining_days = remaining_days - v_total_days
    WHERE employee_id = p_employee_id
      AND category_id = p_category_id
      AND workspace_id = p_workspace_id;
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

REVOKE EXECUTE ON FUNCTION create_time_off_record(uuid, uuid, uuid, date, date, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_time_off_record(uuid, uuid, uuid, date, date, text, text, text)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- approve_time_off_request -- same behaviour, now delegating.
-- Body from 20260604500000.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_time_off_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request         record;
  v_total_days      double precision;
  v_balance         double precision;
  v_accrual_method  text;
  v_employee_status text;
BEGIN
  IF NOT is_workspace_admin() THEN
    RAISE EXCEPTION 'Permission denied: only workspace admins can approve time-off requests';
  END IF;

  SELECT * INTO v_request
  FROM time_off_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.workspace_id IS DISTINCT FROM get_user_workspace_id() THEN
    RAISE EXCEPTION 'Permission denied: request does not belong to your workspace';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  SELECT status INTO v_employee_status
  FROM profiles
  WHERE id = v_request.profile_id
  FOR UPDATE;

  IF v_employee_status IS NULL OR v_employee_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot approve: employee is no longer active';
  END IF;

  -- Recomputed server-side: never trust the total_days on the row.
  v_total_days := count_leave_days(
    v_request.workspace_id, v_request.start_date, v_request.end_date,
    v_request.start_period, v_request.end_period
  );

  -- Symmetric with create_time_off_record: a request that consumes no working
  -- day is not approvable. Without this, approving one wrote an "approved" row
  -- with total_days = 0 plus a delta = 0 audit entry -- noise that looks like a
  -- real decision. Such a request should be rejected instead.
  IF v_total_days <= 0 THEN
    RAISE EXCEPTION 'Request covers no working days (weekends and holidays are not counted) -- reject it instead';
  END IF;

  IF v_request.category_id IS NOT NULL THEN
    SELECT accrual_method INTO v_accrual_method
    FROM time_off_categories
    WHERE id = v_request.category_id
      AND workspace_id = v_request.workspace_id;

    IF v_accrual_method IS NOT NULL AND v_accrual_method <> 'unlimited' THEN
      SELECT remaining_days INTO v_balance
      FROM employee_balances
      WHERE employee_id = v_request.profile_id
        AND category_id = v_request.category_id
        AND workspace_id = v_request.workspace_id
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
        AND category_id = v_request.category_id
        AND workspace_id = v_request.workspace_id;

      INSERT INTO balance_adjustment_log (
        employee_id, category_id, workspace_id,
        delta, balance_before, balance_after,
        reason, request_id, adjusted_by
      ) VALUES (
        v_request.profile_id, v_request.category_id, v_request.workspace_id,
        -v_total_days, v_balance, v_balance - v_total_days,
        'request_approved', p_request_id, auth.uid()
      );
    END IF;
  END IF;

  UPDATE time_off_requests
  SET status      = 'approved',
      total_days  = v_total_days,
      reviewed_by = auth.uid(),
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
-- approve_time_off_request_bot -- same behaviour, now delegating.
-- Body from 20260825150000.
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
  v_admin_status    text;
  v_request         record;
  v_total_days      double precision;
  v_balance         double precision;
  v_accrual_method  text;
  v_employee_status text;
BEGIN
  SELECT role, workspace_id, status
  INTO v_admin_role, v_admin_workspace, v_admin_status
  FROM profiles
  WHERE id = p_admin_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin profile not found';
  END IF;

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

  IF v_request.workspace_id IS DISTINCT FROM v_admin_workspace THEN
    RAISE EXCEPTION 'Request does not belong to your workspace';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  SELECT status INTO v_employee_status
  FROM profiles
  WHERE id = v_request.profile_id
  FOR UPDATE;

  IF v_employee_status IS NULL OR v_employee_status <> 'active' THEN
    RAISE EXCEPTION 'Cannot approve: employee is no longer active';
  END IF;

  v_total_days := count_leave_days(
    v_request.workspace_id, v_request.start_date, v_request.end_date,
    v_request.start_period, v_request.end_period
  );

  IF v_total_days <= 0 THEN
    RAISE EXCEPTION 'Request covers no working days (weekends and holidays are not counted) -- reject it instead';
  END IF;

  IF v_request.category_id IS NOT NULL THEN
    SELECT accrual_method INTO v_accrual_method
    FROM time_off_categories
    WHERE id = v_request.category_id
      AND workspace_id = v_request.workspace_id;

    IF v_accrual_method IS NOT NULL AND v_accrual_method <> 'unlimited' THEN
      SELECT remaining_days INTO v_balance
      FROM employee_balances
      WHERE employee_id = v_request.profile_id
        AND category_id = v_request.category_id
        AND workspace_id = v_request.workspace_id
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
        AND category_id = v_request.category_id
        AND workspace_id = v_request.workspace_id;

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

REVOKE EXECUTE ON FUNCTION approve_time_off_request_bot(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_time_off_request_bot(uuid, uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
