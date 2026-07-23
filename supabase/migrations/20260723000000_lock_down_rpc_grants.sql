-- ============================================================
-- Migration: Lock down RPC grants + close cross-workspace gaps
--
-- Root cause: 20260612100000_grant_data_api_privileges.sql ran
--   GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO anon
-- and the corrective 20260612110000_fix_anon_grants.sql never
-- revoked it. Result: the `anon` (unauthenticated) role could
-- invoke every RPC via /rest/v1/rpc/*, including approve/reject,
-- balance mutations, and internal trigger functions.
--
-- This migration:
--   1. Revokes EXECUTE on all routines from anon (nothing in the
--      app is called pre-auth; login uses the Auth API, not RPCs).
--   2. Revokes EXECUTE from authenticated on trigger/helper
--      functions and Slack-bot RPCs that are only ever invoked by
--      triggers (definer context) or by edge functions (service_role).
--   3. Stops future functions from being auto-granted to anon.
--   4. Sets a stable search_path on auto_reject_pending_on_employee_delete.
--   5. Drops the broad storage SELECT policies that allowed listing
--      entire public buckets (object URLs still work via the CDN).
--   6. Documents the intentionally client-inaccessible Slack tables.
--
-- Note: the workspace-isolation guards on bulk_update_employee_balances,
-- replace_imported_holidays and update_categories_sort_order already
-- exist in the live schema, so no RPC bodies are recreated here.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. anon: no RPC execution at all.
--    NOTE: Postgres grants EXECUTE to PUBLIC on function creation,
--    and anon/authenticated inherit it. Revoking from `anon` alone
--    is a no-op while the PUBLIC grant stands, so we revoke PUBLIC
--    too. `authenticated` keeps its EXPLICIT grant from
--    20260612100000 (GRANT EXECUTE ON ALL ROUTINES TO authenticated),
--    so app RPC calls are unaffected.
-- ------------------------------------------------------------
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- 2. Functions that must never be REST-callable by clients.
--    Trigger functions run in the definer/trigger context and
--    the seed helpers are only called from those triggers.
--    Bot RPCs are only called by edge functions via service_role.
--    Revoke from PUBLIC + authenticated (anon already covered above).
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.sync_request_employee_fields()                       FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_owner_id_change()                            FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_reject_pending_on_employee_delete()             FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_seed_balances_on_new_employee()                  FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_seed_balances_on_new_category()                  FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_seed_balances_on_category_reactivate()           FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_balances_for_employee(uuid, uuid)               FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_balances_for_category(uuid, uuid, text, double precision) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_time_off_request_bot(uuid, uuid)             FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_time_off_request_bot(uuid, uuid, text)        FROM PUBLIC, authenticated;

-- ------------------------------------------------------------
-- 3. Stable search_path on the auto-reject trigger function
--    (advisor: function_search_path_mutable). Recreating the
--    function keeps the existing trigger binding intact.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_reject_pending_on_employee_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
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

-- Note: the cross-workspace guards this audit originally targeted
-- (bulk_update_employee_balances, replace_imported_holidays,
-- update_categories_sort_order) are already enforced in the live
-- schema via get_user_workspace_id() checks — verified against
-- 20260612090000 and 20260320200000. No RPC bodies need recreation.

-- ------------------------------------------------------------
-- 4. Storage: public buckets don't need a broad SELECT policy on
--    storage.objects. It only enables clients to LIST every file.
--    Object URLs continue to resolve via the public CDN endpoint.
--    (advisor: public_bucket_allows_listing)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS storage_logos_select ON storage.objects;
DROP POLICY IF EXISTS storage_avatars_select ON storage.objects;

-- ------------------------------------------------------------
-- 5. Document Slack tables: RLS is on with no policies by design —
--    they are written/read only by edge functions via service_role,
--    which bypasses RLS. No client (anon/authenticated) access is
--    intended, so the deny-all default is correct.
--    (advisor: rls_enabled_no_policy — informational, intentional)
-- ------------------------------------------------------------
COMMENT ON TABLE public.slack_dm_messages IS
  'Service-role only (Slack edge functions). RLS enabled with no policies = deny-all to clients by design.';
COMMENT ON TABLE public.slack_interaction_log IS
  'Service-role only (Slack edge functions). RLS enabled with no policies = deny-all to clients by design.';

COMMIT;

NOTIFY pgrst, 'reload schema';
