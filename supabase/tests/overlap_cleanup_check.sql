-- ============================================================
-- Proves resolve_overlapping_requests() (migration 20260827100000)
-- actually does what the migration relies on.
--
-- This cannot live in the Vitest db suite: creating overlapping rows
-- requires disabling the very trigger and constraint under test, and
-- that needs table-owner DDL, which the service_role key does not
-- have. So it runs as postgres, in a transaction that is rolled back.
--
--   docker exec -i supabase_db_Nova_pto psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/overlap_cleanup_check.sql
--
-- It matters more than a normal test: a local `supabase db reset`
-- produces no overlapping rows at all, so without this the cleanup
-- would first run against production, unexercised.
--
-- Silence means success -- every check is an ASSERT.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_ws        uuid := gen_random_uuid();
  v_emp       uuid := gen_random_uuid();
  v_cat       uuid;
  v_g         uuid;   -- 11-12 Aug, approved, created 15 May  -> kept
  v_f         uuid;   -- 10-11 Aug, PENDING,  created 01 May  -> rejected, though older than G
  v_a         uuid;   -- 05-08 Jul, approved, created 01 Jun  -> kept
  v_b         uuid;   -- 03-06 Jul, approved, created 02 Jun  -> rejected, 2 days returned
  v_c         uuid;   -- 20-21 Jul, approved, created 03 Jun  -> kept, no overlap
  v_d         uuid;   -- 06-07 Jul, pending,  created 04 Jun  -> rejected, nothing to return
  v_e         uuid;   -- Mar 2027,  approved, created 05 Jun  -> kept, FUTURE-DATED
  v_res       record;
  v_left      int;
  v_balance   double precision;
  v_log_rows  int;
  v_log       record;

  START_BALANCE constant double precision := 50;
  B_DAYS        constant double precision := 2;
BEGIN
  -- workspaces.owner_id references auth.users, so the auth row comes first.
  INSERT INTO auth.users (id, instance_id, aud, role, email)
  VALUES (v_emp, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'cleanup@example.test');

  INSERT INTO workspaces (id, name, owner_id)
  VALUES (v_ws, 'Overlap cleanup fixture', v_emp);

  INSERT INTO profiles (id, workspace_id, role, email, first_name, last_name, status, hire_date)
  VALUES (v_emp, v_ws, 'user', 'cleanup@example.test', 'Cleanup', 'Fixture', 'active', '2024-01-15');

  -- Inserting the category seeds a balance row via the existing
  -- after_category_insert_seed_balances trigger; the amount is then pinned so
  -- the arithmetic below does not depend on the accrual policy.
  INSERT INTO time_off_categories (
    workspace_id, name, colour, is_active, leave_type, accrual_method,
    amount_value, granting_frequency, new_hire_rule, waiting_period_value,
    waiting_period_unit, carryover_limit_enabled, sort_order
  )
  VALUES (
    v_ws, 'Vacation', 'green', true, 'paid', 'fixed',
    20, 'yearly', 'immediate', 0, 'month', false, 0
  )
  RETURNING id INTO v_cat;

  UPDATE employee_balances
  SET remaining_days = START_BALANCE
  WHERE employee_id = v_emp AND category_id = v_cat;

  DELETE FROM balance_adjustment_log WHERE employee_id = v_emp;

  -- ---- create the overlaps the migration is meant to clean up ----
  ALTER TABLE time_off_requests DISABLE TRIGGER prevent_overlapping_requests;
  ALTER TABLE time_off_requests DROP CONSTRAINT time_off_requests_no_overlap;

  -- created_at is set explicitly: the ranking under test depends on it, so it
  -- must not depend on how fast these inserts happen to run.
  INSERT INTO time_off_requests
    (profile_id, workspace_id, category_id, employee_name, employee_email,
     start_date, end_date, total_days, status, created_at)
  VALUES
    (v_emp, v_ws, v_cat, 'Cleanup Fixture', 'cleanup@example.test',
     '2026-08-11', '2026-08-12', 2, 'approved', '2026-05-15 10:00+00')
  RETURNING id INTO v_g;

  INSERT INTO time_off_requests
    (profile_id, workspace_id, category_id, employee_name, employee_email,
     start_date, end_date, total_days, status, created_at)
  VALUES
    (v_emp, v_ws, v_cat, 'Cleanup Fixture', 'cleanup@example.test',
     '2026-08-10', '2026-08-11', 2, 'pending', '2026-05-01 10:00+00')
  RETURNING id INTO v_f;

  INSERT INTO time_off_requests
    (profile_id, workspace_id, category_id, employee_name, employee_email,
     start_date, end_date, total_days, status, created_at)
  VALUES
    (v_emp, v_ws, v_cat, 'Cleanup Fixture', 'cleanup@example.test',
     '2026-07-05', '2026-07-08', 2, 'approved', '2026-06-01 10:00+00')
  RETURNING id INTO v_a;

  INSERT INTO time_off_requests
    (profile_id, workspace_id, category_id, employee_name, employee_email,
     start_date, end_date, total_days, status, created_at)
  VALUES
    (v_emp, v_ws, v_cat, 'Cleanup Fixture', 'cleanup@example.test',
     '2026-07-03', '2026-07-06', B_DAYS, 'approved', '2026-06-02 10:00+00')
  RETURNING id INTO v_b;

  INSERT INTO time_off_requests
    (profile_id, workspace_id, category_id, employee_name, employee_email,
     start_date, end_date, total_days, status, created_at)
  VALUES
    (v_emp, v_ws, v_cat, 'Cleanup Fixture', 'cleanup@example.test',
     '2026-07-20', '2026-07-21', 2, 'approved', '2026-06-03 10:00+00')
  RETURNING id INTO v_c;

  INSERT INTO time_off_requests
    (profile_id, workspace_id, category_id, employee_name, employee_email,
     start_date, end_date, total_days, status, created_at)
  VALUES
    (v_emp, v_ws, v_cat, 'Cleanup Fixture', 'cleanup@example.test',
     '2026-07-06', '2026-07-07', 2, 'pending', '2026-06-04 10:00+00')
  RETURNING id INTO v_d;

  -- Far-future, approved, overlaps nothing. Its five days are already
  -- deducted, because every approval path deducts eagerly.
  INSERT INTO time_off_requests
    (profile_id, workspace_id, category_id, employee_name, employee_email,
     start_date, end_date, total_days, status, created_at)
  VALUES
    (v_emp, v_ws, v_cat, 'Cleanup Fixture', 'cleanup@example.test',
     '2027-03-01', '2027-03-05', 5, 'approved', '2026-06-05 10:00+00')
  RETURNING id INTO v_e;

  ALTER TABLE time_off_requests ENABLE TRIGGER prevent_overlapping_requests;

  -- ---------------------- the function under test ----------------------
  SELECT * INTO v_res FROM resolve_overlapping_requests();

  ASSERT v_res.rejected_count = 3,
    format('expected 3 rejections (B, D, F), got %s', v_res.rejected_count);
  ASSERT v_res.restored_count = 1,
    format('expected 1 balance restored (only B was approved), got %s', v_res.restored_count);

  -- Survivors
  ASSERT (SELECT status FROM time_off_requests WHERE id = v_a) = 'approved',
    'A is the oldest approved request on those days and must survive';
  ASSERT (SELECT status FROM time_off_requests WHERE id = v_c) = 'approved',
    'C overlaps nothing and must survive';
  ASSERT (SELECT status FROM time_off_requests WHERE id = v_e) = 'approved',
    'E is far-future and overlaps nothing; it must survive';
  ASSERT (SELECT status FROM time_off_requests WHERE id = v_g) = 'approved',
    'G is approved and must beat the older pending F';

  -- Casualties
  ASSERT (SELECT status FROM time_off_requests WHERE id = v_b) = 'rejected',
    'B overlaps the older approved A and must be rejected';
  ASSERT (SELECT status FROM time_off_requests WHERE id = v_d) = 'rejected',
    'D overlaps the approved A and must be rejected';
  ASSERT (SELECT status FROM time_off_requests WHERE id = v_f) = 'rejected',
    'F is only pending, so it loses to the approved G even though F is older';

  ASSERT (SELECT rejection_reason FROM time_off_requests WHERE id = v_b)
         LIKE 'Auto-resolved:%',
    'a rejection made by the cleanup must say so';
  ASSERT (SELECT reviewed_at FROM time_off_requests WHERE id = v_b) IS NOT NULL,
    'reviewed_at must be stamped, or the row reads as never reviewed';
  ASSERT (SELECT reviewed_by FROM time_off_requests WHERE id = v_b) IS NULL,
    'reviewed_by must stay NULL: no person made this decision';

  -- No overlap may remain, or ADD CONSTRAINT below fails.
  SELECT count(*) INTO v_left
  FROM time_off_requests x
  JOIN time_off_requests y
    ON x.profile_id = y.profile_id
   AND x.id < y.id
   AND daterange(x.start_date, x.end_date, '[]')
       && daterange(y.start_date, y.end_date, '[]')
  WHERE x.status IN ('pending', 'approved')
    AND y.status IN ('pending', 'approved');

  ASSERT v_left = 0, format('%s overlapping pair(s) survived the cleanup', v_left);

  -- ---------------- the balance, to the day ----------------
  -- Exactly B's days come back. Nothing else moves.
  --
  -- This is the regression guard for reaching for
  -- recalculate_employee_balance() here. That function does not adjust the
  -- balance, it rebuilds it: every grant since the hire date, minus only the
  -- approved spends with start_date <= as_of. So it discards whatever the
  -- balance actually was and drops E's five future-dated days from the
  -- subtraction, landing somewhere unrelated to what this cleanup did.
  SELECT remaining_days INTO v_balance
  FROM employee_balances WHERE employee_id = v_emp AND category_id = v_cat;

  ASSERT v_balance = START_BALANCE + B_DAYS,
    format('balance should be %s (%s + %s returned by B) but is %s -- any other number means it was re-derived instead of reversed',
           START_BALANCE + B_DAYS, START_BALANCE, B_DAYS, v_balance);

  -- ---------------- the audit trail ----------------
  SELECT count(*) INTO v_log_rows
  FROM balance_adjustment_log WHERE employee_id = v_emp;

  ASSERT v_log_rows = 1,
    format('expected exactly one audit row, got %s', v_log_rows);

  SELECT * INTO v_log FROM balance_adjustment_log WHERE employee_id = v_emp;

  ASSERT v_log.reason = 'overlap_resolved',
    format('audit reason should be overlap_resolved, got %s', v_log.reason);
  ASSERT v_log.request_id = v_b,
    'the audit row must point at the request whose days came back';
  ASSERT v_log.delta = B_DAYS,
    format('audit delta should be %s, got %s', B_DAYS, v_log.delta);
  ASSERT v_log.balance_before = START_BALANCE AND v_log.balance_after = START_BALANCE + B_DAYS,
    'audit before/after must bracket the actual movement';

  -- Idempotent: nothing left to do, and no second helping of days.
  SELECT * INTO v_res FROM resolve_overlapping_requests();
  ASSERT v_res.rejected_count = 0 AND v_res.restored_count = 0,
    format('second run should be a no-op, got %s / %s',
           v_res.rejected_count, v_res.restored_count);

  SELECT remaining_days INTO v_balance
  FROM employee_balances WHERE employee_id = v_emp AND category_id = v_cat;
  ASSERT v_balance = START_BALANCE + B_DAYS,
    'a second run must not move the balance again';

  -- The end state must be one the real constraint accepts.
  ALTER TABLE time_off_requests
    ADD CONSTRAINT time_off_requests_no_overlap
    EXCLUDE USING gist (
      profile_id WITH =,
      daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status IN ('pending', 'approved'));

  RAISE NOTICE 'overlap cleanup: all checks passed';
END;
$$;

ROLLBACK;
