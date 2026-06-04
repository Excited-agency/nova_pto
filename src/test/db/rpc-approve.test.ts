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

describe.skipIf(skipIfNoServiceKey())("RPC: approve_time_off_request (DB-1..8)", () => {

  let admin: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let categoryId: string

  beforeAll(async () => {
    admin = await createIsolatedWorkspace("admin")
    employee = await createIsolatedWorkspace("user")

    // Move employee into admin's workspace
    await serviceClient
      .from("profiles")
      .update({ workspace_id: admin.workspaceId })
      .eq("id", employee.userId)

    // Create a paid time-off category
    const { data: cat, error: catError } = await serviceClient
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
    if (catError) throw new Error(`cat: ${catError.message}`)
    categoryId = cat.id

    // Allocate 10 days balance (trigger may have already seeded it, so upsert)
    await serviceClient.from("employee_balances").upsert({
      employee_id: employee.userId,
      category_id: categoryId,
      workspace_id: admin.workspaceId,
      remaining_days: 10,
    }, { onConflict: "employee_id,category_id" })

    // Remove any holidays from the test workspace so business-day calculations are deterministic
    await serviceClient.from("holidays").delete().eq("workspace_id", admin.workspaceId)
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 15_000)

  describe("DB-1: approve sets status to approved", () => {
    it("request status changes from pending to approved", async () => {
      const req = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

      const { error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: req.id,
      })
      expect(error).toBeNull()

      const { data } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", req.id)
        .single()
      expect(data?.status).toBe("approved")

      // Cleanup
      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
    })
  })

  describe("DB-2: balance deduction is atomic", () => {
    it("approving a 5-day request deducts exactly 5 from remaining_days", async () => {
      // Get current balance
      const { data: before } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()

      const req = await seedPendingRequest(employee.userId, admin.workspaceId, {
        categoryId,
      })
      // The request spans 2026-06-01 to 2026-06-05 (Mon-Fri = 5 business days)
      const { error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: req.id,
      })
      expect(error).toBeNull()

      const { data: after } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()

      expect(after!.remaining_days).toBe(before!.remaining_days - 5)

      // Restore balance and cleanup
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: before!.remaining_days })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
    })
  })

  describe("DB-3: insufficient balance → exception, balance unchanged", () => {
    it("approve fails when remaining_days < request days", async () => {
      // Set balance to 2 (less than 5-day request)
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 2 })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)

      const req = await seedPendingRequest(employee.userId, admin.workspaceId, {
        categoryId,
      })
      const { error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: req.id,
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/insufficient balance/i)

      // Balance must be unchanged
      const { data: balance } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()
      expect(balance!.remaining_days).toBe(2)

      // Request stays pending
      const { data: req2 } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", req.id)
        .single()
      expect(req2?.status).toBe("pending")

      // Restore and cleanup
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 10 })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
    })
  })

  describe("DB-4: already approved request → exception", () => {
    it("approving an already-approved request raises an error", async () => {
      const req = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })
      await admin.userClient.rpc("approve_time_off_request", { p_request_id: req.id })

      const { error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: req.id,
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/not pending/i)

      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
      // Restore balance
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 10 })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
    })
  })

  describe("DB-5: non-existent request → exception", () => {
    it("approving a random UUID raises request not found", async () => {
      const { error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: crypto.randomUUID(),
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/not found|permission denied/i)
    })
  })

  describe("DB-6: weekends excluded from business-day calc", () => {
    it("Mon-Fri week = 5 days deducted, not 7", async () => {
      const { data: before } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()

      // 2026-06-01 (Mon) to 2026-06-07 (Sun) = 5 business days
      const { data: req, error: insErr } = await serviceClient
        .from("time_off_requests")
        .insert({
          profile_id: employee.userId,
          workspace_id: admin.workspaceId,
          category_id: categoryId,
          employee_name: "Test Employee",
          employee_email: "emp@test.invalid",
          start_date: "2026-06-01",
          end_date: "2026-06-07",
          start_period: "morning",
          end_period: "end_of_day",
          total_days: 7,
          request_type: "vacation",
          status: "pending",
        })
        .select()
        .single()
      if (insErr) throw new Error(insErr.message)

      const { error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: req.id,
      })
      expect(error).toBeNull()

      const { data: after } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()

      // Only 5 business days should be deducted (Mon-Fri), not 7
      expect(after!.remaining_days).toBe(before!.remaining_days - 5)

      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: before!.remaining_days })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
    })
  })

  describe("DB-7: unlimited category skips balance check", () => {
    it("approving unlimited category request works regardless of balance", async () => {
      const { data: unlimitedCat } = await serviceClient
        .from("time_off_categories")
        .insert({
          workspace_id: admin.workspaceId,
          name: "Sick Leave",
          colour: "orange",
          is_active: true,
          leave_type: "paid",
          accrual_method: "unlimited",
          granting_frequency: "yearly",
          new_hire_rule: "immediate",
          waiting_period_value: 0,
          waiting_period_unit: "month",
          carryover_limit_enabled: false,
          sort_order: 1,
        })
        .select("id")
        .single()

      const req = await seedPendingRequest(employee.userId, admin.workspaceId, {
        categoryId: unlimitedCat!.id,
      })

      const { error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: req.id,
      })
      // No balance row needed for unlimited
      expect(error).toBeNull()

      const { data: status } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", req.id)
        .single()
      expect(status?.status).toBe("approved")

      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
      await serviceClient.from("time_off_categories").delete().eq("id", unlimitedCat!.id)
    })
  })

  describe("DB-8: employee cannot call approve_time_off_request", () => {
    it("non-admin role gets permission denied", async () => {
      const req = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })
      const { error } = await employee.userClient.rpc("approve_time_off_request", {
        p_request_id: req.id,
      })
      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/permission denied/i)

      // Request stays pending
      const { data } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", req.id)
        .single()
      expect(data?.status).toBe("pending")

      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
    })
  })

  describe("DB-A1: approve inserts a balance_adjustment_log row", () => {
    it("log row has correct delta, reason, and adjusted_by after approval", async () => {
      const { data: before } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
        .single()

      const req = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

      const { error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: req.id,
      })
      expect(error).toBeNull()

      const { data: logs } = await serviceClient
        .from("balance_adjustment_log")
        .select("*")
        .eq("employee_id", employee.userId)
        .eq("request_id", req.id)

      expect(logs).toHaveLength(1)
      const log = logs![0]
      expect(log.delta).toBe(-5)
      expect(log.balance_before).toBe(before!.remaining_days)
      expect(log.balance_after).toBe(before!.remaining_days - 5)
      expect(log.reason).toBe("request_approved")
      expect(log.adjusted_by).toBe(admin.userId)

      // Restore
      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: before!.remaining_days })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
    })
  })

  describe("DB-A2: approve stamps reviewed_by and reviewed_at on the request", () => {
    it("request row has reviewed_by = admin.userId and reviewed_at IS NOT NULL after approval", async () => {
      const req = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

      const { error } = await admin.userClient.rpc("approve_time_off_request", {
        p_request_id: req.id,
      })
      expect(error).toBeNull()

      const { data: reviewed } = await serviceClient
        .from("time_off_requests")
        .select("reviewed_by, reviewed_at")
        .eq("id", req.id)
        .single()

      expect(reviewed?.reviewed_by).toBe(admin.userId)
      expect(reviewed?.reviewed_at).not.toBeNull()

      // Restore
      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
      await serviceClient
        .from("employee_balances")
        .update({ remaining_days: 10 })
        .eq("employee_id", employee.userId)
        .eq("category_id", categoryId)
    })
  })

  describe("DB-R1: reject stamps reviewed_by and reviewed_at on the request", () => {
    it("request row has reviewed_by = admin.userId and reviewed_at IS NOT NULL after rejection", async () => {
      const req = await seedPendingRequest(employee.userId, admin.workspaceId, { categoryId })

      const { error } = await admin.userClient.rpc("reject_time_off_request", {
        p_request_id: req.id,
        p_rejection_reason: "No coverage available",
      })
      expect(error).toBeNull()

      const { data: reviewed } = await serviceClient
        .from("time_off_requests")
        .select("status, reviewed_by, reviewed_at")
        .eq("id", req.id)
        .single()

      expect(reviewed?.status).toBe("rejected")
      expect(reviewed?.reviewed_by).toBe(admin.userId)
      expect(reviewed?.reviewed_at).not.toBeNull()

      // Cleanup
      await serviceClient.from("time_off_requests").delete().eq("id", req.id)
    })
  })
})
