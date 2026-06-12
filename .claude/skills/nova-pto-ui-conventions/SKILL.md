---
name: nova-pto-ui-conventions
description: Use when creating or editing any UI component, page, or layout in the Nova PTO project. Covers imports, Tailwind tokens, table borders, Radix, cva, and component naming.
---

# Nova PTO: UI Conventions

## Critical patterns

### Table borders (known visual bug)
Last row must NOT have a bottom border when the container already has one:
```tsx
const isLast = index === items.length - 1
<DataTableCell border={!isLast} />
// Also hide manual border-div in action columns for the last row
```

### Conditional classes
```ts
import { cn } from "@/lib/utils"   // clsx + tailwind-merge, always use this
```

### Component variants
```ts
import { cva } from "class-variance-authority"
```

### Identification attribute
Every UI primitive must have:
```tsx
data-slot="component-name"   // e.g. data-slot="button", data-slot="tabs-trigger"
```

### Radix — unified package only
```ts
import { Tabs, Slot, Dialog } from "radix-ui"
// NEVER: import * from "@radix-ui/react-tabs"
```

## Design tokens (src/index.css → @theme inline)

| Group | Tokens |
|-------|--------|
| Shadows | `shadow-2xs` `shadow-xs` `shadow-sm` `shadow-md` `shadow-lg` |
| Focus rings | `shadow-focus` `shadow-destructive-focus` `shadow-switch-focus` |
| Status colors | `color-success-*` `color-warning-*` `color-error-*` |
| Font | Instrument Sans (Google Fonts) |

## Layout

```
DashboardLayout: bg-sidebar-accent p-2 flex h-screen overflow-hidden
  ├─ Sidebar (260px, fixed width)
  └─ main: flex-1 overflow-y-auto rounded-xl bg-background
```

## Component naming

```tsx
// Named export only — no default exports
export function MyComponent() {}
```

## Quick reference

| What | Pattern |
|------|---------|
| Icons | `lucide-react` |
| Higher-level composites | Accept declarative `items` prop, wrap primitives |
| UI primitives location | `src/components/ui/` |
| Page components location | `src/pages/` |
| Path alias | `@/` → `src/` |
