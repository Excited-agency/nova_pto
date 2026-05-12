import { test, expect } from "@playwright/test"
import { createTestUser, seedSession, cleanupTestUser } from "../../fixtures/auth"

test.describe("Route protection", () => {
  test("unauthenticated user is redirected to /login from /requests", async ({ page }) => {
    await page.goto("/requests")
    await expect(page).toHaveURL(/\/login/)
  })

  test("unauthenticated user is redirected to /login from /employees", async ({ page }) => {
    await page.goto("/employees")
    await expect(page).toHaveURL(/\/login/)
  })

  test("unauthenticated user is redirected to /login from /settings", async ({ page }) => {
    await page.goto("/settings")
    await expect(page).toHaveURL(/\/login/)
  })

  test("unauthenticated user is redirected to /login from /time-off-setup", async ({ page }) => {
    await page.goto("/time-off-setup")
    await expect(page).toHaveURL(/\/login/)
  })

  test.describe("Admin access", () => {
    let adminUser: Awaited<ReturnType<typeof createTestUser>>

    test.beforeAll(async () => {
      adminUser = await createTestUser("admin")
    })

    test.afterAll(async () => {
      await cleanupTestUser(adminUser)
    })

    test("admin can access /requests", async ({ page }) => {
      await seedSession(page, adminUser)
      await page.goto("/requests")
      await page.waitForLoadState("networkidle")
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page).not.toHaveURL(/\/access-restricted/)
    })

    test("admin can access /employees", async ({ page }) => {
      await seedSession(page, adminUser)
      await page.goto("/employees")
      await page.waitForLoadState("networkidle")
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page).not.toHaveURL(/\/access-restricted/)
    })

    test("admin can access /settings", async ({ page }) => {
      await seedSession(page, adminUser)
      await page.goto("/settings")
      await page.waitForLoadState("networkidle")
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page).not.toHaveURL(/\/access-restricted/)
    })

    test("admin can access /time-off-setup", async ({ page }) => {
      await seedSession(page, adminUser)
      await page.goto("/time-off-setup")
      await page.waitForLoadState("networkidle")
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page).not.toHaveURL(/\/access-restricted/)
    })
  })

  test.describe("Employee (non-admin) access restrictions", () => {
    let employeeUser: Awaited<ReturnType<typeof createTestUser>>

    test.beforeAll(async () => {
      employeeUser = await createTestUser("user")
    })

    test.afterAll(async () => {
      await cleanupTestUser(employeeUser)
    })

    test("employee accessing /employees is redirected to /access-restricted", async ({ page }) => {
      await seedSession(page, employeeUser)
      await page.goto("/employees")
      await page.waitForLoadState("networkidle")
      await expect(page).toHaveURL(/\/access-restricted/)
    })

    test("employee accessing /settings sees their own user settings page", async ({ page }) => {
      await seedSession(page, employeeUser)
      await page.goto("/settings")
      await page.waitForLoadState("networkidle")
      await expect(page).not.toHaveURL(/\/access-restricted/)
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page).toHaveURL(/\/settings/)
    })

    test("employee accessing /time-off-setup is redirected to /access-restricted", async ({
      page,
    }) => {
      await seedSession(page, employeeUser)
      await page.goto("/time-off-setup")
      await page.waitForLoadState("networkidle")
      await expect(page).toHaveURL(/\/access-restricted/)
    })

    test("employee can access /requests (own view)", async ({ page }) => {
      await seedSession(page, employeeUser)
      await page.goto("/requests")
      await page.waitForLoadState("networkidle")
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page).not.toHaveURL(/\/access-restricted/)
    })
  })
})
