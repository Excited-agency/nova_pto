import { test, expect, type Page } from "@playwright/test"
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

  /**
   * The list is built from divs, not a <table>, so rows are addressed by
   * data-slot="employee-row" (employees.tsx). Counting them is what makes the
   * search assertions meaningful — a selector that matches nothing would make
   * "the filter returned no rows" true whether or not filtering works.
   */
  const rows = (page: Page) => page.locator('[data-slot="employee-row"]')

  test("employees table shows workspace members", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/employees")

    // Admin and the employee moved into the workspace — both must be listed.
    // Scoped to rows: the signed-in admin's email also appears in the sidebar.
    await expect(rows(page)).toHaveCount(2)
    await expect(rows(page).filter({ hasText: adminUser.email })).toHaveCount(1)
    await expect(rows(page).filter({ hasText: employeeUser.email })).toHaveCount(1)
  })

  test("search narrows the list, and clearing it restores the list", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/employees")
    await expect(rows(page)).toHaveCount(2)

    const searchBox = page.getByPlaceholder("Search for employees...")

    // A term nobody matches empties the list. Asserted against a selector that
    // is known to match when the list is populated, so zero means filtered.
    await searchBox.fill("ZZZNOMATCH999")
    await expect(rows(page)).toHaveCount(0)

    // A term matching exactly one employee leaves exactly that one.
    await searchBox.fill(employeeUser.email)
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).filter({ hasText: employeeUser.email })).toHaveCount(1)

    await searchBox.clear()
    await expect(rows(page)).toHaveCount(2)
  })

  test("clicking an employee row opens that employee's details", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/employees")
    await expect(rows(page)).toHaveCount(2)

    // Click the row for a known employee, and check the URL carries that
    // employee's id — not merely that the path changed.
    await rows(page).filter({ hasText: employeeUser.email }).click()

    await expect(page).toHaveURL(new RegExp(`/employees/${employeeUser.userId}$`))
  })
})
