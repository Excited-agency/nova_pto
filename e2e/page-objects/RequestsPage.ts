import type { Page } from "@playwright/test"

export class RequestsPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/requests")
    await this.page.waitForLoadState("networkidle")
  }

  async waitForRequests() {
    await this.page.waitForLoadState("networkidle")
  }

  requestRows() {
    return this.page.getByRole("row").filter({ hasNot: this.page.getByRole("columnheader") })
  }

  async getRequestStatuses() {
    const badges = await this.page.locator("[data-status], [class*='badge'], [class*='status']").allTextContents()
    return badges
  }

  async clickApprove(rowIndex = 0) {
    const rows = this.requestRows()
    await rows.nth(rowIndex).getByRole("button", { name: /approve/i }).click()
  }

  async clickReject(rowIndex = 0) {
    const rows = this.requestRows()
    await rows.nth(rowIndex).getByRole("button", { name: /reject/i }).click()
  }

  async fillRejectionReason(reason: string) {
    await this.page.getByRole("textbox", { name: /reason/i }).fill(reason)
  }

  async confirmRejection() {
    await this.page.getByRole("button", { name: /confirm|reject/i }).last().click()
  }

  async getBalanceText() {
    return this.page.locator("[class*='balance'], [data-balance]").textContent()
  }
}
