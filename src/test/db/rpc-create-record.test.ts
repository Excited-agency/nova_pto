import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  type IsolatedWorkspace,
} from "../security/helpers"

describe.skipIf(skipIfNoServiceKey())("RPC: create_time_off_record (DB-9..13)", () => {

  let admin: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let categoryId: string

  beforeAll(async () => {
    admin = await createIsolatedWorkspace("admin")
    employee = await createIsolatedWorkspace("user")

    await serviceClient
      .from("profiles")
      .update({ workspace_id: admin.workspaceId })
      .eq("id", employee.userId)

    const { data: cat } = await serviceClient
      .from("time_off_categories")
      .insert({
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
      })
      .select("id")
      .single()
    categoryId = cat!.id

    await serviceClient.from("employee_balances").upsert({
      employee_id: employee.userId,
      category_id: categoryId,
      workspace_id: admin.workspaceId,
      remaining_days: 15,
    }, { onConflict: "employee_id,category_id" })

    // Remove any holidays from the test workspace so business-day calculations are deterministic
    await serviceClient.from("holidays").delete().eq("workspace_id", admin.workspaceId)
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 15_000)

  describe("DB-9: creates an approved record and deducts balance", () => {
    it("creates request with status=approved and deducts from balance", async () => {
      const { data: before } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()

      const { data, error } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-07-01",
        p_end_date: "2026-07-03",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_comment: null,
      })
      expect(error).toBeNull()

      const requestId = (data as any)?.id
      const { data: req } = await serviceClient
        .from("time_off_requests")
        .select("status, total_days")
        .eq("id", requestId)
        .single()
      expect(req?.status).toBe("approved")
      expect(req?.total_days).toBe(3) // Wed, Thu, Fri

      const { data: after } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()
      expect(after!.remaining_days).toBe(before!.remaining_days - 3)

      // Restore balance and cleanup
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: before!.remaining_days })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
      await serviceClient.from("time_off_requests").delete().eq("id", requestId)
    })
  })

  describe("DB-10: end_date < start_date → exception", () => {
    it("invalid date range raises an error", async () => {
      const { error } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-07-05",
        p_end_date: "2026-07-01",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_comment: null,
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/end date|after start/i)
    })
  })

  describe("DB-11: employee from different workspace → exception", () => {
    it("cross-workspace employee_id is rejected", async () => {
      const other = await createIsolatedWorkspace("user")

      const { error } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: other.userId,
        p_category_id: categoryId,
        p_start_date: "2026-07-01",
        p_end_date: "2026-07-01",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_comment: null,
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/not found|permission denied/i)

      await deleteAuthUser(other.userId)
      await serviceClient.from("profiles").delete().eq("id", other.userId)
      await cleanupWorkspace(other.workspaceId, other.userId)
    })
  })

  describe("DB-12: insufficient balance → exception, no record created", () => {
    it("request is rolled back when balance is too low", async () => {
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 1 })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)

      const { error } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-07-01",
        p_end_date: "2026-07-03",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_comment: null,
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/insufficient balance/i)

      // No record should have been created
      const { data: requests } = await serviceClient
        .from("time_off_requests")
        .select("id")
        .eq("profile_id", employee.userId)
        .eq("start_date", "2026-07-01")
      expect(requests).toHaveLength(0)

      // Balance unchanged
      const { data: bal } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()
      expect(bal!.remaining_days).toBe(1)

      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 15 })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
    })
  })

  describe("DB-13: employee cannot call create_time_off_record", () => {
    it("non-admin role gets permission denied", async () => {
      const { error } = await employee.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-08-01",
        p_end_date: "2026-08-01",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_comment: null,
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/permission denied/i)
    })
  })

  describe("DB-B1: create_time_off_record inserts a balance_adjustment_log row", () => {
    it("log row has reason='record_created' and correct delta after creating a record", async () => {
      const { data: before } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()

      const { data, error } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-09-01",
        p_end_date: "2026-09-03",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_comment: null,
      })
      expect(error).toBeNull()

      const requestId = (data as any)?.id

      const { data: logs } = await serviceClient
        .from("balance_adjustment_log")
        .select("*")
        .eq("employee_id", employee.userId)
        .eq("request_id", requestId)

      expect(logs).toHaveLength(1)
      const log = logs![0]
      expect(log.reason).toBe("record_created")
      expect(log.delta).toBe(-3)
      expect(log.balance_before).toBe(before!.remaining_days)
      expect(log.balance_after).toBe(before!.remaining_days - 3)
      expect(log.adjusted_by).toBe(admin.userId)

      // Restore
      await serviceClient.from("time_off_requests").delete().eq("id", requestId)
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: before!.remaining_days })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
    })
  })
})
