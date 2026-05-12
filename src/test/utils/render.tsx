import { render, type RenderOptions } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { AuthContext, type Profile } from "@/contexts/auth-context"
import type { ReactElement, ReactNode } from "react"
import type { User, Session } from "@supabase/supabase-js"

interface MockAuthState {
  user?: User | null
  session?: Session | null
  workspace?: { id: string; name: string; owner_id: string; logo_url?: string; created_at: string } | null
  profile?: Profile | null
  loading?: boolean
  authError?: string | null
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

interface TestWrapperOptions extends RenderOptions {
  auth?: MockAuthState
  initialPath?: string
}

export function renderWithProviders(ui: ReactElement, options: TestWrapperOptions = {}) {
  const {
    auth = {},
    initialPath = "/",
    ...renderOptions
  } = options

  const queryClient = makeQueryClient()

  const mockAuthValue = {
    user: auth.user ?? null,
    session: auth.session ?? null,
    workspace: auth.workspace ?? null,
    profile: auth.profile ?? null,
    loading: auth.loading ?? false,
    authError: auth.authError ?? null,
    signOut: (auth as any).signOut ?? vi.fn().mockResolvedValue(undefined),
    refreshWorkspace: (auth as any).refreshWorkspace ?? vi.fn().mockResolvedValue(undefined),
    refreshProfile: (auth as any).refreshProfile ?? vi.fn().mockResolvedValue(undefined),
    retryAuth: (auth as any).retryAuth ?? vi.fn(),
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthContext.Provider value={mockAuthValue}>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    )
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}

export function makeUser(overrides = {}): User {
  return {
    id: "user-123",
    email: "test@example.com",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as User
}

export function makeProfile(overrides = {}): Profile {
  return {
    id: "user-123",
    workspace_id: "ws-123",
    role: "admin",
    email: "test@example.com",
    first_name: "Test",
    last_name: "User",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Profile
}

export function makeWorkspace(overrides = {}) {
  return {
    id: "ws-123",
    name: "Test Workspace",
    owner_id: "user-123",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}
