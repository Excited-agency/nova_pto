import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  serviceClient,
  deleteAuthUser,
  createAuthUserWithSession,
  type IsolatedWorkspace,
} from "./helpers"

describe.skipIf(skipIfNoServiceKey())("RLS — profiles table (security hardening CRIT-1..7)", () => {

  let adminA: IsolatedWorkspace
  let employeeA: IsolatedWorkspace
  let workspaceB: IsolatedWorkspace

  beforeAll(async () => {
    ;[adminA, employeeA, workspaceB] = await Promise.all([
      createIsolatedWorkspace("admin"),
      createIsolatedWorkspace("user"),
      createIsolatedWorkspace("admin"),
    ])
    // Move employeeA to adminA's workspace
    await serviceClient
      .from("profiles")
      .update({ workspace_id: adminA.workspaceId })
      .eq("id", employeeA.userId)
  }, 30_000)

  afterAll(async () => {
    await Promise.all([
      cleanupWorkspace(adminA.workspaceId, adminA.userId),
      cleanupWorkspace(workspaceB.workspaceId, workspaceB.userId),
    ])
    // employeeA is in adminA's workspace now — cleanup manually
    await deleteAuthUser(employeeA.userId)
    await serviceClient.from("profiles").delete().eq("id", employeeA.userId)
  }, 15_000)

  describe("CRIT-1: Employee cannot self-promote to admin", () => {
    it("UPDATE profiles SET role=admin is blocked by WITH CHECK (get_my_role)", async () => {
      const { data, error } = await employeeA.userClient
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", employeeA.userId)
        .select()

      // Either error returned or data is empty (RLS blocks silently)
      const updated = data?.[0]
      expect(updated?.role).not.toBe("admin")
      // Verify in DB via service role
      const { data: dbProfile } = await serviceClient
        .from("profiles")
        .select("role")
        .eq("id", employeeA.userId)
        .single()
      expect(dbProfile?.role).toBe("user")
    })
  })

  describe("CRIT-2: Employee cannot change their own workspace_id", () => {
    it("UPDATE profiles SET workspace_id=B is blocked", async () => {
      const { data } = await employeeA.userClient
        .from("profiles")
        .update({ workspace_id: workspaceB.workspaceId })
        .eq("id", employeeA.userId)
        .select()

      const { data: dbProfile } = await serviceClient
        .from("profiles")
        .select("workspace_id")
        .eq("id", employeeA.userId)
        .single()
      expect(dbProfile?.workspace_id).toBe(adminA.workspaceId)
    })
  })

  describe("CRIT-3: User cannot insert profile into foreign workspace", () => {
    it("INSERT into workspace owned by another user is blocked", async () => {
      const foreignEmail = `foreign-${Date.now()}@test.invalid`
      // Create a new auth user and get real JWT via magic-link flow (no password)
      const { userId: newUserId, accessToken } = await createAuthUserWithSession(foreignEmail)

      const { createClient } = await import("@supabase/supabase-js")
      const newClient = createClient(
        process.env.TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
        process.env.TEST_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "",
        { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      )

      // Try to insert self into adminA's workspace (not owned by newUser)
      const { error } = await newClient.from("profiles").insert({
        id: newUserId,
        workspace_id: adminA.workspaceId,
        role: "admin",
        email: foreignEmail,
        status: "active",
      })

      expect(error).toBeTruthy()

      // Cleanup
      await deleteAuthUser(newUserId)
      await serviceClient.from("profiles").delete().eq("id", newUserId)
    })
  })

  describe("CRIT-4: Admin cannot transfer employee to foreign workspace", () => {
    it("Admin UPDATE profiles SET workspace_id=foreign is blocked", async () => {
      const { data } = await adminA.userClient
        .from("profiles")
        .update({ workspace_id: workspaceB.workspaceId })
        .eq("id", employeeA.userId)
        .select()

      const { data: dbProfile } = await serviceClient
        .from("profiles")
        .select("workspace_id")
        .eq("id", employeeA.userId)
        .single()
      expect(dbProfile?.workspace_id).toBe(adminA.workspaceId)
    })
  })

  describe("CRIT-5: Cross-workspace profile read is blocked", () => {
    it("User in workspace A cannot read profiles from workspace B", async () => {
      const { data, error } = await adminA.userClient
        .from("profiles")
        .select("*")
        .eq("workspace_id", workspaceB.workspaceId)

      // RLS should return empty rows (not an error)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  describe("CRIT-6: Same-workspace profile read IS allowed (by design)", () => {
    it("Employee can read all profiles in their workspace", async () => {
      const { data, error } = await employeeA.userClient
        .from("profiles")
        .select("id, role, email")
        .eq("workspace_id", adminA.workspaceId)

      expect(error).toBeNull()
      expect(data?.length).toBeGreaterThan(0)
      expect(data?.some(p => p.id === adminA.userId)).toBe(true)
    })
  })
})
