-- ============================================================
-- Migration: pin search_path on the two accrual date helpers
--
-- The Supabase database linter flagged accrual_safe_date and
-- accrual_eligible_from as having a role-mutable search_path
-- (lint 0011). Both were added in 20260826110000 without
-- `SET search_path`, unlike every other function in this project.
--
-- Neither is SECURITY DEFINER, so this is hardening rather than an
-- open hole -- but both are called from inside the SECURITY DEFINER
-- engine (accrue_balance, accrual_grant_dates,
-- recalculate_employee_balance) and from the waiting-period
-- trigger. They resolve only built-ins (make_date, make_interval,
-- EXTRACT, LEAST); with a mutable search_path, a shadowing
-- function in an earlier schema could change what a leave-day
-- calculation returns while running as the table owner.
--
-- Bodies are unchanged. Only the search_path setting is added.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION accrual_safe_date(p_year int, p_month int, p_day int)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (
    make_date(p_year, p_month, 1)
    + make_interval(days => LEAST(
        p_day,
        EXTRACT(DAY FROM (make_date(p_year, p_month, 1) + INTERVAL '1 month - 1 day'))::int
      ) - 1)
  )::date;
$$;

CREATE OR REPLACE FUNCTION accrual_eligible_from(
  p_hire_date      date,
  p_created_at     timestamptz,
  p_new_hire_rule  text,
  p_waiting_value  int,
  p_waiting_unit   text
)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_new_hire_rule = 'waiting_period' AND COALESCE(p_waiting_value, 0) > 0 THEN
      CASE COALESCE(p_waiting_unit, 'month')
        WHEN 'year' THEN (s.base + make_interval(years  => p_waiting_value))::date
        ELSE             (s.base + make_interval(months => p_waiting_value))::date
      END
    ELSE s.base
  END
  FROM (SELECT COALESCE(p_hire_date, p_created_at::date) AS base) s;
$$;

COMMENT ON FUNCTION accrual_eligible_from(date, timestamptz, text, int, text) IS
  'First date an employee is entitled to this category. Used both to schedule the first grant and to reject requests raised during a waiting period.';

COMMIT;

NOTIFY pgrst, 'reload schema';
