import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  type IsolatedWorkspace,
} from "./helpers"

describe.skipIf(skipIfNoServiceKey())("RLS — workspaces table (CRIT-8..11)", () => {

  let ownerA: IsolatedWorkspace
  let ownerB: IsolatedWorkspace
  let employeeInA: IsolatedWorkspace

  beforeAll(async () => {
    ;[ownerA, ownerB] = await Promise.all([
      createIsolatedWorkspace("admin"),
      createIsolatedWorkspace("admin"),
    ])
    // Create employee in workspace A
    employeeInA = await createIsolatedWorkspace("user")
    await serviceClient
      .from("profiles")
      .update({ workspace_id: ownerA.workspaceId })
      .eq("id", employeeInA.userId)
  }, 30_000)

  afterAll(async () => {
    await Promise.all([
      cleanupWorkspace(ownerA.workspaceId, ownerA.userId),
      cleanupWorkspace(ownerB.workspaceId, ownerB.userId),
    ])
    await deleteAuthUser(employeeInA.userId)
    await serviceClient.from("profiles").delete().eq("id", employeeInA.userId)
  }, 15_000)

  describe("CRIT-8: Cannot forge owner_id on workspace creation", () => {
    it("INSERT workspaces with owner_id=other is blocked", async () => {
      const fakeId = crypto.randomUUID()
      const { error } = await ownerA.userClient.from("workspaces").insert({
        id: fakeId,
        name: "Forged WS",
        owner_id: ownerB.userId,
      })
      expect(error).toBeTruthy()
      // Verify it doesn't exist
      const { data } = await serviceClient
        .from("workspaces")
        .select("id")
        .eq("id", fakeId)
        .maybeSingle()
      expect(data).toBeNull()
    })
  })

  describe("CRIT-9: workspace owner_id is immutable (trigger)", () => {
    it("UPDATE workspaces SET owner_id=other raises exception", async () => {
      const { error } = await ownerA.userClient
        .from("workspaces")
        .update({ owner_id: ownerB.userId })
        .eq("id", ownerA.workspaceId)

      expect(error).toBeTruthy()

      // Verify owner_id unchanged in DB
      const { data } = await serviceClient
        .from("workspaces")
        .select("owner_id")
        .eq("id", ownerA.workspaceId)
        .single()
      expect(data?.owner_id).toBe(ownerA.userId)
    })
  })

  describe("CRIT-10: Non-member cannot read workspace", () => {
    it("Admin A cannot read workspace B via member policy", async () => {
      const { data, error } = await ownerA.userClient
        .from("workspaces")
        .select("*")
        .eq("id", ownerB.workspaceId)

      expect(error).toBeNull()
      // Should return empty — no profile in workspace B means no member access
      // (Owner policy only applies to owner's own workspace)
      expect(data?.length ?? 0).toBe(0)
    })
  })

  describe("CRIT-11: Non-admin cannot update workspace", () => {
    it("Employee cannot UPDATE workspace name", async () => {
      const { error } = await employeeInA.userClient
        .from("workspaces")
        .update({ name: "Hacked Name" })
        .eq("id", ownerA.workspaceId)

      // Verify name unchanged
      const { data } = await serviceClient
        .from("workspaces")
        .select("name")
        .eq("id", ownerA.workspaceId)
        .single()
      expect(data?.name).not.toBe("Hacked Name")
    })
  })
})
