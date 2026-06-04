-- When an employee is soft-deleted, auto-reject their pending time-off requests.
-- Without this, pending requests from deleted employees sit in the queue forever.
-- The approve RPC already blocks approval (checks employee is active), but the
-- ghost entries are still visible to admins and cause confusion.
CREATE OR REPLACE FUNCTION auto_reject_pending_on_employee_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
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

CREATE TRIGGER trg_auto_reject_on_employee_delete
  AFTER UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_reject_pending_on_employee_delete();
