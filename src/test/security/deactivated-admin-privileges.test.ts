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
 * Regression tests for a cross-tenant privilege escalation.
 *
 * is_workspace_admin() checked role but not status, while
 * get_user_workspace_id() excludes profiles with status='deleted'. Soft-delete
 * keeps the profile row and its role, so for a soft-deleted admin the two
 * helpers disagreed: the admin gate returned TRUE and the workspace lookup
 * returned NULL. Every guard written as an inequality then failed open,
 * because comparing anything with NULL yields NULL rather than TRUE:
 *
 *   IF v_request.workspace_id <> get_user_workspace_id() THEN ...
 *
 * A soft-deleted admin of one workspace could therefore approve or reject
 * requests in ANY workspace for as long as their access token stayed valid.
 * 20260825170000 makes is_workspace_admin() require status='active'.
 *
 * The tests use a still-valid JWT minted before deactivation, which is exactly
 * the window an offboarded admin would have.
 */
describe.skipIf(skipIfNoServiceKey())("Deactivated admin privileges", () => {
  let staleAdmin: IsolatedWorkspace   // admin of workspace A, later soft-deleted
  let inactiveAdmin: IsolatedWorkspace // admin of workspace A, later deactivated
  let otherAdmin: IsolatedWorkspace   // admin of workspace B
  let employeeInB: IsolatedWorkspace
  let requestInB: { id: string }
  let requestInB2: { id: string }

  beforeAll(async () => {
    ;[staleAdmin, inactiveAdmin, otherAdmin] = await Promise.all([
      createIsolatedWorkspace("admin"),
      createIsolatedWorkspace("admin"),
      createIsolatedWorkspace("admin"),
    ])
    employeeInB = await createIsolatedWorkspace("user")

    await serviceClient
      .from("profiles")
      .update({ workspace_id: otherAdmin.workspaceId })
      .eq("id", employeeInB.userId)

    ;[requestInB, requestInB2] = await Promise.all([
      seedPendingRequest(employeeInB.userId, otherAdmin.workspaceId),
      seedPendingRequest(employeeInB.userId, otherAdmin.workspaceId),
    ])

    // Tokens are already issued at this point; now revoke access the way the
    // app does -- soft delete for one admin, deactivation for the other.
    await serviceClient
      .from("profiles")
      .update({ status: "deleted" })
      .eq("id", staleAdmin.userId)

    await serviceClient
      .from("profiles")
      .update({ status: "inactive" })
      .eq("id", inactiveAdmin.userId)
  }, 40_000)

  afterAll(async () => {
    await Promise.all([
      cleanupWorkspace(staleAdmin.workspaceId, staleAdmin.userId),
      cleanupWorkspace(inactiveAdmin.workspaceId, inactiveAdmin.userId),
      cleanupWorkspace(otherAdmin.workspaceId, otherAdmin.userId),
    ])
    await deleteAuthUser(employeeInB.userId)
    await serviceClient.from("profiles").delete().eq("id", employeeInB.userId)
  }, 20_000)

  it("a soft-deleted admin cannot approve a request in another workspace", async () => {
    const { error } = await staleAdmin.userClient.rpc("approve_time_off_request", {
      p_request_id: requestInB.id,
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/permission denied/i)

    const { data: after } = await serviceClient
      .from("time_off_requests")
      .select("status, reviewed_by")
      .eq("id", requestInB.id)
      .single()

    expect(after!.status).toBe("pending")
    expect(after!.reviewed_by).toBeNull()
  })

  it("a soft-deleted admin cannot reject a request in another workspace", async () => {
    const { error } = await staleAdmin.userClient.rpc("reject_time_off_request", {
      p_request_id: requestInB2.id,
      p_rejection_reason: "should never apply",
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/permission denied/i)

    const { data: after } = await serviceClient
      .from("time_off_requests")
      .select("status")
      .eq("id", requestInB2.id)
      .single()

    expect(after!.status).toBe("pending")
  })

  it("a merely deactivated admin also loses admin rights", async () => {
    // 'inactive' must be denied too, not just 'deleted': deactivation is how the
    // app locks someone out (see the /access-restricted screen), so keeping
    // admin powers would defeat it.
    const { error } = await inactiveAdmin.userClient.rpc("approve_time_off_request", {
      p_request_id: requestInB.id,
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/permission denied/i)
  })

  it("a soft-deleted admin cannot move balances in another workspace", async () => {
    const { error } = await staleAdmin.userClient.rpc("bulk_update_employee_balances", {
      p_employee_id: employeeInB.userId,
      p_workspace_id: otherAdmin.workspaceId,
      p_updates: [],
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/permission denied/i)
  })

  it("an active admin is unaffected", async () => {
    // Guards against over-tightening: the fix must deny deactivated accounts
    // without breaking normal admins.
    const { error } = await otherAdmin.userClient.rpc("approve_time_off_request", {
      p_request_id: requestInB.id,
    })

    expect(error).toBeNull()

    const { data: after } = await serviceClient
      .from("time_off_requests")
      .select("status, reviewed_by")
      .eq("id", requestInB.id)
      .single()

    expect(after!.status).toBe("approved")
    expect(after!.reviewed_by).toBe(otherAdmin.userId)
  })
})
