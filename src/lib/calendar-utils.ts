import type { CategoryColor } from "@/lib/category-colors"
import type { TimeOffRequest, TimeOffStatus } from "@/types/time-off-request"
import type { Holiday } from "@/types/holiday"
import type { CalendarDay, CalendarEvent, WeekEventSegment, CalendarWeek } from "@/types/calendar"

export type { CalendarDay, CalendarEvent, WeekEventSegment, CalendarWeek } from "@/types/calendar"

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

function todayStr(): string {
  const d = new Date()
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Generate a month grid: 5-6 rows of 7 days, starting on Monday (ISO).
 * `month` is 0-indexed (0 = January).
 */
export function getMonthGrid(year: number, month: number): CalendarDay[][] {
  const today = todayStr()
  const firstOfMonth = new Date(year, month, 1)
  // JS getDay(): 0=Sun..6=Sat  →  ISO offset: Mon=0..Sun=6
  const jsDay = firstOfMonth.getDay()
  const isoOffset = jsDay === 0 ? 6 : jsDay - 1 // days to go back to reach Monday

  const startDate = new Date(year, month, 1 - isoOffset)
  const weeks: CalendarDay[][] = []

  const cursor = new Date(startDate)
  // Generate weeks until we've passed the last day of the month
  while (true) {
    const week: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      const cy = cursor.getFullYear()
      const cm = cursor.getMonth()
      const cd = cursor.getDate()
      const dateStr = toDateStr(cy, cm, cd)
      const dow = d // 0=Mon..6=Sun by construction
      week.push({
        date: dateStr,
        dayOfMonth: cd,
        isCurrentMonth: cm === month && cy === year,
        isToday: dateStr === today,
        isWeekend: dow >= 5,
        dayOfWeek: dow,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    // Stop once we've included the entire target month
    if (cursor.getMonth() !== month || cursor.getFullYear() !== year) {
      // We've moved past the target month — we're done
      break
    }
  }
  return weeks
}

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

type CategoryMap = Map<string, { name: string; emoji?: string | null; colour: CategoryColor }>

export function normalizeEvents(
  requests: TimeOffRequest[],
  holidays: Holiday[],
  categoryMap: CategoryMap
): CalendarEvent[] {
  const events: CalendarEvent[] = []

  for (const req of requests) {
    const cat = req.category_id ? categoryMap.get(req.category_id) : undefined
    const emoji = cat?.emoji ? ` ${cat.emoji}` : ""
    const label = `${req.employee_name}${emoji}`
    const color: CategoryColor = cat?.colour ?? "gray"

    events.push({
      id: req.id,
      type: "request",
      label,
      startDate: req.start_date,
      endDate: req.end_date,
      color,
      status: req.status,
      originalRequest: req,
    })
  }

  for (const h of holidays) {
    events.push({
      id: h.id,
      type: "holiday",
      label: `${h.name} \u{1F389}`,
      startDate: h.date,
      endDate: h.date,
      color: "green",
    })
  }

  return events
}

// ---------------------------------------------------------------------------
// Event → week assignment + lane allocation
// ---------------------------------------------------------------------------

export function assignEventsToWeeks(
  weeks: CalendarDay[][],
  events: CalendarEvent[]
): CalendarWeek[] {
  return weeks.map((days) => {
    const weekStart = days[0].date
    const weekEnd = days[6].date

    // Pre-build date→column index map for O(1) lookups instead of findIndex
    const dateToCol = new Map<string, number>()
    for (let i = 0; i < days.length; i++) {
      dateToCol.set(days[i].date, i + 1)
    }

    // Collect segments: events overlapping this week, clipped to week boundaries
    const segments: WeekEventSegment[] = []

    for (const ev of events) {
      if (ev.endDate < weekStart || ev.startDate > weekEnd) continue

      // Clipped start/end within this week
      const clippedStart = ev.startDate < weekStart ? weekStart : ev.startDate
      const clippedEnd = ev.endDate > weekEnd ? weekEnd : ev.endDate

      const startCol = dateToCol.get(clippedStart) ?? 0
      const endCol = dateToCol.get(clippedEnd) ?? 0

      if (startCol < 1 || endCol < 1) continue

      segments.push({
        event: ev,
        startCol,
        endCol,
        isStart: ev.startDate >= weekStart,
        isEnd: ev.endDate <= weekEnd,
        lane: 0,
      })
    }

    // Sort: earlier start first, then longer spans first
    segments.sort((a, b) => {
      if (a.startCol !== b.startCol) return a.startCol - b.startCol
      return (b.endCol - b.startCol) - (a.endCol - a.startCol)
    })

    // Greedy lane assignment
    const laneBusy: number[] = [] // laneBusy[i] = last occupied column in lane i
    for (const seg of segments) {
      let assigned = -1
      for (let lane = 0; lane < laneBusy.length; lane++) {
        if (laneBusy[lane] < seg.startCol) {
          assigned = lane
          break
        }
      }
      if (assigned === -1) {
        assigned = laneBusy.length
        laneBusy.push(0)
      }
      seg.lane = assigned
      laneBusy[assigned] = seg.endCol
    }

    return {
      days,
      segments,
      laneCount: laneBusy.length,
    }
  })
}

// ---------------------------------------------------------------------------
// Color mapping
// ---------------------------------------------------------------------------

interface EventColorClasses {
  bg: string
  text: string
}

const approvedColors: Record<CategoryColor, EventColorClasses> = {
  red: { bg: "bg-red-100", text: "text-red-900" },
  orange: { bg: "bg-orange-100", text: "text-orange-900" },
  green: { bg: "bg-green-100", text: "text-green-900" },
  blue: { bg: "bg-blue-100", text: "text-blue-900" },
  gray: { bg: "bg-gray-100", text: "text-gray-900" },
}

const pendingColors: Record<CategoryColor, EventColorClasses & { border: string }> = {
  red: { bg: "bg-red-50", text: "text-red-900", border: "border border-dashed border-red-300" },
  orange: { bg: "bg-orange-50", text: "text-orange-900", border: "border border-dashed border-orange-300" },
  green: { bg: "bg-green-50", text: "text-green-900", border: "border border-dashed border-green-300" },
  blue: { bg: "bg-blue-50", text: "text-blue-900", border: "border border-dashed border-blue-300" },
  gray: { bg: "bg-gray-50", text: "text-gray-900", border: "border border-dashed border-gray-300" },
}

export function getCategoryBgClass(
  color: CategoryColor,
  isPending = false
): { bg: string; text: string; border?: string } {
  if (isPending) return pendingColors[color]
  return approvedColors[color]
}
