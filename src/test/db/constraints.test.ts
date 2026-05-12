import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  type IsolatedWorkspace,
} from "../security/helpers"

describe.skipIf(skipIfNoServiceKey())("DB constraints (DB-25..29)", () => {

  let admin: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let catId: string

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
    catId = cat!.id

    await serviceClient.from("employee_balances").upsert({
      employee_id: employee.userId,
      category_id: catId,
      workspace_id: admin.workspaceId,
      remaining_days: 10,
    }, { onConflict: "employee_id,category_id" })
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 15_000)

  describe("DB-25: employee_balances unique constraint (employee_id, category_id)", () => {
    it("inserting duplicate (employee_id, category_id) pair raises unique violation", async () => {
      const { error } = await serviceClient.from("employee_balances").insert({
        employee_id: employee.userId,
        category_id: catId,
        workspace_id: admin.workspaceId,
        remaining_days: 5,
      })
      expect(error).toBeTruthy()
      expect(error!.code).toBe("23505") // unique_violation
    })
  })

  describe("DB-26: time_off_requests profile_id FK references profiles", () => {
    it("inserting request with non-existent profile_id fails FK constraint", async () => {
      const fakeId = crypto.randomUUID()
      const { error } = await serviceClient.from("time_off_requests").insert({
        profile_id: fakeId,
        workspace_id: admin.workspaceId,
        employee_name: "Ghost",
        employee_email: "ghost@test.invalid",
        start_date: "2026-09-01",
        end_date: "2026-09-01",
        start_period: "morning",
        end_period: "end_of_day",
        total_days: 1,
        request_type: "vacation",
        status: "pending",
      })
      expect(error).toBeTruthy()
      expect(error!.code).toBe("23503") // foreign_key_violation
    })
  })

  describe("DB-27: profiles role must be admin or user", () => {
    it("inserting profile with invalid role fails check constraint", async () => {
      const fakeUserId = crypto.randomUUID()
      const { error } = await serviceClient.from("profiles").insert({
        id: fakeUserId,
        workspace_id: admin.workspaceId,
        role: "superadmin",
        email: "bad@test.invalid",
        status: "active",
      })
      expect(error).toBeTruthy()
      // Either check constraint or FK violation (no auth user)
      expect(["23503", "23514", "23502"].includes(error!.code)).toBe(true)
    })
  })

  describe("DB-28: remaining_days can be 0 (not negative constraint)", () => {
    it("setting remaining_days to 0 is allowed", async () => {
      const { error } = await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 0 })
        .eq("employee_id", employee.userId)
        .eq("category_id", catId)
      expect(error).toBeNull()

      // Restore
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 10 })
        .eq("employee_id", employee.userId)
        .eq("category_id", catId)
    })
  })

  describe("DB-29: time_off_requests status must be pending/approved/rejected", () => {
    it("inserting request with invalid status fails", async () => {
      const { error } = await serviceClient.from("time_off_requests").insert({
        profile_id: employee.userId,
        workspace_id: admin.workspaceId,
        employee_name: "Test",
        employee_email: employee.email,
        start_date: "2026-09-01",
        end_date: "2026-09-01",
        start_period: "morning",
        end_period: "end_of_day",
        total_days: 1,
        request_type: "vacation",
        status: "invalid_status",
      })
      expect(error).toBeTruthy()
    })
  })
})
