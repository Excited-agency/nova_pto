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

## TanStack Query

- Cache keys: always use the factory in `src/lib/query-keys.ts` — never inline strings
- Global config in `src/App.tsx`: staleTime 5 min, gcTime 10 min, retry 3×
- Mutations always invalidate via `employeeKeys.all(workspace.id)` prefix — don't invalidate individual keys

## Auth

- No passwords — magic link OTP only
- Auth state: `useAuth()` → `{ user, session, workspace, profile, loading, signOut }`
- Admin check: `profile.role === "admin"` — never trust client-side role alone
- First sign-in: `runFounderFlow` auto-provisions workspace + profile (idempotent)

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
formatDate(dateString)             // from @/lib/date-utils
addToast({ title, description, variant })  // from @/lib/toast (pub-sub, not context)
```

## Edge Functions

Pattern: CORS preflight → verify JWT → check admin role → service role client → business logic.  
Always use `supabase.functions.invoke` from the frontend — never raw `fetch` with hardcoded URLs unless matching the existing `inviteEmployee`/`deleteEmployee` fetch pattern.

## Pages

- All page components: lazy-loaded via `React.lazy` + `Suspense` in `src/App.tsx`
- Route layout: `/` → `ProtectedRoute` → `DashboardLayout` → nested page via `<Outlet />`
- Admin-only routes wrapped in `<AdminRoute>` which redirects to `/access-restricted`
