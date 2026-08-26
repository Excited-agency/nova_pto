# Nova PTO

> Multi-tenant leave management SaaS built with React 19, Supabase, and Vite.

Nova PTO is a time-off management platform for teams. Each company gets an isolated workspace with full control over employees, time-off categories, accrual policies, holiday calendars, and approval workflows — all secured by Supabase Row-Level Security.

---

## Features

### Time-off Requests
- Submit, approve, and reject leave requests
- Employees can withdraw their own pending requests
- Half-day support (morning/afternoon periods)
- Overlapping dates are impossible: a database trigger explains the clash, and an
  EXCLUDE constraint closes the concurrent-write race. The picker greys out days
  you have already booked and offers the free part of a range in one click.
- Business-day calculation shared by client and server, with workspace holidays excluded
- Request comment and rejection reason fields, masked from other employees by a security view
- Every approval and rejection records who did it and when

### Balances and accruals
- Per-employee, per-category balances
- Accrual engine: amount, frequency, waiting periods, new-hire rules, carryover
  caps and expiry — applied nightly by a `pg_cron` job at 02:00 UTC
- Every balance change is written to an append-only adjustment log with a reason
  and, where applicable, a link to the request that caused it
- Balances are only ever written by the balance-writing RPCs, never directly by a client

### Employee Management
- Invite employees via magic link email
- CSV bulk import with auto-header mapping and validation
- Department assignment and location tracking
- Status management: active, inactive, soft-deleted, and permanent purge
- Soft-deleting an employee auto-rejects their pending requests

### Time-off Categories
- Fully configurable: name, emoji, colour, leave type (paid/unpaid)
- Accrual policies: amount, frequency, waiting periods, carryover rules
- New hire rules per category
- Drag-and-drop reordering
- Toggle active/inactive without deleting; deleting preserves history on past requests

### Holiday Management
- Import country-specific public holidays via external API
- Add custom one-off holidays per workspace
- Year-based holiday sets

### Workspace Settings
- Workspace name and logo upload
- Personal profile (name, avatar)
- Departments CRUD with live updates
- Navigation guard — warns before leaving with unsaved changes
- Owner-only workspace deletion, gated behind typing the workspace name

### Integrations
- Slack OAuth integration
- Slack event handling and DM notifications, with idempotent button handling

### Access Control
- **Owner** — workspace creator, one per workspace. Everything an admin can do,
  plus deleting the workspace. Cannot be deactivated or deleted by an admin.
- **Admin** — full access: employees, categories, requests, settings
- **User** — self-service: submit, view, and withdraw own requests; personal
  settings (name + avatar) via `/settings`

Admin checks must accept **both** `admin` and `owner`. On the database side that
is `is_workspace_admin()`, which additionally requires `status = 'active'`.

---

## Tech Stack

| Category | Technology | Version |
|---|---|---|
| Framework | React | 19 |
| Language | TypeScript | 6 |
| Build tool | Vite | 8 |
| Styling | Tailwind CSS | 4 |
| UI primitives | Radix UI (unified `radix-ui` package) | 1.6 |
| Icons | Lucide React | 1 |
| Component variants | class-variance-authority | 0.7 |
| Server state | TanStack React Query | 5 |
| Forms | React Hook Form + Zod | 7 + 4 |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) | 2 |
| Routing | React Router DOM | 7 |
| Drag and drop | @dnd-kit | 6 |
| CSV parsing | PapaParse | 5 |
| Excel export | xlsx (SheetJS) | 0.18 |
| Unit/integration tests | Vitest + jsdom | 4 |
| E2E tests | Playwright (Chromium) | 1.62 |

Exact versions live in `package.json`; this table is the shape, not the lockfile.

---

## Architecture

### Data Flow

```
Supabase (PostgreSQL + Auth + Storage)
         │
         ▼
Services  src/lib/*-service.ts      ← raw Supabase calls, no React state
         │
         ▼
Hooks     src/hooks/use-*.ts        ← TanStack Query (useQuery / useMutation)
         │
         ▼
Pages / Components                  ← consume hooks only, never call services directly
```

React Query defaults: `staleTime` 5 min, `gcTime` 10 min, no refetch on window
focus, and a retry predicate that never retries 401/403/404 and otherwise makes
up to 3 attempts with capped exponential backoff. Cache keys are centralized in
`src/lib/query-keys.ts`.

### Where the rules live

The server is authoritative. Request writes go through RPCs rather than table
writes, balances are written only by the balance RPCs, and invariants like
"no overlapping leave" and "a waiting period must have elapsed" are enforced by
database triggers and constraints. Client-side checks exist to give a clear
message before Submit — they are never the enforcement point.

### Workspace Isolation

Every table has Row-Level Security policies restricting reads and writes to the
caller's `workspace_id`. Service-layer writes additionally filter by
`workspace_id` as defense in depth, so a mistake in one layer is not enough to
cross a tenant boundary.

### Authentication

Nova PTO uses **Supabase magic link / OTP** — no passwords.

1. User enters their email on `/login`
2. Supabase sends a 6-digit OTP via email
3. User enters the code on `/check-email`
4. On first sign-in the **founder flow** auto-provisions:
   - A `workspaces` row and an `owner` profile
   - Default departments: Design, HR, Engineering, Product, Marketing
   - Default categories: Vacation, Sick leave, Business trip, Loyalty vacation, Unpaid leave
5. Subsequent sign-ins skip provisioning (idempotent)
6. User is redirected to `/requests`

Cross-tab auth sync is handled via `BroadcastChannel` (`src/lib/auth-channel.ts`).

---

## Project Structure

```
Nova_pto/
├── src/
│   ├── pages/              # 17 page components (all lazy-loaded via React.lazy)
│   ├── components/
│   │   ├── ui/             # Low-level UI primitives (Button, Badge, Combobox, Table…)
│   │   ├── layout/         # DashboardLayout, Sidebar
│   │   ├── calendar/       # Month grid, week rows, event bars, filters
│   │   ├── employees/      # Filters, bulk action bar, info card
│   │   ├── requests/       # Request row
│   │   └── settings/       # Workspace, profile, departments sections
│   ├── hooks/              # TanStack Query wrappers (one file per domain)
│   ├── lib/                # Services, utilities, Zod schemas, constants
│   ├── contexts/           # AuthContext, NavigationGuardContext
│   ├── types/              # TypeScript interfaces
│   ├── data/               # Static datasets (cities.json 500 entries, countries.ts)
│   └── test/
│       ├── unit/           # Pure logic
│       ├── integration/    # Component-level tests with mocked services
│       ├── security/       # RLS / privilege-escalation (real local Supabase)
│       └── db/             # DB constraint, cascade, and RPC tests
├── e2e/
│   ├── fixtures/           # Shared helpers (auth setup, test-data builders)
│   └── tests/              # Specs grouped by area
├── supabase/
│   ├── migrations/         # 65 ordered SQL migration files
│   ├── functions/          # 6 Deno Edge Functions
│   ├── tests/              # psql fixtures for repair functions needing owner DDL
│   └── seed.sql            # Local seed data (empty by default)
├── .env                    # Local environment variables (not committed)
├── .env.test               # Test credentials (not committed)
├── vitest.config.ts
└── playwright.config.ts
```

---

## Prerequisites

- **Node.js** ≥ 20.19
- **npm** ≥ 10
- **Supabase CLI** — `npm install -g supabase`
- **Docker** — required by `supabase start` for the local stack
- A Supabase project (cloud) **or** a local Supabase stack

---

## Getting Started

### 1. Clone and install

```bash
git clone <repo-url> nova-pto
cd nova-pto
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
VITE_SITE_URL=http://localhost:5173
```

Both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are found in your Supabase project under **Settings → API**.

`VITE_SITE_URL` is the base URL for auth redirect links. It falls back to
`window.location.origin` if omitted — which means that in production it must be
set explicitly, or magic links can point at the wrong host.

### 3. Apply database migrations

```bash
# Against a remote project
supabase db push

# Or start a local Supabase stack first
supabase start
supabase db reset      # applies every migration from scratch
```

### 4. Start the dev server

```bash
npm run dev
```

The app runs at `http://localhost:5173`. Sign in with any email — you receive a 6-digit OTP and your workspace is created on first login.

---

## Environment Variables

### Application (`.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project REST/Auth endpoint |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) API key |
| `VITE_SITE_URL` | Recommended | Base URL for magic link redirects |

Both required variables are validated at module load in `src/lib/supabase.ts` —
a missing one fails fast rather than at first request.

### Tests (`.env.test`)

Required for security, database, and E2E tests, which hit a real local Supabase instance.

| Variable | Description |
|---|---|
| `TEST_SUPABASE_URL` | Local Supabase URL (e.g. `http://127.0.0.1:54321`) |
| `TEST_SUPABASE_ANON_KEY` | Local anon key |
| `TEST_SUPABASE_SERVICE_ROLE_KEY` | Service-role key for privileged test setup |
| `PLAYWRIGHT_BASE_URL` | Optional override for E2E base URL |

---

## Available Scripts

```bash
# Development
npm run dev             # Start Vite dev server with HMR
npm run build           # Production build
npm run preview         # Preview production build locally
npm run typecheck       # tsc -b, no emit
npm run lint            # ESLint

# Unit / integration / security tests (Vitest + jsdom)
npm test                # Run all Vitest tests once
npm run test:watch      # Vitest in watch mode
npm run test:ui         # Vitest UI
npm run test:coverage   # Coverage report (v8 provider)
npm run test:security   # Only src/test/security/ (requires local Supabase)
npm run test:db         # Only src/test/db/ (requires local Supabase)

# E2E tests (Playwright, Chromium)
npm run test:e2e        # Headless
npm run test:e2e:ui     # Playwright UI mode
npm run test:e2e:headed # Headed (visible browser)

npm run test:all        # Vitest + Playwright combined
```

---

## Testing

Four layers, each with a distinct job. CI runs all of them
(`.github/workflows/test.yml`).

### Unit / Integration — `src/test/`

Vitest + jsdom. `src/test/setup.ts` auto-mocks `@/lib/supabase` globally;
individual tests override it as needed.

| Folder | What's inside |
|---|---|
| `src/test/unit/` | Pure logic — lib utils, hooks |
| `src/test/integration/` | Components with mocked services |

### Security (RLS) — `src/test/security/`

Row-Level Security policies, RPC grants, and privilege-escalation scenarios,
including Edge Function auth. Requires a running local stack.

```bash
supabase start
npm run test:security
```

### Database — `src/test/db/`

Constraints, cascade deletes, triggers, and RPC behaviour against real SQL.

```bash
npm run test:db
```

> Both suites are wrapped in `describe.skipIf(skipIfNoServiceKey())`. Without
> `TEST_SUPABASE_SERVICE_ROLE_KEY` they **skip silently and still report
> success** — check the test count, not just the exit code.

### End-to-End — `e2e/`

Playwright against the full app; the dev server starts automatically. Reusable
helpers live in `e2e/fixtures/` (`createTestUser`, `seedSession`,
`cleanupTestUser`, `adminClient`, and test-data builders).

```bash
npm run test:e2e
npm run test:e2e:ui
```

Conventions worth keeping: prefer web-first assertions (`toBeVisible`,
`toHaveCount`) and `expect.poll` for database state over `waitForTimeout`, and
never guard assertions behind an `if (count > 0)` — that turns a broken feature
into a passing test.

### SQL fixtures — `supabase/tests/`

Repair and migration functions that need table-owner DDL beyond what
`service_role` has. Run with psql inside the local database container; they
open a transaction and roll it back.

---

## Database Schema

All tables are workspace-isolated via RLS. Migrations live in `supabase/migrations/`.

| Table | Key Columns |
|---|---|
| `workspaces` | `id`, `name`, `logo_url`, `owner_id` (unique), `created_at` |
| `profiles` | `id` (= auth user id), `workspace_id`, `role` (`owner\|admin\|user`), `email`, `first_name`, `last_name`, `avatar_url`, `status`, `department_id`, `location`, `hire_date` |
| `departments` | `id`, `workspace_id`, `name` |
| `time_off_requests` | `id`, `profile_id`, `workspace_id`, `category_id`, `category_name`, `start_date`, `end_date`, `start_period`, `end_period`, `total_days`, `status` (`pending\|approved\|rejected\|withdrawn`), `comment`, `rejection_reason`, `reviewed_by`, `reviewed_at` |
| `time_off_categories` | `id`, `workspace_id`, `name`, `emoji`, `colour`, `leave_type` (`paid\|unpaid`), `accrual_method`, `amount_value`, `granting_frequency`, `new_hire_rule`, `waiting_period_value/unit`, `carryover_limit_enabled`, `carryover_max_days`, `sort_order` |
| `holidays` | `id`, `workspace_id`, `name`, `date`, `is_custom`, `country_code`, `year` |
| `employee_balances` | `id`, `employee_id`, `category_id`, `workspace_id`, `remaining_days` |
| `balance_adjustment_log` | `id`, `employee_id`, `category_id`, `workspace_id`, `delta`, `balance_before`, `balance_after`, `reason`, `request_id`, `adjusted_by` — append-only audit trail |
| `slack_installations` | `workspace_id`, `slack_team_id`, `bot_token` — Slack OAuth install data |
| `slack_user_mappings` | Maps Nova `profile_id` to Slack user IDs |
| `slack_interaction_log` | Idempotency tracking for Slack button interactions |
| `slack_dm_messages` | Per-admin DM channel/message refs for in-place notification updates |

Reads of requests go through the `time_off_requests_safe` view, which masks
`comment` and `rejection_reason` from everyone but the request's owner and admins.

Notable database-side behaviour:

| Mechanism | Effect |
|---|---|
| `prevent_overlapping_requests` trigger + `time_off_requests_no_overlap` EXCLUDE constraint | One employee cannot hold two pending/approved requests sharing a calendar day |
| `enforce_category_waiting_period` trigger | Rejects leave taken before the category's waiting period has elapsed |
| `sync_profile_to_requests` trigger | Name/avatar changes propagate to denormalised request columns |
| `after_category_insert/update_seed_balances` triggers | Creating or re-activating a category seeds balances for active employees |
| `auto_reject_pending_on_employee_delete` trigger | Soft-deleting an employee auto-rejects their pending requests |
| `nova-pto-daily-accruals` cron job | `apply_accruals(CURRENT_DATE)` nightly at 02:00 UTC |

---

## Edge Functions

Deno-based functions deployed on Supabase Edge.

| Function | Description |
|---|---|
| `invite-employee` | Verifies caller is an active admin/owner, creates the auth user, inserts `profiles` row |
| `delete-employee` | Soft-delete (`purge: false` — status `deleted`, auth user removed) or permanent purge (`purge: true`) |
| `delete-workspace` | Full workspace teardown, owner-only, via the atomic cascade RPC |
| `slack-oauth` | Slack OAuth 2.0 callback — stores bot token in `slack_installations` |
| `slack-events` | Slack event webhook; uses `slack_interaction_log` for idempotency |
| `slack-notify` | Sends/updates DM notifications to admins; tracks refs in `slack_dm_messages` |

Every admin-gated function must check **role and status** —
`["admin","owner"].includes(role) && status === "active"` — because deactivating
an admin leaves their auth user, and therefore their JWT, working.

```bash
# Deploy a specific function
supabase functions deploy invite-employee

# Deploy all functions
supabase functions deploy
```

`supabase db push` does not deploy functions; they are a separate step.

---

## Deployment

### Frontend

```bash
npm run build
```

Output is in `dist/`. Deployed to Vercel; Speed Insights is integrated via
`@vercel/speed-insights`. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
`VITE_SITE_URL` in the host's dashboard — `VITE_SITE_URL` must be the production
origin, or magic links will point somewhere else.

### Supabase

1. Push migrations: `supabase db push`
2. Deploy Edge Functions: `supabase functions deploy`
3. Configure **Auth → URL Configuration**:
   - Site URL: your production domain
   - Redirect URLs: `https://yourdomain.com/auth/callback`

**Order matters.** Deploy the client *before* a migration that removes something
(a revoked grant, a dropped column, a narrowed privilege). A migration that only
adds a restriction is safe either way — an old client just surfaces the server's
error message.

---

## Key Conventions

- **Named exports** — components use named exports (`export function RequestsPage()`), not defaults.
- **Mode-based shared forms** — `employee-form.tsx` and `category-form.tsx` accept `mode: "add" | "edit"` and optional `initialData`, shared between Add and Edit pages.
- **Path alias** — `@/` maps to `src/`.
- **`cn()` utility** — from `src/lib/utils.ts` (`clsx` + `tailwind-merge`) for all conditional class names.
- **Radix UI** — import from the unified `radix-ui` package (`import { Tabs } from "radix-ui"`), not individual `@radix-ui/*` packages.
- **`data-slot` attributes** — UI primitives and repeated list rows carry `data-slot="<name>"`, used for styling hooks and as stable test handles.
- **Icon-only buttons carry an `aria-label`** — otherwise they have no accessible name and are unreachable by both screen readers and tests.
- **No direct service calls in components** — pages and components consume hooks; hooks call services; services call Supabase.
- **Dates** — parse `YYYY-MM-DD` with `parseDateLocal`, or append an explicit `Z`. `new Date(s + "T00:00:00")` is a local-timezone off-by-one.
