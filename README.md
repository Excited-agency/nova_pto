# Nova PTO

> Multi-tenant leave management SaaS built with React 19, Supabase, and Vite.

Nova PTO is a production-grade time-off management platform for teams. Each company gets an isolated workspace with full control over employees, time-off categories, accrual policies, holiday calendars, and approval workflows — all secured by Supabase Row-Level Security.

---

## Features

### Time-off Requests
- Submit, approve, and reject leave requests
- Employees can withdraw their own pending requests
- Half-day support (morning/afternoon periods)
- Real-time balance tracking per category
- Request comment and rejection reason fields
- Employee self-service view (own requests only)

### Employee Management
- Invite employees via magic link email
- CSV bulk import with auto-header mapping and validation
- Department assignment and location tracking
- Status management: active, inactive, soft-deleted
- Per-employee time-off balance overview

### Time-off Categories
- Fully configurable: name, emoji, colour, leave type (paid/unpaid)
- Accrual policies: amount, frequency, waiting periods, carryover rules
- New hire rules per category
- Drag-and-drop reordering
- Toggle active/inactive without deleting

### Holiday Management
- Import country-specific public holidays via external API
- Add custom one-off holidays per workspace
- Year-based holiday sets

### Workspace Settings
- Workspace name and logo upload
- Personal profile (name, avatar)
- Departments CRUD with live updates
- Navigation guard — warns before leaving with unsaved changes

### Integrations
- Slack OAuth integration
- Slack event handling and DM notifications

### Access Control
- **Admin**: full access — employees, categories, requests, settings
- **User**: self-service — submit, view, and withdraw own requests; personal settings (name + avatar) via `/settings`

---

## Tech Stack

| Category | Technology | Version |
|---|---|---|
| Framework | React | 19 |
| Language | TypeScript | 5 |
| Build tool | Vite | 7 |
| Styling | Tailwind CSS | v4 |
| UI primitives | Radix UI (unified) | 1.4 |
| Icons | Lucide React | 0.576 |
| Component variants | class-variance-authority | 0.7 |
| Server state | TanStack React Query | 5 |
| Forms | React Hook Form + Zod | 7 + 4 |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) | 2.98 |
| Routing | React Router DOM | 7 |
| Drag and drop | @dnd-kit | 6 |
| CSV parsing | PapaParse | 5 |
| Excel export | xlsx (SheetJS) | 0.18 |
| Unit/integration tests | Vitest + jsdom + MSW | 4 |
| E2E tests | Playwright | 1.59 |

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

React Query is configured globally with `staleTime: 5 min`, `gcTime: 10 min`, `retry: 3×`. Cache keys are centralized in `src/lib/query-keys.ts`.

### Workspace Isolation

Every database table has Row-Level Security (RLS) policies that restrict all reads and writes to rows belonging to the caller's `workspace_id`. A user can never see or mutate another workspace's data regardless of frontend code.

### Authentication

Nova PTO uses **Supabase magic link / OTP** — no passwords.

1. User enters their email on `/login`
2. Supabase sends a 6-digit OTP via email
3. User enters the code on `/check-email`
4. On first sign-in the **founder flow** auto-provisions:
   - A `workspaces` row
   - An `admin` profile
   - Default departments: Design, HR, Engineering, Product, Marketing
   - Default time-off categories: Vacation, Sick Leave, Personal, Bereavement, Other
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
│   │   └── layout/         # DashboardLayout, Sidebar
│   ├── hooks/              # TanStack Query wrappers (one file per domain)
│   ├── lib/                # Services, utilities, Zod schemas, constants
│   ├── contexts/           # AuthContext, NavigationGuardContext
│   ├── types/              # TypeScript interfaces
│   ├── data/               # Static datasets (cities.json ~500 entries, countries.ts with flags)
│   └── test/
│       ├── unit/           # Pure logic tests
│       ├── integration/    # Component-level tests with MSW
│       ├── security/       # RLS / privilege-escalation tests (real Supabase)
│       └── db/             # DB constraint and cascade tests
├── e2e/
│   ├── page-objects/       # Playwright page-object classes
│   └── fixtures/           # Shared test helpers (auth setup, test-data builders)
├── supabase/
│   ├── migrations/         # 20+ ordered SQL migration files
│   └── functions/          # 5 Deno Edge Functions
├── .env                    # Local environment variables (not committed)
├── .env.test               # Test credentials (not committed)
├── vitest.config.ts
└── playwright.config.ts
```

---

## Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- **Supabase CLI** — `npm install -g supabase`
- A Supabase project (cloud) **or** a local Supabase stack (`supabase start`)

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

`VITE_SITE_URL` is used as the base URL for auth redirect links. It defaults to `window.location.origin` if omitted.

### 3. Apply database migrations

```bash
# Against a remote project
supabase db push

# Or start a local Supabase stack first
supabase start
supabase db push --local
```

### 4. Start the dev server

```bash
npm run dev
```

The app is now running at `http://localhost:5173`. Sign in with any email — you will receive a 6-digit OTP and your workspace will be auto-created on first login.

---

## Environment Variables

### Application (`.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project REST/Auth endpoint |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) API key |
| `VITE_SITE_URL` | No | Base URL for magic link redirects |

### Tests (`.env.test`)

Required only for security and database tests that hit a real local Supabase instance.

| Variable | Description |
|---|---|
| `TEST_SUPABASE_URL` | Local Supabase URL (e.g. `http://127.0.0.1:54321`) |
| `TEST_SUPABASE_ANON_KEY` | Local anon key |
| `TEST_SUPABASE_SERVICE_ROLE_KEY` | Service-role key for privileged test operations |
| `PLAYWRIGHT_BASE_URL` | Optional override for E2E base URL |

---

## Available Scripts

```bash
# Development
npm run dev             # Start Vite dev server with HMR
npm run build           # Production build
npm run preview         # Preview production build locally
npm run lint            # Run ESLint

# Unit / integration / security tests (Vitest + jsdom)
npm test                # Run all Vitest tests once
npm run test:watch      # Vitest in watch mode
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

Nova PTO has four testing layers:

### Unit / Integration — `src/test/`

Run with **Vitest** + jsdom. The setup file (`src/test/setup.ts`) auto-mocks `@/lib/supabase` globally; individual tests override it as needed.

```bash
npm test
```

| Folder | What's inside |
|---|---|
| `src/test/unit/` | Pure logic — lib utils, hooks |
| `src/test/integration/` | Component-level tests with MSW API mocking |

### Security (RLS) — `src/test/security/`

Tests Supabase Row-Level Security policies and privilege-escalation scenarios. Requires a running local Supabase stack and `.env.test` credentials.

```bash
supabase start
npm run test:security
```

### Database — `src/test/db/`

Tests DB constraints, cascade deletes, and RPC functions directly.

```bash
npm run test:db
```

### End-to-End — `e2e/`

**Playwright** tests that run against the full app. The dev server starts automatically. Page-object classes live in `e2e/page-objects/`.

```bash
npm run test:e2e
npm run test:e2e:ui     # Interactive Playwright UI
```

---

## Database Schema

All tables are workspace-isolated via RLS. Migrations live in `supabase/migrations/`.

| Table | Key Columns |
|---|---|
| `workspaces` | `id`, `name`, `logo_url`, `owner_id` (unique), `created_at` |
| `profiles` | `id` (= auth user id), `workspace_id`, `role` (`admin\|user`), `email`, `first_name`, `last_name`, `avatar_url`, `status`, `department_id`, `location`, `hire_date` |
| `departments` | `id`, `workspace_id`, `name` |
| `time_off_requests` | `id`, `profile_id`, `workspace_id`, `category_id`, `start_date`, `end_date`, `start_period`, `end_period`, `total_days`, `status` (`pending\|approved\|rejected\|withdrawn`), `comment`, `rejection_reason` |
| `time_off_categories` | `id`, `workspace_id`, `name`, `emoji`, `colour`, `leave_type` (`paid\|unpaid`), `accrual_method`, `amount_value`, `granting_frequency`, `new_hire_rule`, `waiting_period_value`, `carryover_limit_enabled`, `carryover_max_days`, `sort_order` |
| `holidays` | `id`, `workspace_id`, `name`, `date`, `is_custom`, `country_code`, `year` |
| `employee_balances` | `id`, `employee_id`, `category_id`, `workspace_id`, `remaining_days` |
| `slack_installations` | `workspace_id`, `slack_team_id`, `bot_token` — Slack OAuth install data per workspace |
| `slack_user_mappings` | Maps Nova `profile_id` to Slack user IDs |
| `slack_interactions` | Idempotency tracking for Slack button interactions |
| `slack_dm_messages` | Per-admin DM channel/message references for in-place notification updates |

---

## Edge Functions

Deno-based functions deployed on Supabase Edge.

| Function | Description |
|---|---|
| `invite-employee` | Verifies admin JWT, creates auth user, inserts `profiles` row |
| `delete-workspace` | Full workspace teardown (cascade) |
| `slack-oauth` | Slack OAuth 2.0 callback — stores bot token in `slack_installations` |
| `slack-events` | Slack event webhook (URL verification + event dispatch); uses `slack_interactions` for idempotency |
| `slack-notify` | Sends/updates DM notifications to admins; tracks message refs in `slack_dm_messages` |

```bash
# Deploy a specific function
supabase functions deploy invite-employee

# Deploy all functions
supabase functions deploy
```

---

## Deployment

### Frontend

```bash
npm run build
```

Output is in `dist/`. Deploy to any static host (Vercel, Netlify, Cloudflare Pages). Vercel Speed Insights is already integrated via `@vercel/speed-insights`.

Set the production environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`) in your host's dashboard.

### Supabase

1. Push migrations to your production project:
   ```bash
   supabase db push
   ```
2. Deploy Edge Functions:
   ```bash
   supabase functions deploy
   ```
3. Configure **Auth → URL Configuration** in the Supabase dashboard:
   - Site URL: your production domain
   - Redirect URLs: `https://yourdomain.com/auth/callback`

---

## Key Conventions

- **Named exports** — all page components use named exports (`export function RequestsPage()`), not defaults.
- **Mode-based shared forms** — `employee-form.tsx` and `category-form.tsx` each accept a `mode: "add" | "edit"` prop and optional `initialData`, shared between Add and Edit pages.
- **Path alias** — `@/` maps to `src/`.
- **`cn()` utility** — use `cn()` from `src/lib/utils.ts` (`clsx` + `tailwind-merge`) for all conditional class names.
- **Radix UI** — import from the unified `radix-ui` package (`import { Tabs } from "radix-ui"`), not individual `@radix-ui/*` packages.
- **`data-slot` attributes** — all UI primitives carry `data-slot="<name>"` for identification and styling hooks.
- **No direct service calls in components** — pages and components consume hooks only; hooks call services; services call Supabase.
