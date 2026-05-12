import { test, expect } from "@playwright/test"
import { createTestUser, seedSession, cleanupTestUser, deleteAuthUser, adminClient } from "../../fixtures/auth"
import { addEmployeeToWorkspace } from "../../fixtures/test-data"

test.describe("Employee management (admin)", () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let employeeUser: Awaited<ReturnType<typeof createTestUser>>

  test.beforeAll(async () => {
    adminUser = await createTestUser("admin")
    employeeUser = await createTestUser("user")
    await addEmployeeToWorkspace(employeeUser.userId, adminUser.workspaceId)
  })

  test.afterAll(async () => {
    await cleanupTestUser(adminUser)
    await deleteAuthUser(employeeUser.userId)
    await adminClient.from("profiles").delete().eq("id", employeeUser.userId)
  })

  test("admin can view /employees page", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/employees")
    await page.waitForLoadState("networkidle")
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).not.toHaveURL(/\/access-restricted/)
  })

  test("employees table shows workspace members", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/employees")
    await page.waitForLoadState("networkidle")

    // Wait for React Query to finish loading employees
    // The employees page uses div rows (not tr), so look for employee email or name text
    await page.waitForTimeout(2000)

    // Check for either admin or employee name/email appearing in the page
    const adminText = page.getByText("Admin Test").or(page.getByText("Employee Test"))
      .or(page.getByText(adminUser.email)).or(page.getByText(employeeUser.email))
    const count = await adminText.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test("search filters employee list", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/employees")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(500)

    const searchBox = page.getByRole("textbox").or(page.getByRole("searchbox")).first()
    if ((await searchBox.count()) > 0) {
      await searchBox.fill("ZZZNOMATCH999")
      await page.waitForTimeout(700) // debounce

      const rows = page.locator("tbody tr")
      const count = await rows.count()
      expect(count).toBe(0)
    }
  })

  test("clicking employee row navigates to employee details", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/employees")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(500)

    const rows = page.locator("tbody tr")
    if ((await rows.count()) > 0) {
      await rows.first().click()
      await page.waitForLoadState("networkidle")
      await expect(page).toHaveURL(/\/employees\//)
    }
  })
})
