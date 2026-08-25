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
 * Deleting a category used to destroy reporting data.
 *
 *   balance_adjustment_log.category_id was ON DELETE CASCADE, so the entire
 *   audit trail for that category was erased -- verified: 0 rows survived.
 *
 *   time_off_requests.category_id was ON DELETE SET NULL, so past requests
 *   survived but collapsed to the legacy request_type label ("Other"), losing
 *   the leave type they were actually taken under.
 *
 * The dialog only warned "this action cannot be undone".
 *
 * 20260826100000 snapshots the name onto both tables and switches the audit
 * log to SET NULL. These tests pin that: the name is captured on write, follows
 * a rename while the category lives, and freezes when it is deleted.
 */
describe.skipIf(skipIfNoServiceKey())("Category history preservation", () => {
  let admin: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let categoryId: string
  let requestId: string

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
        name: "Summer Leave",
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

    // 2026-09-07 is a Monday, 09-11 the Friday: five working days.
    const { data: req } = await serviceClient
      .from("time_off_requests")
      .insert({
        profile_id: employee.userId,
        workspace_id: admin.workspaceId,
        category_id: categoryId,
        employee_name: "History Tester",
        employee_email: "history@test.invalid",
        start_date: "2026-09-07",
        end_date: "2026-09-11",
        start_period: "morning",
        end_period: "end_of_day",
        total_days: 5,
        request_type: "vacation",
        status: "pending",
      })
      .select("id")
      .single()
    requestId = req!.id

    // Approve through the real RPC so the audit row is written the way
    // production writes it, not hand-crafted by the test.
    const { error } = await admin.userClient.rpc("approve_time_off_request", {
      p_request_id: requestId,
    })
    expect(error).toBeNull()
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 15_000)

  it("captures the category name on the request and on the audit row", async () => {
    const { data: req } = await serviceClient
      .from("time_off_requests")
      .select("category_name")
      .eq("id", requestId)
      .single()
    expect(req!.category_name).toBe("Summer Leave")

    const { data: log } = await serviceClient
      .from("balance_adjustment_log")
      .select("category_name")
      .eq("request_id", requestId)
      .single()
    expect(log!.category_name).toBe("Summer Leave")
  })

  it("follows a rename while the category still exists", async () => {
    const { error } = await serviceClient
      .from("time_off_categories")
      .update({ name: "Summer Holiday" })
      .eq("id", categoryId)
    expect(error).toBeNull()

    const { data: req } = await serviceClient
      .from("time_off_requests")
      .select("category_name")
      .eq("id", requestId)
      .single()
    expect(req!.category_name).toBe("Summer Holiday")

    const { data: log } = await serviceClient
      .from("balance_adjustment_log")
      .select("category_name")
      .eq("request_id", requestId)
      .single()
    expect(log!.category_name).toBe("Summer Holiday")
  })

  it("keeps the request and the audit row when the category is deleted", async () => {
    const { error } = await serviceClient
      .from("time_off_categories")
      .delete()
      .eq("id", categoryId)
    expect(error).toBeNull()

    // The request survives, its link is severed, but the name is intact.
    const { data: req } = await serviceClient
      .from("time_off_requests")
      .select("category_id, category_name, total_days, status")
      .eq("id", requestId)
      .single()
    expect(req!.category_id).toBeNull()
    expect(req!.category_name).toBe("Summer Holiday")
    expect(req!.status).toBe("approved")
    expect(req!.total_days).toBe(5)

    // This is the row that used to be cascade-deleted.
    const { data: log } = await serviceClient
      .from("balance_adjustment_log")
      .select("category_id, category_name, delta, balance_before, balance_after")
      .eq("request_id", requestId)
      .single()
    expect(log).not.toBeNull()
    expect(log!.category_id).toBeNull()
    expect(log!.category_name).toBe("Summer Holiday")
    expect(log!.delta).toBe(-5)
    expect(log!.balance_before).toBe(20)
    expect(log!.balance_after).toBe(15)
  })

  it("still removes the balance, which has no meaning without the category", async () => {
    const { data: balances } = await serviceClient
      .from("employee_balances")
      .select("id")
      .eq("category_id", categoryId)

    expect(balances ?? []).toHaveLength(0)
  })
})
