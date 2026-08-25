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
 * Regression test for the cross-tenant write hole in create_time_off_record.
 *
 * 20260320200000_security_hardening.sql added a guard requiring
 * p_workspace_id = get_user_workspace_id(). 20260323000000 recreated the
 * function to add an employee-status check and dropped that guard, and
 * 20260604500000 carried the gap forward.
 *
 * The pre-existing CRIT-20 test did not catch it: it passed an argument the
 * function never accepted, so the call failed as an unknown function and its
 * loose assertion accepted that. This suite closes the hole properly by
 * building a fully self-consistent payload for the OTHER tenant -- real
 * workspace, real employee in it, real category in it, funded balance -- so
 * every check inside the function passes on its own terms and only an explicit
 * caller-workspace comparison can reject it.
 */
describe.skipIf(skipIfNoServiceKey())("RPC: create_time_off_record tenant guard", () => {
  let attacker: IsolatedWorkspace   // admin of workspace A
  let victimAdmin: IsolatedWorkspace // admin of workspace B
  let victimEmployee: IsolatedWorkspace
  let victimCategoryId: string

  const STARTING_BALANCE = 15

  beforeAll(async () => {
    ;[attacker, victimAdmin] = await Promise.all([
      createIsolatedWorkspace("admin"),
      createIsolatedWorkspace("admin"),
    ])
    victimEmployee = await createIsolatedWorkspace("user")

    // Move the employee into the victim workspace (B)
    await serviceClient
      .from("profiles")
      .update({ workspace_id: victimAdmin.workspaceId })
      .eq("id", victimEmployee.userId)

    const { data: cat } = await serviceClient
      .from("time_off_categories")
      .insert({
        workspace_id: victimAdmin.workspaceId,
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
    victimCategoryId = cat!.id

    await serviceClient.from("employee_balances").upsert(
      {
        employee_id: victimEmployee.userId,
        category_id: victimCategoryId,
        workspace_id: victimAdmin.workspaceId,
        remaining_days: STARTING_BALANCE,
      },
      { onConflict: "employee_id,category_id" }
    )
  }, 30_000)

  afterAll(async () => {
    await Promise.all([
      cleanupWorkspace(attacker.workspaceId, attacker.userId),
      cleanupWorkspace(victimAdmin.workspaceId, victimAdmin.userId),
    ])
    await deleteAuthUser(victimEmployee.userId)
    await serviceClient.from("profiles").delete().eq("id", victimEmployee.userId)
  }, 15_000)

  it("rejects a fully valid payload that belongs to another workspace", async () => {
    const { error } = await attacker.userClient.rpc("create_time_off_record", {
      p_workspace_id: victimAdmin.workspaceId,
      p_employee_id: victimEmployee.userId,
      p_category_id: victimCategoryId,
      p_start_date: "2026-09-07",
      p_end_date: "2026-09-08",
      p_comment: "cross-tenant write attempt",
      p_start_period: "morning",
      p_end_period: "end_of_day",
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/workspace does not belong to the current user/i)
  })

  it("leaves the other workspace's data untouched", async () => {
    const { data: requests } = await serviceClient
      .from("time_off_requests")
      .select("id")
      .eq("workspace_id", victimAdmin.workspaceId)

    expect(requests ?? []).toHaveLength(0)

    const { data: balance } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", victimEmployee.userId)
      .eq("category_id", victimCategoryId)
      .single()

    expect(balance!.remaining_days).toBe(STARTING_BALANCE)

    // Scoped to the reasons an attacker could produce. Since the accrual
    // engine landed (20260826110000) the victim's log legitimately contains
    // 'accrual' rows from seeding, so asserting the whole log is empty would
    // now fail for a reason that has nothing to do with this attack.
    const { data: log } = await serviceClient
      .from("balance_adjustment_log")
      .select("id, reason")
      .eq("workspace_id", victimAdmin.workspaceId)
      .in("reason", ["record_created", "request_approved", "manual_adjustment"])

    expect(log ?? []).toHaveLength(0)
  })

  it("still allows the victim's own admin to create the identical record", async () => {
    // Confirms the guard blocks by caller identity, not by rejecting the
    // payload itself -- otherwise the test above could pass on a broken
    // function that refuses everything.
    const { error } = await victimAdmin.userClient.rpc("create_time_off_record", {
      p_workspace_id: victimAdmin.workspaceId,
      p_employee_id: victimEmployee.userId,
      p_category_id: victimCategoryId,
      p_start_date: "2026-09-07",
      p_end_date: "2026-09-08",
      p_comment: "legitimate record",
      p_start_period: "morning",
      p_end_period: "end_of_day",
    })

    expect(error).toBeNull()

    const { data: requests } = await serviceClient
      .from("time_off_requests")
      .select("id, status")
      .eq("workspace_id", victimAdmin.workspaceId)

    expect(requests ?? []).toHaveLength(1)
    expect(requests![0].status).toBe("approved")
  })
})
