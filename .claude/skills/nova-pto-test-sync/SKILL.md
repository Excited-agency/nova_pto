---
name: nova-pto-test-sync
description: Use when any code change is complete in the Nova PTO project — bugfix, refactor, or new feature — before marking the task done. Triggers on role/permission changes, validation changes (Zod/regex), and service/hook edits.
---

# Nova PTO: Test Sync Checklist

After every code change — MANDATORY before marking done.

## Checklist

**1. Find tests for the changed file:**
```bash
grep -r "import.*<changed-filename>" src/test/
# or by symbol name:
grep -r "<FunctionName\|ComponentName>" src/test/
```

**2. For every bug fixed:**  
Ask: "Is there a regression test that catches if someone reverts this?" If not → add one.

**3. For role/permission changes (admin / owner / user):**  
Add a test for EACH role. All three must be covered.

**4. For validation changes (Zod schema / regex):**  
Add at least one boundary-condition test (the exact edge case that changed).

**5. Run tests and verify count increased:**
```bash
npm test
# Count after > count before — by at least the number of new test cases
```

## Test structure

| Folder | When to add here |
|--------|-----------------|
| `src/test/unit/` | Pure lib/utils logic |
| `src/test/integration/` | Components with mocked Supabase |
| `src/test/security/` | RLS / privilege-escalation (requires `supabase start`) |
| `src/test/db/` | DB constraints, cascade-delete, RPC behavior |

## Mocking pattern

```ts
// Global auto-mock in src/test/setup.ts — already active
// Override per-test:
vi.mocked(supabase.from).mockReturnValue({
  select: vi.fn().mockResolvedValue({ data: [...], error: null })
} as any)
```

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Only checking if tests still pass | Count must also increase |
| Adding `owner` role to code without adding `owner` test | Always test all roles explicitly |
| Tightening a regex without testing the new boundary | Add the exact edge case that was tightened |
