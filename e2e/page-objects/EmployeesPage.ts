import type { Page } from "@playwright/test"

export class EmployeesPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/employees")
    await this.page.waitForLoadState("networkidle")
  }

  async search(query: string) {
    await this.page.getByRole("searchbox").fill(query)
    await this.page.waitForTimeout(400) // debounce
  }

  employeeRows() {
    return this.page.getByRole("row").filter({ hasNot: this.page.getByRole("columnheader") })
  }

  async clickAddEmployee() {
    await this.page.getByRole("link", { name: /add employee|invite/i }).click()
  }

  async getEmployeeCount() {
    return this.employeeRows().count()
  }
}
