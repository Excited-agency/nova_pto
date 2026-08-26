---
name: nova-pto-migration
description: Use when writing a new Supabase migration for the Nova PTO project — including scaffolding the timestamped file. Covers file naming, RLS patterns, workspace isolation, function privileges, trigger scoping, data-repair steps, and the pre-push security checklist.
---

# Nova PTO: Migration Patterns

## Scaffolding the file

1. Run `date +%Y%m%d%H%M%S` for the timestamp.
2. Name is snake_case; ask if it wasn't given.
3. Create `supabase/migrations/{TIMESTAMP}_{NAME}.sql`.

```
supabase/migrations/YYYYMMDDHH0000_short_description.sql
# Example: 20260611090000_add_notification_preferences.sql
```

Start the file with a comment explaining **why**, including what was checked and
found missing. The next reader needs the reasoning, not a restatement of the SQL.

## Standard RLS helpers (already defined in DB)

```sql
auth.uid()              -- current authenticated user's UUID
is_workspace_admin()    -- true for roles 'admin' AND 'owner'
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

## Function privileges — REVOKE is load-bearing

Migration `20260612100000` set default privileges so that **every new routine in
`public` is automatically granted EXECUTE to `authenticated`**. A new
`SECURITY DEFINER` function is therefore callable by any signed-in user the
moment it is created.

```sql
REVOKE EXECUTE ON FUNCTION my_internal_fn() FROM PUBLIC, anon, authenticated;
```

For repair tooling that must never be reachable from the app, add a body guard
as well — a REVOKE is one `GRANT` away from being undone:
```sql
IF auth.uid() IS NOT NULL THEN
  RAISE EXCEPTION 'my_repair_fn() is repair tooling, not an application call';
END IF;
```

Always `SET search_path = public` on `SECURITY DEFINER` functions.

## Extensions go in `extensions`, not `public`

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
```
Installing into `public` trips Supabase's `extension_in_public` advisor.

## Triggers: scope UPDATE by column

```sql
CREATE TRIGGER prevent_overlapping_requests
  BEFORE INSERT OR UPDATE OF status, start_date, end_date, profile_id, workspace_id
  ON time_off_requests FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_overlapping_requests();
```

Without the column list the trigger fires on unrelated writes — e.g.
`sync_profile_to_requests` propagating a name change would fail with a
time-off error. Note `UPDATE OF` fires on columns *mentioned* in `SET`, whether
or not the value actually changed.

Trigger firing order is **alphabetical**, so a new trigger's name decides
whether it runs before or after the existing ones on that table.

Prefer one trigger over duplicated checks inside each RPC: a status-change
trigger also covers every approve path for free.

## Constraint plus trigger, when a race matters

A trigger gives a readable message; it cannot see an uncommitted concurrent
transaction. Add the constraint too when double-writes must be impossible:

```sql
ALTER TABLE time_off_requests
  ADD CONSTRAINT time_off_requests_no_overlap
  EXCLUDE USING gist (profile_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('pending','approved'));
```

Raise with `USING ERRCODE = 'exclusion_violation'` (23P01) so PostgREST maps it
to HTTP 409 rather than a generic 500.

## Migrations that change data

- Put the repair in a **named function** and call it, rather than inlining a
  `DO` block. Then it is testable, re-runnable, and reviewable.
- Make it idempotent, and prove a second run is a no-op.
- To undo a balance, reverse **exactly** what was spent and write a
  `balance_adjustment_log` row pointing at the request. Do **not** call
  `recalculate_employee_balance` — it rebuilds from the accrual schedule and
  only counts spends with `start_date <= as_of`, which contradicts the
  eager-deduction model every approval path uses.
- Local `supabase db reset` may not exercise the repair at all (the mock-data
  seed returns early when no workspace exists), so cover it with a fixture in
  `supabase/tests/`.
- Before pushing to a real project: run the repair read-only first, print the
  exact rows it will change, back the tables up into a `nova_backup` schema, and
  keep the backup until the numbers are confirmed.

## Deployment order

Deploy the **client first**, then the migration, whenever the migration
*removes* something the client might still use (a REVOKE, a dropped column, a
narrowed grant). A migration that only *adds* a restriction is safe in either
order — the old client just shows the server's error message.

## Security checklist (before `supabase db push`)

- [ ] `ENABLE ROW LEVEL SECURITY` on every new table
- [ ] SELECT policy filters by `workspace_id`
- [ ] INSERT policy derives `workspace_id` from `profiles`, never from client input
- [ ] UPDATE/DELETE checks both `workspace_id` AND `is_workspace_admin()`
- [ ] `SECURITY DEFINER` functions: `SET search_path`, minimum privilege, explicit REVOKE
- [ ] RPCs validate that **every** ID argument belongs to the caller's workspace
- [ ] Symmetric operations fixed together (approve *and* reject *and* withdraw)
- [ ] No RPC allows reading or writing another workspace's data
- [ ] `mcp__supabase__get_advisors` shows no new warnings after applying

## Standard indexes

```sql
-- Always index by workspace + time for paginated queries:
CREATE INDEX ON my_table (workspace_id, created_at DESC);

-- Add profile join index if table has profile_id:
CREATE INDEX ON my_table (workspace_id, profile_id);
```

A partial GiST index created by an EXCLUDE constraint already serves the
matching lookup — don't add a redundant btree beside it.

## After writing

Run the `supabase-migration-reviewer` agent for independent audit before applying:
```
Agent({ subagent_type: "supabase-migration-reviewer", prompt: "Review <filename>" })
```

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Using `WITH CHECK (workspace_id = 3)` from client | Always derive from `profiles` subquery |
| Missing `ENABLE ROW LEVEL SECURITY` | Add it before policies — silently unprotected otherwise |
| SECURITY DEFINER without workspace check | Attacker can call RPC with arbitrary workspace_id |
| New function left callable by `authenticated` | Explicit REVOKE — the default grant is automatic |
| Unqualified `BEFORE UPDATE` trigger | Scope with `UPDATE OF <columns>` |
| No index on workspace_id | Full table scan on every query — add composite index |
