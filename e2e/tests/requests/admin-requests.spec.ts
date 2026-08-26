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

  test("admin can approve a pending request, and the balance is deducted", async ({ page }) => {
    // The row's buttons are icon-only; their accessible name carries the
    // employee name, so a marker makes exactly one button addressable.
    const marker = `APPROVE-${Date.now()}`
    const reqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      categoryId,
      {
        start_date: "2026-09-01", // Tuesday — one business day
        end_date: "2026-09-01",
        total_days: 1,
        employee_name: marker,
      }
    )

    try {
      await seedSession(page, adminUser)
      await page.goto("/requests")

      await page.getByRole("button", { name: `Approve request from ${marker}` }).click()

      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: "Approve request" }).click()

      await expect
        .poll(
          async () => {
            const { data } = await adminClient
              .from("time_off_requests")
              .select("status")
              .eq("id", reqId)
              .single()
            return data?.status
          },
          { timeout: 10_000 }
        )
        .toBe("approved")

      // Approval spends balance in the same transaction, so 20 - 1 = 19.
      const { data: balance } = await adminClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("employee_id", employeeUser.userId)
        .eq("category_id", categoryId)
        .single()
      expect(balance?.remaining_days).toBe(19)
    } finally {
      await adminClient.from("time_off_requests").delete().eq("id", reqId)
      await adminClient
        .from("employee_balances")
        .update({ remaining_days: 20 })
        .eq("employee_id", employeeUser.userId)
        .eq("category_id", categoryId)
    }
  })

  test("admin can reject a pending request, and the reason is stored", async ({ page }) => {
    const marker = `REJECT-${Date.now()}`
    const reason = "Insufficient coverage"
    const reqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      categoryId,
      {
        start_date: "2026-09-02",
        end_date: "2026-09-02",
        total_days: 1,
        employee_name: marker,
      }
    )

    try {
      await seedSession(page, adminUser)
      await page.goto("/requests")

      await page.getByRole("button", { name: `Reject request from ${marker}` }).click()

      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()

      // Rejecting without a reason must not be possible.
      const confirm = dialog.getByRole("button", { name: "Reject request" })
      await expect(confirm).toBeDisabled()

      await dialog.getByPlaceholder("Type reason here").fill(reason)
      await expect(confirm).toBeEnabled()
      await confirm.click()

      await expect
        .poll(
          async () => {
            const { data } = await adminClient
              .from("time_off_requests")
              .select("status, rejection_reason")
              .eq("id", reqId)
              .single()
            return data
          },
          { timeout: 10_000 }
        )
        .toMatchObject({ status: "rejected", rejection_reason: reason })
    } finally {
      await adminClient.from("time_off_requests").delete().eq("id", reqId)
    }
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

    try {
      await seedSession(page, adminUser)
      await page.goto("/requests")

      // A web-first assertion retries until the row renders, so the page needs
      // no fixed wait — and a genuine failure is reported instead of a count.
      await expect(page.getByText("UNIQUE_MARKER_EMP").first()).toBeVisible()
    } finally {
      await adminClient.from("time_off_requests").delete().eq("id", reqId)
    }
  })
})
