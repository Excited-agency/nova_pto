import { describe, it, expect } from "vitest"
import {
  toOccupiedRanges,
  isDateOccupied,
  findOverlap,
  suggestFreeRange,
  type OccupiedRange,
} from "@/lib/request-overlap"
import type { TimeOffRequest, TimeOffStatus } from "@/types/time-off-request"

function request(
  overrides: Partial<TimeOffRequest> & { start_date: string; end_date: string }
): TimeOffRequest {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    profile_id: "emp-1",
    workspace_id: "ws-1",
    category_id: "cat-1",
    category_name: "Vacation",
    employee_name: "Test Employee",
    employee_email: "test@example.test",
    employee_avatar_url: null,
    start_period: "morning",
    end_period: "end_of_day",
    total_days: 1,
    request_type: "vacation",
    status: "approved" as TimeOffStatus,
    comment: null,
    rejection_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as TimeOffRequest
}

/** Local midnight, matching what the date pickers hand back. */
const d = (iso: string) => {
  const [y, m, day] = iso.split("-").map(Number)
  return new Date(y, m - 1, day)
}

const ranges = (...specs: [string, string][]): OccupiedRange[] =>
  toOccupiedRanges(specs.map(([start, end]) => request({ start_date: start, end_date: end })))

describe("toOccupiedRanges", () => {
  it("keeps only requests that hold their dates", () => {
    const result = toOccupiedRanges([
      request({ start_date: "2026-09-07", end_date: "2026-09-08", status: "pending" }),
      request({ start_date: "2026-09-09", end_date: "2026-09-10", status: "approved" }),
      request({ start_date: "2026-09-11", end_date: "2026-09-11", status: "rejected" }),
      request({ start_date: "2026-09-14", end_date: "2026-09-14", status: "withdrawn" }),
    ])

    expect(result.map((r) => r.status)).toEqual(["pending", "approved"])
  })

  it("leaves out the excluded request so it never conflicts with itself", () => {
    const own = request({ id: "self", start_date: "2026-09-07", end_date: "2026-09-08" })
    expect(toOccupiedRanges([own], "self")).toHaveLength(0)
  })

  it("falls back to a generic label when the category name is missing", () => {
    const [range] = toOccupiedRanges([
      request({ start_date: "2026-09-07", end_date: "2026-09-07", category_name: null }),
    ])
    expect(range.label).toBe("time off")
  })

  it("trims the category name snapshot", () => {
    const [range] = toOccupiedRanges([
      request({ start_date: "2026-09-07", end_date: "2026-09-07", category_name: "Sick leave 🤒 " }),
    ])
    expect(range.label).toBe("Sick leave 🤒")
  })
})

describe("isDateOccupied", () => {
  const occupied = ranges(["2026-09-07", "2026-09-10"])

  it.each([
    ["the first day", "2026-09-07", true],
    ["a day in the middle", "2026-09-08", true],
    ["the last day", "2026-09-10", true],
    ["the day before", "2026-09-06", false],
    ["the day after", "2026-09-11", false],
  ] as [string, string, boolean][])("%s -> %s", (_label, iso, expected) => {
    expect(isDateOccupied(occupied, d(iso)) != null).toBe(expected)
  })

  it("ignores the time of day carried by a Date", () => {
    const afternoon = new Date(2026, 8, 8, 17, 45)
    expect(isDateOccupied(occupied, afternoon)).toBeDefined()
  })
})

describe("findOverlap", () => {
  const occupied = ranges(["2026-09-07", "2026-09-10"])

  it.each([
    ["identical", "2026-09-07", "2026-09-10"],
    ["contained", "2026-09-08", "2026-09-09"],
    ["containing", "2026-09-01", "2026-09-30"],
    ["overlapping the start", "2026-09-03", "2026-09-08"],
    ["overlapping the end", "2026-09-09", "2026-09-15"],
  ] as [string, string, string][])("finds a %s range", (_label, start, end) => {
    expect(findOverlap(occupied, d(start), d(end))).toBeDefined()
  })

  it.each([
    ["entirely before", "2026-09-01", "2026-09-06"],
    ["entirely after", "2026-09-11", "2026-09-14"],
  ] as [string, string, string][])("finds nothing %s", (_label, start, end) => {
    expect(findOverlap(occupied, d(start), d(end))).toBeUndefined()
  })

  it("catches a booked day sitting between two free endpoints", () => {
    // The case a disabled picker cannot catch on its own: both ends are
    // selectable, the conflict is in the middle.
    const middle = ranges(["2026-09-09", "2026-09-09"])
    expect(findOverlap(middle, d("2026-09-07"), d("2026-09-11"))).toBeDefined()
  })

  it("returns the earliest conflict when several overlap", () => {
    const many = ranges(["2026-09-20", "2026-09-21"], ["2026-09-08", "2026-09-09"])
    expect(findOverlap(many, d("2026-09-01"), d("2026-09-30"))!.start).toEqual(d("2026-09-08"))
  })

  it("returns nothing for an inverted range instead of guessing", () => {
    expect(findOverlap(occupied, d("2026-09-10"), d("2026-09-07"))).toBeUndefined()
  })
})

describe("suggestFreeRange", () => {
  it("suggests the free head when the tail is taken", () => {
    // The reported case: 5-8 Jul already requested, 3-6 Jul attempted.
    const occupied = ranges(["2026-07-05", "2026-07-08"])
    expect(suggestFreeRange(occupied, d("2026-07-03"), d("2026-07-06"))).toEqual({
      start: d("2026-07-03"),
      end: d("2026-07-04"),
    })
  })

  it("suggests the free tail when the head is taken", () => {
    const occupied = ranges(["2026-07-03", "2026-07-04"])
    expect(suggestFreeRange(occupied, d("2026-07-03"), d("2026-07-08"))).toEqual({
      start: d("2026-07-05"),
      end: d("2026-07-08"),
    })
  })

  it("picks the longest stretch when a booking splits the range", () => {
    const occupied = ranges(["2026-07-06", "2026-07-06"])
    expect(suggestFreeRange(occupied, d("2026-07-03"), d("2026-07-10"))).toEqual({
      start: d("2026-07-07"),
      end: d("2026-07-10"),
    })
  })

  it("prefers the earlier stretch when two are the same length", () => {
    const occupied = ranges(["2026-07-05", "2026-07-05"])
    expect(suggestFreeRange(occupied, d("2026-07-03"), d("2026-07-07"))).toEqual({
      start: d("2026-07-03"),
      end: d("2026-07-04"),
    })
  })

  it("returns null when every day is taken", () => {
    const occupied = ranges(["2026-07-01", "2026-07-31"])
    expect(suggestFreeRange(occupied, d("2026-07-03"), d("2026-07-06"))).toBeNull()
  })

  it("returns null for an inverted range", () => {
    expect(suggestFreeRange([], d("2026-07-06"), d("2026-07-03"))).toBeNull()
  })

  it("keeps the whole range when nothing is taken", () => {
    expect(suggestFreeRange([], d("2026-07-03"), d("2026-07-06"))).toEqual({
      start: d("2026-07-03"),
      end: d("2026-07-06"),
    })
  })

  it("does not drift across a daylight-saving boundary", () => {
    // Clocks change in most of Europe on 25 Oct 2026. Adding days by
    // millisecond arithmetic would shift the calendar day here.
    const occupied = ranges(["2026-10-28", "2026-10-30"])
    expect(suggestFreeRange(occupied, d("2026-10-23"), d("2026-10-30"))).toEqual({
      start: d("2026-10-23"),
      end: d("2026-10-27"),
    })
  })
})
