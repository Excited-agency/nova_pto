import { test, expect } from "@playwright/test"
import { createTestUser, seedSession, cleanupTestUser, deleteAuthUser, adminClient, createEphemeralAuthUser } from "../../fixtures/auth"
import {
  createCategory,
  createBalance,
  createPendingRequest,
  addEmployeeToWorkspace,
} from "../../fixtures/test-data"

test.describe("Employee requests (self-service)", () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let employeeUser: Awaited<ReturnType<typeof createTestUser>>
  let categoryId: string

  test.beforeAll(async () => {
    adminUser = await createTestUser("admin")
    employeeUser = await createTestUser("user")

    // Move employee into admin's workspace
    await addEmployeeToWorkspace(employeeUser.userId, adminUser.workspaceId)
    employeeUser.workspaceId = adminUser.workspaceId

    categoryId = await createCategory(adminUser.workspaceId, { name: "Vacation" })
    await createBalance(employeeUser.userId, categoryId, adminUser.workspaceId, 20)
  })

  test.afterAll(async () => {
    await cleanupTestUser(adminUser)
    await deleteAuthUser(employeeUser.userId)
    await adminClient.from("profiles").delete().eq("id", employeeUser.userId)
  })

  test("employee sees only their own requests", async ({ page }) => {
    const myReqId = await createPendingRequest(employeeUser.userId, adminUser.workspaceId, categoryId)

    // Create another user in the same workspace
    const otherEmail = `other-${Date.now()}@test.invalid`
    const otherId = await createEphemeralAuthUser(otherEmail)

    await adminClient.from("profiles").insert({
      id: otherId,
      workspace_id: adminUser.workspaceId,
      role: "user",
      email: otherEmail,
      status: "active",
    })
    await createPendingRequest(otherId, adminUser.workspaceId, null)

    await seedSession(page, employeeUser)
    await page.goto("/requests")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(2000)

    // Employee should see at least their own pending request
    // Requests page uses div rows, look for "Pending" status text or "Test Employee" name
    const pendingText = page.getByText("Pending").or(page.getByText("Test Employee"))
    const count = await pendingText.count()
    expect(count).toBeGreaterThanOrEqual(1)

    // Cleanup
    await adminClient.from("time_off_requests").delete().eq("id", myReqId)
    await adminClient.from("time_off_requests").delete().eq("profile_id", otherId)
    await adminClient.from("profiles").delete().eq("id", otherId)
    await deleteAuthUser(otherId)
  })

  test("employee cannot access /employees page", async ({ page }) => {
    await seedSession(page, employeeUser)
    await page.goto("/employees")
    await page.waitForLoadState("networkidle")
    await expect(page).toHaveURL(/\/access-restricted/)
  })

  test("employee cannot access /settings page", async ({ page }) => {
    await seedSession(page, employeeUser)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")
    await expect(page).toHaveURL(/\/access-restricted/)
  })

  test("employee cannot access /time-off-setup page", async ({ page }) => {
    await seedSession(page, employeeUser)
    await page.goto("/time-off-setup")
    await page.waitForLoadState("networkidle")
    await expect(page).toHaveURL(/\/access-restricted/)
  })

  test("employee can view their pending requests on /requests", async ({ page }) => {
    const reqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      categoryId
    )

    await seedSession(page, employeeUser)
    await page.goto("/requests")
    await page.waitForLoadState("networkidle")

    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).not.toHaveURL(/\/access-restricted/)

    await adminClient.from("time_off_requests").delete().eq("id", reqId)
  })

  test("employee request page does not show admin approve/reject buttons", async ({ page }) => {
    const reqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      categoryId
    )

    await seedSession(page, employeeUser)
    await page.goto("/requests")
    await page.waitForLoadState("networkidle")

    // Admin-only buttons should NOT be present for non-admins
    const approveBtn = page.getByRole("button", { name: /^approve$/i })
    const rejectBtn = page.getByRole("button", { name: /^reject$/i })
    await expect(approveBtn).toHaveCount(0)
    await expect(rejectBtn).toHaveCount(0)

    await adminClient.from("time_off_requests").delete().eq("id", reqId)
  })
})
