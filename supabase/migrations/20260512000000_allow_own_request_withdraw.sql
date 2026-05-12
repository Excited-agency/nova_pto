-- Allow employees to withdraw (update to "withdrawn") their own pending requests
CREATE POLICY requests_update_own_to_withdrawn ON time_off_requests
  FOR UPDATE
  USING (
    profile_id = auth.uid()
    AND workspace_id = get_user_workspace_id()
    AND status = 'pending'
  )
  WITH CHECK (
    profile_id = auth.uid()
    AND workspace_id = get_user_workspace_id()
    AND status = 'withdrawn'
  );
