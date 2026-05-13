-- Migration: add 'owner' role to profiles and tighten RLS
-- 2026-05-13

-- 1. Drop and recreate profiles_role_check to include 'owner'
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'user', 'owner'));

-- 2. Backfill existing workspace owners to role='owner'
UPDATE profiles p
SET role = 'owner'
FROM workspaces w
WHERE p.id = w.owner_id;

-- 3. Update is_workspace_admin() to include 'owner'
CREATE OR REPLACE FUNCTION is_workspace_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'owner')
  );
$$;

-- 4. Recreate profiles_update_admin policy to block owner row updates/promotion
DROP POLICY IF EXISTS profiles_update_admin ON profiles;
CREATE POLICY profiles_update_admin ON profiles FOR UPDATE
  USING (
    is_workspace_admin()
    AND workspace_id = get_user_workspace_id()
    AND role != 'owner'
  )
  WITH CHECK (
    is_workspace_admin()
    AND workspace_id = get_user_workspace_id()
    AND role != 'owner'
  );
