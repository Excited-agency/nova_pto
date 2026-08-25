-- ============================================================
-- Migration: is_workspace_admin() must require an ACTIVE profile
--
-- Cross-tenant privilege escalation, reproduced against the live
-- schema before writing this:
--
--   is_workspace_admin()    -- checks role, NOT status
--   get_user_workspace_id() -- filters status != 'deleted'  (20260604100000)
--
-- Soft-deleting an employee keeps their profiles row with its role
-- intact (only status flips to 'deleted'), so for a soft-deleted
-- admin those two helpers disagree: the admin gate still returns
-- TRUE while the workspace lookup returns NULL.
--
-- Every workspace guard written as an inequality then fails open,
-- because a comparison against NULL yields NULL, not TRUE:
--
--   IF v_request.workspace_id <> get_user_workspace_id() THEN ...
--        -- 'b1000000-...' <> NULL  =>  NULL  =>  IF never fires
--
-- Verified exploit: a soft-deleted admin of workspace A called
-- approve_time_off_request on a pending request belonging to
-- workspace B and it was approved. Affected the same way:
--   approve_time_off_request      (20260604500000)
--   reject_time_off_request       (20260604400000)
--   bulk_update_employee_balances (20260612090000)
-- Not affected: update_categories_sort_order and the
-- create_time_off_record guard added in 20260825140000, which use
-- IS DISTINCT FROM and therefore raise on NULL.
--
-- Exploiting it needs an access token issued before the profile was
-- soft-deleted. delete-employee removes the auth user, but an
-- already-issued JWT keeps verifying until it expires, so the window
-- is roughly one token lifetime.
--
-- Fixing the helper closes the hole once for every RPC and every RLS
-- policy that calls it, instead of auditing each inequality. Chosen
-- over rewriting each comparison for exactly that reason.
--
-- 'active' rather than "not deleted": a deactivated (inactive)
-- employee is denied the app entirely -- that is what the
-- /access-restricted screen exists for -- so they must not keep
-- admin rights either.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION is_workspace_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
      AND status = 'active'
  );
$$;

COMMENT ON FUNCTION is_workspace_admin() IS
  'True when the current user is an ACTIVE admin or owner. The status check is load-bearing: soft-deleted profiles keep their role, and pairing a role-only check with get_user_workspace_id() (which excludes deleted profiles) let workspace guards written as <> fail open on NULL.';

COMMIT;

NOTIFY pgrst, 'reload schema';
