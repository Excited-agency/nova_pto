import type { Page } from "@playwright/test"

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/login")
  }

  async fillEmail(email: string) {
    await this.page.getByRole("textbox", { name: /email/i }).fill(email)
  }

  async submit() {
    await this.page.getByRole("button", { name: /continue|send|sign in/i }).click()
  }

  async isOnLoginPage() {
    await this.page.waitForURL("**/login**")
    return this.page.url().includes("/login")
  }
}
