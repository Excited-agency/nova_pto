import { createClient } from "@supabase/supabase-js"
import { GoTrueAdminApi } from "@supabase/auth-js"

const TEST_URL = process.env.TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ""
const TEST_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ""
const SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? ""

if (!SERVICE_KEY) {
  console.warn("[security-tests] TEST_SUPABASE_SERVICE_ROLE_KEY not set — tests will be skipped")
}

export const serviceClient = createClient(TEST_URL, SERVICE_KEY || "dummy", {
  auth: { persistSession: false },
})

// Direct GoTrue admin API (createUser, deleteUser, generateLink)
const goTrueAdmin = new GoTrueAdminApi({
  url: `${TEST_URL}/auth/v1`,
  headers: {
    Authorization: `Bearer ${SERVICE_KEY || "dummy"}`,
    apikey: SERVICE_KEY || "dummy",
  },
})

// Anon client used to exchange magic-link token for a real JWT (enforces RLS)
const anonClient = createClient(TEST_URL, TEST_ANON_KEY || "dummy", {
  auth: { persistSession: false },
})

export interface IsolatedWorkspace {
  userId: string
  workspaceId: string
  email: string
  role: "admin" | "user"
  userClient: ReturnType<typeof createClient>
  accessToken: string
}

/**
 * Gets a real JWT for an existing user via magic-link flow (no password).
 * Uses generateLink (admin API) + verifyOtp to exchange the token for a session.
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
 * Creates a fully isolated test workspace + user.
 * Uses magic-link flow (no password) to get a real JWT that enforces RLS.
 */
export async function createIsolatedWorkspace(
  role: "admin" | "user" = "admin"
): Promise<IsolatedWorkspace> {
  if (!SERVICE_KEY) throw new Error("SERVICE_KEY not set — cannot run security tests")

  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `test-${tag}@test.invalid`
  const workspaceId = crypto.randomUUID()

  // 1. Create auth user (no password — app uses magic link)
  const { data: userData, error: userError } = await goTrueAdmin.createUser({
    email,
    email_confirm: true,
  })
  if (userError || !userData.user) throw new Error(`createUser: ${userError?.message}`)
  const userId = userData.user.id

  // 2. Create workspace
  const { error: wsError } = await serviceClient
    .from("workspaces")
    .insert({ id: workspaceId, name: `Test WS ${tag}`, owner_id: userId })
  if (wsError) throw new Error(`createWorkspace: ${wsError.message}`)

  // 3. Create profile
  const { error: profileError } = await serviceClient.from("profiles").insert({
    id: userId,
    workspace_id: workspaceId,
    role,
    email,
    status: "active",
    first_name: role === "admin" ? "TestAdmin" : "TestEmployee",
    last_name: "User",
  })
  if (profileError) throw new Error(`createProfile: ${profileError.message}`)

  // 4. Get real JWT via magic-link flow (enforces RLS)
  const accessToken = await getSessionForUser(email)

  // 5. Build user-scoped client (enforces RLS)
  const userClient = createClient(TEST_URL, TEST_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  return { userId, workspaceId, email, role, userClient, accessToken }
}

export async function cleanupWorkspace(workspaceId: string, userId: string) {
  await serviceClient.from("workspaces").delete().eq("id", workspaceId)
  await goTrueAdmin.deleteUser(userId).catch(() => {})
}

/** Convenience wrapper — replaces serviceClient.auth.admin.deleteUser everywhere */
export async function deleteAuthUser(userId: string) {
  await goTrueAdmin.deleteUser(userId).catch(() => {})
}

/**
 * Creates an auth user and gets a real JWT via magic-link flow (no password).
 * Used by CRIT-3 to create a foreign user with a real session.
 */
export async function createAuthUserWithSession(email: string) {
  const { data: userData, error: userError } = await goTrueAdmin.createUser({
    email,
    email_confirm: true,
  })
  if (userError || !userData.user) throw new Error(`createUser: ${userError?.message}`)
  const userId = userData.user.id

  const accessToken = await getSessionForUser(email)
  return { userId, accessToken }
}

export async function seedPendingRequest(
  employeeId: string,
  workspaceId: string,
  opts: { categoryId?: string } = {}
) {
  const { data, error } = await serviceClient.from("time_off_requests").insert({
    profile_id: employeeId,
    workspace_id: workspaceId,
    employee_name: "Test Employee",
    employee_email: "emp@test.invalid",
    start_date: "2026-06-01",
    end_date: "2026-06-05",
    start_period: "morning",
    end_period: "end_of_day",
    total_days: 5,
    request_type: "vacation",
    status: "pending",
    category_id: opts.categoryId ?? null,
  }).select().single()

  if (error) throw new Error(`seedPendingRequest: ${error.message}`)
  return data
}

export function skipIfNoServiceKey() {
  if (!SERVICE_KEY) {
    console.warn("Skipping — TEST_SUPABASE_SERVICE_ROLE_KEY not set")
    return true
  }
  return false
}
