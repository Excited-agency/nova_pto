---
name: project-conventions
description: Nova PTO project conventions, architecture rules, and coding patterns. Claude-only background knowledge — auto-loaded when working in this repo to prevent drift from established patterns.
user-invocable: false
---

# Nova PTO Project Conventions

## Architecture: Services → Hooks → Components

**The rule is strict — never skip a layer:**

- **Services** (`src/lib/*-service.ts`) — raw Supabase calls, no React, no state
- **Hooks** (`src/hooks/use-*.ts`) — wrap services in TanStack Query; components call hooks only
- **Components/Pages** — consume hooks only, never import from `*-service.ts` directly

```ts
// ✅ correct
const { data } = useEmployeeList("active")

// ❌ wrong — never call services from components
const data = await fetchEmployees(workspaceId, "active")
```

Data access (`supabase.from`, `supabase.rpc`) belongs in `src/lib/*-service.ts`.
Auth pages are not an exception — they go through `auth-service.ts`.

Two things legitimately sit outside that, and nothing else should:

- `founder-flow.ts` and `default-categories.ts` write via `supabase.from(...)` —
  one-shot provisioning at first sign-in, not a queryable domain.
- `auth-context.tsx` and `App.tsx` touch `supabase.auth.*` only, for the session
  and `onAuthStateChange` subscriptions. A service cannot own a subscription's
  lifetime, so this stays in the context.

If you are adding a third exception, you are almost certainly missing a service.

## Roles: there are three, and admin checks must include owner

```ts
// ✅ correct — every real check in the codebase looks like this
const isAdmin = profile?.role === "admin" || profile?.role === "owner"

// ❌ wrong — locks the workspace owner out of their own admin screens
const isAdmin = profile?.role === "admin"
```

`owner` is a strictly-greater role than `admin`, not a sibling: the owner can
delete the workspace and cannot be deactivated or deleted by an admin. On the
database side `is_workspace_admin()` returns true for both. See `admin-route.tsx`
for the canonical client-side gate.

Where a role is being *assigned* rather than *checked*, the type must exclude
`owner` (`role: "admin" | "user"`) — a workspace has exactly one owner and it is
set at provisioning time.

## Imports

- Radix UI: `import { Tabs, Slot, Dialog } from "radix-ui"` — **never** `@radix-ui/*` packages
- Path alias: `@/` → `src/`  (e.g. `import { cn } from "@/lib/utils"`)
- Icons: `lucide-react` only

## Classnames

Always use `cn()` from `@/lib/utils` (clsx + tailwind-merge). Never concatenate strings.

```ts
className={cn("base-class", condition && "conditional-class", className)}
```

## Component patterns

- **Named exports only**: `export function MyComponent()` — never `export default`
- **UI primitives** must have a `data-slot="<name>"` attribute for identification
- **Variants** use `cva` from `class-variance-authority`
- **`Button`** has a `loading` prop — shows spinner and disables interaction
- **Higher-level composites** wrap primitives and accept declarative `items` prop
- **Icon-only buttons need an explicit `aria-label`** — without it the control has
  no accessible name at all, so it is unreachable by screen reader and by test.
  Include the row's subject in the label so each one is uniquely addressable
  (`aria-label={\`Approve request from ${req.employee_name}\`}`).

## TanStack Query

- Cache keys: always use the factory in `src/lib/query-keys.ts` — never inline strings
- Global config in `src/App.tsx`: `staleTime` 5 min, `gcTime` 10 min,
  `refetchOnWindowFocus: false`, and a retry **predicate** — 401/403/404 never
  retry, anything else up to 3 attempts with capped exponential backoff
- Mutations must invalidate **every** affected key family, not just the obvious
  one. Cross-reference `query-keys.ts`; e.g. approving a request touches
  `timeOffRequestKeys`, `myRequestKeys`, `employeeBalanceKeys` and
  `balanceAdjustmentLogKeys`.
- Optimistic `setQueryData` updaters must match the shape the `queryFn` stored,
  **not** what the component sees — a hook's `select` runs on read only. Use the
  helpers in `src/lib/query-cache-utils.ts` (`removeFromListCache`,
  `removeFromPaginatedCache`) rather than inlining a filter, because a shape
  mismatch throws synchronously inside the click handler and silently prevents
  the mutation from firing at all.

## Auth

- No passwords — magic link OTP only
- `useAuth()` → `{ user, session, workspace, profile, loading, authError,
  retryAuth, signOut, refreshWorkspace, refreshProfile }`
- Role gates exist in three places and must agree: `AdminRoute`, the rendered
  page component, and the RLS policy / RPC. Never trust the client alone.
- First sign-in: `runFounderFlow` auto-provisions workspace + profile (idempotent)

## Server owns the rules

Business rules that protect data live in the database, not the client:
request writes go through RPCs, balances are only ever written by the three
balance-writing RPCs, and overlap is enforced by a trigger plus an EXCLUDE
constraint. Client-side checks exist to give a better message *before* Submit —
they are never the enforcement point, and removing one must not make an invalid
write possible.

## Styling

- Tailwind v4 with CSS custom properties in `src/index.css`
- Design tokens mapped via `@theme inline` — use token names, not raw hex values
- Font: Instrument Sans (Google Fonts)
- Shadows: `shadow-focus`, `shadow-xs`, `shadow-sm`, `shadow-md` — from design system

## Utility functions

```ts
cn(…)                              // classnames
getInitials(firstName, lastName)   // → "JD"
getDisplayName(firstName, lastName)// → "John Doe" or falls back gracefully
formatDate(dateStr)                // from @/lib/date-utils
addToast({ title, description, variant })  // from @/lib/toast (pub-sub, not context)
```

Date strings from the database are `YYYY-MM-DD`. Parse them with
`parseDateLocal` from `@/lib/date-utils`, or append an explicit `Z` when
constructing a Date directly — `new Date(s + "T00:00:00")` is a local-timezone
off-by-one waiting to happen.

## Edge Functions

Pattern: CORS preflight → verify JWT → check admin role → service role client → business logic.
Always use `supabase.functions.invoke` from the frontend — never raw `fetch` with hardcoded URLs unless matching the existing `inviteEmployee`/`deleteEmployee` fetch pattern.

Multi-step functions must be atomic: either wrap the whole thing in one RPC, or
have explicit rollback. Never leave an orphaned auth user or a half-deleted
workspace.

## Pages

- All page components: lazy-loaded via `React.lazy` + `Suspense` in `src/App.tsx`
- Route layout: `/` → `ProtectedRoute` → `DashboardLayout` → nested page via `<Outlet />`
- Admin-only routes wrapped in `<AdminRoute>` which redirects to `/access-restricted`
- Two routes resolve by role at render time rather than by path: `requests`
  (`RequestsPage` / `EmployeeRequestsPage`) and `settings`
  (`SettingsPage` / `UserSettingsPage`)
