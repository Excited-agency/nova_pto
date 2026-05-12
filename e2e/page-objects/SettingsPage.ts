import type { Page } from "@playwright/test"

export class SettingsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/settings")
    await this.page.waitForLoadState("networkidle")
  }

  async fillWorkspaceName(name: string) {
    const input = this.page.getByRole("textbox", { name: /workspace name/i })
    await input.clear()
    await input.fill(name)
  }

  async saveWorkspaceSettings() {
    await this.page.getByRole("button", { name: /save/i }).first().click()
  }

  async fillDangerZoneConfirmation(name: string) {
    await this.page.getByRole("textbox", { name: /type.*name|confirm/i }).fill(name)
  }

  async clickDeleteWorkspace() {
    await this.page.getByRole("button", { name: /delete workspace/i }).click()
  }

  deleteWorkspaceButton() {
    return this.page.getByRole("button", { name: /delete workspace/i })
  }
}
