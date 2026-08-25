-- ============================================================
-- Migration: a waiting period actually blocks leave
--
-- new_hire_rule / waiting_period_value / waiting_period_unit were
-- collected by the category editor and rendered back as "20 days
-- after 3 months", but nothing enforced them. Two of the five
-- default categories ship with a 3-month period, so a brand-new
-- hire could book leave from them on day one.
--
-- 20260826110000 stopped GRANTING the balance before the period
-- ends, which already makes approval fail -- but it fails with
-- "Insufficient balance", which is misleading: the employee is not
-- short of days, they are not entitled yet.
--
-- The rule lives in a trigger rather than inside each RPC. There
-- are four write paths today (submit_time_off_request,
-- submit_time_off_request_bot, create_time_off_record, and the
-- Slack bot behind the first two) and the last audit found what
-- happens when a rule is copied per path: they drift, and one of
-- them silently loses it. A BEFORE INSERT trigger is one
-- implementation that no future write path can bypass.
--
-- Checked against start_date, not today: booking in August for
-- leave that starts in October, once the period has elapsed, is
-- legitimate and should not be refused.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION trg_enforce_category_waiting_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c          record;
  pr         record;
  v_eligible date;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT new_hire_rule, waiting_period_value, waiting_period_unit, name
    INTO c
  FROM time_off_categories
  WHERE id = NEW.category_id;

  IF NOT FOUND
     OR c.new_hire_rule <> 'waiting_period'
     OR COALESCE(c.waiting_period_value, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT hire_date, created_at INTO pr FROM profiles WHERE id = NEW.profile_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_eligible := accrual_eligible_from(
    pr.hire_date, pr.created_at,
    c.new_hire_rule, c.waiting_period_value, c.waiting_period_unit
  );

  IF NEW.start_date < v_eligible THEN
    RAISE EXCEPTION '% is not available until % (waiting period for new joiners)',
      c.name, to_char(v_eligible, 'DD Mon YYYY');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION trg_enforce_category_waiting_period()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_category_waiting_period ON time_off_requests;
CREATE TRIGGER enforce_category_waiting_period
  BEFORE INSERT ON time_off_requests
  FOR EACH ROW
  EXECUTE FUNCTION trg_enforce_category_waiting_period();

-- ------------------------------------------------------------
-- Let the client tell an employee WHEN a category opens up,
-- instead of only refusing them at submit time.
--
-- Security: returns rows for the caller's own workspace only, and
-- only for the caller unless they are an admin.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION category_availability(p_employee_id uuid DEFAULT NULL)
RETURNS TABLE (category_id uuid, available_from date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target uuid := COALESCE(p_employee_id, auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_target <> auth.uid() AND NOT is_workspace_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can read another employee''s availability';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_target AND workspace_id = get_user_workspace_id()
  ) THEN
    RAISE EXCEPTION 'Employee not found in this workspace';
  END IF;

  RETURN QUERY
  SELECT c.id,
         accrual_eligible_from(
           p.hire_date, p.created_at,
           c.new_hire_rule, c.waiting_period_value, c.waiting_period_unit
         )
  FROM time_off_categories c
  CROSS JOIN profiles p
  WHERE p.id = v_target
    AND c.workspace_id = p.workspace_id
    AND c.is_active = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION category_availability(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION category_availability(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
