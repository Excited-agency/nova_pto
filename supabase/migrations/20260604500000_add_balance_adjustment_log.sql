-- ============================================================
-- Migration: Add balance_adjustment_log table
-- Tracks every change to employee_balances: who changed it,
-- what it was before, what it changed to, and why.
-- Populated by approve_time_off_request, create_time_off_record,
-- and bulk_update_employee_balances RPCs.
-- ============================================================

CREATE TABLE balance_adjustment_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id    uuid NOT NULL REFERENCES time_off_categories(id) ON DELETE CASCADE,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  delta          double precision NOT NULL,   -- negative = deduction, positive = addition
  balance_before double precision NOT NULL,
  balance_after  double precision NOT NULL,
  reason         text NOT NULL,               -- 'manual_adjustment' | 'request_approved' | 'record_created'
  request_id     uuid REFERENCES time_off_requests(id) ON DELETE SET NULL,
  adjusted_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_balance_log_employee   ON balance_adjustment_log(employee_id);
CREATE INDEX idx_balance_log_workspace  ON balance_adjustment_log(workspace_id);
CREATE INDEX idx_balance_log_request    ON balance_adjustment_log(request_id);

ALTER TABLE balance_adjustment_log ENABLE ROW LEVEL SECURITY;

-- Admins see all logs in their workspace; employees see only their own
CREATE POLICY bal_log_select ON balance_adjustment_log
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid())
    AND (is_workspace_admin() OR employee_id = auth.uid())
  );

-- ============================================================
-- Rebuild approve_time_off_request with balance log INSERT
-- (includes reviewed_by/at from migration 20260604400000)
-- ============================================================
CREATE OR REPLACE FUNCTION approve_time_off_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request         record;
  v_total_days      double precision;
  v_start_portion   double precision;
  v_end_portion     double precision;
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

  IF v_request.workspace_id <> get_user_workspace_id() THEN
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

-- ============================================================
-- Rebuild create_time_off_record with balance log INSERT
-- (full body from 20260323000000 + log insert)
-- ============================================================
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

-- ============================================================
-- Rebuild bulk_update_employee_balances with balance log INSERTs
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
  v_update        jsonb;
  v_balance_before double precision;
  v_new_balance    double precision;
BEGIN
  IF NOT is_workspace_admin() THEN
    RAISE EXCEPTION 'Permission denied: only workspace admins can update balances';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_employee_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Employee not found in this workspace';
  END IF;

  FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_new_balance := (v_update->>'remaining_days')::double precision;

    SELECT remaining_days INTO v_balance_before
    FROM employee_balances
    WHERE employee_id = p_employee_id
      AND category_id = (v_update->>'category_id')::uuid
      AND workspace_id = p_workspace_id;

    UPDATE employee_balances
    SET remaining_days = v_new_balance,
        updated_at     = now()
    WHERE employee_id  = p_employee_id
      AND category_id  = (v_update->>'category_id')::uuid
      AND workspace_id = p_workspace_id;

    IF v_balance_before IS NOT NULL THEN
      INSERT INTO balance_adjustment_log (
        employee_id, category_id, workspace_id,
        delta, balance_before, balance_after,
        reason, adjusted_by
      ) VALUES (
        p_employee_id,
        (v_update->>'category_id')::uuid,
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
