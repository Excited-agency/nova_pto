-- Defense-in-depth: exclude deleted profiles from get_user_workspace_id().
-- Deleted users have their auth account removed, so auth.uid() won't match
-- them in practice. This filter prevents any edge-case where a stale JWT
-- might still resolve to a deleted profile and grant workspace access via RLS.
CREATE OR REPLACE FUNCTION get_user_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM profiles
  WHERE id = auth.uid() AND status != 'deleted'
  LIMIT 1;
$$;
