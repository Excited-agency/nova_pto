-- ============================================================
-- Migration: the accrual engine
--
-- The category editor has always collected a full leave policy:
-- accrual method, granting frequency, accrual day, seniority
-- bonus, new-hire waiting period, carryover limit and carryover
-- expiry. All of it was stored, and getAllowancePolicy() rendered
-- it back as a sentence -- but NOTHING ever applied it. There is
-- no scheduled job anywhere in the project.
--
-- What actually happened: seed_balances_for_employee() wrote
-- amount_value once, when the employee or the category was
-- created, and from then on the number could only go down. So
-- "20 days per year" meant 20 days once, ever; 1 January did
-- nothing; a configured 3-month waiting period (which two of the
-- five default categories set) was ignored, and carryover limits
-- were decoration.
--
-- This migration makes the settings real:
--
--   accrual_grant_dates()  -- when a grant is due, per policy
--   accrue_balance()       -- apply everything due for one row
--   apply_accruals()       -- daily sweep, driven by pg_cron
--   recalculate_employee_balance() -- replay from the hire date
--
-- Decisions taken by the product owner, encoded here:
--   * every method and frequency the form offers is implemented;
--   * carryover with the limit switched OFF carries the whole
--     remaining balance (the switch is labelled "Limit
--     carryover", so off means unlimited, not "none");
--   * a waiting period means no balance at all until it ends,
--     then the full amount lands in one grant;
--   * existing balances are recalculated from the hire date.
--
-- Idempotency: employee_balances.last_accrual_on records the last
-- grant date applied, so a re-run, a missed day, or a month of
-- downtime all converge on the same answer.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. State the engine needs.
-- ------------------------------------------------------------
ALTER TABLE employee_balances
  ADD COLUMN IF NOT EXISTS last_accrual_on      date,
  ADD COLUMN IF NOT EXISTS carryover_days       double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carryover_expires_on date;

COMMENT ON COLUMN employee_balances.last_accrual_on IS
  'Date of the most recent grant applied to this row. The engine only considers dates after it, which is what makes apply_accruals() safe to run repeatedly and safe to miss.';
COMMENT ON COLUMN employee_balances.carryover_days IS
  'How much of remaining_days came from carryover at the last reset. Only meaningful when the category sets a carryover expiry.';
COMMENT ON COLUMN employee_balances.carryover_expires_on IS
  'When the carried days lapse. NULL means they never do.';

-- New audit reasons. The log is the only record of an automated
-- change, so every branch below writes one.
ALTER TABLE balance_adjustment_log
  DROP CONSTRAINT IF EXISTS balance_adjustment_log_reason_check;

ALTER TABLE balance_adjustment_log
  ADD CONSTRAINT balance_adjustment_log_reason_check
  CHECK (reason IN (
    'manual_adjustment',
    'request_approved',
    'record_created',
    'accrual',
    'carryover_capped',
    'carryover_expired',
    'recalculated'
  ));

-- ------------------------------------------------------------
-- 2. Date helpers.
-- ------------------------------------------------------------

-- make_date(2027, 2, 29) throws. Anyone hired on a 29th, 30th or
-- 31st needs their anniversary clamped to the length of the target
-- month, or the engine dies once a year on real data.
CREATE OR REPLACE FUNCTION accrual_safe_date(p_year int, p_month int, p_day int)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    make_date(p_year, p_month, 1)
    + make_interval(days => LEAST(
        p_day,
        EXTRACT(DAY FROM (make_date(p_year, p_month, 1) + INTERVAL '1 month - 1 day'))::int
      ) - 1)
  )::date;
$$;

-- The first day an employee may accrue anything in this category.
-- Falls back to created_at because hire_date is nullable and 6 of
-- the 35 live profiles have none.
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

-- ------------------------------------------------------------
-- 3. The schedule.
--
--    Returns every date d with p_after < d <= p_through on which a
--    grant is due, for the policy on p_category_id.
--
--    p_eligible_from is granted itself (for `fixed` and
--    `periodic`): someone hired in June must not wait until
--    January for their first day. `anniversary` is excluded on
--    purpose -- it is a seniority bonus, not a base allowance, so
--    handing it out on day one would be wrong.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION accrual_grant_dates(
  p_category_id    uuid,
  p_hire_date      date,
  p_eligible_from  date,
  p_after          date,
  p_through        date
)
RETURNS SETOF date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            record;
  v_hire       date := COALESCE(p_hire_date, p_eligible_from);
  v_year       int;
  v_month      int;
  v_day        int;
  v_date       date;
  v_first      date;
  v_k          int;
  v_step_month int;
BEGIN
  SELECT accrual_method, granting_frequency, accrual_day, anniversary_years
    INTO c
  FROM time_off_categories
  WHERE id = p_category_id;

  IF NOT FOUND OR c.accrual_method = 'unlimited' THEN
    RETURN;
  END IF;

  -- The eligibility grant.
  IF c.accrual_method IN ('fixed', 'periodic')
     AND p_eligible_from > p_after
     AND p_eligible_from <= p_through THEN
    RETURN NEXT p_eligible_from;
  END IF;

  -- ---- fixed: one reset per year ----
  IF c.accrual_method = 'fixed' THEN
    IF COALESCE(c.granting_frequency, 'yearly') = 'hire_anniversary' THEN
      v_month := EXTRACT(MONTH FROM v_hire)::int;
      v_day   := EXTRACT(DAY   FROM v_hire)::int;
    ELSE
      v_month := 1;
      v_day   := 1;
    END IF;

    FOR v_year IN EXTRACT(YEAR FROM p_after)::int .. EXTRACT(YEAR FROM p_through)::int LOOP
      v_date := accrual_safe_date(v_year, v_month, v_day);
      IF v_date > p_after AND v_date <= p_through AND v_date > p_eligible_from THEN
        RETURN NEXT v_date;
      END IF;
    END LOOP;
    RETURN;
  END IF;

  -- ---- anniversary: a bonus every N years of service ----
  IF c.accrual_method = 'anniversary' THEN
    v_k := 1;
    LOOP
      v_date := (v_hire + make_interval(years => v_k * GREATEST(COALESCE(c.anniversary_years, 1), 1)))::date;
      EXIT WHEN v_date > p_through;
      IF v_date > p_after AND v_date >= p_eligible_from THEN
        RETURN NEXT v_date;
      END IF;
      v_k := v_k + 1;
      EXIT WHEN v_k > 200;   -- guard: nobody serves 200 milestones
    END LOOP;
    RETURN;
  END IF;

  -- ---- periodic: a rate, credited every period ----
  IF c.accrual_method = 'periodic' THEN
    IF COALESCE(c.granting_frequency, 'monthly') IN ('weekly', 'bi_weekly') THEN
      -- accrual_day is a weekday name. Anchor on the first such
      -- weekday on or after eligibility so the bi-weekly phase is
      -- stable no matter when the sweep runs.
      v_first := p_eligible_from;
      WHILE lower(to_char(v_first, 'FMday')) <> lower(COALESCE(c.accrual_day, 'monday')) LOOP
        v_first := v_first + 1;
        EXIT WHEN v_first > p_eligible_from + 7;
      END LOOP;

      v_date := v_first;
      WHILE v_date <= p_through LOOP
        IF v_date > p_after AND v_date > p_eligible_from THEN
          RETURN NEXT v_date;
        END IF;
        v_date := v_date + CASE WHEN c.granting_frequency = 'bi_weekly' THEN 14 ELSE 7 END;
      END LOOP;
      RETURN;
    END IF;

    v_step_month := CASE COALESCE(c.granting_frequency, 'monthly')
                      WHEN 'monthly'   THEN 1
                      WHEN 'quarterly' THEN 3
                      ELSE 12          -- yearly
                    END;

    -- Phase: anniversary-day schedules follow the hire month, the
    -- calendar ones follow January.
    IF COALESCE(c.accrual_day, 'first_day_of_month') = 'hire_anniversary_day' THEN
      v_first := accrual_safe_date(
        EXTRACT(YEAR FROM v_hire)::int,
        EXTRACT(MONTH FROM v_hire)::int,
        EXTRACT(DAY FROM v_hire)::int
      );
    ELSE
      v_first := make_date(EXTRACT(YEAR FROM v_hire)::int, 1, 1);
    END IF;

    -- Walk forward in whole steps until we are inside the window.
    v_k := 0;
    LOOP
      v_date := (v_first + make_interval(months => v_k * v_step_month))::date;

      IF COALESCE(c.accrual_day, 'first_day_of_month') = 'last_day_of_month' THEN
        v_date := (date_trunc('month', v_date) + INTERVAL '1 month - 1 day')::date;
      ELSIF COALESCE(c.accrual_day, 'first_day_of_month') = 'first_day_of_month' THEN
        v_date := date_trunc('month', v_date)::date;
      END IF;

      EXIT WHEN v_date > p_through;
      IF v_date > p_after AND v_date > p_eligible_from THEN
        RETURN NEXT v_date;
      END IF;
      v_k := v_k + 1;
      EXIT WHEN v_k > 5000;   -- guard against a pathological config
    END LOOP;
  END IF;
END;
$$;

-- Internal to the engine: never reachable from a browser. service_role keeps
-- access so the trusted backend (and the test suite) can assert a schedule
-- directly instead of inferring it from a resulting balance.
REVOKE EXECUTE ON FUNCTION accrual_grant_dates(uuid, date, date, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION accrual_grant_dates(uuid, date, date, date, date) TO service_role;

-- ------------------------------------------------------------
-- 4. Apply everything due for one (employee, category).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION accrue_balance(
  p_employee_id uuid,
  p_category_id uuid,
  p_as_of       date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of      date := COALESCE(p_as_of, CURRENT_DATE);
  b            record;
  c            record;
  pr           record;
  v_eligible   date;
  v_cursor     date;
  v_grant      date;
  v_amount     double precision;
  v_before     double precision;
  v_after      double precision;
  v_carried    double precision;
  v_forfeited  double precision;
  v_expire     double precision;
BEGIN
  SELECT * INTO b
  FROM employee_balances
  WHERE employee_id = p_employee_id AND category_id = p_category_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO c FROM time_off_categories WHERE id = p_category_id;
  IF NOT FOUND OR c.accrual_method = 'unlimited' OR NOT c.is_active THEN
    RETURN;
  END IF;

  SELECT hire_date, created_at, status INTO pr FROM profiles WHERE id = p_employee_id;
  IF NOT FOUND OR pr.status <> 'active' THEN
    RETURN;
  END IF;

  v_amount   := GREATEST(COALESCE(c.amount_value, 0), 0);
  v_eligible := accrual_eligible_from(
    pr.hire_date, pr.created_at, c.new_hire_rule,
    c.waiting_period_value, c.waiting_period_unit
  );
  v_cursor := COALESCE(b.last_accrual_on, v_eligible - 1);
  v_before := b.remaining_days;

  FOR v_grant IN
    SELECT d FROM accrual_grant_dates(
      p_category_id, pr.hire_date, v_eligible, v_cursor, v_as_of
    ) AS d
    ORDER BY d
  LOOP
    -- Carried days that lapsed before this grant go first, so the
    -- carryover cap below sees the balance the employee actually had.
    IF b.carryover_expires_on IS NOT NULL
       AND b.carryover_expires_on <= v_grant
       AND b.carryover_days > 0 THEN
      v_expire := LEAST(b.carryover_days, b.remaining_days);
      IF v_expire > 0 THEN
        INSERT INTO balance_adjustment_log (
          employee_id, category_id, workspace_id, delta,
          balance_before, balance_after, reason
        ) VALUES (
          p_employee_id, p_category_id, b.workspace_id, -v_expire,
          b.remaining_days, b.remaining_days - v_expire, 'carryover_expired'
        );
        b.remaining_days := b.remaining_days - v_expire;
      END IF;
      b.carryover_days := 0;
      b.carryover_expires_on := NULL;
    END IF;

    IF c.accrual_method = 'fixed' THEN
      -- A reset: the year starts over at amount_value, plus whatever
      -- the policy lets the employee carry.
      v_carried := GREATEST(b.remaining_days, 0);
      IF c.carryover_limit_enabled THEN
        v_forfeited := v_carried - LEAST(v_carried, GREATEST(COALESCE(c.carryover_max_days, 0), 0));
        v_carried   := v_carried - v_forfeited;
        IF v_forfeited > 0 THEN
          INSERT INTO balance_adjustment_log (
            employee_id, category_id, workspace_id, delta,
            balance_before, balance_after, reason
          ) VALUES (
            p_employee_id, p_category_id, b.workspace_id, -v_forfeited,
            b.remaining_days, v_carried, 'carryover_capped'
          );
        END IF;
      END IF;

      INSERT INTO balance_adjustment_log (
        employee_id, category_id, workspace_id, delta,
        balance_before, balance_after, reason
      ) VALUES (
        p_employee_id, p_category_id, b.workspace_id, v_amount,
        v_carried, v_carried + v_amount, 'accrual'
      );

      b.remaining_days := v_carried + v_amount;
      b.carryover_days := v_carried;
      b.carryover_expires_on := CASE
        WHEN v_carried > 0 AND COALESCE(c.carryover_expiration_value, 0) > 0 THEN
          CASE COALESCE(c.carryover_expiration_unit, 'year')
            WHEN 'month' THEN (v_grant + make_interval(months => c.carryover_expiration_value))::date
            ELSE              (v_grant + make_interval(years  => c.carryover_expiration_value))::date
          END
        ELSE NULL
      END;

    ELSE
      -- periodic and anniversary both add to the balance.
      INSERT INTO balance_adjustment_log (
        employee_id, category_id, workspace_id, delta,
        balance_before, balance_after, reason
      ) VALUES (
        p_employee_id, p_category_id, b.workspace_id, v_amount,
        b.remaining_days, b.remaining_days + v_amount, 'accrual'
      );
      b.remaining_days := b.remaining_days + v_amount;

      -- For a rate-based category the carryover limit is a ceiling
      -- carried into the new calendar year rather than a reset.
      IF c.accrual_method = 'periodic'
         AND c.carryover_limit_enabled
         AND EXTRACT(MONTH FROM v_grant) = 1
         AND EXTRACT(DAY FROM v_grant) = 1
         AND b.remaining_days > GREATEST(COALESCE(c.carryover_max_days, 0), 0) THEN
        v_forfeited := b.remaining_days - GREATEST(COALESCE(c.carryover_max_days, 0), 0);
        INSERT INTO balance_adjustment_log (
          employee_id, category_id, workspace_id, delta,
          balance_before, balance_after, reason
        ) VALUES (
          p_employee_id, p_category_id, b.workspace_id, -v_forfeited,
          b.remaining_days, b.remaining_days - v_forfeited, 'carryover_capped'
        );
        b.remaining_days := b.remaining_days - v_forfeited;
      END IF;
    END IF;

    b.last_accrual_on := v_grant;
  END LOOP;

  -- Carryover that lapsed with no grant following it.
  IF b.carryover_expires_on IS NOT NULL
     AND b.carryover_expires_on <= v_as_of
     AND b.carryover_days > 0 THEN
    v_expire := LEAST(b.carryover_days, b.remaining_days);
    IF v_expire > 0 THEN
      INSERT INTO balance_adjustment_log (
        employee_id, category_id, workspace_id, delta,
        balance_before, balance_after, reason
      ) VALUES (
        p_employee_id, p_category_id, b.workspace_id, -v_expire,
        b.remaining_days, b.remaining_days - v_expire, 'carryover_expired'
      );
      b.remaining_days := b.remaining_days - v_expire;
    END IF;
    b.carryover_days := 0;
    b.carryover_expires_on := NULL;
  END IF;

  -- Unconditional: the row is already locked, and comparing every
  -- field back against the table to save one write buys nothing but
  -- a chance to get the comparison wrong.
  UPDATE employee_balances
  SET remaining_days       = b.remaining_days,
      carryover_days       = b.carryover_days,
      carryover_expires_on = b.carryover_expires_on,
      last_accrual_on      = b.last_accrual_on,
      updated_at           = CASE WHEN b.remaining_days IS DISTINCT FROM v_before THEN now() ELSE updated_at END
  WHERE id = b.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION accrue_balance(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION accrue_balance(uuid, uuid, date) TO service_role;

-- ------------------------------------------------------------
-- 5. Daily sweep.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_accruals(p_as_of date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT b.employee_id, b.category_id
    FROM employee_balances b
    JOIN time_off_categories c ON c.id = b.category_id
    JOIN profiles p           ON p.id = b.employee_id
    WHERE c.is_active
      AND c.accrual_method <> 'unlimited'
      AND p.status = 'active'
  LOOP
    PERFORM accrue_balance(r.employee_id, r.category_id, p_as_of);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_accruals(date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION apply_accruals(date) TO service_role;

COMMENT ON FUNCTION apply_accruals(date) IS
  'Daily entry point, scheduled with pg_cron. Idempotent: re-running it on the same day is a no-op, and a run after downtime catches up on every missed grant.';

-- ------------------------------------------------------------
-- 6. Replay a balance from scratch.
--
--    Merges the grant schedule with the leave actually taken
--    (attributed to each request's start date) and walks the
--    timeline in order, so a carryover cap sees the balance the
--    employee really had at that moment.
--
--    Writes a single 'recalculated' audit row rather than
--    hundreds of synthetic ones -- the point is to explain the
--    jump, not to fabricate a history that never happened.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalculate_employee_balance(
  p_employee_id uuid,
  p_category_id uuid,
  p_as_of       date DEFAULT NULL
)
RETURNS double precision
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of     date := COALESCE(p_as_of, CURRENT_DATE);
  b           record;
  c           record;
  pr          record;
  v_eligible  date;
  v_amount    double precision;
  v_running   double precision := 0;
  v_carried   double precision := 0;
  v_expires   date := NULL;
  v_before    double precision;
  ev          record;
BEGIN
  SELECT * INTO b
  FROM employee_balances
  WHERE employee_id = p_employee_id AND category_id = p_category_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO c FROM time_off_categories WHERE id = p_category_id;
  IF NOT FOUND OR c.accrual_method = 'unlimited' THEN
    RETURN b.remaining_days;
  END IF;

  SELECT hire_date, created_at INTO pr FROM profiles WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN b.remaining_days; END IF;

  v_before   := b.remaining_days;
  v_amount   := GREATEST(COALESCE(c.amount_value, 0), 0);
  v_eligible := accrual_eligible_from(
    pr.hire_date, pr.created_at, c.new_hire_rule,
    c.waiting_period_value, c.waiting_period_unit
  );

  FOR ev IN
    -- priority, not the text of `kind`: a grant must land before a
    -- spend on the same date, and sorting 'grant'/'spend' as strings
    -- to achieve that is exactly the kind of accident worth avoiding.
    SELECT d AS event_date, 'grant'::text AS kind, 0 AS priority, 0::double precision AS used
    FROM accrual_grant_dates(p_category_id, pr.hire_date, v_eligible, v_eligible - 1, v_as_of) AS d
    UNION ALL
    SELECT start_date AS event_date, 'spend'::text AS kind, 1 AS priority, total_days AS used
    FROM time_off_requests
    WHERE profile_id = p_employee_id
      AND category_id = p_category_id
      AND status = 'approved'
      AND start_date <= v_as_of
    ORDER BY event_date, priority
  LOOP
    IF ev.kind = 'grant' THEN
      IF v_expires IS NOT NULL AND v_expires <= ev.event_date AND v_carried > 0 THEN
        v_running := GREATEST(v_running - LEAST(v_carried, v_running), 0);
        v_carried := 0;
        v_expires := NULL;
      END IF;

      IF c.accrual_method = 'fixed' THEN
        v_carried := GREATEST(v_running, 0);
        IF c.carryover_limit_enabled THEN
          v_carried := LEAST(v_carried, GREATEST(COALESCE(c.carryover_max_days, 0), 0));
        END IF;
        v_running := v_carried + v_amount;
        v_expires := CASE
          WHEN v_carried > 0 AND COALESCE(c.carryover_expiration_value, 0) > 0 THEN
            CASE COALESCE(c.carryover_expiration_unit, 'year')
              WHEN 'month' THEN (ev.event_date + make_interval(months => c.carryover_expiration_value))::date
              ELSE              (ev.event_date + make_interval(years  => c.carryover_expiration_value))::date
            END
          ELSE NULL
        END;
      ELSE
        v_running := v_running + v_amount;
        IF c.accrual_method = 'periodic'
           AND c.carryover_limit_enabled
           AND EXTRACT(MONTH FROM ev.event_date) = 1
           AND EXTRACT(DAY FROM ev.event_date) = 1 THEN
          v_running := LEAST(v_running, GREATEST(COALESCE(c.carryover_max_days, 0), 0));
        END IF;
      END IF;
    ELSE
      v_running := GREATEST(v_running - ev.used, 0);
    END IF;
  END LOOP;

  IF v_expires IS NOT NULL AND v_expires <= v_as_of AND v_carried > 0 THEN
    v_running := GREATEST(v_running - LEAST(v_carried, v_running), 0);
    v_carried := 0;
    v_expires := NULL;
  END IF;

  UPDATE employee_balances
  SET remaining_days       = v_running,
      carryover_days       = v_carried,
      carryover_expires_on = v_expires,
      last_accrual_on      = (
        SELECT max(d) FROM accrual_grant_dates(
          p_category_id, pr.hire_date, v_eligible, v_eligible - 1, v_as_of
        ) AS d
      ),
      updated_at           = now()
  WHERE id = b.id;

  IF v_running IS DISTINCT FROM v_before THEN
    INSERT INTO balance_adjustment_log (
      employee_id, category_id, workspace_id, delta,
      balance_before, balance_after, reason
    ) VALUES (
      p_employee_id, p_category_id, b.workspace_id, v_running - v_before,
      v_before, v_running, 'recalculated'
    );
  END IF;

  RETURN v_running;
END;
$$;

REVOKE EXECUTE ON FUNCTION recalculate_employee_balance(uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recalculate_employee_balance(uuid, uuid, date) TO service_role;

-- ------------------------------------------------------------
-- 7. A new employee or category must not wait for the nightly run.
--
--    The seeding helpers used to write amount_value straight into
--    remaining_days, which is now the engine's job -- doing both
--    would grant twice. They now create the row empty and let
--    accrue_balance() decide, which also means a waiting period is
--    honoured from the moment the employee is created.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_balances_for_employee(
  p_employee_id  uuid,
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  INSERT INTO employee_balances (employee_id, category_id, workspace_id, remaining_days)
  SELECT p_employee_id, c.id, p_workspace_id, 0
  FROM time_off_categories c
  WHERE c.workspace_id = p_workspace_id
    AND c.is_active = true
  ON CONFLICT (employee_id, category_id) DO NOTHING;

  FOR r IN
    SELECT c.id
    FROM time_off_categories c
    WHERE c.workspace_id = p_workspace_id
      AND c.is_active = true
      AND c.accrual_method <> 'unlimited'
  LOOP
    PERFORM accrue_balance(p_employee_id, r.id, CURRENT_DATE);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION seed_balances_for_category(
  p_category_id    uuid,
  p_workspace_id   uuid,
  p_accrual_method text,
  p_amount_value   double precision
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  INSERT INTO employee_balances (employee_id, category_id, workspace_id, remaining_days)
  SELECT p.id, p_category_id, p_workspace_id, 0
  FROM profiles p
  WHERE p.workspace_id = p_workspace_id
    AND p.status = 'active'
  ON CONFLICT (employee_id, category_id) DO NOTHING;

  IF p_accrual_method = 'unlimited' THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT p.id
    FROM profiles p
    WHERE p.workspace_id = p_workspace_id
      AND p.status = 'active'
  LOOP
    PERFORM accrue_balance(r.id, p_category_id, CURRENT_DATE);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_balances_for_employee(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION seed_balances_for_category(uuid, uuid, text, double precision) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8. Nightly schedule.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('nova-pto-daily-accruals');
EXCEPTION
  WHEN OTHERS THEN NULL;   -- not scheduled yet
END;
$$;

SELECT cron.schedule(
  'nova-pto-daily-accruals',
  '0 2 * * *',
  $cron$SELECT public.apply_accruals(CURRENT_DATE)$cron$
);

-- ------------------------------------------------------------
-- 9. One-off: bring existing balances in line with the policy.
--
--    Chosen over "leave them alone" by the product owner. Safe to
--    do here: the seeded number was a one-time amount_value, and
--    replaying grants minus approved leave is strictly better
--    defined than the figure it replaces.
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT b.employee_id, b.category_id
    FROM employee_balances b
    JOIN time_off_categories c ON c.id = b.category_id
    JOIN profiles p           ON p.id = b.employee_id
    WHERE c.accrual_method <> 'unlimited'
      -- Active only. Replaying the schedule for someone who left
      -- would credit them for every year since, and there is no
      -- termination date to stop at.
      AND p.status = 'active'
  LOOP
    PERFORM recalculate_employee_balance(r.employee_id, r.category_id, CURRENT_DATE);
  END LOOP;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
