import { test, expect } from "@playwright/test"
import { createTestUser, seedSession, deleteAuthUser, adminClient } from "../../fixtures/auth"

/**
 * Deleting a workspace is the one irreversible action in the product, so both
 * halves are pinned: the confirmation gate that stops an accidental click, and
 * the teardown itself.
 *
 * createTestUser sets owner_id to the new user, so the test admin is also the
 * owner and the danger zone renders — it is owner-only (workspace-section.tsx).
 */
test.describe("Danger zone — delete workspace", () => {
  test("delete button stays disabled until the workspace name is typed exactly", async ({ page }) => {
    const adminUser = await createTestUser("admin")

    try {
      const { data: ws } = await adminClient
        .from("workspaces")
        .select("name")
        .eq("id", adminUser.workspaceId)
        .single()

      await seedSession(page, adminUser)
      await page.goto("/settings")

      const trigger = page.getByRole("button", { name: "Delete workspace" })
      await expect(trigger).toBeVisible()
      await trigger.click()

      // Scope everything to the dialog: the trigger keeps the same accessible
      // name and stays in the DOM behind it.
      const dialog = page.getByRole("alertdialog")
      await expect(dialog).toBeVisible()
      const confirmDelete = dialog.getByRole("button", { name: "Delete workspace" })

      await expect(confirmDelete).toBeDisabled()

      const confirmInput = dialog.getByPlaceholder(ws!.name)
      await confirmInput.fill("Wrong Name")
      await expect(confirmDelete).toBeDisabled()

      // A near-miss must not pass either — the check is equality, not prefix.
      await confirmInput.fill(ws!.name.slice(0, -1))
      await expect(confirmDelete).toBeDisabled()

      await confirmInput.fill(ws!.name)
      await expect(confirmDelete).toBeEnabled()
    } finally {
      await adminClient.from("workspaces").delete().eq("id", adminUser.workspaceId)
      await deleteAuthUser(adminUser.userId)
    }
  })

  test("confirming delete removes the workspace and redirects to /login", async ({ page }) => {
    const adminUser = await createTestUser("admin")

    try {
      const { data: ws } = await adminClient
        .from("workspaces")
        .select("name")
        .eq("id", adminUser.workspaceId)
        .single()

      await seedSession(page, adminUser)
      await page.goto("/settings")

      const trigger = page.getByRole("button", { name: "Delete workspace" })
      await expect(trigger).toBeVisible()
      await trigger.click()

      const dialog = page.getByRole("alertdialog")
      await expect(dialog).toBeVisible()

      await dialog.getByPlaceholder(ws!.name).fill(ws!.name)
      await dialog.getByRole("button", { name: "Delete workspace" }).click()

      await page.waitForURL(/\/login/, { timeout: 15_000 })

      const { data: deleted } = await adminClient
        .from("workspaces")
        .select("id")
        .eq("id", adminUser.workspaceId)
        .maybeSingle()
      expect(deleted).toBeNull()
    } finally {
      // Idempotent: the successful path already removed the workspace.
      await adminClient.from("workspaces").delete().eq("id", adminUser.workspaceId)
      await deleteAuthUser(adminUser.userId)
    }
  })
})
