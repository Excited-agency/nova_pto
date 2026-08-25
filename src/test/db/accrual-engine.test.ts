import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  serviceClient,
  type IsolatedWorkspace,
} from "../security/helpers"

/**
 * Before 20260826110000 there was no accrual at all.
 *
 * seed_balances_for_employee() wrote amount_value once, when the employee or
 * the category was created, and the number could then only go down. So
 * "20 days per year" meant 20 days for the lifetime of the account, 1 January
 * did nothing, carryover limits were decoration, and a configured 3-month
 * waiting period (two of the five default categories set one) was ignored --
 * a new joiner could book leave on day one.
 *
 * These tests pin the schedule and the arithmetic. HIRE_DATE is fixed and every
 * assertion passes an explicit as_of, so none of them depend on today's date.
 */
describe.skipIf(skipIfNoServiceKey())("Accrual engine", () => {
  let ws: IsolatedWorkspace

  const HIRE_DATE = "2024-06-15"

  interface CategoryOptions {
    accrual_method: "fixed" | "periodic" | "anniversary" | "unlimited"
    amount_value?: number
    granting_frequency?: string | null
    accrual_day?: string | null
    anniversary_years?: number | null
    new_hire_rule?: "immediate" | "waiting_period"
    waiting_period_value?: number
    waiting_period_unit?: "month" | "year"
    carryover_limit_enabled?: boolean
    carryover_max_days?: number | null
    carryover_expiration_value?: number | null
    carryover_expiration_unit?: "month" | "year" | null
  }

  async function makeCategory(name: string, opts: CategoryOptions): Promise<string> {
    const { data, error } = await serviceClient
      .from("time_off_categories")
      .insert({
        workspace_id: ws.workspaceId,
        name,
        colour: "green",
        is_active: true,
        leave_type: "paid",
        amount_value: opts.amount_value ?? 0,
        granting_frequency: opts.granting_frequency ?? null,
        accrual_day: opts.accrual_day ?? null,
        anniversary_years: opts.anniversary_years ?? null,
        new_hire_rule: opts.new_hire_rule ?? "immediate",
        waiting_period_value: opts.waiting_period_value ?? 0,
        waiting_period_unit: opts.waiting_period_unit ?? "month",
        carryover_limit_enabled: opts.carryover_limit_enabled ?? false,
        carryover_max_days: opts.carryover_max_days ?? null,
        carryover_expiration_value: opts.carryover_expiration_value ?? null,
        carryover_expiration_unit: opts.carryover_expiration_unit ?? null,
        accrual_method: opts.accrual_method,
        sort_order: 0,
      })
      .select("id")
      .single()

    expect(error).toBeNull()
    return data!.id
  }

  /** Wipe the row the seeding trigger already accrued, then run to `asOf`. */
  async function accrueTo(categoryId: string, asOf: string): Promise<number> {
    await serviceClient
      .from("employee_balances")
      .update({
        remaining_days: 0,
        carryover_days: 0,
        carryover_expires_on: null,
        last_accrual_on: null,
      })
      .eq("employee_id", ws.userId)
      .eq("category_id", categoryId)

    await serviceClient
      .from("balance_adjustment_log")
      .delete()
      .eq("category_id", categoryId)

    const { error } = await serviceClient.rpc("accrue_balance", {
      p_employee_id: ws.userId,
      p_category_id: categoryId,
      p_as_of: asOf,
    })
    expect(error).toBeNull()

    return balanceOf(categoryId)
  }

  async function balanceOf(categoryId: string): Promise<number> {
    const { data } = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", ws.userId)
      .eq("category_id", categoryId)
      .single()
    return data!.remaining_days
  }

  beforeAll(async () => {
    ws = await createIsolatedWorkspace("admin")
    await serviceClient
      .from("profiles")
      .update({ hire_date: HIRE_DATE })
      .eq("id", ws.userId)
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(ws.workspaceId, ws.userId)
  }, 15_000)

  it("grants on hire, then every 1 January — and carries everything when no limit is set", async () => {
    // "Limit carryover" off means unlimited, not none: unused days accumulate.
    // 2024-06-15 -> 20, 2025-01-01 -> 40, 2026-01-01 -> 60.
    const id = await makeCategory("Fixed Yearly", {
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
    })

    expect(await accrueTo(id, "2026-08-25")).toBe(60)
  })

  it("caps the carry-over at the configured maximum and records what was lost", async () => {
    // 2024-06-15 -> 20; 2025-01-01 keeps 5 of 20, +20 = 25; 2026-01-01 keeps 5
    // of 25, +20 = 25.
    const id = await makeCategory("Capped", {
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
      carryover_limit_enabled: true,
      carryover_max_days: 5,
    })

    expect(await accrueTo(id, "2026-08-25")).toBe(25)

    const { data: capped } = await serviceClient
      .from("balance_adjustment_log")
      .select("delta")
      .eq("category_id", id)
      .eq("reason", "carryover_capped")
      .order("created_at", { ascending: true })

    // 15 forfeited at the first reset, 20 at the second — never silently.
    expect((capped ?? []).map((r) => r.delta)).toEqual([-15, -20])
  })

  it("resets on the hire anniversary when the policy says so", async () => {
    // 2024-06-15, 2025-06-15, 2026-06-15 = three grants.
    const id = await makeCategory("Anniversary Reset", {
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "hire_anniversary",
    })

    expect(await accrueTo(id, "2026-08-25")).toBe(60)
  })

  it("accrues a monthly rate without resetting", async () => {
    // Eligibility grant on 2024-06-15, then the 1st of each month through
    // 2026-08-01: 1 + 26 = 27 grants of 1.5.
    const id = await makeCategory("Monthly Rate", {
      accrual_method: "periodic",
      amount_value: 1.5,
      granting_frequency: "monthly",
      accrual_day: "first_day_of_month",
    })

    expect(await accrueTo(id, "2026-08-25")).toBeCloseTo(40.5, 5)
  })

  it("awards a seniority bonus only on the milestone, never on day one", async () => {
    // "1 day for every 2 years" is a bonus, not an allowance: nothing is due
    // at hire. Milestones fall on 2026-06-15 and 2028-06-15.
    const id = await makeCategory("Seniority", {
      accrual_method: "anniversary",
      amount_value: 1,
      anniversary_years: 2,
    })

    expect(await accrueTo(id, "2025-01-01")).toBe(0)
    expect(await accrueTo(id, "2026-08-25")).toBe(1)
    expect(await accrueTo(id, "2029-01-01")).toBe(2)
  })

  it("grants nothing during a waiting period, then the full amount once it ends", async () => {
    // Hired 2024-06-15 with a 3-month wait: eligible 2024-09-15.
    const id = await makeCategory("Probationary", {
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
      new_hire_rule: "waiting_period",
      waiting_period_value: 3,
      waiting_period_unit: "month",
    })

    expect(await accrueTo(id, "2024-09-14")).toBe(0)
    expect(await accrueTo(id, "2024-09-15")).toBe(20)
  })

  it("refuses leave that starts before the waiting period ends", async () => {
    const id = await makeCategory("Probationary Block", {
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
      new_hire_rule: "waiting_period",
      waiting_period_value: 3,
      waiting_period_unit: "month",
    })

    // 2024-07-01 is inside the period.
    const early = await serviceClient.from("time_off_requests").insert({
      profile_id: ws.userId,
      workspace_id: ws.workspaceId,
      category_id: id,
      employee_name: "Accrual Tester",
      employee_email: "accrual@test.invalid",
      start_date: "2024-07-01",
      end_date: "2024-07-02",
      start_period: "morning",
      end_period: "end_of_day",
      total_days: 2,
      request_type: "vacation",
      status: "pending",
    })
    expect(early.error).toBeTruthy()
    expect(early.error!.message).toMatch(/not available until/i)

    // Booked for after the period, it goes through.
    const later = await serviceClient.from("time_off_requests").insert({
      profile_id: ws.userId,
      workspace_id: ws.workspaceId,
      category_id: id,
      employee_name: "Accrual Tester",
      employee_email: "accrual@test.invalid",
      start_date: "2024-10-01",
      end_date: "2024-10-02",
      start_period: "morning",
      end_period: "end_of_day",
      total_days: 2,
      request_type: "vacation",
      status: "pending",
    })
    expect(later.error).toBeNull()

    await serviceClient.from("time_off_requests").delete().eq("category_id", id)
  })

  it("is idempotent — a second run on the same day changes nothing", async () => {
    const id = await makeCategory("Idempotent", {
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
    })

    const first = await accrueTo(id, "2026-08-25")

    await serviceClient.rpc("accrue_balance", {
      p_employee_id: ws.userId,
      p_category_id: id,
      p_as_of: "2026-08-25",
    })

    expect(await balanceOf(id)).toBe(first)
  })

  it("catches up after downtime instead of losing a grant", async () => {
    // Run to 2025-06-01, then jump 14 months. The 2026-01-01 reset must still
    // land, which is the whole point of tracking last_accrual_on.
    const id = await makeCategory("Catch Up", {
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
    })

    expect(await accrueTo(id, "2025-06-01")).toBe(40)

    await serviceClient.rpc("accrue_balance", {
      p_employee_id: ws.userId,
      p_category_id: id,
      p_as_of: "2026-08-25",
    })
    expect(await balanceOf(id)).toBe(60)
  })

  it("leaves unlimited categories alone", async () => {
    const id = await makeCategory("Unlimited", { accrual_method: "unlimited" })

    expect(await accrueTo(id, "2030-01-01")).toBe(0)

    const { data: log } = await serviceClient
      .from("balance_adjustment_log")
      .select("id")
      .eq("category_id", id)
    expect(log ?? []).toHaveLength(0)
  })

  it("expires carried days once their window closes", async () => {
    // Carry up to 5 days, expiring 3 months after the reset that created them.
    const id = await makeCategory("Expiring Carryover", {
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
      carryover_limit_enabled: true,
      carryover_max_days: 5,
      carryover_expiration_value: 3,
      carryover_expiration_unit: "month",
    })

    // 2025-01-01: carry 5 of 20, +20 = 25, the 5 expiring on 2025-04-01.
    expect(await accrueTo(id, "2025-03-31")).toBe(25)

    // One day past expiry the carried 5 are gone.
    await serviceClient.rpc("accrue_balance", {
      p_employee_id: ws.userId,
      p_category_id: id,
      p_as_of: "2025-04-01",
    })
    expect(await balanceOf(id)).toBe(20)

    const { data: expired } = await serviceClient
      .from("balance_adjustment_log")
      .select("delta")
      .eq("category_id", id)
      .eq("reason", "carryover_expired")
      .single()
    expect(expired!.delta).toBe(-5)
  })

  it("replays a balance from the hire date, counting only approved leave", async () => {
    const id = await makeCategory("Replay", {
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
    })

    await serviceClient.from("time_off_requests").insert([
      {
        profile_id: ws.userId,
        workspace_id: ws.workspaceId,
        category_id: id,
        employee_name: "Accrual Tester",
        employee_email: "accrual@test.invalid",
        start_date: "2024-07-01",
        end_date: "2024-07-05",
        start_period: "morning",
        end_period: "end_of_day",
        total_days: 5,
        request_type: "vacation",
        status: "approved",
      },
      {
        profile_id: ws.userId,
        workspace_id: ws.workspaceId,
        category_id: id,
        employee_name: "Accrual Tester",
        employee_email: "accrual@test.invalid",
        start_date: "2025-05-05",
        end_date: "2025-05-09",
        start_period: "morning",
        end_period: "end_of_day",
        total_days: 5,
        request_type: "vacation",
        // Pending must NOT be deducted — it has not moved a balance yet.
        status: "pending",
      },
    ])

    // Deliberately wrong starting figure, as a stale seeded balance would be.
    await serviceClient
      .from("employee_balances")
      .update({ remaining_days: 999, last_accrual_on: null, carryover_days: 0 })
      .eq("employee_id", ws.userId)
      .eq("category_id", id)

    const { data: result, error } = await serviceClient.rpc(
      "recalculate_employee_balance",
      { p_employee_id: ws.userId, p_category_id: id, p_as_of: "2026-08-25" }
    )
    expect(error).toBeNull()

    // +20 on hire, -5 taken, +20 (carry 15) = 35, +20 (carry 35) = 55.
    expect(result).toBe(55)
    expect(await balanceOf(id)).toBe(55)

    // One row explains the correction rather than inventing a history.
    const { data: log } = await serviceClient
      .from("balance_adjustment_log")
      .select("reason, balance_before, balance_after")
      .eq("category_id", id)
      .eq("reason", "recalculated")
      .single()
    expect(log!.balance_before).toBe(999)
    expect(log!.balance_after).toBe(55)

    await serviceClient.from("time_off_requests").delete().eq("category_id", id)
  })

  it("clamps a hire date of 29 February instead of throwing once a year", async () => {
    await serviceClient
      .from("profiles")
      .update({ hire_date: "2024-02-29" })
      .eq("id", ws.userId)

    const id = await makeCategory("Leap Hire", {
      accrual_method: "fixed",
      amount_value: 10,
      granting_frequency: "hire_anniversary",
    })

    const { data: dates, error } = await serviceClient.rpc("accrual_grant_dates", {
      p_category_id: id,
      p_hire_date: "2024-02-29",
      p_eligible_from: "2024-02-29",
      p_after: "2024-02-28",
      p_through: "2027-06-01",
    })

    expect(error).toBeNull()
    expect(dates).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
    ])

    await serviceClient
      .from("profiles")
      .update({ hire_date: HIRE_DATE })
      .eq("id", ws.userId)
  })
})
