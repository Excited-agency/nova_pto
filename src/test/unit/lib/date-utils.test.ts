import { describe, it, expect } from "vitest"
import {
  calculateDays,
  formatDays,
  formatDate,
  formatLocalDate,
  formatPeriod,
  isBeforeDate,
  parseDateLocal,
} from "@/lib/date-utils"

describe("calculateDays", () => {
  it("counts Mon–Fri as 5 days (full days)", () => {
    // 2026-05-11 Mon → 2026-05-15 Fri
    expect(calculateDays("2026-05-11", "2026-05-15")).toBe(5)
  })

  it("skips Saturday and Sunday", () => {
    // 2026-05-15 Fri → 2026-05-18 Mon = 2 days (Fri + Mon)
    expect(calculateDays("2026-05-15", "2026-05-18")).toBe(2)
  })

  it("counts single full day as 1", () => {
    expect(calculateDays("2026-05-11", "2026-05-11")).toBe(1)
  })

  it("counts half-day start (midday) on single day as 0.5", () => {
    expect(calculateDays("2026-05-11", "2026-05-11", "midday", "end_of_day")).toBe(0.5)
  })

  it("counts half-day end (midday) on single day as 0.5", () => {
    expect(calculateDays("2026-05-11", "2026-05-11", "morning", "midday")).toBe(0.5)
  })

  it("both halves on same day = 0 (midday start + midday end)", () => {
    expect(calculateDays("2026-05-11", "2026-05-11", "midday", "midday")).toBe(0)
  })

  it("half-day start across multiple days = 4.5 (Mon midday → Fri full)", () => {
    // Mon midday (0.5) + Tue + Wed + Thu + Fri = 0.5 + 4 = 4.5
    expect(calculateDays("2026-05-11", "2026-05-15", "midday", "end_of_day")).toBe(4.5)
  })

  it("half-day end across multiple days = 4.5 (Mon full → Fri midday)", () => {
    // Mon + Tue + Wed + Thu + Fri midday (0.5) = 4 + 0.5 = 4.5
    expect(calculateDays("2026-05-11", "2026-05-15", "morning", "midday")).toBe(4.5)
  })

  it("skips holidays within the range", () => {
    // Mon–Fri (5 days) with holiday on Wednesday
    expect(calculateDays("2026-05-11", "2026-05-15", "morning", "end_of_day", ["2026-05-13"])).toBe(4)
  })

  it("skips multiple holidays", () => {
    // Mon–Fri with 2 holidays = 3 days
    expect(calculateDays("2026-05-11", "2026-05-15", "morning", "end_of_day", ["2026-05-12", "2026-05-14"])).toBe(3)
  })

  it("holiday on weekend is ignored (already excluded)", () => {
    // Same result whether Sat is in holiday list or not
    expect(calculateDays("2026-05-11", "2026-05-18", "morning", "end_of_day", ["2026-05-16"])).toBe(6)
    expect(calculateDays("2026-05-11", "2026-05-18")).toBe(6)
  })

  it("returns 0 when range is entirely weekend", () => {
    // 2026-05-16 Sat → 2026-05-17 Sun
    expect(calculateDays("2026-05-16", "2026-05-17")).toBe(0)
  })

  it("two weeks Mon–Fri = 10 days", () => {
    expect(calculateDays("2026-05-11", "2026-05-22")).toBe(10)
  })

  it("defaults to morning/end_of_day (full days) when periods omitted", () => {
    expect(calculateDays("2026-05-11", "2026-05-11")).toBe(1)
  })

  it("handles single holiday that falls on the only working day → 0", () => {
    expect(calculateDays("2026-05-11", "2026-05-11", "morning", "end_of_day", ["2026-05-11"])).toBe(0)
  })
})

describe("formatDays", () => {
  it("formats 1 as '1 day' (singular)", () => {
    expect(formatDays(1)).toBe("1 day")
  })

  it("formats 2 as '2 days'", () => {
    expect(formatDays(2)).toBe("2 days")
  })

  it("formats 0.5 as '0.5 days'", () => {
    expect(formatDays(0.5)).toBe("0.5 days")
  })

  it("formats 0 as '0 days'", () => {
    expect(formatDays(0)).toBe("0 days")
  })

  it("formats whole numbers without decimal", () => {
    expect(formatDays(5)).toBe("5 days")
  })

  it("formats 4.5 with one decimal", () => {
    expect(formatDays(4.5)).toBe("4.5 days")
  })
})

describe("formatDate", () => {
  it("returns em-dash for undefined", () => {
    expect(formatDate(undefined)).toBe("—")
  })

  it("returns em-dash for null", () => {
    expect(formatDate(null)).toBe("—")
  })

  it("formats ISO date string correctly", () => {
    expect(formatDate("2026-05-11")).toBe("May 11, 2026")
  })

  it("formats another date correctly", () => {
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026")
  })
})

describe("formatLocalDate", () => {
  it("formats a Date object as YYYY-MM-DD with zero-padding", () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05")
  })

  it("formats month 10 correctly", () => {
    expect(formatLocalDate(new Date(2026, 9, 15))).toBe("2026-10-15")
  })

  it("formats Dec 31 correctly", () => {
    expect(formatLocalDate(new Date(2026, 11, 31))).toBe("2026-12-31")
  })
})

describe("formatPeriod", () => {
  it("returns single date when start equals end", () => {
    const result = formatPeriod("2026-05-11", "2026-05-11")
    expect(result).toBe("May 11, 2026")
  })

  it("returns range with same year (no year on start)", () => {
    const result = formatPeriod("2026-05-11", "2026-05-15")
    expect(result).toContain("May 11")
    expect(result).toContain("May 15, 2026")
  })

  it("returns range with different years (year on both)", () => {
    const result = formatPeriod("2025-12-29", "2026-01-02")
    expect(result).toContain("2025")
    expect(result).toContain("2026")
  })
})

describe("isBeforeDate", () => {
  it("returns true when date is before reference", () => {
    expect(isBeforeDate(new Date(2026, 0, 1), new Date(2026, 0, 2))).toBe(true)
  })

  it("returns false when date equals reference", () => {
    expect(isBeforeDate(new Date(2026, 4, 11), new Date(2026, 4, 11))).toBe(false)
  })

  it("returns false when date is after reference", () => {
    expect(isBeforeDate(new Date(2026, 4, 12), new Date(2026, 4, 11))).toBe(false)
  })

  it("handles year boundary correctly", () => {
    expect(isBeforeDate(new Date(2025, 11, 31), new Date(2026, 0, 1))).toBe(true)
  })
})

describe("timezone-safe date parsing regression", () => {
  // Regression: prior code used new Date(dateStr + "T00:00:00") for calculateDays
  // and new Date(dateStr) for formatPeriod. The latter parses date-only strings as
  // UTC midnight, which shifts to the previous day in UTC-X timezones.
  // parseDateLocal uses new Date(y, m-1, d) — always local, always correct.

  it("formatPeriod: Jan 1 renders as Jan 1 not Dec 31 (timezone-safe)", () => {
    const result = formatPeriod("2026-01-01", "2026-01-01")
    expect(result).toBe("Jan 1, 2026")
    expect(result).not.toContain("Dec 31")
    expect(result).not.toContain("2025")
  })

  it("formatPeriod: Dec 31 renders as Dec 31 not Dec 30", () => {
    const result = formatPeriod("2026-12-31", "2026-12-31")
    expect(result).toBe("Dec 31, 2026")
    expect(result).not.toContain("Dec 30")
  })

  it("calculateDays: Jan 1 (Thursday) counted as 1 working day", () => {
    // 2026-01-01 is a Thursday — must be counted regardless of timezone
    expect(calculateDays("2026-01-01", "2026-01-01")).toBe(1)
  })

  it("calculateDays: year-boundary week Mon Dec 28 → Fri Jan 1 = 5 days", () => {
    // 2026-12-28 Mon → 2027-01-01 Fri = 5 working days
    expect(calculateDays("2026-12-28", "2027-01-01")).toBe(5)
  })
})

describe("parseDateLocal", () => {
  it("returns a local-midnight Date with the correct year/month/day", () => {
    const d = parseDateLocal("2026-01-01")
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)   // January (0-indexed)
    expect(d.getDate()).toBe(1)
  })

  it("returns Jan 1 — not Dec 31 — regardless of timezone offset", () => {
    // new Date("2026-01-01") parses as UTC midnight → local date shifts to Dec 31 in UTC-X
    // parseDateLocal must always yield the calendar date as written
    const d = parseDateLocal("2026-01-01")
    expect(d.getDate()).toBe(1)
    expect(d.getMonth()).toBe(0)
  })

  it("returns Dec 31 for 2026-12-31", () => {
    const d = parseDateLocal("2026-12-31")
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(11)  // December (0-indexed)
    expect(d.getDate()).toBe(31)
  })

  it("is equivalent to new Date(y, m-1, d) constructor", () => {
    const d1 = parseDateLocal("2026-06-15")
    const d2 = new Date(2026, 5, 15)
    expect(d1.getTime()).toBe(d2.getTime())
  })
})
