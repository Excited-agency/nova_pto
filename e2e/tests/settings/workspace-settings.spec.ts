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

    await expect(page.getByPlaceholder("Your workspace")).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).not.toHaveURL(/\/access-restricted/)
  })

  test("workspace name field is visible and editable", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/settings")

    const nameInput = page.getByPlaceholder("Your workspace")
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toBeEnabled()
  })

  test("saving workspace name updates it in the DB", async ({ page }) => {
    const newName = `WS-${Date.now()}`

    await seedSession(page, adminUser)
    await page.goto("/settings")

    const nameInput = page.getByPlaceholder("Your workspace")
    await expect(nameInput).toBeVisible()
    await nameInput.fill(newName)

    // Save is rendered disabled inside a tooltip until the form is dirty, so
    // reaching an enabled one also proves the dirty-state tracking works.
    const saveBtn = page.getByRole("button", { name: "Save changes" })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()

    await expect(page.getByText("Settings saved")).toBeVisible()

    // Poll the row rather than guessing how long the write takes.
    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("workspaces")
            .select("name")
            .eq("id", adminUser.workspaceId)
            .single()
          return data?.name
        },
        { timeout: 10_000 }
      )
      .toBe(newName)
  })
})
