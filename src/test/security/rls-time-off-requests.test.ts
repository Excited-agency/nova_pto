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

describe.skipIf(skipIfNoServiceKey())("RLS — time_off_requests table (CRIT-12..16)", () => {

  let adminA: IsolatedWorkspace
  let employeeA: IsolatedWorkspace
  let employeeB: IsolatedWorkspace
  let workspaceB: IsolatedWorkspace
  let pendingRequestA: { id: string }
  let pendingRequestB: { id: string }

  beforeAll(async () => {
    ;[adminA, workspaceB] = await Promise.all([
      createIsolatedWorkspace("admin"),
      createIsolatedWorkspace("admin"),
    ])
    ;[employeeA, employeeB] = await Promise.all([
      createIsolatedWorkspace("user"),
      createIsolatedWorkspace("user"),
    ])

    // Move both employees to workspace A
    await serviceClient
      .from("profiles")
      .update({ workspace_id: adminA.workspaceId })
      .in("id", [employeeA.userId, employeeB.userId])

    // Seed pending requests
    ;[pendingRequestA, pendingRequestB] = await Promise.all([
      seedPendingRequest(employeeA.userId, adminA.workspaceId),
      seedPendingRequest(employeeB.userId, adminA.workspaceId),
    ])
  }, 30_000)

  afterAll(async () => {
    await Promise.all([
      cleanupWorkspace(adminA.workspaceId, adminA.userId),
      cleanupWorkspace(workspaceB.workspaceId, workspaceB.userId),
    ])
    await Promise.all([
      deleteAuthUser(employeeA.userId),
      deleteAuthUser(employeeB.userId),
    ])
    await serviceClient.from("profiles").delete().in("id", [employeeA.userId, employeeB.userId])
  }, 15_000)

  describe("CRIT-12: admin_insert cannot link foreign profile_id", () => {
    it("Admin A cannot create request with profile_id from workspace B", async () => {
      const { error } = await adminA.userClient.from("time_off_requests").insert({
        profile_id: workspaceB.userId,
        workspace_id: adminA.workspaceId,
        employee_name: "Hacker",
        employee_email: "hacker@test.invalid",
        start_date: "2026-07-01",
        end_date: "2026-07-01",
        start_period: "morning",
        end_period: "end_of_day",
        total_days: 1,
        request_type: "vacation",
        status: "pending",
      })
      expect(error).toBeTruthy()
    })
  })

  describe("CRIT-13: Employee cannot insert request for another employee", () => {
    it("Employee A cannot create request with profile_id=Employee B", async () => {
      const { error } = await employeeA.userClient.from("time_off_requests").insert({
        profile_id: employeeB.userId,
        workspace_id: adminA.workspaceId,
        employee_name: "Impersonating B",
        employee_email: "b@test.invalid",
        start_date: "2026-07-10",
        end_date: "2026-07-10",
        start_period: "morning",
        end_period: "end_of_day",
        total_days: 1,
        request_type: "vacation",
        status: "pending",
      })
      expect(error).toBeTruthy()
    })
  })

  describe("CRIT-14: Cross-workspace request read blocked", () => {
    it("Employee in workspace A sees 0 requests from workspace B", async () => {
      const { data, error } = await employeeA.userClient
        .from("time_off_requests")
        .select("*")
        .eq("workspace_id", workspaceB.workspaceId)

      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  describe("CRIT-15: Employee cannot delete other employee's requests", () => {
    it("Employee A cannot delete Employee B's pending request", async () => {
      const { data } = await employeeA.userClient
        .from("time_off_requests")
        .delete()
        .eq("id", pendingRequestB.id)
        .select()

      // Should not delete (0 rows affected)
      expect(data).toHaveLength(0)

      // Verify B's request still exists
      const { data: dbReq } = await serviceClient
        .from("time_off_requests")
        .select("id")
        .eq("id", pendingRequestB.id)
        .single()
      expect(dbReq?.id).toBe(pendingRequestB.id)
    })
  })

  describe("CRIT-16: employee_balances cross-workspace read blocked", () => {
    it("User in workspace A cannot read balances from workspace B", async () => {
      const { data, error } = await employeeA.userClient
        .from("employee_balances")
        .select("*")
        .eq("workspace_id", workspaceB.workspaceId)

      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  describe("Employee self-service: can create own requests", () => {
    it("Employee A can create their own request", async () => {
      const { data, error } = await employeeA.userClient.from("time_off_requests").insert({
        profile_id: employeeA.userId,
        workspace_id: adminA.workspaceId,
        employee_name: "Employee A",
        employee_email: employeeA.email,
        start_date: "2026-08-01",
        end_date: "2026-08-01",
        start_period: "morning",
        end_period: "end_of_day",
        total_days: 1,
        request_type: "vacation",
        status: "pending",
      }).select().single()

      expect(error).toBeNull()
      expect(data?.profile_id).toBe(employeeA.userId)

      // Cleanup
      await serviceClient.from("time_off_requests").delete().eq("id", data!.id)
    })
  })
})
