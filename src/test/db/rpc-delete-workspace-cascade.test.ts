import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  seedPendingRequest,
  type IsolatedWorkspace,
} from "../security/helpers"

/**
 * delete_workspace_cascade replaces three separate, non-transactional deletes
 * that the delete-workspace edge function used to issue.
 *
 * Besides not being atomic, the old sequence sat on a schema contradiction:
 * 20260604000000 made slack_installations.installed_by ON DELETE SET NULL but
 * left the column NOT NULL, so deleting the profile that installed Slack
 * raised SQLSTATE 23502 (not_null_violation). That broke two things -- purging
 * such an employee always failed, and deleting a workspace only worked when
 * the cascade happened to remove slack_installations before profiles, an order
 * Postgres does not guarantee.
 *
 * 20260825160000 drops the stray NOT NULL and deletes slack_installations
 * explicitly inside the RPC, so neither depends on trigger firing order.
 */
describe.skipIf(skipIfNoServiceKey())("RPC: delete_workspace_cascade", () => {
  let ws: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let outsider: IsolatedWorkspace
  let categoryId: string

  beforeAll(async () => {
    ws = await createIsolatedWorkspace("owner")
    employee = await createIsolatedWorkspace("user")
    outsider = await createIsolatedWorkspace("admin")

    await serviceClient
      .from("profiles")
      .update({ workspace_id: ws.workspaceId })
      .eq("id", employee.userId)

    const { data: cat } = await serviceClient
      .from("time_off_categories")
      .insert({
        workspace_id: ws.workspaceId,
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

    await seedPendingRequest(employee.userId, ws.workspaceId, { categoryId })

    await serviceClient.from("slack_installations").insert({
      workspace_id: ws.workspaceId,
      slack_team_id: `T${Date.now()}`,
      bot_token: "xoxb-test",
      bot_user_id: "U-test",
      installed_by: ws.userId,
      is_active: true,
    })

    // The row that used to make workspace deletion impossible.
    await serviceClient.from("slack_interaction_log").insert({
      interaction_id: `int-${Date.now()}`,
      action_type: "approve",
      workspace_id: ws.workspaceId,
      processed_by: ws.userId,
    })
  }, 30_000)

  afterAll(async () => {
    // The cascade removes profiles/workspaces; auth users are the caller's job.
    await Promise.all([
      deleteAuthUser(ws.userId),
      deleteAuthUser(employee.userId),
    ])
    await serviceClient.from("workspaces").delete().eq("id", outsider.workspaceId)
    await deleteAuthUser(outsider.userId)
  }, 15_000)

  it("regression: the profile that installed Slack can now be deleted", async () => {
    // Before 20260825160000 this raised
    //   null value in column "installed_by" ... violates not-null constraint
    // because the FK was SET NULL while the column was still NOT NULL. It is
    // the exact failure that made purging such an employee impossible and made
    // workspace deletion depend on cascade ordering. Deleting only the
    // installer here (not the whole workspace) isolates that single constraint.
    const { error } = await serviceClient
      .from("profiles")
      .delete()
      .eq("id", ws.userId)

    expect(error).toBeNull()

    // The installation survives with its installer reference cleared.
    const { data: install } = await serviceClient
      .from("slack_installations")
      .select("installed_by")
      .eq("workspace_id", ws.workspaceId)
      .single()

    expect(install!.installed_by).toBeNull()

    // Put the owner profile back so the cascade tests below still have one.
    await serviceClient.from("profiles").insert({
      id: ws.userId,
      workspace_id: ws.workspaceId,
      role: "owner",
      email: `restored-${ws.userId}@test.invalid`,
      status: "active",
    })
    await serviceClient
      .from("slack_installations")
      .update({ installed_by: ws.userId })
      .eq("workspace_id", ws.workspaceId)
  })

  it("rejects a caller who is not the workspace owner", async () => {
    const { error } = await serviceClient.rpc("delete_workspace_cascade", {
      p_workspace_id: ws.workspaceId,
      p_owner_id: outsider.userId,
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/only the workspace owner/i)

    // ...and nothing was removed on the way to that rejection.
    const { data: stillThere } = await serviceClient
      .from("workspaces")
      .select("id")
      .eq("id", ws.workspaceId)
      .maybeSingle()
    expect(stillThere).not.toBeNull()
  })

  it("deletes the whole workspace in one statement and returns its profile ids", async () => {
    const { data, error } = await serviceClient.rpc("delete_workspace_cascade", {
      p_workspace_id: ws.workspaceId,
      p_owner_id: ws.userId,
    })

    expect(error).toBeNull()
    expect(data!.deleted).toBe(true)
    expect(data!.profile_ids).toHaveLength(2)
    expect(data!.profile_ids).toEqual(
      expect.arrayContaining([ws.userId, employee.userId])
    )

    // Every workspace-scoped table must be empty, including the Slack rows
    // whose NO ACTION references used to block the delete.
    const tables = [
      "profiles",
      "time_off_requests",
      "employee_balances",
      "time_off_categories",
      "departments",
      "holidays",
      "balance_adjustment_log",
      "slack_installations",
      "slack_interaction_log",
    ] as const

    for (const table of tables) {
      const { data: rows } = await serviceClient
        .from(table)
        .select("*")
        .eq("workspace_id", ws.workspaceId)
      expect(rows ?? [], `${table} should be empty`).toHaveLength(0)
    }

    const { data: workspace } = await serviceClient
      .from("workspaces")
      .select("id")
      .eq("id", ws.workspaceId)
      .maybeSingle()
    expect(workspace).toBeNull()
  })

  it("reports a clear error for an already-deleted workspace", async () => {
    const { error } = await serviceClient.rpc("delete_workspace_cascade", {
      p_workspace_id: ws.workspaceId,
      p_owner_id: ws.userId,
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/workspace not found/i)
  })
})
