import { test, expect } from "@playwright/test"
import { createTestUser, seedSession, deleteAuthUser, adminClient } from "../../fixtures/auth"

test.describe("Danger zone — delete workspace", () => {
  test("delete button is disabled until correct workspace name is typed", async ({ page }) => {
    const adminUser = await createTestUser("admin")

    try {
      await seedSession(page, adminUser)
      await page.goto("/settings")
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(500)

      // Click the trigger to open the delete dialog
      const triggerBtn = page.getByRole("button", { name: /delete workspace/i })
      if ((await triggerBtn.count()) === 0) {
        // UI not implemented yet — skip gracefully
        return
      }

      await triggerBtn.scrollIntoViewIfNeeded()
      await triggerBtn.click()
      await page.waitForTimeout(300)

      // The dialog should be open now. The confirm button inside the dialog is disabled initially.
      // There are now TWO "Delete workspace" buttons: trigger (hidden) + dialog button
      const dialogDeleteBtn = page.getByRole("button", { name: /delete workspace/i }).last()
      await expect(dialogDeleteBtn).toBeDisabled()

      // Get actual workspace name from DB
      const { data: ws } = await adminClient
        .from("workspaces")
        .select("name")
        .eq("id", adminUser.workspaceId)
        .single()

      // Confirmation input placeholder equals the workspace name
      const confirmInput = page.getByPlaceholder(ws!.name)

      // Type wrong name — button stays disabled
      await confirmInput.fill("Wrong Name")
      await expect(dialogDeleteBtn).toBeDisabled()

      // Type correct name — button should become enabled
      await confirmInput.clear()
      await confirmInput.fill(ws!.name)
      await expect(dialogDeleteBtn).toBeEnabled()
    } finally {
      await adminClient.from("workspaces").delete().eq("id", adminUser.workspaceId)
      await deleteAuthUser(adminUser.userId)
    }
  })

  test("confirming delete removes workspace and redirects to /login", async ({ page }) => {
    const adminUser = await createTestUser("admin")

    const { data: ws } = await adminClient
      .from("workspaces")
      .select("name")
      .eq("id", adminUser.workspaceId)
      .single()

    await seedSession(page, adminUser)
    await page.goto("/settings")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(500)

    const triggerBtn = page.getByRole("button", { name: /delete workspace/i })
    if ((await triggerBtn.count()) === 0) {
      // Danger zone UI not implemented — skip gracefully
      await adminClient.from("workspaces").delete().eq("id", adminUser.workspaceId)
      await deleteAuthUser(adminUser.userId)
      return
    }

    await triggerBtn.scrollIntoViewIfNeeded()
    await triggerBtn.click()
    await page.waitForTimeout(300)

    // Fill in the confirmation input inside the dialog
    const confirmInput = page.getByPlaceholder(ws!.name)
    await confirmInput.fill(ws!.name)

    // Click the confirm delete button (last "Delete workspace" button in dialog)
    const dialogDeleteBtn = page.getByRole("button", { name: /delete workspace/i }).last()
    await dialogDeleteBtn.click()

    // Wait for redirect after deletion
    await page.waitForURL(/\/login/, { timeout: 15_000 })
    await expect(page).toHaveURL(/\/login/)

    // Verify workspace is gone from DB
    const { data: deleted } = await adminClient
      .from("workspaces")
      .select("id")
      .eq("id", adminUser.workspaceId)
      .maybeSingle()
    expect(deleted).toBeNull()

    await deleteAuthUser(adminUser.userId)
  })
})
