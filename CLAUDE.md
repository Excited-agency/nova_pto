# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev             # Start dev server (Vite HMR)
npm run build           # Production build
npm run lint            # ESLint
npm run preview         # Preview production build

# Unit / integration / security tests (Vitest + jsdom)
npm test                # Run all Vitest tests once
npm run test:watch      # Vitest in watch mode
npm run test:coverage   # Coverage report (v8)
npm run test:security   # Only src/test/security/
npm run test:db         # Only src/test/db/

# E2E tests (Playwright, Chromium)
npm run test:e2e        # Headless
npm run test:e2e:ui     # Playwright UI mode
npm run test:e2e:headed # Headed (visible browser)

npm run test:all        # Vitest + Playwright
```

## Testing

**Unit/integration tests** live in `src/test/` and are run with Vitest (`vitest.config.ts`).  
Setup file `src/test/setup.ts` auto-mocks `@/lib/supabase` globally — individual tests override as needed.

| Folder | What's inside |
|---|---|
| `src/test/unit/` | Pure logic (lib utils, hooks) |
| `src/test/integration/` | Component-level tests with MSW or mocked services |
| `src/test/security/` | RLS / privilege-escalation tests hitting a real local Supabase |
| `src/test/db/` | DB constraint, cascade-delete, and RPC tests |

Security and DB tests require a running local Supabase stack (`supabase start`) and read credentials from `.env.test` (`TEST_SUPABASE_*` vars, including `TEST_SUPABASE_SERVICE_ROLE_KEY`).

**E2E tests** live in `e2e/` and use Playwright (`playwright.config.ts`). The dev server starts automatically. Credentials come from `.env.test` (`PLAYWRIGHT_BASE_URL` optional override). Page-object classes are in `e2e/page-objects/`. Reusable test helpers live in `e2e/fixtures/`:
- `e2e/fixtures/auth.ts` — `createTestUser()`, `seedSession()`, `cleanupTestUser()`, `createEphemeralAuthUser()`, `adminClient` (service-role Supabase client)
- `e2e/fixtures/test-data.ts` — `createCategory()`, `createBalance()`, `createPendingRequest()`, `addEmployeeToWorkspace()`

## Environment

Requires a `.env` file with:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Architecture

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + Supabase + TanStack React Query

**App:** Nova PTO — a leave management SaaS. Auth uses Supabase magic link (OTP via email, no passwords).

**Key dependencies beyond core stack:** `react-hook-form` + `zod` (forms/validation), `@dnd-kit/*` (drag-and-drop), `xlsx` (Excel export), `papaparse` (CSV parsing), `react-highlight-words` (search result highlighting), `lucide-react` (icons), `radix-ui` (unified Radix package).

### Key flows

- `src/App.tsx` — router root. All routes wrapped in `AuthProvider`. `/` layout route is behind `ProtectedRoute`. App pages use nested routes via `<Outlet />` in `DashboardLayout`.
- **Auth sequence**: `/login` (enter email) → Supabase sends OTP → `/check-email` (enter 6-digit code) → verify → redirect to `/requests`.
- **Role-based routing**: The `requests` route renders `RequestsPage` for admins and `EmployeeRequestsPage` for non-admins — both lazy-loaded, switch decided inside the route element.
- `src/contexts/auth-context.tsx` — central auth state. Exposes `user`, `session`, `workspace`, `profile`, `loading`, `authError`, `retryAuth`, `signOut`, `refreshWorkspace`, `refreshProfile`. On first sign-in (`SIGNED_IN` event), runs `runFounderFlow` to auto-provision a workspace and profile for new users.
- `src/contexts/navigation-guard-context.tsx` — provides `registerGuard`/`unregisterGuard` for pages with unsaved changes (e.g. Settings) to block navigation until confirmed.
- `src/lib/founder-flow.ts` — first-time user setup: creates a `workspaces` row and a `profiles` row (role: `admin`) in Supabase. Idempotent — skips if profile already exists.
- `src/lib/supabase.ts` — single shared Supabase client.

### Data flow

Pages do **not** fetch data directly. The layered pattern is: **Services → Hooks → Components**.

- **Services** (`src/lib/*-service.ts`) — raw Supabase calls, no React state
- **Hooks** (`src/hooks/use-*.ts`) — wrap services in TanStack Query (`useQuery`/`useMutation`). React Query is configured globally in `src/App.tsx` with staleTime 5 min, gcTime 10 min, retry 3×. Cache keys are centralized in `src/lib/query-keys.ts`.
- **Components/Pages** — consume hooks only, never call services directly

### Supabase schema

- `workspaces` — `id`, `name`, `logo_url?`, `owner_id` (unique), `created_at`
- `profiles` — `id` (= auth user id), `workspace_id`, `role` (`"admin" | "user"`), `email`, `first_name?`, `last_name?`, `avatar_url?`, `status` (`EmployeeStatus`), `department_id?`, `location?`, `hire_date?`, `created_at` (note: `full_name` was split into `first_name` + `last_name` via migration)
- `departments` — `id`, `workspace_id`, `name`, `created_at`
- `time_off_requests` — `id`, `profile_id`, `workspace_id`, `category_id?`, `employee_name`, `employee_email`, `employee_avatar_url?`, `start_date`, `end_date`, `start_period`, `end_period`, `total_days`, `request_type`, `status`, `comment?`, `rejection_reason?`, `created_at`, `updated_at`
- `time_off_categories` — `id`, `workspace_id`, `name`, `emoji?`, `colour`, `is_active`, `leave_type` (`"paid" | "unpaid"`), `accrual_method`, `amount_value`, `granting_frequency`, `new_hire_rule`, `waiting_period_value/unit`, `carryover_limit_enabled`, `carryover_max_days`, `sort_order`, `created_at`, `updated_at`
- `holidays` — `id`, `workspace_id`, `name`, `date`, `is_custom`, `country_code?`, `year?`, `created_at`, `updated_at`
- `employee_balances` — `id`, `employee_id`, `category_id`, `workspace_id`, `remaining_days`, `created_at`, `updated_at`
- `slack_installations` — Slack OAuth install data per workspace (`workspace_id`, `slack_team_id`, `bot_token`, etc.)
- `slack_user_mappings` — maps Nova `profile_id` to Slack user IDs
- `slack_interactions` — idempotency tracking for Slack button interactions
- `slack_dm_messages` — per-admin DM channel/message references for updating Slack notifications in-place

Migrations live in `supabase/migrations/`. Run `supabase db push` to apply them to a local/remote instance.

### App routes

Defined in `src/App.tsx`. All page components are lazy-loaded via `React.lazy` + `Suspense`. `/` redirects to `/requests`. Currently implemented pages:
- `/auth/callback` — OAuth/magic link callback handler
- `/requests` — `RequestsPage` (admin) or `EmployeeRequestsPage` (non-admin), role-resolved at render
- `/employees` — `EmployeesPage` (tabs/search/table, live Supabase data, status filtering, action dropdowns)
- `/employees/new` — `AddEmployeePage` (uses shared `employee-form.tsx`; calls `inviteEmployee` from employee-service)
- `/employees/:id` — `EmployeeDetailsPage` (individual employee details view)
- `/employees/:id/edit` — `EditEmployeePage` (uses shared `employee-form.tsx`; loads via `fetchEmployee`, saves via `updateEmployee`)
- `/employees/import` — `ImportPreviewPage` (CSV bulk employee import with header mapping and validation)
- `/settings` — role-resolved: `SettingsPage` (admin — workspace name/logo, profile name/avatar, departments CRUD, dirty-state guard) or `UserSettingsPage` (non-admin — employee-only profile editor for first/last name + avatar)
- `/check-email` — `CheckEmailPage` (OTP 6-digit code entry, part of the magic-link auth sequence)
- `/calendar` — stub placeholder
- `/time-off-setup` — `TimeOffSetupPage` (categories CRUD with drag-and-drop reordering via `@dnd-kit`)
- `/time-off-setup/new` — `AddCategoryPage` (uses shared `category-form.tsx`)
- `/time-off-setup/:id/edit` — `EditCategoryPage` (uses shared `category-form.tsx`)
- `/access-restricted` — shown when user lacks permissions

### Types

- `src/types/time-off-request.ts` — `TimeOffRequest`, `TimeOffStatus` (`"pending" | "approved" | "rejected" | "withdrawn"`), `TimeOffType` (`"vacation" | "sick_leave" | "personal" | "bereavement" | "other"`), `StartPeriod`, `EndPeriod` (half-day support)
- `src/types/employee.ts` — `EmployeeStatus` (`"active" | "inactive" | "deleted"`)
- `src/types/department.ts` — `Department` interface
- `src/types/time-off-category.ts` — `TimeOffCategory`, `LeaveType`, `AccrualMethod`, `GrantingFrequency`, `NewHireRule`, `PeriodUnit`
- `src/types/holiday.ts` — `Holiday`, `NagerHoliday` (external API shape), `CreateHolidayData`
- `src/types/employee-balance.ts` — `EmployeeBalance` interface
- `src/types/csv-import.ts` — `SchemaField`, `HeaderMapping`, `CsvEmployeeRow`, `RowValidation`, `ImportRowResult`, `ImportStep`

### Services

- `src/lib/employee-service.ts` — `fetchEmployees`, `fetchEmployeeCounts`, `fetchEmployee`, `updateEmployee`, `updateEmployeeStatus`, `bulkUpdateEmployeeStatus`, `inviteEmployee` (calls the `invite-employee` Edge Function)
- `src/lib/settings-service.ts` — `fetchDepartments`, `createDepartment`, `updateDepartment`, `deleteDepartment`, `updateWorkspace`, `updateProfile`, `uploadImage`, `removeImage`
- `src/lib/time-off-request-service.ts` — fetch/create/approve/reject time-off requests; `fetchEmployeeBalance`, `fetchEmployeeBalances`
- `src/lib/time-off-category-service.ts` — category CRUD + `updateCategorySortOrder`
- `src/lib/holiday-service.ts` — holiday import and management
- `src/lib/report-service.ts` — report data fetching; `src/lib/generate-report.ts` — Excel export via `xlsx`
- `src/lib/founder-flow.ts` — first-time workspace + profile provisioning (idempotent)
- `src/lib/toast.ts` — pub-sub toast notification helper (`addToast`, `removeToast`, `subscribe`, `getSnapshot`)
- `src/lib/query-keys.ts` — TanStack Query key factory (centralized cache key definitions)
- `src/lib/constants.ts` — `IMAGE_ALLOWED_TYPES`, `IMAGE_MAX_SIZE` (2 MB), `EMPLOYEES_PAGE_SIZE` (100), `AUTH_SAFETY_TIMEOUT` (10 s)
- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge), `getInitials(firstName, lastName)`, `getDisplayName(firstName, lastName)`
- `src/lib/date-utils.ts` / `src/lib/calendar-utils.ts` — date parsing, formatting, and calendar calculations
- `src/lib/category-colors.ts` — color palette for time-off categories
- `src/lib/category-form-schema.ts` — Zod validation schema for category forms
- `src/lib/csv-header-mapping.ts` — `mapHeaders()` (3-phase CSV header auto-detection), `splitFullName()`
- `src/lib/csv-validation.ts` — `processRows()`, `rowHasErrors()` (CSV row validation with error/warning detection)
- `src/lib/auth-channel.ts` — `broadcastAuthComplete()`, `onAuthComplete()` (BroadcastChannel for cross-tab auth sync)
- `src/lib/request-display.ts` — `legacyTypeLabels`, `getCategoryDisplay()` (legacy request type display logic)
- `src/lib/site-url.ts` — `getSiteUrl()` (returns `VITE_SITE_URL` for auth redirects, falls back to `window.location.origin`)
- `src/lib/default-categories.ts` — `seedDefaultCategories()` (seeds 5 default time-off categories on workspace creation)
- `src/lib/time-off-category-utils.ts` — `getAllowancePolicy()` (displays accrual policy text based on category settings)

### Hooks

All in `src/hooks/`. Each wraps one domain's service calls in TanStack Query:

- `use-auth.ts` — simple `useContext(AuthContext)` consumer
- `use-employees.ts` — `useEmployeeList`, `useEmployeeCounts`, `useEmployee`, `useEmployeeStatusMutation`, `useUpdateEmployeeMutation`, `useInviteEmployeeMutation`, `useActiveEmployeesForCombobox`
- `use-time-off-requests.ts` — `useTimeOffRequests`, `useMyTimeOffRequests`, `useEmployeeBalance`, `useEmployeeBalances`, `useApproveTimeOffRequestMutation`, `useRejectTimeOffRequestMutation`, `useSubmitTimeOffRequestMutation`, `useCreateTimeOffRecordMutation`
- `use-time-off-categories.ts` — category CRUD queries/mutations
- `use-departments.ts` — department CRUD queries/mutations
- `use-holidays.ts` — holiday management queries/mutations
- `use-image-upload.ts` — avatar/logo file selection: exposes `file`, `preview`, `error`, `inputRef`, `handleSelect`, `handleRemove`. Validates PNG/JPEG ≤ 2 MB.
- `use-debounced-value.ts` — debounced value for search inputs
- `use-csv-import.ts` — manages multi-step CSV employee import workflow (upload → preview → import → results), including file parsing, header mapping, validation, and progress tracking

### Supabase Edge Functions

- `supabase/functions/invite-employee/` — Deno function: verifies caller JWT + admin role, creates Supabase auth user via admin API, inserts `profiles` row.
- `supabase/functions/delete-workspace/` — workspace deletion (owner-only, cascades all workspace data)
- `supabase/functions/slack-oauth/` — handles Slack OAuth callback, stores bot token in `slack_installations`
- `supabase/functions/slack-events/` — receives Slack event payloads (button clicks, etc.), uses `slack_interactions` for idempotency
- `supabase/functions/slack-notify/` — sends/updates DM notifications to admins via `slack_dm_messages`

Deploy with `supabase functions deploy <function-name>`.

### Layout structure

Non-dashboard components: `src/components/auth-layout.tsx` (wrapper for login/OTP pages), `src/components/protected-route.tsx` (redirects unauthenticated users), `src/components/admin-route.tsx` (wraps admin-only routes, redirects non-admins to `/access-restricted`), `src/components/error-boundary.tsx` (error fallback wrapping DashboardLayout), `src/components/nova-logo.tsx`. Dashboard-specific layout: `src/components/layout/DashboardLayout.tsx` and `src/components/layout/Sidebar.tsx`.

`DashboardLayout`: outer `div` with `bg-sidebar-accent p-2 flex h-screen overflow-hidden`, containing a fixed-width `Sidebar` (260px) and a `main` that is `flex-1 overflow-y-auto rounded-xl bg-background`. The sidebar background is visually inset into the app chrome.

### Styling

Tailwind v4 with a custom design system sourced from Figma. Design tokens are defined as CSS variables in `src/index.css` and mapped via `@theme inline`. The font is **Instrument Sans** (Google Fonts). Use `cn()` from `src/lib/utils.ts` (`clsx` + `tailwind-merge`) for conditional class names.

Custom tokens beyond shadcn defaults:
- `shadow-focus`, `shadow-destructive-focus`, `shadow-switch-focus` — used for focus rings on interactive elements
- `color-success-*`, `color-warning-*`, `color-error-*` — semantic status colors
- `shadow-2xs`, `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg` — Figma-matched shadows

### Component conventions

- UI primitives live in `src/components/ui/`. These are custom components (not auto-generated shadcn CLI output) built to match Figma specs exactly. Notable groups:
  - **Combobox system**: `combobox-menu.tsx`, `combobox-search-field.tsx`, `combobox-menu-item.tsx`, `combobox-menu-label.tsx` — low-level primitives. `location-combobox.tsx` composes these with a static `src/data/cities.json` dataset (~500 entries, `{ name, country }`) and `src/data/countries.ts` (`Country` interface + `countries` array with codes, names, and emoji flags) for the employee location field. `employee-combobox.tsx` uses live data from `useActiveEmployeesForCombobox`.
  - **Data table**: `data-table-header-cell.tsx`, `data-table-cell.tsx`, `data-table-pagination.tsx` — used in Requests and Employees pages.
  - **Calendar primitives**: `calendar-cell.tsx`, `calendar-day-button.tsx`, `calendar-event-slot.tsx`, `calendar-header.tsx`, `calendar-arrow-button.tsx` — low-level atoms. Higher-level composites live in `src/components/calendar/`: `CalendarMonthGrid`, `CalendarWeekRow`, `CalendarEventBar`, `CalendarFilters` — all built but not yet wired to a live calendar page.
- Radix primitives come from the unified `radix-ui` package (e.g. `import { Tabs, Slot } from "radix-ui"`), **not** individual `@radix-ui/*` packages.
- Component variants are built with `cva` from `class-variance-authority`.
- All UI primitives use a `data-slot="<name>"` attribute for identification (e.g. `data-slot="button"`, `data-slot="tabs-trigger"`).
- Higher-level composite components (e.g. `TabGroup`) wrap the lower-level primitives and accept a declarative `items` prop instead of requiring manual composition.
- `src/components/employee-form.tsx` — shared form used by `AddEmployeePage` and `EditEmployeePage`. Accepts `mode` (`"add" | "edit"`) and optional `initialData`.
- `src/components/category-form.tsx` — shared form used by `AddCategoryPage` and `EditCategoryPage`. Same `mode`/`initialData` pattern.
- `Button` supports a `loading` prop that shows a spinner and disables interaction.
- Page components export named functions (e.g. `export function LoginPage()`), not default exports.
- Path alias `@/` maps to `src/`.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items (create the `tasks/` directory if it doesn't exist)
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
