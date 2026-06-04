import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  type IsolatedWorkspace,
} from "../security/helpers"

describe.skipIf(skipIfNoServiceKey())("Cascade deletes (DB-18..24)", () => {

  describe("DB-18..21: DELETE workspace cascades to all child tables", () => {
    let ws: IsolatedWorkspace
    let catId: string

    let reqId: string
    let balId: string
    let holidayId: string

    beforeAll(async () => {
      ws = await createIsolatedWorkspace("admin")

      // Department (created to ensure workspace cascade covers departments table)
      await serviceClient
        .from("departments")
        .insert({ workspace_id: ws.workspaceId, name: "Engineering" })

      // Category
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
      catId = cat!.id

      // Balance (auto-seeded by trigger; upsert to get the id)
      const { data: bal } = await serviceClient
        .from("employee_balances")
        .upsert({
          employee_id: ws.userId,
          category_id: catId,
          workspace_id: ws.workspaceId,
          remaining_days: 10,
        }, { onConflict: "employee_id,category_id" })
        .select("id")
        .single()
      balId = bal!.id

      // Time off request
      const { data: req } = await serviceClient
        .from("time_off_requests")
        .insert({
          profile_id: ws.userId,
          workspace_id: ws.workspaceId,
          category_id: catId,
          employee_name: "Test Admin",
          employee_email: ws.email,
          start_date: "2026-07-01",
          end_date: "2026-07-01",
          start_period: "morning",
          end_period: "end_of_day",
          total_days: 1,
          request_type: "vacation",
          status: "pending",
        })
        .select("id")
        .single()
      reqId = req!.id

      // Holiday
      const { data: holiday } = await serviceClient
        .from("holidays")
        .insert({
          workspace_id: ws.workspaceId,
          name: "Test Holiday",
          date: "2026-12-25",
          is_custom: true,
        })
        .select("id")
        .single()
      holidayId = holiday!.id
    }, 30_000)

    it("DB-18: deleting workspace removes time_off_requests", async () => {
      await serviceClient.from("workspaces").delete().eq("id", ws.workspaceId)

      const { data } = await serviceClient
        .from("time_off_requests")
        .select("id")
        .eq("id", reqId)
      expect(data).toHaveLength(0)
    })

    it("DB-19: deleting workspace removes time_off_categories", async () => {
      const { data } = await serviceClient
        .from("time_off_categories")
        .select("id")
        .eq("id", catId)
      expect(data).toHaveLength(0)
    })

    it("DB-20: deleting workspace removes employee_balances", async () => {
      const { data } = await serviceClient
        .from("employee_balances")
        .select("id")
        .eq("id", balId)
      expect(data).toHaveLength(0)
    })

    it("DB-21: deleting workspace removes holidays", async () => {
      const { data } = await serviceClient
        .from("holidays")
        .select("id")
        .eq("id", holidayId)
      expect(data).toHaveLength(0)
    })

    afterAll(async () => {
      await deleteAuthUser(ws.userId)
    })
  })

  describe("DB-22..24: DELETE profile cascades to user-owned records", () => {
    let admin: IsolatedWorkspace
    let employee: IsolatedWorkspace
    let catId: string
    let reqId: string
    let balId: string

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

      const { data: req } = await serviceClient
        .from("time_off_requests")
        .insert({
          profile_id: employee.userId,
          workspace_id: admin.workspaceId,
          category_id: catId,
          employee_name: "Test Employee",
          employee_email: employee.email,
          start_date: "2026-08-01",
          end_date: "2026-08-01",
          start_period: "morning",
          end_period: "end_of_day",
          total_days: 1,
          request_type: "vacation",
          status: "pending",
        })
        .select("id")
        .single()
      reqId = req!.id

      const { data: bal } = await serviceClient
        .from("employee_balances")
        .upsert({
          employee_id: employee.userId,
          category_id: catId,
          workspace_id: admin.workspaceId,
          remaining_days: 10,
        }, { onConflict: "employee_id,category_id" })
        .select("id")
        .single()
      balId = bal!.id
    }, 30_000)

    it("DB-22: deleting profile removes their time_off_requests", async () => {
      await serviceClient.from("profiles").delete().eq("id", employee.userId)
      await deleteAuthUser(employee.userId)

      const { data } = await serviceClient
        .from("time_off_requests")
        .select("id")
        .eq("id", reqId)
      expect(data).toHaveLength(0)
    })

    it("DB-23: deleting profile removes their employee_balances", async () => {
      const { data } = await serviceClient
        .from("employee_balances")
        .select("id")
        .eq("id", balId)
      expect(data).toHaveLength(0)
    })

    it("DB-24: workspace itself is not deleted when profile is deleted", async () => {
      const { data } = await serviceClient
        .from("workspaces")
        .select("id")
        .eq("id", admin.workspaceId)
        .maybeSingle()
      expect(data).not.toBeNull()
    })

    afterAll(async () => {
      await serviceClient.from("workspaces").delete().eq("id", admin.workspaceId)
      await deleteAuthUser(admin.userId)
    })
  })

  describe("DB-T1..T3: auto_reject trigger on soft-delete (status → 'deleted')", () => {
    let admin: IsolatedWorkspace
    let employee: IsolatedWorkspace
    let pendingReqId: string
    let approvedReqId: string
    let rejectedReqId: string

    beforeAll(async () => {
      admin = await createIsolatedWorkspace("admin")
      employee = await createIsolatedWorkspace("user")

      await serviceClient
        .from("profiles")
        .update({ workspace_id: admin.workspaceId })
        .eq("id", employee.userId)

      const insertReq = (status: string, date: string) =>
        serviceClient
          .from("time_off_requests")
          .insert({
            profile_id: employee.userId,
            workspace_id: admin.workspaceId,
            employee_name: "Test Employee",
            employee_email: employee.email,
            start_date: date,
            end_date: date,
            start_period: "morning",
            end_period: "end_of_day",
            total_days: 1,
            request_type: "vacation",
            status,
          })
          .select("id")
          .single()

      const [pending, approved, rejected] = await Promise.all([
        insertReq("pending", "2026-09-01"),
        insertReq("approved", "2026-10-01"),
        insertReq("rejected", "2026-11-01"),
      ])
      if (!pending.data || !approved.data || !rejected.data) {
        throw new Error("Failed to seed requests for trigger tests")
      }
      pendingReqId = pending.data.id
      approvedReqId = approved.data.id
      rejectedReqId = rejected.data.id
    }, 30_000)

    afterAll(async () => {
      await cleanupWorkspace(admin.workspaceId, admin.userId)
      await deleteAuthUser(employee.userId)
    }, 15_000)

    it("DB-T3: status change to 'inactive' does NOT reject pending requests", async () => {
      await serviceClient.from("profiles").update({ status: "inactive" }).eq("id", employee.userId)

      const { data } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", pendingReqId)
        .single()
      expect(data?.status).toBe("pending")

      // Restore to active for the next test
      await serviceClient.from("profiles").update({ status: "active" }).eq("id", employee.userId)
    })

    it("DB-T1: status change to 'deleted' auto-rejects all pending requests", async () => {
      await serviceClient.from("profiles").update({ status: "deleted" }).eq("id", employee.userId)

      const { data } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", pendingReqId)
        .single()
      expect(data?.status).toBe("rejected")
    })

    it("DB-T2: already-approved and already-rejected requests are not changed by the trigger", async () => {
      const { data: approved } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", approvedReqId)
        .single()
      expect(approved?.status).toBe("approved")

      const { data: rejected } = await serviceClient
        .from("time_off_requests")
        .select("status")
        .eq("id", rejectedReqId)
        .single()
      expect(rejected?.status).toBe("rejected")
    })
  })
})
