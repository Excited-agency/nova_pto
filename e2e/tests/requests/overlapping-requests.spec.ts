import { test, expect, type Page } from "@playwright/test"
import {
  createTestUser,
  seedSession,
  cleanupTestUser,
  deleteAuthUser,
  adminClient,
} from "../../fixtures/auth"
import {
  createCategory,
  createBalance,
  createPendingRequest,
  addEmployeeToWorkspace,
} from "../../fixtures/test-data"

/**
 * Booking the same days twice, in a real browser.
 *
 * The rule itself is proven at the database level (src/test/db/request-overlap)
 * and the date maths in unit tests. What this covers is the part only a browser
 * can show: that the days the employee has already booked actually arrive in
 * the picker, that a range stepping over them is refused with a message naming
 * the clash, and that the offered trim ends up as the row the server stores.
 */

/** Booked days. September 2026: 7th is a Monday, 12th/13th the weekend. */
const BOOKED = { start: "2026-09-08", end: "2026-09-09" }

/** Opens one of the two pickers and pages it forward to September 2026. */
async function openSeptember(page: Page, field: "From" | "To") {
  const wrapper = page.locator('[data-slot="field"]', { hasText: field })
  await wrapper.locator('[data-slot="date-picker-trigger"]').click()

  // The calendar popover is also role=dialog, and sits above the modal.
  const popover = page.getByRole("dialog").filter({ hasText: "Mo" }).last()
  for (let i = 0; i < 24; i++) {
    if (await popover.getByText("September 2026").isVisible().catch(() => false)) break
    await popover.locator('[data-slot="calendar-arrow-button"]').nth(1).click()
  }
  await expect(popover.getByText("September 2026")).toBeVisible()
  return popover
}

function day(popover: ReturnType<Page["getByRole"]>, label: string) {
  return popover.locator('[data-slot="calendar-day-button"]', { hasText: new RegExp(`^${label}$`) })
}

test.describe("Overlapping time-off requests", () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>
  let employeeUser: Awaited<ReturnType<typeof createTestUser>>
  let categoryId: string

  test.beforeAll(async () => {
    adminUser = await createTestUser("admin")
    employeeUser = await createTestUser("user")

    await addEmployeeToWorkspace(employeeUser.userId, adminUser.workspaceId)
    employeeUser.workspaceId = adminUser.workspaceId

    categoryId = await createCategory(adminUser.workspaceId, { name: "Vacation" })
    await createBalance(employeeUser.userId, categoryId, adminUser.workspaceId, 20)

    await createPendingRequest(employeeUser.userId, adminUser.workspaceId, categoryId, {
      start_date: BOOKED.start,
      end_date: BOOKED.end,
      total_days: 2,
    })
  })

  test.afterAll(async () => {
    await adminClient.from("time_off_requests").delete().eq("profile_id", employeeUser.userId)
    await cleanupTestUser(adminUser)
    await deleteAuthUser(employeeUser.userId)
    await adminClient.from("profiles").delete().eq("id", employeeUser.userId)
  })

  test("booked days are not selectable, and the reason is on the day", async ({ page }) => {
    await seedSession(page, employeeUser)
    await page.goto("/requests")
    await page.getByRole("button", { name: "Request time off" }).first().click()

    const popover = await openSeptember(page, "From")

    await expect(day(popover, "8")).toBeDisabled()
    await expect(day(popover, "9")).toBeDisabled()
    await expect(day(popover, "8")).toHaveAttribute(
      "title",
      "Already booked: Vacation (pending)"
    )

    // Either side stays open.
    await expect(day(popover, "7")).toBeEnabled()
    await expect(day(popover, "10")).toBeEnabled()
  })

  test("a range stepping over booked days is refused, trimmed, and stored trimmed", async ({ page }) => {
    await seedSession(page, employeeUser)
    await page.goto("/requests")
    await page.getByRole("button", { name: "Request time off" }).first().click()

    const modal = page.getByRole("dialog").filter({ hasText: "Request time off" })
    await modal.getByRole("combobox").first().click()
    await page.getByRole("option", { name: /Vacation/ }).click()

    // 7 and 10 Sep are both selectable; the clash is between them.
    await day(await openSeptember(page, "From"), "7").click()
    await day(await openSeptember(page, "To"), "10").click()

    await expect(modal.getByText(/you're already off/i)).toBeVisible()
    await expect(modal.getByText(/Vacation \(pending\)/)).toBeVisible()
    await expect(modal.getByRole("button", { name: "Submit request" })).toBeDisabled()

    const trim = modal.getByRole("button", { name: /instead/i })
    await expect(trim).toContainText("Sep 7, 2026")
    await trim.click()

    await expect(modal.getByText(/you're already off/i)).toBeHidden()
    await modal.getByRole("button", { name: "Submit request" }).click()

    await expect(page.getByText("Request submitted")).toBeVisible()

    // What the server actually stored.
    const { data } = await adminClient
      .from("time_off_requests")
      .select("start_date, end_date, status")
      .eq("profile_id", employeeUser.userId)
      .order("created_at", { ascending: true })

    expect(data).toHaveLength(2)
    expect(data![1]).toMatchObject({
      start_date: "2026-09-07",
      end_date: "2026-09-07",
      status: "pending",
    })

    // Leave the fixture as the next test expects it.
    await adminClient
      .from("time_off_requests")
      .delete()
      .eq("profile_id", employeeUser.userId)
      .eq("start_date", "2026-09-07")
  })

  test("an admin gets no override when recording for someone else", async ({ page }) => {
    // Blocking admins too was a deliberate product decision, so it is worth
    // pinning in the interface and not only in the database.
    await seedSession(page, adminUser)
    await page.goto("/requests")
    await page.getByRole("button", { name: /create.*record/i }).first().click()

    const modal = page.getByRole("dialog").filter({ hasText: "Create time-off record" })

    // EmployeeCombobox is a search input plus a list of plain buttons, not a
    // Radix Select, so there is no option role to query.
    const employeeSearch = modal.getByPlaceholder(/search for employee/i)
    await employeeSearch.click()
    await employeeSearch.fill(employeeUser.email)
    await page.getByRole("button").filter({ hasText: employeeUser.email }).first().click()

    await modal.getByRole("combobox").first().click()
    await page.getByRole("option", { name: /Vacation/ }).click()

    await day(await openSeptember(page, "From"), "7").click()
    await day(await openSeptember(page, "To"), "10").click()

    await expect(modal.getByText(/already off/i)).toBeVisible()
    await expect(modal.getByRole("button", { name: "Create record" })).toBeDisabled()
  })
})
