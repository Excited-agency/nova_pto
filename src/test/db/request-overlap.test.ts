import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  deleteAuthUser,
  serviceClient,
  type IsolatedWorkspace,
} from "../security/helpers"

/**
 * One employee cannot be on leave twice on the same day.
 *
 * Nothing enforced this before migration 20260827100000: all four write paths
 * and both approve paths ignored the employee's other requests, so overlapping
 * requests were accepted and the balance was deducted twice for the same days.
 *
 * Enforcement is a single trigger plus an EXCLUDE constraint rather than a
 * check inside each RPC, so these tests deliberately come at it through every
 * public entry point — employee submit, Slack bot, admin record, approval —
 * to prove no path is left out.
 *
 * All dates sit in September 2026 and avoid weekends: 7 Sep is a Monday,
 * 10 Sep a Thursday, and 5/6, 12/13, 19/20 are weekends. A range with no
 * working day is rejected for an unrelated reason, which would make a test
 * pass for the wrong cause.
 */
describe.skipIf(skipIfNoServiceKey())("time-off request overlap", () => {
  let admin: IsolatedWorkspace
  let employee: IsolatedWorkspace
  let categoryId: string
  let otherCategoryId: string

  /** Anchor everything else overlaps: Mon 7 Sep – Thu 10 Sep 2026. */
  const ANCHOR = { start: "2026-09-07", end: "2026-09-10" }

  async function seedRequest(opts: {
    start: string
    end: string
    status?: string
    categoryId?: string
    profileId?: string
    startPeriod?: string
    endPeriod?: string
    totalDays?: number
  }) {
    const { data, error } = await serviceClient
      .from("time_off_requests")
      .insert({
        profile_id: opts.profileId ?? employee.userId,
        workspace_id: admin.workspaceId,
        category_id: opts.categoryId ?? categoryId,
        employee_name: "Overlap Employee",
        employee_email: employee.email,
        start_date: opts.start,
        end_date: opts.end,
        start_period: opts.startPeriod ?? "morning",
        end_period: opts.endPeriod ?? "end_of_day",
        total_days: opts.totalDays ?? 1,
        request_type: "vacation",
        status: opts.status ?? "approved",
      })
      .select("id")
      .single()

    if (error) throw new Error(`seedRequest: ${error.message}`)
    return data!.id as string
  }

  /** The employee's own path, through a real JWT. */
  function submitAsEmployee(start: string, end: string, cat = categoryId) {
    return employee.userClient.rpc("submit_time_off_request", {
      p_category_id: cat,
      p_start_date: start,
      p_end_date: end,
      p_start_period: "morning",
      p_end_period: "end_of_day",
      p_comment: null,
    })
  }

  beforeAll(async () => {
    admin = await createIsolatedWorkspace("admin")
    employee = await createIsolatedWorkspace("user")

    await serviceClient
      .from("profiles")
      .update({ workspace_id: admin.workspaceId, hire_date: "2024-01-15" })
      .eq("id", employee.userId)

    const mkCategory = async (name: string) => {
      const { data, error } = await serviceClient
        .from("time_off_categories")
        .insert({
          workspace_id: admin.workspaceId,
          name,
          colour: "green",
          is_active: true,
          leave_type: "paid",
          accrual_method: "fixed",
          amount_value: 30,
          granting_frequency: "yearly",
          new_hire_rule: "immediate",
          waiting_period_value: 0,
          waiting_period_unit: "month",
          carryover_limit_enabled: false,
          sort_order: 0,
        })
        .select("id")
        .single()
      if (error) throw new Error(`category ${name}: ${error.message}`)
      return data!.id as string
    }

    categoryId = await mkCategory("Vacation")
    otherCategoryId = await mkCategory("Sick leave")

    // Generous balance so nothing ever fails for want of days — this suite is
    // about dates, and "Insufficient balance" would be a false pass.
    for (const cat of [categoryId, otherCategoryId]) {
      await serviceClient.from("employee_balances").upsert(
        {
          employee_id: employee.userId,
          category_id: cat,
          workspace_id: admin.workspaceId,
          remaining_days: 200,
        },
        { onConflict: "employee_id,category_id" }
      )
    }
  }, 40_000)

  afterEach(async () => {
    await serviceClient.from("time_off_requests").delete().eq("profile_id", employee.userId)
  })

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
    await deleteAuthUser(employee.userId)
    await serviceClient.from("profiles").delete().eq("id", employee.userId)
  }, 20_000)

  // ---------------------------------------------------------------- geometry

  const blocked: [string, string, string][] = [
    ["the exact same dates", ANCHOR.start, ANCHOR.end],
    ["a range inside the existing one", "2026-09-08", "2026-09-09"],
    ["a range that swallows the existing one", "2026-09-04", "2026-09-14"],
    ["a range overlapping the start", "2026-09-03", "2026-09-08"],
    ["a range overlapping the end", "2026-09-09", "2026-09-15"],
    ["a single day inside the existing one", "2026-09-08", "2026-09-08"],
  ]

  for (const [label, start, end] of blocked) {
    it(`rejects ${label}`, async () => {
      await seedRequest({ ...ANCHOR, status: "approved" })

      const { error } = await submitAsEmployee(start, end)

      expect(error).toBeTruthy()
      expect(error!.message).toMatch(/overlap/i)
    })
  }

  const allowed: [string, string, string][] = [
    ["ends the working day before the existing one starts", "2026-09-03", "2026-09-04"],
    ["starts the working day after the existing one ends", "2026-09-11", "2026-09-11"],
  ]

  for (const [label, start, end] of allowed) {
    it(`allows a request that ${label}`, async () => {
      await seedRequest({ ...ANCHOR, status: "approved" })

      const { error } = await submitAsEmployee(start, end)

      expect(error).toBeNull()
    })
  }

  // ------------------------------------------------------------ what occupies

  it("ignores a rejected request — its dates are free again", async () => {
    await seedRequest({ ...ANCHOR, status: "rejected" })

    const { error } = await submitAsEmployee(ANCHOR.start, ANCHOR.end)

    expect(error).toBeNull()
  })

  it("ignores a withdrawn request — its dates are free again", async () => {
    await seedRequest({ ...ANCHOR, status: "withdrawn" })

    const { error } = await submitAsEmployee(ANCHOR.start, ANCHOR.end)

    expect(error).toBeNull()
  })

  it("blocks against a pending request, not just an approved one", async () => {
    await seedRequest({ ...ANCHOR, status: "pending" })

    const { error } = await submitAsEmployee("2026-09-08", "2026-09-09")

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/pending/i)
  })

  it("blocks a different category on the same dates", async () => {
    // A person is either at work or not; the category does not change that.
    await seedRequest({ ...ANCHOR, status: "approved", categoryId })

    const { error } = await submitAsEmployee(ANCHOR.start, ANCHOR.end, otherCategoryId)

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/overlap/i)
  })

  it("blocks two half-days that share one calendar day", async () => {
    // Agreed granularity is the whole day: morning + afternoon of the same
    // date still counts as being away twice.
    await seedRequest({
      start: "2026-09-07",
      end: "2026-09-07",
      status: "approved",
      startPeriod: "morning",
      endPeriod: "midday",
      totalDays: 0.5,
    })

    const { error } = await employee.userClient.rpc("submit_time_off_request", {
      p_category_id: categoryId,
      p_start_date: "2026-09-07",
      p_end_date: "2026-09-07",
      p_start_period: "midday",
      p_end_period: "end_of_day",
      p_comment: null,
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/overlap/i)
  })

  it("does not block a different employee on the same dates", async () => {
    await seedRequest({ ...ANCHOR, status: "approved", profileId: admin.userId })

    const { error } = await submitAsEmployee(ANCHOR.start, ANCHOR.end)

    expect(error).toBeNull()

    await serviceClient.from("time_off_requests").delete().eq("profile_id", admin.userId)
  })

  // ------------------------------------------------------------- every path

  it("names the conflicting request so the message is actionable", async () => {
    await seedRequest({ ...ANCHOR, status: "approved" })

    const { error } = await submitAsEmployee("2026-09-08", "2026-09-09")

    expect(error!.message).toContain("Vacation")
    expect(error!.message).toContain("07 Sep 2026")
    expect(error!.message).toContain("10 Sep 2026")
  })

  it("blocks the Slack bot path", async () => {
    await seedRequest({ ...ANCHOR, status: "approved" })

    const { error } = await serviceClient.rpc("submit_time_off_request_bot", {
      p_profile_id: employee.userId,
      p_category_id: categoryId,
      p_start_date: "2026-09-08",
      p_end_date: "2026-09-09",
      p_start_period: "morning",
      p_end_period: "end_of_day",
      p_comment: null,
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/overlap/i)
  })

  it("blocks the admin record path — no override for admins", async () => {
    await seedRequest({ ...ANCHOR, status: "approved" })

    const { error } = await admin.userClient.rpc("create_time_off_record", {
      p_workspace_id: admin.workspaceId,
      p_employee_id: employee.userId,
      p_category_id: otherCategoryId,
      p_start_date: "2026-09-08",
      p_end_date: "2026-09-09",
      p_comment: "admin booking over an existing one",
      p_start_period: "morning",
      p_end_period: "end_of_day",
    })

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/overlap/i)
  })

  it("blocks reviving a rejected request onto days since taken, and spends no balance", async () => {
    // The reachable form of the approval race: R1's dates are free while it is
    // rejected, R2 takes them, and only then does someone try to put R1 back.
    // It is also the proof that the guard fires on UPDATE OF status, which is
    // what protects approve_time_off_request without touching that function.
    const revived = await seedRequest({ ...ANCHOR, status: "rejected" })
    await seedRequest({ start: "2026-09-08", end: "2026-09-09", status: "approved" })

    const before = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()

    const { error } = await serviceClient
      .from("time_off_requests")
      .update({ status: "approved" })
      .eq("id", revived)

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/overlap/i)

    expect(await serviceClient
      .from("time_off_requests")
      .select("status")
      .eq("id", revived)
      .single()
      .then((r) => r.data!.status)).toBe("rejected")

    const after = await serviceClient
      .from("employee_balances")
      .select("remaining_days")
      .eq("employee_id", employee.userId)
      .eq("category_id", categoryId)
      .single()

    expect(after.data!.remaining_days).toBe(before.data!.remaining_days)
  })

  it("frees the dates once a request is withdrawn", async () => {
    const first = await seedRequest({ ...ANCHOR, status: "pending" })

    const { error: withdrawError } = await employee.userClient.rpc(
      "withdraw_time_off_request",
      { p_request_id: first }
    )
    expect(withdrawError).toBeNull()

    const { error } = await submitAsEmployee(ANCHOR.start, ANCHOR.end)
    expect(error).toBeNull()
  })

  // --------------------------------------------------------- no misfiring

  it("still lets a profile be renamed while holding requests", async () => {
    // sync_profile_to_requests rewrites the denormalised name columns on every
    // request. If the overlap trigger were not scoped to the date/status
    // columns, editing an employee would fail with an error about time off.
    await seedRequest({ ...ANCHOR, status: "approved" })

    const { error } = await serviceClient
      .from("profiles")
      .update({ first_name: "Renamed" })
      .eq("id", employee.userId)
      .eq("workspace_id", admin.workspaceId)

    expect(error).toBeNull()

    const { data } = await serviceClient
      .from("time_off_requests")
      .select("employee_name")
      .eq("profile_id", employee.userId)
      .single()

    expect(data!.employee_name).toContain("Renamed")

    await serviceClient
      .from("profiles")
      .update({ first_name: "TestEmployee" })
      .eq("id", employee.userId)
  })

  it("still auto-rejects pending requests when the employee is soft-deleted", async () => {
    // That trigger sets pending -> rejected. A guard that fired on any status
    // change would break employee deletion.
    const victim = await createIsolatedWorkspace("user")
    await serviceClient
      .from("profiles")
      .update({ workspace_id: admin.workspaceId })
      .eq("id", victim.userId)

    await seedRequest({ ...ANCHOR, status: "pending", profileId: victim.userId })

    const { error } = await serviceClient
      .from("profiles")
      .update({ status: "deleted" })
      .eq("id", victim.userId)
      .eq("workspace_id", admin.workspaceId)

    expect(error).toBeNull()

    const { data } = await serviceClient
      .from("time_off_requests")
      .select("status")
      .eq("profile_id", victim.userId)
      .single()

    expect(data!.status).toBe("rejected")

    await serviceClient.from("time_off_requests").delete().eq("profile_id", victim.userId)
    await deleteAuthUser(victim.userId)
    await serviceClient.from("profiles").delete().eq("id", victim.userId)
    await serviceClient.from("workspaces").delete().eq("id", victim.workspaceId)
  }, 30_000)
})
