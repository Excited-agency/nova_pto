-- ============================================================
-- Migration: Fix reject_time_off_request workspace isolation
-- Same gap as approve_time_off_request (fixed in 20260512100000):
-- is_workspace_admin() only checks role, not workspace membership,
-- so an admin from workspace B could reject requests in workspace A.
-- ============================================================

CREATE OR REPLACE FUNCTION reject_time_off_request(
  p_request_id       uuid,
  p_rejection_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request record;
BEGIN
  IF NOT is_workspace_admin() THEN
    RAISE EXCEPTION 'Permission denied: only workspace admins can reject time-off requests';
  END IF;

  -- Load and lock the request
  SELECT * INTO v_request
  FROM time_off_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- Workspace isolation: caller must belong to the same workspace as the request
  IF v_request.workspace_id <> get_user_workspace_id() THEN
    RAISE EXCEPTION 'Permission denied: request does not belong to your workspace';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  UPDATE time_off_requests
  SET status = 'rejected',
      rejection_reason = p_rejection_reason
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'id', p_request_id,
    'status', 'rejected'
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
