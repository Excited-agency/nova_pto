import type { TimeOffRequest } from "@/types/time-off-request"
import { parseDateLocal } from "@/lib/date-utils"

/**
 * Client-side overlap detection for time-off requests.
 *
 * The server is authoritative — trg_prevent_overlapping_requests plus the
 * time_off_requests_no_overlap EXCLUDE constraint (migration 20260827100000)
 * decide what is allowed. Everything here exists so the UI can grey out the
 * days and explain the conflict before the user reaches Submit, and it
 * deliberately mirrors the server's rule exactly: a whole shared calendar day
 * is an overlap, half-day periods do not narrow it.
 */

const MS_PER_DAY = 86_400_000

/**
 * A calendar day as a single integer, computed from the LOCAL y/m/d.
 *
 * Comparing Date objects directly is unsafe here: pickers hand back local
 * midnight, `new Date()` carries a time, and adding days across a DST boundary
 * shifts the clock. Reducing to a day index removes all three problems.
 */
function dayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY
  )
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** Statuses that hold their dates. Rejected and withdrawn requests free them. */
const OCCUPYING_STATUSES = new Set<string>(["pending", "approved"])

export interface OccupiedRange {
  id: string
  start: Date
  end: Date
  /** Category name snapshot, matching the wording the server's error uses. */
  label: string
  status: "pending" | "approved"
}

/**
 * Reduce a list of requests to the ranges that block new bookings.
 *
 * `excludeId` leaves out one request — needed when editing rather than
 * creating, so a request never conflicts with itself.
 */
export function toOccupiedRanges(
  requests: TimeOffRequest[],
  excludeId?: string
): OccupiedRange[] {
  const ranges: OccupiedRange[] = []

  for (const request of requests) {
    if (!OCCUPYING_STATUSES.has(request.status)) continue
    if (excludeId != null && request.id === excludeId) continue

    ranges.push({
      id: request.id,
      start: parseDateLocal(request.start_date),
      end: parseDateLocal(request.end_date),
      label: request.category_name?.trim() || "time off",
      status: request.status as "pending" | "approved",
    })
  }

  return ranges
}

/** The range holding this day, if any — used to grey out a day in the picker. */
export function isDateOccupied(
  ranges: OccupiedRange[],
  date: Date
): OccupiedRange | undefined {
  const day = dayNumber(date)
  return ranges.find((r) => day >= dayNumber(r.start) && day <= dayNumber(r.end))
}

/**
 * The earliest range that shares any day with [start, end].
 *
 * Catches the case a disabled picker cannot: both endpoints free but a booked
 * day sitting between them.
 */
export function findOverlap(
  ranges: OccupiedRange[],
  start: Date,
  end: Date
): OccupiedRange | undefined {
  const from = dayNumber(start)
  const to = dayNumber(end)
  if (to < from) return undefined

  let earliest: OccupiedRange | undefined
  for (const range of ranges) {
    if (dayNumber(range.start) > to || dayNumber(range.end) < from) continue
    if (earliest == null || dayNumber(range.start) < dayNumber(earliest.start)) {
      earliest = range
    }
  }

  return earliest
}

/**
 * The longest unbroken stretch inside [start, end] that is still free, so the
 * user can be offered "take only 3–4 Jul" instead of being told to start over.
 * Ties go to the earlier stretch. Returns null when no day is free.
 *
 * Weekends and holidays are not considered: they are not booked by anyone, and
 * a suggestion that lands entirely on them is already caught by the existing
 * "no working days" check.
 */
export function suggestFreeRange(
  ranges: OccupiedRange[],
  start: Date,
  end: Date
): { start: Date; end: Date } | null {
  const span = dayNumber(end) - dayNumber(start)
  if (span < 0) return null

  let best: { offset: number; length: number } | null = null
  let runStart: number | null = null

  // Runs one past the end so a stretch reaching the last day still closes.
  for (let offset = 0; offset <= span + 1; offset++) {
    const isFree = offset <= span && !isDateOccupied(ranges, addDays(start, offset))

    if (isFree) {
      if (runStart == null) runStart = offset
      continue
    }

    if (runStart != null) {
      const length = offset - runStart
      if (best == null || length > best.length) best = { offset: runStart, length }
      runStart = null
    }
  }

  if (best == null) return null

  return {
    start: addDays(start, best.offset),
    end: addDays(start, best.offset + best.length - 1),
  }
}
