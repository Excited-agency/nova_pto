import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  type IsolatedWorkspace,
} from "./helpers"

describe.skipIf(skipIfNoServiceKey())("RLS — balance_adjustment_log table (CRIT-BL1..BL4)", () => {

  let admin: IsolatedWorkspace
  let employeeA: IsolatedWorkspace
  let employeeB: IsolatedWorkspace
  let foreignWs: IsolatedWorkspace
  let categoryId: string
  let foreignCategoryId: string
  let logForA: string
  let logForB: string
  let logInForeignWs: string

  beforeAll(async () => {
    ;[admin, foreignWs] = await Promise.all([
      createIsolatedWorkspace("admin"),
      createIsolatedWorkspace("admin"),
    ])
    ;[employeeA, employeeB] = await Promise.all([
      createIsolatedWorkspace("user"),
      createIsolatedWorkspace("user"),
    ])

    // Move both employees into admin's workspace
    await serviceClient
      .from("profiles")
      .update({ workspace_id: admin.workspaceId })
      .in("id", [employeeA.userId, employeeB.userId])

    const insertCategory = (workspaceId: string) =>
      serviceClient
        .from("time_off_categories")
        .insert({
          workspace_id: workspaceId,
          name: "Vacation",
          colour: "green",
          is_active: true,
          leave_type: "paid",
          accrual_method: "fixed",
          amount_value: 20,
          granting_frequency: "yearly",
          new_hire_rule: "immediate",
          waiting_period_value: 0,
          waiting_period_unit: "month",
          carryover_limit_enabled: false,
          sort_order: 0,
        })
        .select("id")
        .single()

    const [catAdmin, catForeign] = await Promise.all([
      insertCategory(admin.workspaceId),
      insertCategory(foreignWs.workspaceId),
    ])
    categoryId = catAdmin.data!.id
    foreignCategoryId = catForeign.data!.id

    // Insert log rows directly via service client (bypasses RLS, seeds test data)
    const insertLog = (employeeId: string, catId: string, workspaceId: string, adjustedBy: string) =>
      serviceClient
        .from("balance_adjustment_log")
        .insert({
          employee_id: employeeId,
          category_id: catId,
          workspace_id: workspaceId,
          delta: 5,
          balance_before: 10,
          balance_after: 15,
          reason: "manual_adjustment",
          adjusted_by: adjustedBy,
        })
        .select("id")
        .single()

    const [logA, logB, logForeign] = await Promise.all([
      insertLog(employeeA.userId, categoryId, admin.workspaceId, admin.userId),
      insertLog(employeeB.userId, categoryId, admin.workspaceId, admin.userId),
      insertLog(foreignWs.userId, foreignCategoryId, foreignWs.workspaceId, foreignWs.userId),
    ])
    logForA = logA.data!.id
    logForB = logB.data!.id
    logInForeignWs = logForeign.data!.id
  }, 30_000)

  afterAll(async () => {
    await Promise.all([
      cleanupWorkspace(admin.workspaceId, admin.userId),
      cleanupWorkspace(foreignWs.workspaceId, foreignWs.userId),
    ])
    await Promise.all([
      deleteAuthUser(employeeA.userId),
      deleteAuthUser(employeeB.userId),
    ])
    await serviceClient.from("profiles").delete().in("id", [employeeA.userId, employeeB.userId])
  }, 15_000)

  describe("CRIT-BL1: employee can SELECT their own balance_adjustment_log rows", () => {
    it("employee A sees their own log row", async () => {
      const { data, error } = await employeeA.userClient
        .from("balance_adjustment_log")
        .select("*")
        .eq("id", logForA)

      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].employee_id).toBe(employeeA.userId)
    })
  })

  describe("CRIT-BL2: employee cannot SELECT another employee's log rows", () => {
    it("employee A sees 0 rows when querying employee B's log", async () => {
      const { data, error } = await employeeA.userClient
        .from("balance_adjustment_log")
        .select("*")
        .eq("id", logForB)

      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  describe("CRIT-BL3: admin can SELECT all log rows in their workspace", () => {
    it("admin sees log rows for both employees", async () => {
      const { data, error } = await admin.userClient
        .from("balance_adjustment_log")
        .select("*")
        .in("id", [logForA, logForB])

      expect(error).toBeNull()
      expect(data).toHaveLength(2)
    })
  })

  describe("CRIT-BL4: admin cannot SELECT log rows from a foreign workspace", () => {
    it("admin sees 0 rows when querying a foreign workspace's log", async () => {
      const { data, error } = await admin.userClient
        .from("balance_adjustment_log")
        .select("*")
        .eq("id", logInForeignWs)

      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })
})
