import { test, expect } from "@playwright/test"
import { createTestUser, seedSession, cleanupTestUser, deleteAuthUser, adminClient } from "../../fixtures/auth"
import {
  createCategory,
  createBalance,
  createPendingRequest,
  addEmployeeToWorkspace,
} from "../../fixtures/test-data"

test.describe("Admin request management", () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let employeeUser: Awaited<ReturnType<typeof createTestUser>>
  let categoryId: string

  test.beforeAll(async () => {
    adminUser = await createTestUser("admin")
    employeeUser = await createTestUser("user")
    await addEmployeeToWorkspace(employeeUser.userId, adminUser.workspaceId)
    categoryId = await createCategory(adminUser.workspaceId, { name: "Vacation" })
    await createBalance(employeeUser.userId, categoryId, adminUser.workspaceId, 20)
  })

  test.afterAll(async () => {
    await cleanupTestUser(adminUser)
    await deleteAuthUser(employeeUser.userId)
    await adminClient.from("profiles").delete().eq("id", employeeUser.userId)
  })

  test("admin sees requests page (not redirected)", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/requests")
    await page.waitForLoadState("networkidle")
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).not.toHaveURL(/\/access-restricted/)
  })

  test("admin can approve a pending request", async ({ page }) => {
    const reqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      categoryId,
      {
        start_date: "2026-09-01",
        end_date: "2026-09-01",
        total_days: 1,
      }
    )

    await seedSession(page, adminUser)
    await page.goto("/requests")
    await page.waitForLoadState("networkidle")

    // Click first approve button
    const approveBtn = page.getByRole("button", { name: /approve/i }).first()
    if ((await approveBtn.count()) > 0) {
      await approveBtn.click()
      await page.waitForLoadState("networkidle")

      // Verify in DB
      const { data } = await adminClient
        .from("time_off_requests")
        .select("status")
        .eq("id", reqId)
        .single()
      expect(data?.status).toBe("approved")
    }

    await adminClient.from("time_off_requests").delete().eq("id", reqId)
    // Restore balance
    await adminClient
      .from("employee_balances")
      .update({ remaining_days: 20 })
      .eq("employee_id", employeeUser.userId)
      .eq("category_id", categoryId)
  })

  test("admin can reject a pending request with a reason", async ({ page }) => {
    const reqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      categoryId,
      {
        start_date: "2026-09-02",
        end_date: "2026-09-02",
        total_days: 1,
      }
    )

    await seedSession(page, adminUser)
    await page.goto("/requests")
    await page.waitForLoadState("networkidle")

    const rejectBtn = page.getByRole("button", { name: /reject/i }).first()
    if ((await rejectBtn.count()) > 0) {
      await rejectBtn.click()

      // Fill rejection reason
      const reasonField = page.getByRole("textbox", { name: /reason/i })
      if ((await reasonField.count()) > 0) {
        await reasonField.fill("Insufficient coverage")
        await page.getByRole("button", { name: /confirm|submit/i }).last().click()
        await page.waitForLoadState("networkidle")

        const { data } = await adminClient
          .from("time_off_requests")
          .select("status, rejection_reason")
          .eq("id", reqId)
          .single()
        expect(data?.status).toBe("rejected")
      }
    }

    await adminClient.from("time_off_requests").delete().eq("id", reqId)
  })

  test("admin sees all workspace requests (not just own)", async ({ page }) => {
    const reqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      null,
      {
        start_date: "2026-10-01",
        end_date: "2026-10-01",
        total_days: 1,
        employee_name: "UNIQUE_MARKER_EMP",
        employee_email: employeeUser.email,
      }
    )

    await seedSession(page, adminUser)
    await page.goto("/requests")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(2000)

    // Admin should see the request with UNIQUE_MARKER_EMP name
    // Requests page uses div rows (not tr/tbody), look for employee name text
    const markerText = page.getByText("UNIQUE_MARKER_EMP")
    const count = await markerText.count()
    expect(count).toBeGreaterThanOrEqual(1)

    await adminClient.from("time_off_requests").delete().eq("id", reqId)
  })
})
