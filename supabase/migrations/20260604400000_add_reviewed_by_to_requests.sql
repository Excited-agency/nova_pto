-- ============================================================
-- Migration: Add reviewed_by and reviewed_at to time_off_requests
-- Records which admin approved or rejected each request via
-- the web UI, and when they did it.
-- ============================================================

ALTER TABLE time_off_requests
  ADD COLUMN reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz;

-- Rebuild the safe view to expose the new columns.
-- CREATE OR REPLACE VIEW cannot insert columns mid-list; drop + recreate instead.
-- reviewed_by/reviewed_at are shown to admins and to the request owner.
DROP VIEW IF EXISTS time_off_requests_safe;
CREATE VIEW time_off_requests_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  profile_id,
  workspace_id,
  category_id,
  employee_name,
  employee_email,
  employee_avatar_url,
  start_date,
  end_date,
  start_period,
  end_period,
  total_days,
  request_type,
  status,
  reviewed_by,
  reviewed_at,
  created_at,
  updated_at,
  CASE
    WHEN profile_id = auth.uid() OR is_workspace_admin() THEN comment
    ELSE NULL
  END AS comment,
  CASE
    WHEN profile_id = auth.uid() OR is_workspace_admin() THEN rejection_reason
    ELSE NULL
  END AS rejection_reason
FROM time_off_requests;

GRANT SELECT ON time_off_requests_safe TO authenticated;

-- ============================================================
-- Update approve_time_off_request to capture reviewer
-- (full body reproduced from 20260512100000 + reviewed_by/at)
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
-- Update reject_time_off_request to capture reviewer
-- (full body reproduced from 20260512200000 + reviewed_by/at)
-- ============================================================
CREATE OR REPLACE FUNCTION reject_time_off_request(
  p_request_id       uuid,
  p_rejection_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request record;
BEGIN
  IF NOT is_workspace_admin() THEN
    RAISE EXCEPTION 'Permission denied: only workspace admins can reject time-off requests';
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

  UPDATE time_off_requests
  SET status           = 'rejected',
      rejection_reason = p_rejection_reason,
      reviewed_by      = auth.uid(),
      reviewed_at      = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'id', p_request_id,
    'status', 'rejected'
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
