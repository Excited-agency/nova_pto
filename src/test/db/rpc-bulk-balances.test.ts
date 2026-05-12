import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  type IsolatedWorkspace,
} from "../security/helpers"

describe.skipIf(skipIfNoServiceKey())("RPC: bulk_update_employee_balances (DB-14..17)", () => {

  let admin: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let catA: string
  let catB: string

  beforeAll(async () => {
    admin = await createIsolatedWorkspace("admin")
    employee = await createIsolatedWorkspace("user")

    await serviceClient
      .from("profiles")
      .update({ workspace_id: admin.workspaceId })
      .eq("id", employee.userId)

    const { data: categories } = await serviceClient
      .from("time_off_categories")
      .insert([
        {
          workspace_id: admin.workspaceId,
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
        },
        {
          workspace_id: admin.workspaceId,
          name: "Personal",
          colour: "blue",
          is_active: true,
          leave_type: "paid",
          accrual_method: "fixed",
          amount_value: 5,
          granting_frequency: "yearly",
          new_hire_rule: "immediate",
          waiting_period_value: 0,
          waiting_period_unit: "month",
          carryover_limit_enabled: false,
          sort_order: 1,
        },
      ])
      .select("id")
    catA = categories![0].id
    catB = categories![1].id

    await serviceClient.from("employee_balances").upsert([
      {
        employee_id: employee.userId,
        category_id: catA,
        workspace_id: admin.workspaceId,
        remaining_days: 10,
      },
      {
        employee_id: employee.userId,
        category_id: catB,
        workspace_id: admin.workspaceId,
        remaining_days: 5,
      },
    ], { onConflict: "employee_id,category_id" })
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 15_000)

  describe("DB-14: updates multiple balances atomically", () => {
    it("both categories are updated in one call", async () => {
      const { error } = await admin.userClient.rpc("bulk_update_employee_balances", {
        p_employee_id: employee.userId,
        p_workspace_id: admin.workspaceId,
        p_updates: [
          { category_id: catA, remaining_days: 15 },
          { category_id: catB, remaining_days: 3 },
        ],
      })
      expect(error).toBeNull()

      const { data: balances } = await serviceClient
        .from("employee_balances")
        .select("category_id, remaining_days")
        .eq("employee_id", employee.userId)
        .in("category_id", [catA, catB])

      const balMap = Object.fromEntries(balances!.map((b) => [b.category_id, b.remaining_days]))
      expect(balMap[catA]).toBe(15)
      expect(balMap[catB]).toBe(3)

      // Restore
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 10 })
        .eq("employee_id", employee.userId)
        .eq("category_id", catA)
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 5 })
        .eq("employee_id", employee.userId)
        .eq("category_id", catB)
    })
  })

  describe("DB-15: employee cannot call bulk_update_employee_balances", () => {
    it("non-admin role gets permission denied", async () => {
      const { error } = await employee.userClient.rpc("bulk_update_employee_balances", {
        p_employee_id: employee.userId,
        p_workspace_id: admin.workspaceId,
        p_updates: [{ category_id: catA, remaining_days: 99 }],
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/permission denied/i)

      // Balance unchanged
      const { data } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", catA)
        .single()
      expect(data!.remaining_days).toBe(10)
    })
  })

  describe("DB-16: cross-workspace employee_id → exception", () => {
    it("cannot update balances for employee in a different workspace", async () => {
      const other = await createIsolatedWorkspace("user")

      const { error } = await admin.userClient.rpc("bulk_update_employee_balances", {
        p_employee_id: other.userId,
        p_workspace_id: admin.workspaceId,
        p_updates: [{ category_id: catA, remaining_days: 99 }],
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/not found|permission denied/i)

      await deleteAuthUser(other.userId)
      await serviceClient.from("profiles").delete().eq("id", other.userId)
      await cleanupWorkspace(other.workspaceId, other.userId)
    })
  })

  describe("DB-17: empty updates array is a no-op", () => {
    it("calling with empty array does not error", async () => {
      const { error } = await admin.userClient.rpc("bulk_update_employee_balances", {
        p_employee_id: employee.userId,
        p_workspace_id: admin.workspaceId,
        p_updates: [],
      })
      expect(error).toBeNull()

      // Balances unchanged
      const { data } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", catA)
        .single()
      expect(data!.remaining_days).toBe(10)
    })
  })
})
