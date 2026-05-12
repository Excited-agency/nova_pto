import { createClient } from "@supabase/supabase-js"
import { GoTrueAdminApi } from "@supabase/auth-js"
import type { Page } from "@playwright/test"

const SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? ""
const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ""

// Service-role client for DB operations (bypasses RLS)
export const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// GoTrueAdminApi for user management (createUser, deleteUser, generateLink)
const goTrueAdmin = new GoTrueAdminApi({
  url: `${SUPABASE_URL}/auth/v1`,
  headers: {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
  },
})

// Anon client used to exchange magic-link token for a real JWT (enforces RLS)
const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false },
})

export interface TestUser {
  userId: string
  workspaceId: string
  email: string
  role: "admin" | "user"
  accessToken: string
}

/**
 * Gets a real JWT for an existing user via magic-link flow (no password).
 */
async function getSessionForUser(email: string): Promise<string> {
  const { data: linkData, error: linkError } = await goTrueAdmin.generateLink({
    type: "magiclink",
    email,
  })
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink: ${linkError?.message}`)
  }

  const { data: sessionData, error: sessionError } = await anonClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  })
  if (sessionError || !sessionData.session) {
    throw new Error(`verifyOtp: ${sessionError?.message}`)
  }

  return sessionData.session.access_token
}

/**
 * Creates an isolated test user + workspace + session directly via service role.
 * Uses magic-link flow (no password) — consistent with how the app authenticates.
 * Injects the session token into the browser's localStorage so the app
 * treats the user as authenticated — no email / magic link required.
 */
export async function createTestUser(
  role: "admin" | "user" = "admin"
): Promise<TestUser> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `e2e-${tag}@test.invalid`
  const workspaceId = crypto.randomUUID()

  // 1. Create auth user (no password — app uses magic link)
  const { data: userData, error: userError } = await goTrueAdmin.createUser({
    email,
    email_confirm: true,
  })
  if (userError || !userData.user) throw new Error(`createUser: ${userError?.message}`)
  const userId = userData.user.id

  // 2. Create workspace + profile
  await adminClient.from("workspaces").insert({
    id: workspaceId,
    name: `E2E WS ${tag}`,
    owner_id: userId,
  })

  await adminClient.from("profiles").insert({
    id: userId,
    workspace_id: workspaceId,
    role,
    email,
    status: "active",
    first_name: role === "admin" ? "Admin" : "Employee",
    last_name: "Test",
  })

  // 3. Get real JWT via magic-link flow (enforces RLS)
  const accessToken = await getSessionForUser(email)

  return { userId, workspaceId, email, role, accessToken }
}

/**
 * Seeds the Supabase session into the browser's localStorage so that
 * the app's AuthProvider picks it up on the next navigation.
 */
export async function seedSession(page: Page, user: TestUser) {
  const hostname = new URL(SUPABASE_URL).hostname
  const prefix = hostname.includes("127.0.0.1") ? "127" : hostname.split(".")[0]
  const storageKey = `sb-${prefix}-auth-token`

  const sessionPayload = {
    access_token: user.accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "e2e-dummy-refresh",
    user: { id: user.userId, email: user.email, role: "authenticated" },
  }

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value))
    },
    { key: storageKey, value: sessionPayload }
  )
}

export async function cleanupTestUser(user: TestUser) {
  await adminClient.from("workspaces").delete().eq("id", user.workspaceId)
  await goTrueAdmin.deleteUser(user.userId).catch(() => {})
}

export async function deleteAuthUser(userId: string) {
  await goTrueAdmin.deleteUser(userId).catch(() => {})
}

/**
 * Creates an auth user without a session (useful when you just need a real
 * auth.users row for FK purposes, not an actual logged-in client).
 */
export async function createEphemeralAuthUser(email: string): Promise<string> {
  const { data, error } = await goTrueAdmin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw new Error(`createEphemeralAuthUser: ${error?.message}`)
  return data.user.id
}
