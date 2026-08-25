-- ============================================================
-- Migration: single transactional RPC for workspace deletion
--
-- Before: supabase/functions/delete-workspace/index.ts ran three
-- separate DB deletes (slack_installations -> profiles ->
-- workspaces) with no transaction. A failure or timeout between
-- them left the workspace permanently half-deleted, with nothing
-- to repair it.
--
-- It also sat on a schema contradiction. 20260604000000 changed
-- slack_installations.installed_by to ON DELETE SET NULL but left
-- the column NOT NULL. Deleting a profile that installed Slack
-- therefore tries to write NULL into a NOT NULL column and fails
-- with SQLSTATE 23502 (not_null_violation) -- verified against the
-- live schema. Unlike a foreign-key check this is NOT deferred to
-- end-of-statement, so no cascade ordering can rescue it. Two
-- separate operations were broken by it:
--   * purging an employee who installed Slack (delete-employee
--     with purge: true) always failed;
--   * deleting a workspace only worked when the referential-
--     integrity triggers on `workspaces` happened to cascade
--     slack_installations (via workspace_id) BEFORE profiles.
--     That firing order is not guaranteed by Postgres, so the same
--     statement could succeed locally and fail in production.
--
-- Fixes here:
--   1. Drop the stray NOT NULL, completing what 20260604000000
--      intended. This alone unblocks purging an installer.
--   2. Delete slack_installations explicitly inside the RPC before
--      removing the workspace, so correctness no longer depends on
--      trigger firing order at all.
--   3. Delete the workspaces row and let the existing ON DELETE
--      CASCADE chain remove the rest in one statement:
--        workspaces -> profiles, departments, time_off_categories,
--                      holidays, time_off_requests, employee_balances,
--                      balance_adjustment_log, slack_interaction_log,
--                      slack_user_mappings
--        time_off_requests -> slack_dm_messages
--      The remaining profile referrers (slack_interaction_log
--      .processed_by, time_off_requests.reviewed_by,
--      balance_adjustment_log.adjusted_by) are all SET NULL on
--      nullable columns, so they are harmless.
-- Everything runs in one function body = all-or-nothing.
--
-- Auth users stay in the edge function: deleting them is an Auth
-- Admin API call that cannot join a SQL transaction, and
-- workspaces.owner_id -> auth.users (NO ACTION) blocks it until
-- the workspace row is gone. The RPC therefore returns the profile
-- IDs so the caller can clean up auth afterwards; that step is
-- idempotent and safe to retry.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Finish the change 20260604000000 started: the FK became
--    ON DELETE SET NULL, but the column stayed NOT NULL, so the
--    SET NULL could never actually execute.
-- ------------------------------------------------------------
ALTER TABLE slack_installations ALTER COLUMN installed_by DROP NOT NULL;

-- ------------------------------------------------------------
-- 2. Transactional workspace deletion.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_workspace_cascade(
  p_workspace_id uuid,
  p_owner_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner       uuid;
  v_profile_ids uuid[];
BEGIN
  -- Lock the workspace so a concurrent call cannot delete it twice.
  SELECT owner_id INTO v_owner
  FROM workspaces
  WHERE id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found';
  END IF;

  -- Ownership is re-verified here, not just in the edge function:
  -- this RPC runs as SECURITY DEFINER under service_role, so it
  -- must not trust the caller's claim about who the owner is.
  IF v_owner IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'Permission denied: only the workspace owner can delete the workspace';
  END IF;

  -- Capture profile IDs before the cascade removes them; the caller
  -- needs them to delete the matching auth users.
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_profile_ids
  FROM profiles
  WHERE workspace_id = p_workspace_id;

  -- Remove Slack installations first. They would also be cascaded by the
  -- DELETE below, but only if the referential-integrity triggers on
  -- `workspaces` happen to fire slack_installations.workspace_id before
  -- profiles.workspace_id. Postgres does not define that order, so do it
  -- explicitly rather than depend on it. Cascades to slack_dm_messages
  -- and slack_user_mappings.
  DELETE FROM slack_installations WHERE workspace_id = p_workspace_id;

  DELETE FROM workspaces WHERE id = p_workspace_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'profile_ids', to_jsonb(v_profile_ids)
  );
END;
$$;

-- Service-role only: invoked exclusively by the delete-workspace
-- edge function. Never reachable from a browser client.
REVOKE EXECUTE ON FUNCTION public.delete_workspace_cascade(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_workspace_cascade(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.delete_workspace_cascade(uuid, uuid) IS
  'Transactional workspace deletion. Verifies ownership, then deletes the workspaces row so the ON DELETE CASCADE chain removes all workspace data atomically. Returns the deleted profile IDs so the caller can remove the corresponding auth users. Service-role only.';

COMMIT;

NOTIFY pgrst, 'reload schema';
