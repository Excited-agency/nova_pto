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
grep -r "<FunctionName\|ComponentName>" src/test/ e2e/
```

**2. For every bug fixed:**
Ask: "Is there a regression test that catches if someone reverts this?" If not → add one.

**3. Prove the new test can fail.**
Run it against the *unfixed* code — revert the fix, or drop the constraint, or
stub the data source to return `[]`. A test that passes without the fix is worth
nothing. This is not optional and it is not satisfied by "the suite is green".

**4. For role/permission changes (admin / owner / user):**
Add a test for EACH role. All three must be covered — `owner` is a real role
with more power than `admin`, not an alias for it.

**5. For validation changes (Zod schema / regex):**
Add at least one boundary-condition test (the exact edge case that changed).

**6. Run tests and verify count increased:**
```bash
npm test              # count after > count before
npm run test:e2e      # if UI behaviour changed
```

## Tests that cannot fail — the most common defect in this repo

Green does not mean covered. Before trusting a test, check it for these:

| Pattern | Why it never fails | Do this instead |
|---|---|---|
| `if ((await x.count()) > 0) { …assertions… }` | On a freshly loaded page `count()` is 0 and does not wait, so the body is skipped | `await expect(x).toBeVisible()` then assert |
| `if ((await x.count()) === 0) return` | "Not implemented yet" escape hatch that outlives the feature | Assert it exists; delete the branch |
| `expect(count).toBeGreaterThanOrEqual(1)` on a broad `.or()` chain | Any one match satisfies it, including an unrelated one | Assert the specific thing by a unique marker |
| `expect(rows).toBe(0)` where the selector never matches anything | Vacuously true before and after the change | Count with a selector proven to match when populated |
| Asserting only `status`, when the test name promises a reason/amount too | The half that regresses is unchecked | Assert every field the name claims |
| `getByRole("button", { name: /approve/i })` on an icon-only button | Icon buttons have no accessible name — matches nothing | Give the button an `aria-label`, then query it |

A negative assertion (`toHaveCount(0)`) is only meaningful once something
positive on the same page has been asserted first — otherwise it passes because
the page never loaded.

## E2E: wait for state, never for time

`waitForTimeout` is a guess that is either flaky or slow. Web-first assertions
retry on their own.

```ts
// ❌ guesses, and hides what it is waiting for
await page.waitForTimeout(2000)
expect(await rows.count()).toBeGreaterThanOrEqual(1)

// ✅ retries until true, fails with a real diff
await expect(rows).toHaveCount(2)

// ✅ for state that lives in the DB rather than the DOM
await expect.poll(async () => (await read()).status, { timeout: 10_000 }).toBe("approved")
```

## Test structure

| Folder | When to add here |
|--------|-----------------|
| `src/test/unit/` | Pure lib/utils logic |
| `src/test/integration/` | Components with mocked services |
| `src/test/security/` | RLS / privilege-escalation (requires `supabase start`) |
| `src/test/db/` | DB constraints, cascade-delete, RPC behaviour |
| `e2e/tests/` | Only what needs a real browser |
| `supabase/tests/*.sql` | Repair/migration functions needing owner-level DDL that `service_role` lacks — run with psql, not vitest |

`src/test/db/` and `src/test/security/` need a local stack (`supabase start`)
and `.env.test`. Every describe there is wrapped in
`describe.skipIf(skipIfNoServiceKey())`, so **without the service key they
silently skip and the run still reports success** — check the file count, not
just the exit code.

## Mocking pattern

```ts
// Global auto-mock in src/test/setup.ts — already active
// Override per-test:
vi.mocked(supabase.from).mockReturnValue({
  select: vi.fn().mockResolvedValue({ data: [...], error: null })
} as any)
```

## jsdom limits worth knowing

- Radix `Select` needs a `hasPointerCapture` polyfill; asserting a picker
  trigger's text is often a better proxy for form state anyway
- Radix `Popover` and `Dialog` both expose `role="dialog"` — take the last match
  for the layer on top
- `Field` renders its label as a plain sibling with no `htmlFor`, so
  `getByLabelText` cannot reach the control; scope by
  `.closest('[data-slot="field"]')`
- Pin the clock with `vi.useFakeTimers({ shouldAdvanceTime: true })` plus
  `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` so date pickers
  open on a known month

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Only checking if tests still pass | Count must also increase, and the new test must fail without the fix |
| Adding `owner` role to code without adding `owner` test | Always test all roles explicitly |
| Tightening a regex without testing the new boundary | Add the exact edge case that was tightened |
| A shared fixture emitting identical rows | Fine until a uniqueness/exclusion constraint lands — fix the fixture, don't weaken the rule |
