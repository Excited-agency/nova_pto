import type { CategoryColor } from "@/lib/category-colors"
import type { TimeOffRequest, TimeOffStatus } from "@/types/time-off-request"

export interface CalendarDay {
  date: string // YYYY-MM-DD
  dayOfMonth: number
  isCurrentMonth: boolean
  isToday: boolean
  isWeekend: boolean
  /** 0 = Mon … 6 = Sun (ISO, 0-indexed for grid columns) */
  dayOfWeek: number
}

export interface CalendarEvent {
  id: string
  type: "request" | "holiday"
  label: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  color: CategoryColor
  status?: TimeOffStatus
  originalRequest?: TimeOffRequest
}

export interface WeekEventSegment {
  event: CalendarEvent
  /** 1-based grid column where this segment starts within the week */
  startCol: number
  /** 1-based grid column where this segment ends (inclusive) */
  endCol: number
  /** true if the overall event actually starts in this week */
  isStart: boolean
  /** true if the overall event actually ends in this week */
  isEnd: boolean
  /** 0-based lane index for vertical stacking */
  lane: number
}

export interface CalendarWeek {
  days: CalendarDay[]
  segments: WeekEventSegment[]
  laneCount: number
}
