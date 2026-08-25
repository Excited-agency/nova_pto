import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  type IsolatedWorkspace,
} from "../security/helpers"

/**
 * The rule: weekends and workspace holidays are never leave days, on every
 * path that can move a balance.
 *
 * It used to be implemented four times and one of them disagreed.
 * create_time_off_record counted plain calendar days -- business-day counting
 * was added in 20260320100000 and then silently lost when 20260604500000
 * rebuilt the function from an older body. So an admin recording Mon -> Sun
 * saw "5 days" in the UI while the RPC deducted 7, permanently, with the
 * inflated figure written to balance_adjustment_log as fact.
 *
 * The existing rpc-create-record test could not catch it: it used a Wed-Fri
 * range, where the calendar and business-day formulas agree. These cases
 * deliberately straddle a weekend and a holiday.
 *
 * Reference dates: 2026-09-07 is a Monday, 09-12/09-13 the weekend,
 * 09-14 the following Monday.
 */
describe.skipIf(skipIfNoServiceKey())("Leave-day calculation", () => {
  let admin: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let categoryId: string

  const START_BALANCE = 30

  async function balance(): Promise<number> {
    const { data } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()
    return data!.remaining_days
  }

  async function resetBalance() {
    await serviceClient
      .from("employee_balances")
      .update({ remaining_days: START_BALANCE })
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
    await serviceClient
      .from("time_off_requests")
      .delete()
      .eq("workspace_id", admin.workspaceId)
  }

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
        amount_value: 30,
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

    await serviceClient.from("employee_balances").upsert(
      {
        employee_id: employee.userId,
        category_id: categoryId,
        workspace_id: admin.workspaceId,
        remaining_days: START_BALANCE,
      },
      { onConflict: "employee_id,category_id" }
    )

    await serviceClient.from("holidays").delete().eq("workspace_id", admin.workspaceId)
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 15_000)

  describe("create_time_off_record (admin records leave directly)", () => {
    it("does not charge the employee for the weekend", async () => {
      await resetBalance()

      // Mon 07 -> Sun 13 spans 7 calendar days but only 5 working days.
      const { data, error } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-09-07",
        p_end_date: "2026-09-13",
        p_comment: null,
        p_start_period: "morning",
        p_end_period: "end_of_day",
      })

      expect(error).toBeNull()
      expect(data!.total_days).toBe(5)
      expect(await balance()).toBe(START_BALANCE - 5)
    })

    it("does not charge the employee for a holiday", async () => {
      await resetBalance()
      await serviceClient.from("holidays").insert({
        workspace_id: admin.workspaceId,
        name: "Test holiday",
        date: "2026-09-09",
        is_custom: true,
      })

      // Mon 07 -> Fri 11 = 5 working days, minus the Wednesday holiday = 4.
      const { data, error } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-09-07",
        p_end_date: "2026-09-11",
        p_comment: null,
        p_start_period: "morning",
        p_end_period: "end_of_day",
      })

      expect(error).toBeNull()
      expect(data!.total_days).toBe(4)
      expect(await balance()).toBe(START_BALANCE - 4)

      await serviceClient
        .from("holidays")
        .delete()
        .eq("workspace_id", admin.workspaceId)
        .eq("date", "2026-09-09")
    })

    it("logs the same number it deducted", async () => {
      await resetBalance()

      const { data } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-09-07",
        p_end_date: "2026-09-13",
        p_comment: null,
        p_start_period: "morning",
        p_end_period: "end_of_day",
      })

      const { data: log } = await serviceClient
        .from("balance_adjustment_log")
        .select("delta, balance_before, balance_after")
        .eq("request_id", data!.id)
        .single()

      // The audit trail must not claim a different figure from the balance.
      expect(log!.delta).toBe(-5)
      expect(log!.balance_before).toBe(START_BALANCE)
      expect(log!.balance_after).toBe(START_BALANCE - 5)
      expect(await balance()).toBe(log!.balance_after)
    })

    it("refuses a weekend-only range instead of charging a day for it", async () => {
      await resetBalance()

      const { error } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-09-12",
        p_end_date: "2026-09-13",
        p_comment: null,
        p_start_period: "morning",
        p_end_period: "end_of_day",
      })

      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/no working days/i)
      expect(await balance()).toBe(START_BALANCE)
    })

    it("counts a half day only when it lands on a working day", async () => {
      await resetBalance()

      // Fri 11 midday -> Mon 14 end of day: half of Friday + all of Monday.
      const { data, error } = await admin.userClient.rpc("create_time_off_record", {
        p_workspace_id: admin.workspaceId,
        p_employee_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-09-11",
        p_end_date: "2026-09-14",
        p_comment: null,
        p_start_period: "midday",
        p_end_period: "end_of_day",
      })

      expect(error).toBeNull()
      expect(data!.total_days).toBe(1.5)
      expect(await balance()).toBe(START_BALANCE - 1.5)
    })
  })

  describe("approve_time_off_request agrees with create_time_off_record", () => {
    it("deducts the same number for the same dates", async () => {
      await resetBalance()

      const submitted = await serviceClient.rpc("submit_time_off_request_bot", {
        p_profile_id: employee.userId,
        p_category_id: categoryId,
        p_start_date: "2026-09-07",
        p_end_date: "2026-09-13",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_comment: null,
      })

      expect(submitted.error).toBeNull()
      // Already correct at submit time — not only once an admin approves.
      expect(submitted.data!.total_days).toBe(5)

      const { data: approved, error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: submitted.data!.id,
      })

      expect(error).toBeNull()
      expect(approved!.total_days).toBe(5)
      expect(await balance()).toBe(START_BALANCE - 5)
    })
  })

  describe("submit_time_off_request (employee self-service)", () => {
    it("computes total_days server-side, ignoring anything the client thinks", async () => {
      await resetBalance()

      const { data, error } = await employee.userClient.rpc("submit_time_off_request", {
        p_category_id: categoryId,
        p_start_date: "2026-09-07",
        p_end_date: "2026-09-13",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_comment: "holiday",
      })

      expect(error).toBeNull()
      expect(data!.total_days).toBe(5)

      const { data: row } = await serviceClient
        .from("time_off_requests")
        .select("status, total_days, profile_id, request_type")
        .eq("id", data!.id)
        .single()

      // Status is forced server-side; an employee cannot self-approve.
      expect(row!.status).toBe("pending")
      expect(row!.total_days).toBe(5)
      expect(row!.profile_id).toBe(employee.userId)
      expect(row!.request_type).toBe("vacation")
    })

    it("refuses a weekend-only request", async () => {
      const { error } = await employee.userClient.rpc("submit_time_off_request", {
        p_category_id: categoryId,
        p_start_date: "2026-09-12",
        p_end_date: "2026-09-13",
        p_start_period: "morning",
        p_end_period: "end_of_day",
        p_comment: null,
      })

      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/no working days/i)
    })
  })
})
