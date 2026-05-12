import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  serviceClient,
  type IsolatedWorkspace,
} from "./helpers"

describe.skipIf(skipIfNoServiceKey())("Privilege escalation attempts (ESCALATION-1..4)", () => {

  let employee: IsolatedWorkspace

  beforeAll(async () => {
    employee = await createIsolatedWorkspace("user")
  }, 15_000)

  afterAll(async () => {
    await cleanupWorkspace(employee.workspaceId, employee.userId)
  }, 10_000)

  describe("ESCALATION-1: Direct role self-promotion blocked", () => {
    it("employee UPDATE role=admin via anon client is blocked", async () => {
      const { data } = await employee.userClient
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", employee.userId)
        .select("role")

      // Check DB directly
      const { data: db } = await serviceClient
        .from("profiles")
        .select("role")
        .eq("id", employee.userId)
        .single()
      expect(db?.role).toBe("user")
    })
  })

  describe("ESCALATION-2: No public RPC exposes role change", () => {
    it("No 'set_role' or 'promote_user' RPC exists", async () => {
      const { error: e1 } = await employee.userClient.rpc("set_role" as any, {
        p_user_id: employee.userId,
        p_role: "admin",
      })
      expect(e1).toBeTruthy()

      const { error: e2 } = await employee.userClient.rpc("promote_user" as any, {
        user_id: employee.userId,
      })
      expect(e2).toBeTruthy()
    })
  })

  describe("ESCALATION-3: Workspace owner_id cannot be transferred", () => {
    it("Any UPDATE to owner_id is rejected by trigger", async () => {
      const newOwnerId = crypto.randomUUID()
      const { error } = await employee.userClient
        .from("workspaces")
        .update({ owner_id: newOwnerId })
        .eq("id", employee.workspaceId)

      const { data: db } = await serviceClient
        .from("workspaces")
        .select("owner_id")
        .eq("id", employee.workspaceId)
        .single()
      expect(db?.owner_id).toBe(employee.userId)
    })
  })

  describe("ESCALATION-4: Service role trigger also blocks owner change", () => {
    it("Even service role cannot change owner_id via UPDATE (trigger fires for all)", async () => {
      const { error } = await serviceClient
        .from("workspaces")
        .update({ owner_id: crypto.randomUUID() })
        .eq("id", employee.workspaceId)

      // Trigger should block this
      const { data: db } = await serviceClient
        .from("workspaces")
        .select("owner_id")
        .eq("id", employee.workspaceId)
        .single()
      // Either error or unchanged owner_id
      expect(db?.owner_id).toBe(employee.userId)
    })
  })
})
