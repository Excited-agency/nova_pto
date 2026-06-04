import { useState, useMemo } from "react"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { isBeforeDate, isSameDay } from "@/lib/date-utils"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { CalendarDayButton } from "@/components/ui/calendar-day-button"
import { CalendarArrowButton } from "@/components/ui/calendar-arrow-button"

interface DatePickerProps {
  value?: Date
  onChange?: (date: Date) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  minDate?: Date
}

const DAYS_OF_WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  // Returns 0 (Mon) – 6 (Sun) for ISO week
  const day = new Date(year, month, 1).getDay()
  return day === 0 ? 6 : day - 1
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function formatMonthYear(year: number, month: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month, 1))
}

function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  className,
  disabled = false,
  minDate,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const today = useMemo(() => new Date(), [])
  const [viewYear, setViewYear] = useState(value?.getFullYear() ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(value?.getMonth() ?? today.getMonth())

  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth)

  // Previous month trailing days
  const prevMonthDays = getDaysInMonth(
    viewMonth === 0 ? viewYear - 1 : viewYear,
    viewMonth === 0 ? 11 : viewMonth - 1
  )

  function goToPrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  function handleDayClick(day: number) {
    const date = new Date(viewYear, viewMonth, day)
    onChange?.(date)
    setOpen(false)
  }

  // Build grid cells
  const cells: { day: number; currentMonth: boolean }[] = []

  // Leading days from previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: prevMonthDays - i, currentMonth: false })
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, currentMonth: true })
  }
  // Trailing days to fill last row
  const remaining = 7 - (cells.length % 7)
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, currentMonth: false })
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-slot="date-picker-trigger"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 tracking-tight shadow-xs transition-[color,border-color,box-shadow] outline-none",
            "focus:border-focus focus:shadow-focus",
            "cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
            value ? "font-medium text-foreground" : "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left truncate">
            {value ? formatDate(value) : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-2">
          <CalendarArrowButton
            direction="left"
            onClick={goToPrevMonth}
            disabled={
              !!minDate &&
              (viewYear < minDate.getFullYear() ||
                (viewYear === minDate.getFullYear() && viewMonth <= minDate.getMonth()))
            }
          />
          <span className="text-sm font-medium leading-5 tracking-tight text-foreground">
            {formatMonthYear(viewYear, viewMonth)}
          </span>
          <CalendarArrowButton direction="right" onClick={goToNextMonth} />
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS_OF_WEEK.map((day) => (
            <div
              key={day}
              className="flex size-8 items-center justify-center text-xs font-medium leading-4 text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7">
          {cells.map((cell, idx) => {
            const isSelected =
              cell.currentMonth &&
              value != null &&
              isSameDay(value, new Date(viewYear, viewMonth, cell.day))

            const isToday =
              cell.currentMonth &&
              isSameDay(today, new Date(viewYear, viewMonth, cell.day))

            const isPastDate =
              cell.currentMonth &&
              minDate != null &&
              isBeforeDate(new Date(viewYear, viewMonth, cell.day), minDate)

            const isDayDisabled = !cell.currentMonth || isPastDate

            return (
              <CalendarDayButton
                key={idx}
                label={String(cell.day)}
                selected={isSelected}
                disabled={isDayDisabled}
                onClick={() => !isDayDisabled && handleDayClick(cell.day)}
                className={cn(
                  !cell.currentMonth && "opacity-30",
                  isToday && !isSelected && "bg-accent font-medium"
                )}
              />
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
export type { DatePickerProps }
