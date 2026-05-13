---
name: new-migration
description: Scaffold a new Supabase migration with the correct timestamp filename. Use when the user says "new migration", "create migration", or "add migration".
---

# New Migration

Create a Supabase migration file with the correct timestamp.

## Steps

1. Run `date +%Y%m%d%H%M%S` to get the current timestamp.
2. The argument after the skill name is the migration name (snake_case). If none provided, ask.
3. Create the file at `supabase/migrations/{TIMESTAMP}_{NAME}.sql` — empty body.
4. Report the full path created.

## Example

User: `/new-migration add_avatar_url_to_profiles`

You run: `date +%Y%m%d%H%M%S` → `20260513142300`

You create: `supabase/migrations/20260513142300_add_avatar_url_to_profiles.sql`

Then write the SQL the user needs.
