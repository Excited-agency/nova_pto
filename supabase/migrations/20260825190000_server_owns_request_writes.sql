-- ============================================================
-- Migration: the server owns status, total_days and balances
--
-- The approve/reject/create RPCs are carefully written: they
-- recompute days, check the balance, and write an audit row. But
-- the underlying tables stayed directly writable by any logged-in
-- client, so all of that could simply be skipped. Verified against
-- the live schema:
--
--   requests_insert_own    -- WITH CHECK (profile_id = auth.uid()
--                             AND workspace_id = ...) and nothing
--                             about status or total_days
--   requests_update_admin  -- USING (admin AND same workspace),
--                             with NO WITH CHECK at all
--   balances_update_admin  -- same shape, no WITH CHECK
--
-- combined with GRANT INSERT/UPDATE ON ALL TABLES TO authenticated
-- (20260612100000). Reproduced over the table API:
--
--   * an EMPLOYEE could insert their own request with
--     status = 'approved' and any total_days. It never passes
--     through approve_time_off_request, so no balance is deducted
--     at all and no audit row exists -- unlimited leave that reads
--     as approved everywhere, including exported reports.
--   * an ADMIN could flip a pending request straight to 'approved'
--     (balance untouched, no log row), rewrite total_days to any
--     number, or flip an approved request back to pending while the
--     deduction stayed -- leaving a balance that nothing explains.
--     There is no un-approve path, so that damage was permanent.
--   * an ADMIN could write employee_balances.remaining_days
--     directly, bypassing bulk_update_employee_balances and its
--     balance_adjustment_log row.
--
-- Fix: give clients no direct write path at all. Every mutation
-- goes through a SECURITY DEFINER RPC that owns the rules. The two
-- flows that still wrote directly -- submit and withdraw -- become
-- RPCs here, which also removes the last place where the browser
-- decided total_days.
--
-- Read access is unchanged.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Prerequisite: the auto-reject trigger must not depend on the
--    caller's table privileges.
--
--    auto_reject_pending_on_employee_delete fires on profiles
--    UPDATE and writes time_off_requests. It is NOT security
--    definer, so it runs as the invoking role. Soft-deleting an
--    employee from the UI (updateEmployeeStatus / bulk delete) runs
--    as `authenticated`, so revoking UPDATE below would have made
--    employee deletion fail outright. Body is unchanged.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_reject_pending_on_employee_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'deleted' AND OLD.status IS DISTINCT FROM 'deleted' THEN
    UPDATE time_off_requests
    SET status = 'rejected',
        rejection_reason = 'Employee account was deleted',
        updated_at = now()
    WHERE profile_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION auto_reject_pending_on_employee_delete()
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Submitting a request -- replaces the browser INSERT and the
--    duplicate implementation inside the Slack edge function.
--
--    total_days is computed here, so the requester can no longer
--    choose it, and status is forced to 'pending'. The denormalised
--    employee_name / employee_email / employee_avatar_url and the
--    legacy request_type are derived server-side too, rather than
--    taken on trust from the client.
--
--    One body, two entry points (same shape as the approve/reject
--    pair): the _bot variant takes the requester's profile id
--    because the Slack edge function runs as service_role, where
--    auth.uid() is NULL. The web function is a thin wrapper, so the
--    rules cannot drift between the two paths.
--
--    This also retires a THIRD request_type mapping: slack-events
--    used substring matching (`name.includes("vacation")`) while the
--    web path and create_time_off_record use an exact match, so a
--    category named "Extra vacation" was classified differently
--    depending on where the request came from.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_time_off_request_bot(
  p_profile_id    uuid,
  p_category_id   uuid,
  p_start_date    date,
  p_end_date      date,
  p_start_period  text DEFAULT 'morning',
  p_end_period    text DEFAULT 'end_of_day',
  p_comment       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile       record;
  v_category_name text;
  v_request_type  text;
  v_total_days    double precision;
  v_request_id    uuid;
BEGIN
  SELECT id, workspace_id, first_name, last_name, email, avatar_url, status
  INTO v_profile
  FROM profiles
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- A deactivated or deleted employee keeps their profile row, and an
  -- already-issued token stays valid until it expires.
  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Permission denied: your account is not active';
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

  SELECT name INTO v_category_name
  FROM time_off_categories
  WHERE id = p_category_id
    AND workspace_id = v_profile.workspace_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found or inactive in this workspace';
  END IF;

  v_total_days := count_leave_days(
    v_profile.workspace_id, p_start_date, p_end_date, p_start_period, p_end_period
  );

  IF v_total_days <= 0 THEN
    RAISE EXCEPTION 'Selected dates contain no working days (weekends and holidays are not counted)';
  END IF;

  v_request_type := CASE lower(v_category_name)
    WHEN 'vacation' THEN 'vacation'
    WHEN 'sick leave' THEN 'sick_leave'
    WHEN 'personal' THEN 'personal'
    WHEN 'bereavement' THEN 'bereavement'
    ELSE 'other'
  END;

  INSERT INTO time_off_requests (
    profile_id, workspace_id, category_id,
    start_date, end_date, start_period, end_period, total_days,
    request_type, status, comment,
    employee_name, employee_email, employee_avatar_url
  ) VALUES (
    v_profile.id, v_profile.workspace_id, p_category_id,
    p_start_date, p_end_date, p_start_period, p_end_period, v_total_days,
    v_request_type, 'pending', p_comment,
    coalesce(trim(concat(v_profile.first_name, ' ', v_profile.last_name)), ''),
    v_profile.email,
    v_profile.avatar_url
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'id', v_request_id,
    'total_days', v_total_days,
    'workspace_id', v_profile.workspace_id
  );
END;
$$;

-- Only the Slack edge function (service_role) may name the requester.
REVOKE EXECUTE ON FUNCTION submit_time_off_request_bot(uuid, uuid, date, date, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_time_off_request_bot(uuid, uuid, date, date, text, text, text)
  TO service_role;

-- Web entry point: the requester is always the caller, never a parameter.
CREATE OR REPLACE FUNCTION submit_time_off_request(
  p_category_id   uuid,
  p_start_date    date,
  p_end_date      date,
  p_start_period  text DEFAULT 'morning',
  p_end_period    text DEFAULT 'end_of_day',
  p_comment       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN submit_time_off_request_bot(
    auth.uid(), p_category_id, p_start_date, p_end_date,
    p_start_period, p_end_period, p_comment
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION submit_time_off_request(uuid, date, date, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_time_off_request(uuid, date, date, text, text, text)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. withdraw_time_off_request -- replaces the browser UPDATE.
--    Only the requester, only while still pending. A pending
--    request has not touched the balance, so nothing to restore.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION withdraw_time_off_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request record;
BEGIN
  SELECT * INTO v_request
  FROM time_off_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.profile_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Permission denied: you can only withdraw your own requests';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending requests can be withdrawn';
  END IF;

  UPDATE time_off_requests
  SET status = 'withdrawn'
  WHERE id = p_request_id;

  RETURN jsonb_build_object('id', p_request_id, 'status', 'withdrawn');
END;
$$;

REVOKE EXECUTE ON FUNCTION withdraw_time_off_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION withdraw_time_off_request(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Close the direct write paths.
--
--    Table-level privileges, not policies: an RLS policy cannot
--    express "status must not change" (WITH CHECK sees only the new
--    row, never the old one), so the privilege is the right tool.
--
--    The existing write policies are left in place but are now
--    unreachable -- a policy only ever narrows a privilege the role
--    already holds. Re-granting INSERT/UPDATE on these tables to
--    `authenticated` would reopen everything described above.
--
--    SECURITY DEFINER RPCs are unaffected (they run as the owner),
--    as are the edge functions, which use service_role.
-- ------------------------------------------------------------
REVOKE INSERT, UPDATE ON time_off_requests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON employee_balances FROM authenticated;

COMMENT ON TABLE time_off_requests IS
  'Writes go exclusively through RPCs: submit_time_off_request, withdraw_time_off_request, approve/reject_time_off_request(_bot), create_time_off_record. INSERT/UPDATE are revoked from `authenticated` on purpose -- status and total_days must never be client-controlled. DELETE stays for the requests_delete_own_pending policy.';

COMMENT ON TABLE employee_balances IS
  'Writes go exclusively through RPCs (bulk_update_employee_balances, the approve/create paths) and the SECURITY DEFINER seed triggers, so every change lands in balance_adjustment_log. INSERT/UPDATE/DELETE are revoked from `authenticated` on purpose.';

-- ------------------------------------------------------------
-- 5. Validate the values bulk_update_employee_balances is given.
--
--    It writes remaining_days as an absolute value straight from the
--    caller, with no bounds check. The balance editor already refuses
--    negatives and non-numbers client-side
--    (src/pages/employee-details.tsx), so the rule exists -- it just
--    was not enforced anywhere it could not be skipped. Now that this
--    RPC is the ONLY way to write a balance, that check belongs here.
--
--    Body reproduced from 20260612090000; the only addition is the
--    validation loop.
-- ------------------------------------------------------------
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

  IF get_user_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'Permission denied: workspace mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_employee_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Employee not found in this workspace';
  END IF;

  -- Validate every category AND every value before changing anything, so a
  -- bad entry cannot leave half the balances updated.
  FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_category_id := (v_update->>'category_id')::uuid;
    v_new_balance := (v_update->>'remaining_days')::double precision;

    IF NOT EXISTS (
      SELECT 1 FROM time_off_categories
      WHERE id = v_category_id AND workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'Category % does not belong to workspace %', v_category_id, p_workspace_id;
    END IF;

    IF v_new_balance IS NULL THEN
      RAISE EXCEPTION 'Balance for category % is missing or not a number', v_category_id;
    END IF;

    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'Balance cannot be negative (category %, value %)', v_category_id, v_new_balance;
    END IF;
  END LOOP;

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

REVOKE EXECUTE ON FUNCTION bulk_update_employee_balances(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bulk_update_employee_balances(uuid, uuid, jsonb) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
