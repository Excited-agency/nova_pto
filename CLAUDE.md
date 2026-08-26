# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm run dev            # Vite dev server (HMR)
npm run build          # Production build
npm run typecheck      # tsc -b
npm run lint           # ESLint

npm test               # All Vitest tests once
npm run test:watch     # Watch mode
npm run test:ui        # Vitest UI
npm run test:coverage  # Coverage (v8)
npm run test:security  # Only src/test/security/   — needs local Supabase
npm run test:db        # Only src/test/db/         — needs local Supabase

npm run test:e2e       # Playwright, headless
npm run test:e2e:ui    # Playwright UI mode
npm run test:all       # Vitest + Playwright

npx vitest run src/test/unit/your-file.test.ts   # single Vitest file
npx playwright test e2e/tests/your-spec.spec.ts  # single Playwright spec
```

Local stack: `supabase start`, `supabase db reset` (all migrations from scratch),
`supabase db push` (apply pending to the linked project).

Two traps that make a run lie to you:

- The Edge Functions runtime **caches a warm worker** and does not reliably pick
  up file edits, so a mutation check can pass against the old bundle. Restart it
  after changing a function: `docker restart supabase_edge_runtime_Nova_pto`.
  Cheapest way to detect it: change an error message and see whether the
  response changes.
- After bumping `@playwright/test`, run `npx playwright install chromium`.
  Otherwise every spec fails in 0 ms with "Executable doesn't exist", which
  looks like a code regression and is not one.

CI (`.github/workflows/test.yml`) runs four jobs: `static`
(typecheck + lint + build), unit/integration with coverage, security + DB against
a real local stack, and E2E. All four must pass — `static` is the only one that
catches a type error or a broken build.

## Environment

`.env` needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`
(base URL for magic-link redirects; falls back to `window.location.origin`).
`.env.test` adds `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`,
`TEST_SUPABASE_SERVICE_ROLE_KEY` and optional `PLAYWRIGHT_BASE_URL`.

## Stack

React 19 + TypeScript + Vite + Tailwind v4 + Supabase + TanStack React Query.
Beyond the core: `react-hook-form` + `zod`, `@dnd-kit/*`, `xlsx`, `papaparse`,
`react-highlight-words`, `lucide-react`, unified `radix-ui`.

Nova PTO is a multi-tenant leave-management SaaS. Auth is Supabase magic link
(OTP by email, no passwords).

---

## Architecture

### Services → Hooks → Components

Pages never fetch, and no component imports a service directly. Data access
(`supabase.from`, `supabase.rpc`) belongs in `src/lib/*-service.ts` — auth pages
included, which go through `auth-service.ts`.

Two categories sit outside that and are the only legitimate exceptions:

| Where | What | Why |
|---|---|---|
| `founder-flow.ts`, `default-categories.ts` | `supabase.from(...)` writes | One-shot provisioning at first sign-in, not a queryable domain |
| `auth-context.tsx`, `App.tsx` | `supabase.auth.*` only | Session lifecycle and `onAuthStateChange` subscriptions — a service cannot own a subscription's lifetime |

Anything else calling `supabase.*` is a layering violation. Code examples:
`project-conventions` skill.

### The server owns the rules

Request writes go through RPCs, not table writes. Balances are written only by
the balance-writing RPCs. Invariants — no overlapping leave, waiting periods,
workspace ownership of every ID — live in triggers, constraints and RPC bodies.
Client-side checks exist to give a good message before Submit; they are never
the enforcement point, and deleting one must not make an invalid write possible.

### Key flows

- `src/App.tsx` — router root. Everything inside `AuthProvider`; `/` is behind
  `ProtectedRoute` and renders `DashboardLayout` with nested `<Outlet />` pages.
  All pages lazy-loaded.
- **Auth**: `/login` → OTP email → `/check-email` (6-digit code) → `/requests`.
- **Role-resolved routes**: `requests` renders `RequestsPage` (admin) or
  `EmployeeRequestsPage` (user); `settings` renders `SettingsPage` (admin) or
  `UserSettingsPage` (user). Decided inside the route element, not by path.
- `src/contexts/auth-context.tsx` — exposes `user`, `session`, `workspace`,
  `profile`, `loading`, `authError`, `retryAuth`, `signOut`, `refreshWorkspace`,
  `refreshProfile`. On `SIGNED_IN` for a new user it runs `runFounderFlow`.
- `src/contexts/navigation-guard-context.tsx` — `registerGuard`/`unregisterGuard`
  for pages with unsaved changes (Settings).
- `src/lib/founder-flow.ts` — idempotent first-time provisioning: workspace,
  `owner` profile, default departments and categories.

### Roles

| Role | Can |
|---|---|
| `owner` | Everything an admin can, plus delete the workspace. One per workspace. Cannot be deactivated or deleted by an admin. |
| `admin` | Employees, categories, requests, settings |
| `user` | Submit / view / withdraw own requests; edit own name + avatar |

**Admin checks must accept both `admin` and `owner`** —
`profile?.role === "admin" || profile?.role === "owner"`. Checking only
`"admin"` locks the owner out. The DB equivalent is `is_workspace_admin()`,
which *also* requires `status = 'active'`; Edge Functions must check status too,
because deactivating an admin leaves their auth user and JWT working.

Gates exist in three places and must agree: `AdminRoute`, the rendered page, and
the RLS policy / RPC.

---

## Routes

`/` redirects to `/requests`. All page components lazy-loaded.

| Route | Page | Access |
|---|---|---|
| `/login`, `/check-email`, `/auth/callback` | login, otp-verification, auth-callback | public |
| `/access-restricted` | access-restricted | public |
| `/requests` | requests **or** employee-requests | role-resolved |
| `/employees` | employees | admin |
| `/employees/new`, `/employees/import` | add-employee, import-preview | admin |
| `/employees/:id`, `/employees/:id/edit` | employee-details, edit-employee | admin |
| `/calendar` | calendar | all |
| `/time-off-setup` | time-off-setup | admin |
| `/time-off-setup/new`, `/time-off-setup/:id/edit` | add-category, edit-category | admin |
| `/settings` | settings **or** user-settings | role-resolved |

---

## Inventory

### Services — `src/lib/*-service.ts`

| File | Notes |
|---|---|
| `employee-service.ts` | `fetchEmployees` (paginated `{data,count}`), `fetchEmployeeCounts`, `fetchEmployee`, `fetchWorkspaceEmails` (dedupe set for CSV import), `updateEmployee`, `updateEmployeeStatus`, `bulkUpdateEmployeeStatus`, `inviteEmployee`, `deleteEmployee`/`purgeEmployee` (Edge Function, `purge` flag) |
| `time-off-request-service.ts` | Reads the `time_off_requests_safe` view. Writes via RPCs only: `submit_time_off_request`, `create_time_off_record`, `approve_time_off_request`, `reject_time_off_request`, `withdraw_time_off_request`, `bulk_update_employee_balances`. Also `fetchTimeOffRequests`, `fetchMyTimeOffRequests`, `fetchEmployeeBalance(s)`, `fetchBalanceAdjustmentLog`, `fetchActiveEmployeesForCombobox` |
| `time-off-category-service.ts` | `fetchTimeOffCategories`, `fetchCategory`, `createCategory`, `updateCategory`, `updateCategoryActive`, `deleteCategory`, `updateCategorySortOrder` (RPC `update_categories_sort_order`), `fetchCategoryAvailability` (RPC `category_availability`) |
| `settings-service.ts` | `fetchDepartments`, `createDepartment`, `updateDepartment`, `deleteDepartment`, `updateWorkspace`, `updateProfile`, `fetchWorkspaceAdminEmail`, `uploadImage`, `removeImage`, **`deleteWorkspace`** (owner-only, calls the `delete-workspace` Edge Function) |
| `holiday-service.ts` | `fetchHolidays`, `fetchPublicHolidays` (external Nager API), `createHoliday`, `updateHoliday`, `deleteHoliday`, `bulkDeleteHolidays`, `replaceImportedHolidays` (RPC) |
| `report-service.ts` | `fetchReportEmployees`, `fetchAllEmployeeBalances`; `generate-report.ts` does the Excel export |
| `auth-service.ts` | `sendMagicLink`, `exchangeCodeForSession`, `getCurrentSession` |
| `founder-flow.ts` | First-time provisioning (idempotent). Writes directly — see the layering exceptions above |

### Other `src/lib`

`supabase.ts` (shared client, validates env at load) · `query-keys.ts` (cache key
factory) · `query-cache-utils.ts` (`removeFromListCache`,
`removeFromPaginatedCache`) · `constants.ts` · `utils.ts` (`cn`, `getInitials`,
`getDisplayName`) · `date-utils.ts` · `calendar-utils.ts` · `request-overlap.ts`
(client-side overlap detection mirroring the server rule) · `balance-utils.ts` ·
`validation.ts` (`isValidEmail`, shared by form and CSV import) ·
`category-colors.ts` · `category-form-schema.ts` · `time-off-category-utils.ts`
(`getAllowancePolicy`) · `csv-header-mapping.ts` · `csv-validation.ts` ·
`request-display.ts` · `default-categories.ts` · `site-url.ts` ·
`auth-channel.ts` (cross-tab sync) · `toast.ts` (pub-sub)

`constants.ts`: `IMAGE_ALLOWED_TYPES`, `IMAGE_MAX_SIZE` (5 MB),
`AUTH_SAFETY_TIMEOUT` (10 s), `INVITE_TIMEOUT_MS` (10 s), `DEBOUNCE_DELAY_MS`
(300), `TOAST_DURATION_MS` (5 s), `EMPLOYEES_PAGE_SIZE` (100),
`TIME_OFF_REQUESTS_LIMIT` (1000), `BALANCE_LOG_LIMIT` (500), `HOLIDAYS_LIMIT`
(2000 — must stay above any realistic count, or the client under-excludes
holidays relative to the server).

### Hooks — `src/hooks/`

| File | Exports |
|---|---|
| `use-auth.ts` | `useAuth` |
| `use-employees.ts` | `useEmployeeList`, `useEmployeeCounts`, `useEmployee`, `useEmployeeStatusMutation`, `useBulkEmployeeStatusMutation`, `useUpdateEmployeeMutation`, `useInviteEmployeeMutation`, `useDeleteEmployeeMutation`, `usePurgeEmployeeMutation` |
| `use-time-off-requests.ts` | `useTimeOffRequests`, `useMyTimeOffRequests`, `usePendingRequestCount`, `useActiveEmployees`, `useEmployeeBalance`, `useEmployeeBalances`, `useUpdateEmployeeBalancesMutation`, `useApproveRequestMutation`, `useRejectRequestMutation`, `useSubmitTimeOffRequestMutation`, `useCreateTimeOffRecordMutation`, `useWithdrawRequestMutation` |
| `use-time-off-categories.ts` | `useTimeOffCategories`, `useCategory`, `useCategoryAvailability`, `useCreateCategoryMutation`, `useUpdateCategoryMutation`, `useToggleCategoryActiveMutation`, `useDeleteCategoryMutation`, `useReorderCategoriesMutation` |
| `use-departments.ts` | `useDepartments`, `useCreateDepartmentMutation`, `useUpdateDepartmentMutation`, `useDeleteDepartmentMutation` |
| `use-holidays.ts` | `useHolidays`, `usePublicHolidays`, `useCreateHolidayMutation`, `useUpdateHolidayMutation`, `useDeleteHolidayMutation`, `useBulkDeleteHolidaysMutation`, `useImportHolidaysMutation` |
| `use-image-upload.ts` | `file`, `preview`, `error`, `inputRef`, `handleSelect`, `handleRemove` (PNG/JPEG ≤ 5 MB) |
| `use-debounced-value.ts` | Debounce for search inputs |
| `use-csv-import.ts` | Multi-step import: upload → preview → import → results |

### Types — `src/types/`

`workspace.ts` · `profile.ts` · `employee.ts` (`EmployeeStatus`:
`active|inactive|deleted`) · `department.ts` · `time-off-request.ts`
(`TimeOffStatus`: `pending|approved|rejected|withdrawn`; `TimeOffType`;
`StartPeriod`/`EndPeriod` half-days) · `time-off-category.ts` ·
`employee-balance.ts` · `balance-adjustment-log.ts` · `holiday.ts` ·
`calendar.ts` · `csv-import.ts`

### Components

UI primitives in `src/components/ui/`; grouped folders `calendar/`,
`categories/`, `employees/`, `requests/`, `settings/`, `layout/`. Shared
mode-based forms: `employee-form.tsx` and `category-form.tsx`
(`mode: "add" | "edit"`). Conventions, tokens and layout: `nova-pto-ui-conventions`
skill.

---

## Database

Migrations in `supabase/migrations/` (65 files). Patterns and the pre-push
checklist: `nova-pto-migration` skill.

### Tables

`workspaces` · `profiles` · `departments` · `time_off_requests` ·
`time_off_categories` · `holidays` · `employee_balances` ·
`balance_adjustment_log` · `slack_installations` · `slack_user_mappings` ·
`slack_interaction_log` · `slack_dm_messages`

Column-level detail is in the README; the schema of record is the migrations.

- `time_off_requests` carries denormalised `employee_name`, `employee_email`,
  `employee_avatar_url` and `category_name` so history survives renames and
  deletes, plus `reviewed_by`/`reviewed_at`.
- `balance_adjustment_log` is append-only, written only by the balance RPCs.
  Its `reason` values: `manual_adjustment`, `request_approved`, `record_created`,
  `accrual`, `carryover_capped`, `carryover_expired`, `recalculated`,
  `overlap_resolved`.
- Requests are read through the `time_off_requests_safe` view, which masks
  `comment` and `rejection_reason` from everyone but the owner and admins.

### Triggers, constraints and jobs

| Mechanism | Effect |
|---|---|
| `prevent_overlapping_requests` trigger + `time_off_requests_no_overlap` EXCLUDE constraint | One employee cannot hold two pending/approved requests sharing a calendar day. Trigger gives the readable message; the constraint closes the concurrent-write race. |
| `enforce_category_waiting_period` trigger | Refuses leave before the category's waiting period elapses |
| `sync_profile_to_requests` trigger | Name/avatar changes propagate to the denormalised columns |
| `after_category_insert/update_seed_balances` triggers | Creating or re-activating a category seeds balances for active employees |
| `auto_reject_pending_on_employee_delete` trigger | Soft-deleting an employee auto-rejects their pending requests |
| `nova-pto-daily-accruals` cron | `apply_accruals(CURRENT_DATE)` nightly at 02:00 UTC |

Accrual engine (`20260826110000_accrual_engine.sql`): `accrual_eligible_from`,
`accrual_grant_dates`, `accrue_balance`, `apply_accruals`,
`recalculate_employee_balance`, `seed_balances_for_employee/category`.

> `recalculate_employee_balance` **rebuilds** a balance from the accrual
> schedule and only counts approved spends with `start_date <= as_of`. Every
> approval path deducts eagerly regardless of date, so the two models disagree.
> It is currently called only from one-off backfills, not from `apply_accruals`,
> so nothing is broken — but never use it to undo a single request. Reverse the
> exact amount instead.

### Edge Functions — `supabase/functions/`

`invite-employee` · `delete-employee` (soft-delete / purge) · `delete-workspace`
(owner-only, atomic cascade RPC) · `slack-oauth` · `slack-events` ·
`slack-notify`. Deploy with `supabase functions deploy <name>` — `db push` does
not deploy them. Scaffolding and the auth gate: `new-edge-function` skill.

---

## Testing

| Folder | Contents |
|---|---|
| `src/test/unit/` | Pure logic (lib utils, hooks) |
| `src/test/integration/` | Components with mocked services |
| `src/test/security/` | RLS, RPC grants, privilege escalation, Edge Function auth |
| `src/test/db/` | Constraints, cascades, triggers, RPC behaviour |
| `e2e/tests/` | Playwright; helpers in `e2e/fixtures/` |
| `supabase/tests/` | psql fixtures for repair functions needing owner-level DDL |

`src/test/setup.ts` auto-mocks `@/lib/supabase` globally; tests override as
needed. Security and DB suites need `supabase start` and `.env.test`, and are
wrapped in `describe.skipIf(skipIfNoServiceKey())` — **without the service key
they skip silently and the run still reports success.** Check the count.

Full checklist, the "tests that cannot fail" catalogue, and jsdom gotchas:
`nova-pto-test-sync` skill.

---

## Rules

### Security

1. **Workspace isolation.** Every service-layer UPDATE/DELETE on a
   workspace-scoped table includes `.eq("workspace_id", workspaceId)` as a
   second filter, even where RLS already covers it. RLS is the last line of
   defence, not the only one.
2. **Symmetric operations get fixed symmetrically.** Fixing
   `approve_time_off_request` means checking `reject_…` and `withdraw_…` in the
   same change. Never patch one sibling alone.
3. **RPCs validate workspace ownership of every input ID** inside the RPC.
   Clients cannot be trusted to pass only valid IDs.
4. **Dates use explicit UTC.** `new Date(s + "T00:00:00Z")`, never
   `"T00:00:00"` — the latter is a local-timezone off-by-one.
5. **Env vars are validated at module load**, so a missing one fails fast.
6. **Types encode business rules.** If a value is forbidden in context, exclude
   it from the union (`role: "admin" | "user"` where `owner` must not be
   assignable) rather than rejecting it at runtime.
7. **Admin gates check role *and* status**, in the client, in RLS, and in Edge
   Functions.

### Data integrity

8. **Every mutation audits its cache invalidations.** Check the full set of
   affected keys against `query-keys.ts`, not just the obvious one. Approve or
   reject touches `timeOffRequestKeys`, `myRequestKeys`, `employeeBalanceKeys`
   and `balanceAdjustmentLogKeys`; invite touches `employeeKeys.all`,
   `activeEmployeeKeys` and counts.
9. **Optimistic `setQueryData` must match the cached shape**, not what the
   component sees — a hook's `select` runs on read only. Use
   `query-cache-utils.ts`; a mismatch throws inside the click handler and
   silently prevents the mutation from firing.
10. **Multi-step Edge Functions are atomic** — one RPC wrapping a transaction,
    or explicit rollback with a documented recovery path. Never leave an
    orphaned auth user or a half-deleted workspace.

### Code quality

11. **Services → Hooks → Components, no exceptions.**
12. **`noUnusedLocals` / `noUnusedParameters` stay enabled.** Fix the errors
    they surface; do not suppress the rule.
13. **Deployment order.** Client first, then the migration, whenever the
    migration *removes* something the client uses (a REVOKE, a dropped column, a
    narrowed grant). Add-only restrictions are safe either way.

---

## Skills

| Situation | Skill |
|---|---|
| Any code change is done — before marking it complete | `nova-pto-test-sync` |
| Creating or editing a UI component or page | `nova-pto-ui-conventions` |
| Writing a Supabase migration | `nova-pto-migration` |
| Creating a Supabase Edge Function | `new-edge-function` |
| Background conventions, auto-loaded | `project-conventions` |
| Implementing a Figma design (needs the Figma MCP server) | `implement-design` |

---

## Working method

**Plan before non-trivial work.** Anything with 3+ steps or an architectural
choice gets a plan in `tasks/todo.md` with checkable items, confirmed before
implementation. Completed task records move to `tasks/archive/`. If the work
goes sideways, stop and re-plan rather than pushing on.

**Verify before claiming done.** Run the tests, show the output, and prove the
new test fails without the fix. "The suite is green" is not evidence that
anything is covered. Report honestly: if a step was skipped or a test fails, say
so with the output.

**Capture lessons.** After a correction, add the pattern to `tasks/lessons.md`
as a rule — what went wrong, why, and what to do instead.

**Simplicity and minimal impact.** Change only what the task needs. Find root
causes rather than adding a workaround. If a fix feels hacky, stop and ask
whether there is a straightforward version.
