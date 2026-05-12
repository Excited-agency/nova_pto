-- Allow a workspace owner to SELECT their own workspace without needing a profile row.
-- Without this, profiles_insert_own WITH CHECK cannot verify the workspace during
-- founder flow (chicken-and-egg: need profile to read workspace, need workspace to
-- insert profile). Safe: users can only see workspaces where owner_id = auth.uid().
CREATE POLICY workspaces_select_owner ON workspaces
  FOR SELECT USING (owner_id = auth.uid());
