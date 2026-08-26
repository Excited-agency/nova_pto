-- ============================================================
-- Migration: one person cannot be on leave twice on the same day
--
-- Nothing prevented double-booking. All four write paths
-- (submit_time_off_request, submit_time_off_request_bot,
-- create_time_off_record, and Slack behind the first two) validate
-- profile, status, date order, periods, category, working days,
-- waiting period and balance -- and none of them compares the dates
-- against the employee's other requests. approve_time_off_request
-- recomputes days and re-checks the balance at approval time but
-- likewise ignores overlap, so two overlapping requests are both
-- approved and the balance is deducted twice for the same calendar
-- days.
--
-- Enforcement is deliberately NOT copied into each RPC. Same reason
-- as 20260826120000 (waiting period): rules copied per write path
-- drift, and one path silently loses it. A trigger is one
-- implementation no future write path can bypass, and it also covers
-- approval for free, since approval is an UPDATE of status.
--
-- Granularity is a whole calendar day. This is a product decision,
-- not a fact about the data model -- half-day periods exist, so
-- "vacation until Wednesday midday" and "unpaid leave from
-- Wednesday midday" are now refused even though they do not really
-- double-book. Blocking the whole day was chosen for being
-- predictable and for matching how the balance is reasoned about.
--
-- Two layers, on purpose:
--   * the trigger produces a message a human can act on
--     ("overlaps Vacation 13 Apr to 17 Apr")
--   * the EXCLUDE constraint closes what a trigger cannot -- two
--     concurrent transactions do not see each other before commit,
--     so a check-then-insert can always be raced. The partial GiST
--     index the constraint creates also serves the trigger's own
--     lookup, so no extra btree index is needed.
-- ============================================================

BEGIN;

-- In the extensions schema rather than public, so this does not add
-- to Supabase's extension_in_public advisor findings.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- Returning days taken by a request that turned out to be a duplicate
-- is neither a manual correction nor an accrual, and calling it
-- 'recalculated' would hide it among the accrual backfill's rows.
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
    'recalculated',
    'overlap_resolved'
  ));

-- ------------------------------------------------------------
-- Step 1: resolve overlaps that already exist
--
-- Required, not optional: an EXCLUDE constraint is validated against
-- existing rows, so it cannot be added while any overlap remains.
-- Production holds two overlapping approved pairs for one employee
-- (verified by query, 26 Aug 2026); a local `supabase db reset`
-- produces none, because the request seed in 20260319000000
-- short-circuits when there is no workspace to attach to.
--
-- That asymmetry is the reason this is a named function rather than
-- an inline DO block: otherwise the one part of this migration that
-- rewrites rows and moves balances would never have executed
-- anywhere before it executed against production. It is exercised by
-- supabase/tests/overlap_cleanup_check.sql. It is also idempotent --
-- a second call finds nothing to do.
--
-- Ranking, in order: approved before pending, then oldest first.
-- Pure created_at order would let an untouched pending request
-- survive and auto-reject an approved one the employee may already
-- have taken and had deducted.
--
-- The ORDER BY and the comparison tuple in the EXISTS below must
-- stay the same expression. The pass is only provably overlap-free
-- because the loop visits rows in exactly the order the comparison
-- ranks them; changing one without the other silently leaves
-- overlaps behind and the ADD CONSTRAINT at the end of this
-- migration then fails.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_overlapping_requests()
RETURNS TABLE (rejected_count int, restored_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_before double precision;
BEGIN
  -- Belt and braces next to the REVOKE below. Supabase's default
  -- privileges grant EXECUTE on new public routines to
  -- `authenticated` (20260612100000), so the REVOKE is the only thing
  -- standing between a logged-in user and a one-call, cross-workspace
  -- mass reject. One dropped line should not be enough to undo that.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_overlapping_requests() is repair tooling, not an application call';
  END IF;

  rejected_count := 0;
  restored_count := 0;

  FOR r IN
    SELECT id, profile_id, workspace_id, category_id,
           start_date, end_date, status, total_days, created_at
    FROM time_off_requests
    WHERE status IN ('pending', 'approved')
    ORDER BY profile_id,
             (CASE WHEN status = 'approved' THEN 0 ELSE 1 END),
             created_at,
             id
  LOOP
    -- Not scoped by workspace_id on purpose: this looks for conflicts,
    -- and an extra filter on a conflict search can only find fewer of
    -- them. The invariant, like the constraint below, is per person.
    IF EXISTS (
      SELECT 1
      FROM time_off_requests k
      WHERE k.profile_id = r.profile_id
        AND k.id <> r.id
        AND k.status IN ('pending', 'approved')
        AND ((CASE WHEN k.status = 'approved' THEN 0 ELSE 1 END), k.created_at, k.id)
          < ((CASE WHEN r.status = 'approved' THEN 0 ELSE 1 END), r.created_at, r.id)
        AND daterange(k.start_date, k.end_date, '[]')
            && daterange(r.start_date, r.end_date, '[]')
    ) THEN
      UPDATE time_off_requests
      SET status           = 'rejected',
          rejection_reason = 'Auto-resolved: overlapped an earlier request for the same dates',
          -- reviewed_by stays NULL: no person decided this.
          reviewed_at      = now()
      WHERE id = r.id;

      rejected_count := rejected_count + 1;

      -- Give back exactly what approval took, rather than re-deriving
      -- the balance from scratch. recalculate_employee_balance() looks
      -- like the right tool and is not: it only replays spends with
      -- start_date <= as_of, while every approval path deducts
      -- immediately whatever the date, so calling it here would also
      -- hand back every future-dated approved request in the same
      -- category. Reversing one known deduction cannot drift.
      --
      -- A NULL accrual_method (category since deleted) fails this test
      -- and is left alone -- better than guessing at a balance whose
      -- policy can no longer be read.
      IF r.status = 'approved'
         AND r.category_id IS NOT NULL
         AND (SELECT accrual_method FROM time_off_categories WHERE id = r.category_id)
             <> 'unlimited'
      THEN
        SELECT remaining_days INTO v_before
        FROM employee_balances
        WHERE employee_id = r.profile_id
          AND category_id = r.category_id
        FOR UPDATE;

        IF v_before IS NOT NULL THEN
          UPDATE employee_balances
          SET remaining_days = v_before + r.total_days,
              updated_at     = now()
          WHERE employee_id = r.profile_id
            AND category_id = r.category_id;

          INSERT INTO balance_adjustment_log (
            employee_id, category_id, workspace_id,
            delta, balance_before, balance_after, reason, request_id
          ) VALUES (
            r.profile_id, r.category_id, r.workspace_id,
            r.total_days, v_before, v_before + r.total_days,
            'overlap_resolved', r.id
          );

          restored_count := restored_count + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION resolve_overlapping_requests()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION resolve_overlapping_requests() IS
  'Rejects requests that overlap an earlier active request for the same employee (approved wins over pending, then oldest wins) and returns the days any affected approved request had deducted. Idempotent. Run before adding time_off_requests_no_overlap.';

SELECT * FROM resolve_overlapping_requests();

-- ------------------------------------------------------------
-- Step 2: the readable check
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_prevent_overlapping_requests()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict record;
BEGIN
  -- withdrawn / rejected requests free their dates, including the
  -- auto-reject that fires when an employee is soft-deleted.
  IF NEW.status NOT IN ('pending', 'approved') THEN
    RETURN NEW;
  END IF;

  -- Keyed on profile_id alone, exactly like the constraint below. Adding
  -- workspace_id would narrow a conflict search, which can only produce
  -- false negatives -- and a missed conflict here means the user gets the
  -- raw exclusion-constraint text instead of the sentence this function
  -- exists to write.
  SELECT start_date,
         end_date,
         status,
         COALESCE(NULLIF(btrim(category_name), ''), 'time off') AS label
    INTO v_conflict
  FROM time_off_requests
  WHERE profile_id = NEW.profile_id
    AND id <> NEW.id
    AND status IN ('pending', 'approved')
    AND daterange(start_date, end_date, '[]')
        && daterange(NEW.start_date, NEW.end_date, '[]')
  ORDER BY start_date
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'These dates overlap an existing % request: % (% to %)',
      v_conflict.status,
      v_conflict.label,
      to_char(v_conflict.start_date, 'DD Mon YYYY'),
      to_char(v_conflict.end_date, 'DD Mon YYYY')
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION trg_prevent_overlapping_requests()
  FROM PUBLIC, anon, authenticated;

-- Scoped to the columns that can create an overlap. Without the
-- column list this would also fire on every unrelated UPDATE --
-- notably sync_profile_to_requests, which rewrites the denormalised
-- name/avatar columns whenever a profile is edited, and
-- sync_category_name. Renaming an employee who happens to hold
-- overlapping rows would then fail with an error about time off.
-- Note UPDATE OF fires on columns MENTIONED in SET, changed or not.
DROP TRIGGER IF EXISTS prevent_overlapping_requests ON time_off_requests;
CREATE TRIGGER prevent_overlapping_requests
  BEFORE INSERT OR UPDATE OF status, start_date, end_date, profile_id, workspace_id
  ON time_off_requests
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_overlapping_requests();

-- ------------------------------------------------------------
-- Step 3: the guarantee
-- ------------------------------------------------------------
ALTER TABLE time_off_requests
  DROP CONSTRAINT IF EXISTS time_off_requests_no_overlap;

ALTER TABLE time_off_requests
  ADD CONSTRAINT time_off_requests_no_overlap
  EXCLUDE USING gist (
    profile_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status IN ('pending', 'approved'));

COMMENT ON CONSTRAINT time_off_requests_no_overlap ON time_off_requests IS
  'One employee cannot hold two pending/approved requests covering the same calendar day. Backstop for trg_prevent_overlapping_requests, which raises the human-readable error; this closes the concurrent-insert race the trigger cannot. Note daterange() requires the existing valid_date_range CHECK to hold, or the index expression would throw.';

COMMIT;

NOTIFY pgrst, 'reload schema';
