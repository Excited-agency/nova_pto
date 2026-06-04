-- Transactional RPC for updating time-off category sort orders.
-- Replaces Promise.all() of individual client-side UPDATEs, which could leave
-- sort order inconsistent if any update failed mid-way.
CREATE OR REPLACE FUNCTION update_categories_sort_order(
  p_workspace_id uuid,
  p_updates       jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
BEGIN
  IF p_workspace_id IS DISTINCT FROM get_user_workspace_id() THEN
    RAISE EXCEPTION 'Workspace mismatch';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE time_off_categories
    SET sort_order = (item->>'sort_order')::integer
    WHERE id       = (item->>'id')::uuid
      AND workspace_id = p_workspace_id;
  END LOOP;
END;
$$;
