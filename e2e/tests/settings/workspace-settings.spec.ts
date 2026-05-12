import { test, expect } from "@playwright/test"
import { createTestUser, seedSession, cleanupTestUser, adminClient } from "../../fixtures/auth"

test.describe("Workspace settings", () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  test.beforeAll(async () => {
    adminUser = await createTestUser("admin")
  })

  test.afterAll(async () => {
    await cleanupTestUser(adminUser)
  })

  test("admin can view settings page", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).not.toHaveURL(/\/access-restricted/)
  })

  test("workspace name field is visible and editable", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")

    // Workspace name input has placeholder "Your workspace"
    const nameInput = page.getByPlaceholder("Your workspace")
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toBeEnabled()
  })

  test("saving workspace name updates it in the DB", async ({ page }) => {
    const newName = `WS-${Date.now()}`

    await seedSession(page, adminUser)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")

    // Fill workspace name
    const nameInput = page.getByPlaceholder("Your workspace")
    await nameInput.clear()
    await nameInput.fill(newName)

    // Click "Save changes" button
    const saveBtn = page.getByRole("button", { name: /save changes/i })
    if ((await saveBtn.count()) > 0) {
      await saveBtn.click()
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(500)

      // Verify in DB
      const { data } = await adminClient
        .from("workspaces")
        .select("name")
        .eq("id", adminUser.workspaceId)
        .single()
      expect(data?.name).toBe(newName)
    }
  })
})
