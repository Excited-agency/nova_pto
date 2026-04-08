export function formatPeriod(startDate: string, endDate: string) {
  const start = new Date(startDate)
  const end = new Date(endDate)

  const endFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(end)

  if (startDate === endDate) return endFmt

  const sameYear = start.getFullYear() === end.getFullYear()
  const startFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" as const }),
  }).format(start)

  return `${startFmt} - ${endFmt}`
}

export function formatLocalDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function calculateDays(
  startDate: string,
  endDate: string,
  startPeriod: "morning" | "midday" = "morning",
  endPeriod: "midday" | "end_of_day" = "end_of_day",
  holidays: string[] = []
): number {
  const startPortion = startPeriod === "morning" ? 1.0 : 0.5
  const endPortion = endPeriod === "end_of_day" ? 1.0 : 0.5
  const holidaySet = new Set(holidays)

  const cur = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T00:00:00")
  let total = 0

  while (cur <= end) {
    const dow = cur.getDay()
    const iso = formatLocalDate(cur)
    const isFirst = iso === startDate
    const isLast = iso === endDate

    if (dow !== 0 && dow !== 6 && !holidaySet.has(iso)) {
      if (isFirst && isLast) {
        total += startPortion + endPortion - 1.0
      } else if (isFirst) {
        total += startPortion
      } else if (isLast) {
        total += endPortion
      } else {
        total += 1.0
      }
    }

    cur.setDate(cur.getDate() + 1)
  }

  return total
}

export function formatDays(days: number): string {
  const formatted = Number.isInteger(days) ? String(days) : days.toFixed(1)
  return `${formatted} ${days === 1 ? "day" : "days"}`
}

export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "—"
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(y, m - 1, d))
}

export function formatPeriodLabel(period: string): string {
  const labels: Record<string, string> = {
    morning: "Morning",
    midday: "Midday",
    end_of_day: "End of day",
  }
  return labels[period] ?? period
}

export function isBeforeDate(date: Date, referenceDate: Date): boolean {
  if (date.getFullYear() < referenceDate.getFullYear()) return true
  if (date.getFullYear() > referenceDate.getFullYear()) return false
  if (date.getMonth() < referenceDate.getMonth()) return true
  if (date.getMonth() > referenceDate.getMonth()) return false
  return date.getDate() < referenceDate.getDate()
}

export function formatDateTime(isoString: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoString))
}
