-- ============================================================
-- Migration: history survives category deletion
--
-- Deleting a time-off category used to take reporting data with
-- it, because of how the foreign keys were wired:
--
--   time_off_requests.category_id   ON DELETE SET NULL  -- request kept, but
--                                                       -- became "uncategorised"
--   employee_balances.category_id   ON DELETE CASCADE   -- fine, a balance for a
--                                                       -- deleted category is moot
--   balance_adjustment_log.category_id ON DELETE CASCADE -- NOT fine: this is the
--                                                       -- permanent audit trail
--
-- So one click on Delete (the dialog only said "cannot be
-- undone") silently erased every past balance change for that
-- category, and every past request lost the name of the leave
-- type it was taken under -- exactly the data an admin needs
-- when exporting a report.
--
-- Fix: snapshot the category name onto both tables, and stop the
-- audit log from being cascade-deleted. The name is kept in sync
-- while the category exists (so a rename is reflected everywhere)
-- and freezes at the last known value once it is deleted.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Snapshot columns.
-- ------------------------------------------------------------
ALTER TABLE time_off_requests
  ADD COLUMN IF NOT EXISTS category_name text;

ALTER TABLE balance_adjustment_log
  ADD COLUMN IF NOT EXISTS category_name text;

COMMENT ON COLUMN time_off_requests.category_name IS
  'Snapshot of the category name, kept in sync by trigger while the category exists and frozen once it is deleted. Reports read this, not a join, so a deleted category still shows the leave type it was taken under.';

COMMENT ON COLUMN balance_adjustment_log.category_name IS
  'Snapshot of the category name -- see time_off_requests.category_name. The audit log outlives the category it refers to.';

-- ------------------------------------------------------------
-- 2. Backfill from the live categories.
-- ------------------------------------------------------------
UPDATE time_off_requests r
SET category_name = c.name
FROM time_off_categories c
WHERE r.category_id = c.id
  AND r.category_name IS NULL;

UPDATE balance_adjustment_log l
SET category_name = c.name
FROM time_off_categories c
WHERE l.category_id = c.id
  AND l.category_name IS NULL;

-- ------------------------------------------------------------
-- 3. Stop the audit log from being cascade-deleted.
--
--    category_id becomes nullable and is nulled out instead, so
--    the row (delta, before, after, who, when, category_name)
--    survives. Same treatment time_off_requests already had.
-- ------------------------------------------------------------
ALTER TABLE balance_adjustment_log
  ALTER COLUMN category_id DROP NOT NULL;

ALTER TABLE balance_adjustment_log
  DROP CONSTRAINT IF EXISTS balance_adjustment_log_category_id_fkey;

ALTER TABLE balance_adjustment_log
  ADD CONSTRAINT balance_adjustment_log_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES time_off_categories(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 4. Keep the snapshot filled on write.
--
--    Guard on "NEW.category_id IS NOT NULL" is the whole point:
--    when the FK nulls category_id during a category delete, that
--    fires this same trigger as an UPDATE. Without the guard it
--    would helpfully overwrite the snapshot with NULL and undo
--    the entire migration.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fill_category_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT name INTO NEW.category_name
    FROM time_off_categories
    WHERE id = NEW.category_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION trg_fill_category_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS fill_category_name ON time_off_requests;
CREATE TRIGGER fill_category_name
  BEFORE INSERT OR UPDATE OF category_id ON time_off_requests
  FOR EACH ROW
  EXECUTE FUNCTION trg_fill_category_name();

DROP TRIGGER IF EXISTS fill_category_name ON balance_adjustment_log;
CREATE TRIGGER fill_category_name
  BEFORE INSERT OR UPDATE OF category_id ON balance_adjustment_log
  FOR EACH ROW
  EXECUTE FUNCTION trg_fill_category_name();

-- ------------------------------------------------------------
-- 5. A rename propagates to the snapshots.
--
--    While the category exists, reports should show its current
--    name -- the snapshot only takes over after deletion.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_sync_category_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE time_off_requests
  SET category_name = NEW.name
  WHERE category_id = NEW.id;

  UPDATE balance_adjustment_log
  SET category_name = NEW.name
  WHERE category_id = NEW.id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION trg_sync_category_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_category_name ON time_off_categories;
CREATE TRIGGER sync_category_name
  AFTER UPDATE OF name ON time_off_categories
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION trg_sync_category_name();

-- ------------------------------------------------------------
-- 6. Expose the snapshot through the safe view.
--    CREATE OR REPLACE cannot insert a column mid-list.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS time_off_requests_safe;
CREATE VIEW time_off_requests_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  profile_id,
  workspace_id,
  category_id,
  category_name,
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

COMMIT;

NOTIFY pgrst, 'reload schema';
