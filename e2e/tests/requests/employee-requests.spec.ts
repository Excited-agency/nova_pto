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
    // The employee's row shows category, period, comment and status — no name
    // (employee-requests.tsx). So the comment is the only field that can carry
    // a marker distinguishing one person's request from another's.
    const tag = Date.now()
    const mine = `MINE-${tag}`
    const theirs = `THEIRS-${tag}`

    const myReqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      categoryId,
      { comment: mine }
    )

    // Another user in the same workspace, whose request must stay invisible.
    const otherEmail = `other-${tag}@test.invalid`
    const otherId = await createEphemeralAuthUser(otherEmail)

    await adminClient.from("profiles").insert({
      id: otherId,
      workspace_id: adminUser.workspaceId,
      role: "user",
      email: otherEmail,
      status: "active",
    })
    await createPendingRequest(otherId, adminUser.workspaceId, null, { comment: theirs })

    try {
      await seedSession(page, employeeUser)
      await page.goto("/requests")

      // Own request present first — that also proves the list finished loading,
      // which is what makes the absence check below mean something.
      await expect(page.getByText(mine)).toBeVisible()
      await expect(page.getByText(theirs)).toHaveCount(0)
    } finally {
      await adminClient.from("time_off_requests").delete().eq("id", myReqId)
      await adminClient.from("time_off_requests").delete().eq("profile_id", otherId)
      await adminClient.from("profiles").delete().eq("id", otherId)
      await deleteAuthUser(otherId)
    }
  })

  test("employee cannot access /employees page", async ({ page }) => {
    await seedSession(page, employeeUser)
    await page.goto("/employees")
    await page.waitForLoadState("networkidle")
    await expect(page).toHaveURL(/\/access-restricted/)
  })

  test("employee can access /settings page (user settings)", async ({ page }) => {
    await seedSession(page, employeeUser)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")
    await expect(page).not.toHaveURL(/\/access-restricted/)
    await expect(page).not.toHaveURL(/\/login/)
  })

  test("employee cannot access /time-off-setup page", async ({ page }) => {
    await seedSession(page, employeeUser)
    await page.goto("/time-off-setup")
    await page.waitForLoadState("networkidle")
    await expect(page).toHaveURL(/\/access-restricted/)
  })

  test("employee can view their pending requests on /requests", async ({ page }) => {
    const marker = `VIEW-${Date.now()}`
    const reqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      categoryId,
      { comment: marker }
    )

    try {
      await seedSession(page, employeeUser)
      await page.goto("/requests")

      await expect(page).not.toHaveURL(/\/login/)
      await expect(page).not.toHaveURL(/\/access-restricted/)
      // The point of the test is the row, not just the route.
      await expect(page.getByText(marker)).toBeVisible()
      await expect(page.getByText("Pending")).toBeVisible()
    } finally {
      await adminClient.from("time_off_requests").delete().eq("id", reqId)
    }
  })

  test("employee request page does not show admin approve/reject buttons", async ({ page }) => {
    const reqId = await createPendingRequest(
      employeeUser.userId,
      adminUser.workspaceId,
      categoryId
    )

    try {
      await seedSession(page, employeeUser)
      await page.goto("/requests")

      // These are the row buttons' real accessible names (request-row.tsx);
      // the same patterns are clicked successfully in admin-requests.spec.ts,
      // so a zero count here means absent rather than merely unmatched.
      await expect(page.getByRole("button", { name: /^Approve request from / })).toHaveCount(0)
      await expect(page.getByRole("button", { name: /^Reject request from / })).toHaveCount(0)
    } finally {
      await adminClient.from("time_off_requests").delete().eq("id", reqId)
    }
  })
})
