import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  seedPendingRequest,
  type IsolatedWorkspace,
} from "../security/helpers"

/**
 * The Slack-button RPCs must leave the same trace as the web-UI ones.
 *
 * approve_time_off_request / reject_time_off_request gained reviewed_by +
 * reviewed_at (20260604400000) and an audit-log row (20260604500000), but the
 * *_bot variants were never updated. A request actioned from Slack therefore
 * showed no reviewer anywhere in the UI or reports, and a Slack approval moved
 * an employee's balance without recording why.
 *
 * These RPCs are revoked from `authenticated` on purpose, so they are called
 * here through the service-role client exactly as the slack-events edge
 * function does.
 */
describe.skipIf(skipIfNoServiceKey())("RPC: Slack bot review parity", () => {
  let admin: IsolatedWorkspace
  let owner: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let categoryId: string

  const STARTING_BALANCE = 20

  beforeAll(async () => {
    admin = await createIsolatedWorkspace("admin")
    owner = await createIsolatedWorkspace("admin")
    employee = await createIsolatedWorkspace("user")

    // One workspace: `admin` is its admin, `owner` is promoted to owner,
    // `employee` is the requester.
    await serviceClient
      .from("profiles")
      .update({ workspace_id: admin.workspaceId })
      .in("id", [employee.userId, owner.userId])

    await serviceClient
      .from("profiles")
      .update({ role: "owner" })
      .eq("id", owner.userId)

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
        remaining_days: STARTING_BALANCE,
      },
      { onConflict: "employee_id,category_id" }
    )

    // Deterministic day maths
    await serviceClient.from("holidays").delete().eq("workspace_id", admin.workspaceId)
  }, 30_000)

  afterAll(async () => {
    await Promise.all([
      cleanupWorkspace(admin.workspaceId, admin.userId),
      cleanupWorkspace(owner.workspaceId, owner.userId),
    ])
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 15_000)

  it("approve_time_off_request_bot stamps reviewed_by/reviewed_at", async () => {
    const request = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

    const { error } = await serviceClient.rpc("approve_time_off_request_bot", {
      p_request_id: request.id,
      p_admin_profile_id: admin.userId,
    })
    expect(error).toBeNull()

    const { data: updated } = await serviceClient
      .from("time_off_requests")
      .select("status, reviewed_by, reviewed_at")
      .eq("id", request.id)
      .single()

    expect(updated!.status).toBe("approved")
    expect(updated!.reviewed_by).toBe(admin.userId)
    expect(updated!.reviewed_at).not.toBeNull()
  })

  it("approve_time_off_request_bot writes a balance_adjustment_log row", async () => {
    const request = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

    const { data: before } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()

    const { error } = await serviceClient.rpc("approve_time_off_request_bot", {
      p_request_id: request.id,
      p_admin_profile_id: admin.userId,
    })
    expect(error).toBeNull()

    const { data: log } = await serviceClient
      .from("balance_adjustment_log")
      .select("reason, delta, balance_before, balance_after, adjusted_by, request_id")
      .eq("request_id", request.id)
      .single()

    expect(log).not.toBeNull()
    expect(log!.reason).toBe("request_approved")
    // adjusted_by must be the reviewing admin: auth.uid() is NULL under service_role,
    // so the RPC has to use the profile id it was handed.
    expect(log!.adjusted_by).toBe(admin.userId)
    expect(log!.balance_before).toBe(before!.remaining_days)
    expect(log!.balance_after).toBe(before!.remaining_days + log!.delta)
    expect(log!.delta).toBeLessThan(0)
  })

  it("reject_time_off_request_bot stamps reviewed_by/reviewed_at", async () => {
    const request = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

    const { error } = await serviceClient.rpc("reject_time_off_request_bot", {
      p_request_id: request.id,
      p_admin_profile_id: admin.userId,
      p_rejection_reason: "Not this week",
    })
    expect(error).toBeNull()

    const { data: updated } = await serviceClient
      .from("time_off_requests")
      .select("status, rejection_reason, reviewed_by, reviewed_at")
      .eq("id", request.id)
      .single()

    expect(updated!.status).toBe("rejected")
    expect(updated!.rejection_reason).toBe("Not this week")
    expect(updated!.reviewed_by).toBe(admin.userId)
    expect(updated!.reviewed_at).not.toBeNull()
  })

  it("a workspace owner may review via the bot RPCs, matching is_workspace_admin()", async () => {
    // The bot RPCs used to hard-code `role <> 'admin'`, so an owner clicking a
    // Slack button was denied while the same action worked in the web UI
    // (which gates on is_workspace_admin(), i.e. admin OR owner).
    const request = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

    const { error } = await serviceClient.rpc("reject_time_off_request_bot", {
      p_request_id: request.id,
      p_admin_profile_id: owner.userId,
      p_rejection_reason: "Owner decision",
    })

    expect(error).toBeNull()

    const { data: updated } = await serviceClient
      .from("time_off_requests")
      .select("status, reviewed_by")
      .eq("id", request.id)
      .single()

    expect(updated!.status).toBe("rejected")
    expect(updated!.reviewed_by).toBe(owner.userId)
  })

  it("a soft-deleted admin may not review via the bot RPCs", async () => {
    // Soft-delete keeps the profile row (role intact) AND its
    // slack_user_mappings row, so without an explicit status check a
    // deactivated admin's Slack buttons would keep working. There is no
    // web-UI equivalent of this path, since there the session is gone.
    const request = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

    await serviceClient.from("profiles").update({ status: "deleted" }).eq("id", owner.userId)

    const { error } = await serviceClient.rpc("reject_time_off_request_bot", {
      p_request_id: request.id,
      p_admin_profile_id: owner.userId,
      p_rejection_reason: "should be refused",
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/only active workspace admins/i)

    const { data: after } = await serviceClient
      .from("time_off_requests")
      .select("status")
      .eq("id", request.id)
      .single()
    expect(after!.status).toBe("pending")

    await serviceClient.from("profiles").update({ status: "active" }).eq("id", owner.userId)
  })

  it("a plain employee may not review via the bot RPCs", async () => {
    const request = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

    const { error } = await serviceClient.rpc("reject_time_off_request_bot", {
      p_request_id: request.id,
      p_admin_profile_id: employee.userId,
      p_rejection_reason: "should not work",
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/permission denied/i)
  })
})
