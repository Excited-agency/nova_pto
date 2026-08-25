import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  serviceClient,
  type IsolatedWorkspace,
} from "../security/helpers"

/**
 * "If I create more leave types by hand and fill in the settings, will they
 * accrue the way I set them up?"
 *
 * This walks EVERY combination the category form can produce, creates each one
 * through the admin's own authenticated client (the same path the app uses, so
 * the seeding triggers run under `authenticated` privileges rather than the
 * service key), and checks the resulting balance against an expectation
 * computed independently here in TypeScript from the documented rules.
 *
 * That independence is the point: asserting the engine equals itself would
 * prove nothing. The engine and this file implement the same policy twice, so a
 * disagreement means one of them is wrong.
 */
describe.skipIf(skipIfNoServiceKey())("Accrual policy matrix", () => {
  let ws: IsolatedWorkspace

  // Deliberately the 31st: it exercises month-length clamping (Feb, Apr, Jun)
  // on every anniversary-day schedule, and it makes the day-of-month
  // assertions discriminating. An earlier fixture used the 15th, which made a
  // hardcoded "15" indistinguishable from a correctly computed date.
  const HIRE = "2024-01-31"
  const AS_OF = "2026-08-25"

  type Method = "fixed" | "periodic" | "anniversary" | "unlimited"

  interface Policy {
    name: string
    accrual_method: Method
    amount_value?: number | null
    granting_frequency?: string | null
    accrual_day?: string | null
    anniversary_years?: number | null
    new_hire_rule?: "immediate" | "waiting_period"
    waiting_period_value?: number
    waiting_period_unit?: "month" | "year"
    carryover_limit_enabled?: boolean
    carryover_max_days?: number | null
  }

  // ---- the full set the form allows -------------------------------------
  const POLICIES: Policy[] = []

  for (const freq of ["yearly", "hire_anniversary"]) {
    for (const cap of [null, 5]) {
      for (const wait of [0, 3]) {
        POLICIES.push({
          name: `fixed-${freq}-cap${cap ?? "none"}-wait${wait}`,
          accrual_method: "fixed",
          amount_value: 20,
          granting_frequency: freq,
          new_hire_rule: wait > 0 ? "waiting_period" : "immediate",
          waiting_period_value: wait,
          waiting_period_unit: "month",
          carryover_limit_enabled: cap !== null,
          carryover_max_days: cap,
        })
      }
    }
  }

  for (const freq of ["weekly", "bi_weekly"]) {
    for (const day of ["monday", "friday", "sunday"]) {
      POLICIES.push({
        name: `periodic-${freq}-${day}`,
        accrual_method: "periodic",
        amount_value: 0.5,
        granting_frequency: freq,
        accrual_day: day,
      })
    }
  }

  for (const freq of ["monthly", "quarterly", "yearly"]) {
    for (const day of ["first_day_of_month", "last_day_of_month", "hire_anniversary_day"]) {
      POLICIES.push({
        name: `periodic-${freq}-${day}`,
        accrual_method: "periodic",
        amount_value: 1.5,
        granting_frequency: freq,
        accrual_day: day,
      })
    }
  }

  POLICIES.push({
    name: "periodic-monthly-capped",
    accrual_method: "periodic",
    amount_value: 2,
    granting_frequency: "monthly",
    accrual_day: "first_day_of_month",
    carryover_limit_enabled: true,
    carryover_max_days: 10,
  })

  for (const years of [1, 2, 5]) {
    POLICIES.push({
      name: `anniversary-every-${years}y`,
      accrual_method: "anniversary",
      amount_value: 1,
      anniversary_years: years,
    })
  }

  POLICIES.push({ name: "unlimited", accrual_method: "unlimited" })

  // ---- independent expectation ------------------------------------------

  /** hire + waiting period, in UTC so no local-timezone drift. */
  function eligibleFrom(p: Policy): string {
    if (p.new_hire_rule !== "waiting_period" || !p.waiting_period_value) return HIRE
    const d = new Date(HIRE + "T00:00:00Z")
    if (p.waiting_period_unit === "year") {
      d.setUTCFullYear(d.getUTCFullYear() + p.waiting_period_value)
    } else {
      d.setUTCMonth(d.getUTCMonth() + p.waiting_period_value)
    }
    return d.toISOString().slice(0, 10)
  }

  /**
   * Whether this policy legitimately has nothing due by AS_OF.
   *
   * Guards against the failure mode where accrual_grant_dates returns nothing,
   * the expectation computes to 0, the engine also holds 0, and the assertion
   * passes having verified precisely nothing. Only one case in the matrix
   * qualifies: a 5-year seniority milestone for someone hired in 2024.
   */
  function expectsNoGrants(p: Policy): boolean {
    if (p.accrual_method !== "anniversary") return false
    const first = new Date(HIRE + "T00:00:00Z")
    first.setUTCFullYear(first.getUTCFullYear() + (p.anniversary_years ?? 1))
    return first.toISOString().slice(0, 10) > AS_OF
  }

  const WEEKDAYS = [
    "sunday", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday",
  ]

  const utc = (iso: string) => new Date(iso + "T00:00:00Z")
  const daysBetween = (a: string, b: string) =>
    Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000)
  const monthsBetween = (a: string, b: string) =>
    (utc(b).getUTCFullYear() - utc(a).getUTCFullYear()) * 12 +
    (utc(b).getUTCMonth() - utc(a).getUTCMonth())
  const lastDayOfMonth = (iso: string) =>
    new Date(Date.UTC(utc(iso).getUTCFullYear(), utc(iso).getUTCMonth() + 1, 0))
      .getUTCDate()

  /**
   * Check the SHAPE of the schedule, independently of the engine.
   *
   * The balance comparison further down feeds the engine's own dates into the
   * expectation, so a wrong schedule would cancel out on both sides and pass.
   * These assertions are what actually pin the dates to the configured policy.
   */
  function assertSchedule(p: Policy, dates: string[], eligible: string) {
    if (p.accrual_method === "unlimited" || dates.length === 0) return

    // fixed and periodic open with a grant on the eligibility date so a
    // mid-year joiner is not left waiting; a seniority bonus does not.
    const recurring =
      p.accrual_method === "anniversary" ? dates : (expect(dates[0]).toBe(eligible), dates.slice(1))

    if (p.accrual_method === "fixed") {
      for (const d of recurring) {
        if (p.granting_frequency === "yearly") {
          expect(d.slice(5)).toBe("01-01")
        } else {
          const hireDay = utc(HIRE).getUTCDate()
          expect(utc(d).getUTCMonth()).toBe(utc(HIRE).getUTCMonth())
          expect(utc(d).getUTCDate()).toBe(Math.min(hireDay, lastDayOfMonth(d)))
        }
      }
      return
    }

    if (p.accrual_method === "anniversary") {
      const years = p.anniversary_years ?? 1
      dates.forEach((d, i) => {
        const due = utc(HIRE)
        due.setUTCFullYear(due.getUTCFullYear() + years * (i + 1))
        expect(d).toBe(due.toISOString().slice(0, 10))
      })
      return
    }

    // periodic
    if (p.granting_frequency === "weekly" || p.granting_frequency === "bi_weekly") {
      const step = p.granting_frequency === "bi_weekly" ? 14 : 7
      for (const d of recurring) {
        expect(WEEKDAYS[utc(d).getUTCDay()]).toBe(p.accrual_day)
      }
      for (let i = 1; i < recurring.length; i++) {
        expect(daysBetween(recurring[i - 1], recurring[i])).toBe(step)
      }
      return
    }

    const stepMonths =
      p.granting_frequency === "monthly" ? 1 : p.granting_frequency === "quarterly" ? 3 : 12

    for (const d of recurring) {
      if (p.accrual_day === "first_day_of_month") {
        expect(utc(d).getUTCDate()).toBe(1)
      } else if (p.accrual_day === "last_day_of_month") {
        expect(utc(d).getUTCDate()).toBe(lastDayOfMonth(d))
      } else {
        const hireDay = utc(HIRE).getUTCDate()
        expect(utc(d).getUTCDate()).toBe(Math.min(hireDay, lastDayOfMonth(d)))
      }
    }
    for (let i = 1; i < recurring.length; i++) {
      expect(monthsBetween(recurring[i - 1], recurring[i])).toBe(stepMonths)
    }
  }

  /** Replay the documented rules over the schedule the engine reports. */
  function expectedBalance(p: Policy, grantDates: string[]): number {
    const amount = Math.max(p.amount_value ?? 0, 0)
    const cap = p.carryover_limit_enabled
      ? Math.max(p.carryover_max_days ?? 0, 0)
      : null

    let running = 0
    for (const d of grantDates) {
      if (p.accrual_method === "fixed") {
        // A reset: start over at `amount`, plus whatever may be carried.
        let carried = Math.max(running, 0)
        if (cap !== null) carried = Math.min(carried, cap)
        running = carried + amount
      } else {
        running += amount
        // For a rate, the limit is a ceiling entering the new calendar year.
        if (p.accrual_method === "periodic" && cap !== null && d.endsWith("-01-01")) {
          running = Math.min(running, cap)
        }
      }
    }
    return running
  }

  beforeAll(async () => {
    ws = await createIsolatedWorkspace("admin")
    await serviceClient
      .from("profiles")
      .update({ hire_date: HIRE })
      .eq("id", ws.userId)
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(ws.workspaceId, ws.userId)
  }, 20_000)

  it.each(POLICIES.map((p) => [p.name, p] as const))(
    "accrues %s exactly as configured",
    async (_name, policy) => {
      // Created the way the app creates it: the admin's own JWT, not the
      // service key. This is what proves the seeding triggers still work now
      // that `authenticated` has no direct write access to employee_balances.
      const { data: cat, error: createError } = await ws.userClient
        .from("time_off_categories")
        .insert({
          workspace_id: ws.workspaceId,
          name: policy.name,
          colour: "green",
          is_active: true,
          leave_type: "paid",
          accrual_method: policy.accrual_method,
          amount_value: policy.amount_value ?? null,
          granting_frequency: policy.granting_frequency ?? null,
          accrual_day: policy.accrual_day ?? null,
          anniversary_years: policy.anniversary_years ?? null,
          new_hire_rule: policy.new_hire_rule ?? "immediate",
          waiting_period_value: policy.waiting_period_value ?? 0,
          waiting_period_unit: policy.waiting_period_unit ?? "month",
          carryover_limit_enabled: policy.carryover_limit_enabled ?? false,
          carryover_max_days: policy.carryover_max_days ?? null,
          sort_order: 0,
        })
        .select("id")
        .single()

      expect(createError).toBeNull()
      const categoryId = cat!.id

      // The trigger must have produced a balance row without the admin ever
      // touching the table directly.
      const { data: seeded } = await serviceClient
        .from("employee_balances")
        .select("id, remaining_days")
        .eq("employee_id", ws.userId)
        .eq("category_id", categoryId)
        .single()
      expect(seeded).not.toBeNull()

      if (policy.accrual_method === "unlimited") {
        expect(seeded!.remaining_days).toBe(0)
        const { data: log } = await serviceClient
          .from("balance_adjustment_log")
          .select("id")
          .eq("category_id", categoryId)
        expect(log ?? []).toHaveLength(0)
        return
      }

      // Run the engine to a fixed date so the assertion never depends on today.
      await serviceClient
        .from("employee_balances")
        .update({
          remaining_days: 0,
          carryover_days: 0,
          carryover_expires_on: null,
          last_accrual_on: null,
        })
        .eq("id", seeded!.id)

      const { error: accrueError } = await serviceClient.rpc("accrue_balance", {
        p_employee_id: ws.userId,
        p_category_id: categoryId,
        p_as_of: AS_OF,
      })
      expect(accrueError).toBeNull()

      const eligible = eligibleFrom(policy)
      const dayBefore = new Date(eligible + "T00:00:00Z")
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)

      const { data: dates, error: datesError } = await serviceClient.rpc(
        "accrual_grant_dates",
        {
          p_category_id: categoryId,
          p_hire_date: HIRE,
          p_eligible_from: eligible,
          p_after: dayBefore.toISOString().slice(0, 10),
          p_through: AS_OF,
        }
      )
      expect(datesError).toBeNull()

      const grantDates = (dates ?? []) as string[]

      // The anti-vacuity check: every policy here except the 5-year milestone
      // must actually have produced grants, otherwise the comparison below is
      // 0 === 0 and proves nothing.
      if (expectsNoGrants(policy)) {
        expect(grantDates).toHaveLength(0)
      } else {
        expect(grantDates.length).toBeGreaterThan(0)
        expect(expectedBalance(policy, grantDates)).toBeGreaterThan(0)
      }

      // Every schedule must be strictly increasing and inside the window.
      for (let i = 1; i < grantDates.length; i++) {
        expect(grantDates[i] > grantDates[i - 1]).toBe(true)
      }
      for (const d of grantDates) {
        expect(d >= eligible).toBe(true)
        expect(d <= AS_OF).toBe(true)
      }

      assertSchedule(policy, grantDates, eligible)

      const { data: after } = await serviceClient
        .from("employee_balances")
        .select("remaining_days, last_accrual_on")
        .eq("id", seeded!.id)
        .single()

      expect(after!.remaining_days).toBeCloseTo(
        expectedBalance(policy, grantDates),
        5
      )

      // A waiting period that has not elapsed yet must leave nothing behind.
      if (grantDates.length === 0) {
        expect(after!.remaining_days).toBe(0)
        expect(after!.last_accrual_on).toBeNull()
      } else {
        expect(after!.last_accrual_on).toBe(grantDates[grantDates.length - 1])
      }

      // Re-running the sweep must be a no-op.
      await serviceClient.rpc("accrue_balance", {
        p_employee_id: ws.userId,
        p_category_id: categoryId,
        p_as_of: AS_OF,
      })
      const { data: again } = await serviceClient
        .from("employee_balances")
        .select("remaining_days")
        .eq("id", seeded!.id)
        .single()
      expect(again!.remaining_days).toBeCloseTo(after!.remaining_days, 5)
    },
    20_000
  )

  it("picks every new category up in the nightly sweep", async () => {
    // apply_accruals() is what pg_cron calls. It must see the categories that
    // were just created, not only the ones present when it was written.
    const { data: count, error } = await serviceClient.rpc("apply_accruals", {
      p_as_of: AS_OF,
    })

    expect(error).toBeNull()
    // One row per (employee, non-unlimited category) in the whole database, so
    // just assert it covered at least this workspace's own.
    const { count: mine } = await serviceClient
      .from("employee_balances")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws.workspaceId)

    expect(count as number).toBeGreaterThanOrEqual((mine ?? 1) - 1)
  }, 60_000)

  it("re-seeds and accrues when a category is switched back on", async () => {
    const { data: cat } = await ws.userClient
      .from("time_off_categories")
      .insert({
        workspace_id: ws.workspaceId,
        name: "Toggled",
        colour: "green",
        is_active: false,
        leave_type: "paid",
        accrual_method: "fixed",
        amount_value: 12,
        granting_frequency: "yearly",
        new_hire_rule: "immediate",
        waiting_period_value: 0,
        waiting_period_unit: "month",
        carryover_limit_enabled: false,
        sort_order: 0,
      })
      .select("id")
      .single()

    // Inactive on creation: no balance row yet.
    const { data: none } = await serviceClient
      .from("employee_balances")
      .select("id")
      .eq("category_id", cat!.id)
    expect(none ?? []).toHaveLength(0)

    const { error } = await ws.userClient
      .from("time_off_categories")
      .update({ is_active: true })
      .eq("id", cat!.id)
    expect(error).toBeNull()

    const { data: seeded } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("category_id", cat!.id)
      .single()

    // Accrued on activation rather than waiting for the nightly run.
    expect(seeded!.remaining_days).toBeGreaterThan(0)
  }, 30_000)
})
