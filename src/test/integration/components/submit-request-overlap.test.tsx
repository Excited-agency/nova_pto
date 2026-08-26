import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SubmitTimeOffRequestModal } from "@/components/submit-time-off-request-modal"
import { renderWithProviders, makeUser, makeProfile, makeWorkspace } from "@/test/utils/render"

/**
 * The client half of the overlap rule.
 *
 * The date logic itself is covered in unit/lib/request-overlap.test.ts and the
 * server rule in db/request-overlap.test.ts. What is only observable here is
 * the wiring: that the employee's own booked days reach the picker, and that a
 * range stepping over a booked day is still refused — the picker cannot help
 * there, because both endpoints are selectable and the conflict sits between
 * them.
 */

const EXISTING = { start: "2026-09-08", end: "2026-09-09" }

vi.mock("@/lib/time-off-category-service", () => ({
  fetchTimeOffCategories: vi.fn(async () => [
    {
      id: "cat-1",
      workspace_id: "ws-123",
      name: "Vacation",
      emoji: null,
      colour: "green",
      is_active: true,
      leave_type: "paid",
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
      new_hire_rule: "immediate",
      waiting_period_value: 0,
      waiting_period_unit: "month",
      carryover_limit_enabled: false,
      carryover_max_days: null,
      sort_order: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]),
  fetchCategoryAvailability: vi.fn(async () => []),
}))

vi.mock("@/lib/holiday-service", () => ({
  fetchHolidays: vi.fn(async () => []),
}))

vi.mock("@/lib/time-off-request-service", () => ({
  fetchEmployeeBalances: vi.fn(async () => [
    {
      id: "bal-1",
      employee_id: "user-123",
      category_id: "cat-1",
      workspace_id: "ws-123",
      remaining_days: 20,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]),
  fetchMyTimeOffRequests: vi.fn(async () => [
    {
      id: "req-existing",
      profile_id: "user-123",
      workspace_id: "ws-123",
      category_id: "cat-1",
      category_name: "Vacation",
      employee_name: "Test User",
      employee_email: "test@example.com",
      employee_avatar_url: null,
      start_date: EXISTING.start,
      end_date: EXISTING.end,
      start_period: "morning",
      end_period: "end_of_day",
      total_days: 2,
      request_type: "vacation",
      status: "pending",
      comment: null,
      rejection_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z",
    },
  ]),
  submitTimeOffRequest: vi.fn(async () => ({})),
}))

/**
 * The trigger inside a labelled Field.
 *
 * Field renders its label as a plain sibling with no htmlFor, so
 * getByLabelText cannot reach the control — scope by the field wrapper.
 */
function fieldTrigger(label: string) {
  const field = screen.getByText(label).closest('[data-slot="field"]')
  if (!field) throw new Error(`no field wrapper around label "${label}"`)
  return within(field as HTMLElement).getByRole("button")
}

/**
 * The open calendar popover.
 *
 * The modal itself is also role="dialog", and the popover renders on top of
 * it, so the last match is the calendar.
 */
function openCalendar() {
  const dialogs = screen.getAllByRole("dialog")
  return dialogs[dialogs.length - 1]
}

async function pickDay(
  user: ReturnType<typeof userEvent.setup>,
  fieldLabel: string,
  day: string
) {
  await user.click(fieldTrigger(fieldLabel))
  await waitFor(() => expect(screen.getAllByRole("dialog").length).toBeGreaterThan(1))
  await user.click(within(openCalendar()).getByRole("button", { name: day }))
}

describe("SubmitTimeOffRequestModal — overlapping dates", () => {
  const auth = {
    user: makeUser(),
    workspace: makeWorkspace(),
    profile: makeProfile({ role: "user" }),
    loading: false,
  }

  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    // Freezing the clock pins which month the pickers open on, so the test
    // needs no month navigation and does not rot as the real date moves.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 1))
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function openModal() {
    renderWithProviders(
      <SubmitTimeOffRequestModal open onOpenChange={vi.fn()} />,
      { auth }
    )
    await waitFor(() =>
      expect(screen.getByText("Request time off")).toBeInTheDocument()
    )
  }

  it("greys out days the employee is already booked for", async () => {
    await openModal()

    await user.click(fieldTrigger("From"))
    await waitFor(() => expect(screen.getAllByRole("dialog").length).toBeGreaterThan(1))
    const calendar = within(openCalendar())

    await waitFor(() => expect(calendar.getByRole("button", { name: "8" })).toBeDisabled())
    expect(calendar.getByRole("button", { name: "9" })).toBeDisabled()
    // Either side of the booking stays selectable.
    expect(calendar.getByRole("button", { name: "7" })).toBeEnabled()
    expect(calendar.getByRole("button", { name: "10" })).toBeEnabled()
  })

  it("explains why a booked day is unavailable", async () => {
    await openModal()

    await user.click(fieldTrigger("From"))
    await waitFor(() => expect(screen.getAllByRole("dialog").length).toBeGreaterThan(1))

    await waitFor(() =>
      expect(within(openCalendar()).getByRole("button", { name: "8" })).toHaveAttribute(
        "title",
        "Already booked: Vacation (pending)"
      )
    )
  })

  it("refuses a range that steps over a booked day, and trims it on request", async () => {
    await openModal()

    // 7 and 10 Sep are both free; 8-9 Sep sit between them.
    await pickDay(user, "From", "7")
    await pickDay(user, "To", "10")

    await waitFor(() =>
      expect(screen.getByText(/you're already off/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/Vacation \(pending\)/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled()

    const trim = screen.getByRole("button", { name: /instead/i })
    expect(trim).toHaveTextContent("Sep 7, 2026")

    await user.click(trim)

    // Both ends move to the free stretch, so the conflict clears and the form
    // now holds what will actually be submitted.
    await waitFor(() =>
      expect(screen.queryByText(/you're already off/i)).not.toBeInTheDocument()
    )
    expect(fieldTrigger("From")).toHaveTextContent("Sep 7, 2026")
    expect(fieldTrigger("To")).toHaveTextContent("Sep 7, 2026")
  })
})
