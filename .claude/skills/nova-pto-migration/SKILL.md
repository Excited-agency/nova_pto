---
name: nova-pto-migration
description: Use when writing a new Supabase migration for the Nova PTO project. Covers file naming, RLS patterns, workspace isolation, security checklist, and index conventions specific to this schema.
---

# Nova PTO: Migration Patterns

## File naming

```
supabase/migrations/YYYYMMDDHH0000_short_description.sql
# Example: 20260611090000_add_notification_preferences.sql
```

## Standard RLS helpers (already defined in DB)

```sql
auth.uid()              -- current authenticated user's UUID
is_workspace_admin()    -- returns true for roles: 'admin' | 'owner'
```

## Workspace isolation template

Every policy that touches user data must scope to workspace:
```sql
-- For SELECT / UPDATE / DELETE:
USING (
  workspace_id = (
    SELECT workspace_id FROM profiles WHERE id = auth.uid()
  )
)

-- For INSERT (don't trust client-supplied workspace_id):
WITH CHECK (
  workspace_id = (
    SELECT workspace_id FROM profiles WHERE id = auth.uid()
  )
)
```

## Full RLS block template

```sql
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can read"
  ON my_table FOR SELECT
  USING (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "admins can insert"
  ON my_table FOR INSERT
  WITH CHECK (
    is_workspace_admin()
    AND workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "admins can update"
  ON my_table FOR UPDATE
  USING (is_workspace_admin())
  WITH CHECK (workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "admins can delete"
  ON my_table FOR DELETE
  USING (
    is_workspace_admin()
    AND workspace_id = (SELECT workspace_id FROM profiles WHERE id = auth.uid())
  );
```

## Standard indexes

```sql
-- Always index by workspace + time for paginated queries:
CREATE INDEX ON my_table (workspace_id, created_at DESC);

-- Add profile join index if table has profile_id:
CREATE INDEX ON my_table (workspace_id, profile_id);
```

## Security checklist (before `supabase db push`)

- [ ] `ENABLE ROW LEVEL SECURITY` on every new table
- [ ] SELECT policy filters by `workspace_id`
- [ ] INSERT policy derives `workspace_id` from `profiles`, never from client input
- [ ] UPDATE/DELETE checks both `workspace_id` AND `is_workspace_admin()`
- [ ] `SECURITY DEFINER` functions: verify they grant minimum necessary privilege
- [ ] No RPC allows reading or writing another workspace's data

## After writing

Run the `supabase-migration-reviewer` agent for independent audit before applying:
```
Agent({ subagent_type: "supabase-migration-reviewer", prompt: "Review <filename>" })
```

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Using `WITH CHECK (workspace_id = $1)` from client | Always derive from `profiles` subquery |
| Missing `ENABLE ROW LEVEL SECURITY` | Add it before policies — silently unprotected otherwise |
| SECURITY DEFINER without workspace check | Attacker can call RPC with arbitrary workspace_id |
| No index on workspace_id | Full table scan on every query — add composite index |
