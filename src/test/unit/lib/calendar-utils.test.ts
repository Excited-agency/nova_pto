import { describe, it, expect } from "vitest"
import { getMonthGrid, assignEventsToWeeks, normalizeEvents } from "@/lib/calendar-utils"
import type { CalendarEvent } from "@/lib/calendar-utils"

describe("getMonthGrid", () => {
  it("May 2026 starts on a Friday → grid starts Mon April 27", () => {
    const grid = getMonthGrid(2026, 4) // month 4 = May (0-indexed)
    expect(grid[0][0].date).toBe("2026-04-27")
    // Day 0 in grid = Monday
    expect(grid[0][0].dayOfWeek).toBe(0)
  })

  it("each week has exactly 7 days", () => {
    const grid = getMonthGrid(2026, 4)
    for (const week of grid) {
      expect(week).toHaveLength(7)
    }
  })

  it("isCurrentMonth is false for padding days", () => {
    const grid = getMonthGrid(2026, 4)
    // First day is April 27 — not May
    expect(grid[0][0].isCurrentMonth).toBe(false)
    // May 1 should be current month
    const may1 = grid[0].find(d => d.date === "2026-05-01")
    expect(may1?.isCurrentMonth).toBe(true)
  })

  it("isWeekend is true for Sat (index 5) and Sun (index 6)", () => {
    const grid = getMonthGrid(2026, 4)
    for (const week of grid) {
      expect(week[5].isWeekend).toBe(true)
      expect(week[6].isWeekend).toBe(true)
      expect(week[0].isWeekend).toBe(false)
    }
  })

  it("all days in grid are unique dates", () => {
    const grid = getMonthGrid(2026, 4)
    const dates = grid.flat().map(d => d.date)
    const unique = new Set(dates)
    expect(unique.size).toBe(dates.length)
  })

  it("all days of the month are present", () => {
    const grid = getMonthGrid(2026, 4)
    const currentMonthDates = grid.flat()
      .filter(d => d.isCurrentMonth)
      .map(d => d.date)
    expect(currentMonthDates).toContain("2026-05-01")
    expect(currentMonthDates).toContain("2026-05-31")
    expect(currentMonthDates).toHaveLength(31)
  })

  it("January 2026 grid covers the full month", () => {
    const grid = getMonthGrid(2026, 0)
    const days = grid.flat().filter(d => d.isCurrentMonth)
    expect(days).toHaveLength(31)
    expect(days[0].date).toBe("2026-01-01")
    expect(days[days.length - 1].date).toBe("2026-01-31")
  })
})

describe("assignEventsToWeeks", () => {
  function makeEvent(id: string, startDate: string, endDate: string): CalendarEvent {
    return { id, type: "request", label: id, startDate, endDate, color: "blue" }
  }

  it("event within a single week appears in that week", () => {
    const grid = getMonthGrid(2026, 4)
    const events = [makeEvent("e1", "2026-05-11", "2026-05-13")]
    const weeks = assignEventsToWeeks(grid, events)
    const weekWithEvent = weeks.find(w => w.segments.some(s => s.event.id === "e1"))
    expect(weekWithEvent).toBeDefined()
    const seg = weekWithEvent!.segments.find(s => s.event.id === "e1")!
    expect(seg.isStart).toBe(true)
    expect(seg.isEnd).toBe(true)
  })

  it("event spanning two weeks appears in both weeks", () => {
    const grid = getMonthGrid(2026, 4)
    // May 15 Fri → May 18 Mon spans week boundary
    const events = [makeEvent("e1", "2026-05-15", "2026-05-18")]
    const weeks = assignEventsToWeeks(grid, events)
    const weekSegments = weeks
      .map(w => w.segments.filter(s => s.event.id === "e1"))
      .filter(segs => segs.length > 0)
    expect(weekSegments).toHaveLength(2)
    // First week segment: isStart=true, isEnd=false
    const firstSeg = weekSegments[0][0]
    expect(firstSeg.isStart).toBe(true)
    expect(firstSeg.isEnd).toBe(false)
    // Second week segment: isStart=false, isEnd=true
    const secondSeg = weekSegments[1][0]
    expect(secondSeg.isStart).toBe(false)
    expect(secondSeg.isEnd).toBe(true)
  })

  it("assigns lane 0 to first event", () => {
    const grid = getMonthGrid(2026, 4)
    const events = [makeEvent("e1", "2026-05-11", "2026-05-13")]
    const weeks = assignEventsToWeeks(grid, events)
    const seg = weeks.flatMap(w => w.segments).find(s => s.event.id === "e1")
    expect(seg?.lane).toBe(0)
  })

  it("overlapping events get different lanes", () => {
    const grid = getMonthGrid(2026, 4)
    const events = [
      makeEvent("e1", "2026-05-11", "2026-05-13"),
      makeEvent("e2", "2026-05-12", "2026-05-14"),
    ]
    const weeks = assignEventsToWeeks(grid, events)
    const segsInWeek = weeks.find(w => w.segments.length >= 2)?.segments ?? []
    const lanes = segsInWeek.map(s => s.lane)
    expect(lanes).toContain(0)
    expect(lanes).toContain(1)
  })

  it("non-overlapping events both get lane 0", () => {
    const grid = getMonthGrid(2026, 4)
    const events = [
      makeEvent("e1", "2026-05-11", "2026-05-11"),
      makeEvent("e2", "2026-05-13", "2026-05-13"),
    ]
    const weeks = assignEventsToWeeks(grid, events)
    const weekSegs = weeks.find(w => w.segments.length >= 2)?.segments ?? []
    expect(weekSegs.every(s => s.lane === 0)).toBe(true)
  })

  it("event outside month range is not included", () => {
    const grid = getMonthGrid(2026, 4)
    const events = [makeEvent("outside", "2024-01-01", "2024-01-05")]
    const weeks = assignEventsToWeeks(grid, events)
    const allSegs = weeks.flatMap(w => w.segments)
    expect(allSegs.some(s => s.event.id === "outside")).toBe(false)
  })

  it("laneCount reflects the maximum number of simultaneous events", () => {
    const grid = getMonthGrid(2026, 4)
    const events = [
      makeEvent("e1", "2026-05-11", "2026-05-15"),
      makeEvent("e2", "2026-05-11", "2026-05-15"),
      makeEvent("e3", "2026-05-11", "2026-05-15"),
    ]
    const weeks = assignEventsToWeeks(grid, events)
    const weekWithAll = weeks.find(w => w.segments.length >= 3)
    expect(weekWithAll?.laneCount).toBeGreaterThanOrEqual(3)
  })
})
