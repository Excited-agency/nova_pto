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

/**
 * The approve/reject/create RPCs recompute days, check the balance and write an
 * audit row -- but all of that was skippable, because the tables themselves were
 * directly writable by any logged-in client:
 *
 *   requests_insert_own   -- said nothing about status or total_days
 *   requests_update_admin -- had no WITH CHECK at all
 *   balances_update_admin -- likewise
 *
 * Reproduced before the fix: an employee could insert their own request with
 * status='approved' and no balance was ever deducted; an admin could flip a
 * request to approved without a deduction, rewrite total_days, or un-approve a
 * request while the deduction stayed (which nothing could then explain, since
 * there is no reversal path).
 *
 * 20260825190000 revokes INSERT/UPDATE on time_off_requests and
 * INSERT/UPDATE/DELETE on employee_balances from `authenticated`, so the RPCs
 * are the only way in. These tests pin that shut.
 */
describe.skipIf(skipIfNoServiceKey())("Request write lockdown", () => {
  let admin: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let categoryId: string
  let pending: { id: string }

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

    await serviceClient.from("employee_balances").upsert(
      {
        employee_id: employee.userId,
        category_id: categoryId,
        workspace_id: admin.workspaceId,
        remaining_days: 20,
      },
      { onConflict: "employee_id,category_id" }
    )

    pending = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 15_000)

  it("an employee cannot insert a request that is already approved", async () => {
    // The worst of the bunch: leave that costs nothing and reads as approved.
    const { error } = await employee.userClient.from("time_off_requests").insert({
      profile_id: employee.userId,
      workspace_id: admin.workspaceId,
      category_id: categoryId,
      employee_name: "Self Approver",
      employee_email: "self@test.invalid",
      start_date: "2026-10-05",
      end_date: "2026-10-09",
      start_period: "morning",
      end_period: "end_of_day",
      total_days: 5,
      request_type: "vacation",
      status: "approved",
    })

    expect(error).toBeTruthy()

    const { data: rows } = await serviceClient
      .from("time_off_requests")
      .select("id")
      .eq("workspace_id", admin.workspaceId)
      .eq("status", "approved")

    expect(rows ?? []).toHaveLength(0)
  })

  it("an employee cannot insert a request at all — submission goes through the RPC", async () => {
    const { error } = await employee.userClient.from("time_off_requests").insert({
      profile_id: employee.userId,
      workspace_id: admin.workspaceId,
      category_id: categoryId,
      employee_name: "Direct Insert",
      employee_email: "direct@test.invalid",
      start_date: "2026-10-12",
      end_date: "2026-10-13",
      start_period: "morning",
      end_period: "end_of_day",
      total_days: 2,
      request_type: "vacation",
      status: "pending",
    })

    expect(error).toBeTruthy()
  })

  it("an admin cannot approve a request by writing the table directly", async () => {
    const { error } = await admin.userClient
      .from("time_off_requests")
      .update({ status: "approved" })
      .eq("id", pending.id)

    expect(error).toBeTruthy()

    const { data: row } = await serviceClient
      .from("time_off_requests")
      .select("status")
      .eq("id", pending.id)
      .single()

    expect(row!.status).toBe("pending")
  })

  it("an admin cannot rewrite total_days", async () => {
    const { error } = await admin.userClient
      .from("time_off_requests")
      .update({ total_days: 999 })
      .eq("id", pending.id)

    expect(error).toBeTruthy()

    const { data: row } = await serviceClient
      .from("time_off_requests")
      .select("total_days")
      .eq("id", pending.id)
      .single()

    expect(row!.total_days).not.toBe(999)
  })

  it("an admin cannot un-approve a request and leave the balance spent", async () => {
    // Approve properly first, then try to strip the status behind the RPC's back.
    const { error: approveError } = await admin.userClient.rpc("approve_time_off_request", {
      p_request_id: pending.id,
    })
    expect(approveError).toBeNull()

    const { data: afterApprove } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()

    const { error } = await admin.userClient
      .from("time_off_requests")
      .update({ status: "pending" })
      .eq("id", pending.id)

    expect(error).toBeTruthy()

    const { data: row } = await serviceClient
      .from("time_off_requests")
      .select("status")
      .eq("id", pending.id)
      .single()

    // Still approved, and the balance still matches the deduction that explains it.
    expect(row!.status).toBe("approved")

    const { data: afterAttempt } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()

    expect(afterAttempt!.remaining_days).toBe(afterApprove!.remaining_days)
  })

  it("an admin cannot write a balance directly, bypassing the audit log", async () => {
    const { error } = await admin.userClient
      .from("employee_balances")
      .update({ remaining_days: 999 })
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)

    expect(error).toBeTruthy()

    const { data: row } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()

    expect(row!.remaining_days).not.toBe(999)
  })

  it("the sanctioned balance RPC still works and still logs", async () => {
    // Guards against over-tightening: admins must retain a legitimate,
    // audited way to correct a balance.
    const { error } = await admin.userClient.rpc("bulk_update_employee_balances", {
      p_employee_id: employee.userId,
      p_workspace_id: admin.workspaceId,
      p_updates: [{ category_id: categoryId, remaining_days: 12 }],
    })

    expect(error).toBeNull()

    const { data: row } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()
    expect(row!.remaining_days).toBe(12)

    const { data: log } = await serviceClient
      .from("balance_adjustment_log")
      .select("reason, balance_after")
      .eq("employee_id", employee.userId)
      .eq("reason", "manual_adjustment")
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    expect(log!.balance_after).toBe(12)
  })

  it("an employee can still withdraw their own pending request via the RPC", async () => {
    const fresh = await serviceClient.rpc("submit_time_off_request_bot", {
      p_profile_id: employee.userId,
      p_category_id: categoryId,
      p_start_date: "2026-10-19",
      p_end_date: "2026-10-20",
      p_start_period: "morning",
      p_end_period: "end_of_day",
      p_comment: null,
    })
    expect(fresh.error).toBeNull()

    const { error } = await employee.userClient.rpc("withdraw_time_off_request", {
      p_request_id: fresh.data!.id,
    })
    expect(error).toBeNull()

    const { data: row } = await serviceClient
      .from("time_off_requests")
      .select("status")
      .eq("id", fresh.data!.id)
      .single()
    expect(row!.status).toBe("withdrawn")
  })

  it("rejects a negative balance instead of storing it", async () => {
    // The balance editor refuses negatives client-side, but the RPC accepted
    // any number -- and it is now the only way to write a balance, so the rule
    // has to live here.
    const { error } = await admin.userClient.rpc("bulk_update_employee_balances", {
      p_employee_id: employee.userId,
      p_workspace_id: admin.workspaceId,
      p_updates: [{ category_id: categoryId, remaining_days: -5 }],
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/cannot be negative/i)

    const { data: row } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()
    expect(row!.remaining_days).toBeGreaterThanOrEqual(0)
  })

  it("applies no balance at all when one entry in the batch is invalid", async () => {
    const { data: before } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()

    // Valid entry first, invalid second: the whole call must be rejected so the
    // batch cannot land half-applied.
    const { error } = await admin.userClient.rpc("bulk_update_employee_balances", {
      p_employee_id: employee.userId,
      p_workspace_id: admin.workspaceId,
      p_updates: [
        { category_id: categoryId, remaining_days: 7 },
        { category_id: categoryId, remaining_days: -1 },
      ],
    })

    expect(error).toBeTruthy()

    const { data: after } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()
    expect(after!.remaining_days).toBe(before!.remaining_days)
  })

  it("an employee cannot withdraw someone else's request", async () => {
    const other = await seedPendingRequest(admin.userId, admin.workspaceId, { categoryId })

    const { error } = await employee.userClient.rpc("withdraw_time_off_request", {
      p_request_id: other.id,
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/only withdraw your own/i)
  })
})
