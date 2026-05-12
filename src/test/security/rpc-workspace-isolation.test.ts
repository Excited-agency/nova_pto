import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  seedPendingRequest,
  type IsolatedWorkspace,
} from "./helpers"

describe.skipIf(skipIfNoServiceKey())("RPC workspace isolation (CRIT-17..22)", () => {

  let adminA: IsolatedWorkspace
  let adminB: IsolatedWorkspace
  let employeeInA: IsolatedWorkspace
  let pendingRequestInA: { id: string }

  beforeAll(async () => {
    ;[adminA, adminB] = await Promise.all([
      createIsolatedWorkspace("admin"),
      createIsolatedWorkspace("admin"),
    ])
    employeeInA = await createIsolatedWorkspace("user")
    await serviceClient
      .from("profiles")
      .update({ workspace_id: adminA.workspaceId })
      .eq("id", employeeInA.userId)

    pendingRequestInA = await seedPendingRequest(employeeInA.userId, adminA.workspaceId)
  }, 30_000)

  afterAll(async () => {
    await Promise.all([
      cleanupWorkspace(adminA.workspaceId, adminA.userId),
      cleanupWorkspace(adminB.workspaceId, adminB.userId),
    ])
    await deleteAuthUser(employeeInA.userId)
    await serviceClient.from("profiles").delete().eq("id", employeeInA.userId)
  }, 15_000)

  describe("CRIT-17: approve_time_off_request cross-workspace blocked", () => {
    it("Admin B cannot approve request in workspace A", async () => {
      const { error } = await adminB.userClient
        .rpc("approve_time_off_request", { p_request_id: pendingRequestInA.id })

      expect(error).toBeTruthy()
      expect(error!.message.toLowerCase()).toMatch(/permission denied|workspace/i)

      // Verify request still pending
      const { data } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", pendingRequestInA.id)
        .single()
      expect(data?.status).toBe("pending")
    })
  })

  describe("CRIT-18: approve_time_off_request non-admin blocked", () => {
    it("Employee cannot call approve_time_off_request", async () => {
      const { error } = await employeeInA.userClient
        .rpc("approve_time_off_request", { p_request_id: pendingRequestInA.id })

      expect(error).toBeTruthy()
      expect(error!.message.toLowerCase()).toMatch(/permission denied|admin/i)
    })
  })

  describe("CRIT-19: replace_imported_holidays cross-workspace blocked", () => {
    it("Admin A cannot replace holidays in workspace B", async () => {
      const { error } = await adminA.userClient.rpc("replace_imported_holidays", {
        p_workspace_id: adminB.workspaceId,
        p_holidays: [],
      })

      expect(error).toBeTruthy()
      expect(error!.message.toLowerCase()).toMatch(/permission denied|workspace/i)
    })
  })

  describe("CRIT-20: create_time_off_record cross-workspace blocked", () => {
    it("Admin A cannot create record in workspace B", async () => {
      const { error } = await adminA.userClient.rpc("create_time_off_record", {
        p_workspace_id: adminB.workspaceId,
        p_employee_id: adminB.userId,
        p_category_id: null,
        p_start_date: "2026-09-01",
        p_end_date: "2026-09-01",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_request_type: "vacation",
        p_comment: null,
      })

      expect(error).toBeTruthy()
      expect(error!.message.toLowerCase()).toMatch(/permission denied|workspace|not found/i)
    })
  })

  describe("CRIT-22: reject_time_off_request non-admin blocked", () => {
    it("Employee cannot call reject_time_off_request", async () => {
      const { error } = await employeeInA.userClient.rpc("reject_time_off_request", {
        p_request_id: pendingRequestInA.id,
        p_rejection_reason: "Test rejection",
      })

      expect(error).toBeTruthy()
      expect(error!.message.toLowerCase()).toMatch(/permission denied|admin/i)

      // Verify request still pending
      const { data } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", pendingRequestInA.id)
        .single()
      expect(data?.status).toBe("pending")
    })
  })
})
