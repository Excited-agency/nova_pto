import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  type IsolatedWorkspace,
} from "./helpers"

const SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ""
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`

async function callEdgeFunction(name: string, body: object, authToken?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

describe.skipIf(skipIfNoServiceKey())("Edge Function auth (EF-1..11)", () => {

  let admin: IsolatedWorkspace
  let employee: IsolatedWorkspace

  beforeAll(async () => {
    ;[admin, employee] = await Promise.all([
      createIsolatedWorkspace("admin"),
      createIsolatedWorkspace("user"),
    ])
    // Move employee into admin's workspace
    await serviceClient
      .from("profiles")
      .update({ workspace_id: admin.workspaceId })
      .eq("id", employee.userId)
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 15_000)

  describe("invite-employee edge function", () => {
    it("EF-1: no Authorization header → 401", async () => {
      const { status } = await callEdgeFunction("invite-employee", {
        email: "new@test.invalid",
        role: "user",
        hire_date: "2026-01-01",
        redirect_url: "http://localhost:5173",
      })
      expect(status).toBe(401)
    })

    it("EF-2: invalid JWT → 401", async () => {
      const { status } = await callEdgeFunction(
        "invite-employee",
        { email: "new@test.invalid", role: "user", hire_date: "2026-01-01", redirect_url: "http://localhost:5173" },
        "invalid.jwt.token"
      )
      expect(status).toBe(401)
    })

    it("EF-3: employee JWT (non-admin) → 403", async () => {
      const { status, body } = await callEdgeFunction(
        "invite-employee",
        { email: "new@test.invalid", role: "user", hire_date: "2026-01-01", redirect_url: "http://localhost:5173" },
        employee.accessToken
      )
      expect(status).toBe(403)
    })

    it("EF-4: admin JWT + valid body → 200 and profile created", async () => {
      const testEmail = `invited-${Date.now()}@test.invalid`
      const { status, body } = await callEdgeFunction(
        "invite-employee",
        {
          email: testEmail,
          role: "user",
          hire_date: "2026-01-01",
          redirect_url: "http://localhost:5173",
        },
        admin.accessToken
      )
      expect(status).toBe(200)

      // Cleanup invited user
      if (body?.user_id) {
        await deleteAuthUser(body.user_id)
        await serviceClient.from("profiles").delete().eq("id", body.user_id)
      } else {
        // Find by email
        const { data: profile } = await serviceClient
          .from("profiles")
          .select("id")
          .eq("email", testEmail)
          .maybeSingle()
        if (profile?.id) {
          await deleteAuthUser(profile.id)
          await serviceClient.from("profiles").delete().eq("id", profile.id)
        }
      }
    })

    it("EF-5: duplicate email → 409 or 400", async () => {
      const { status } = await callEdgeFunction(
        "invite-employee",
        {
          email: employee.email,
          role: "user",
          hire_date: "2026-01-01",
          redirect_url: "http://localhost:5173",
        },
        admin.accessToken
      )
      expect([400, 409]).toContain(status)
    })

    it("EF-6: invalid email format → 400", async () => {
      const { status } = await callEdgeFunction(
        "invite-employee",
        { email: "notanemail", role: "user", hire_date: "2026-01-01", redirect_url: "http://localhost:5173" },
        admin.accessToken
      )
      expect(status).toBe(400)
    })
  })

  describe("delete-workspace edge function", () => {
    it("EF-8: no Authorization → 401", async () => {
      const { status } = await callEdgeFunction("delete-workspace", {
        workspace_id: admin.workspaceId,
        confirmation_name: "Test WS",
      })
      expect(status).toBe(401)
    })

    it("EF-9: non-owner JWT → 403", async () => {
      const { status } = await callEdgeFunction(
        "delete-workspace",
        { workspace_id: admin.workspaceId, confirmation_name: "Test WS" },
        employee.accessToken
      )
      expect(status).toBe(403)
    })

    it("EF-10: wrong confirmation_name → 400", async () => {
      const { status } = await callEdgeFunction(
        "delete-workspace",
        { workspace_id: admin.workspaceId, confirmation_name: "Wrong Name" },
        admin.accessToken
      )
      expect(status).toBe(400)
    })
  })
})
