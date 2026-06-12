import { useState, useMemo, useCallback, startTransition } from "react"
import { useNavigate } from "react-router-dom"
import { Calendar, CalendarClock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import { CalendarFilters } from "@/components/calendar/calendar-filters"
import { CalendarMonthGrid } from "@/components/calendar/calendar-month-grid"
import { CreateTimeOffRecordModal } from "@/components/create-time-off-record-modal"
import { SubmitTimeOffRequestModal } from "@/components/submit-time-off-request-modal"
import { RequestDetailsModal } from "@/components/request-details-modal"
import { useTimeOffRequests, useActiveEmployees  } from "@/hooks/use-time-off-requests"
import { useTimeOffCategories } from "@/hooks/use-time-off-categories"
import { useHolidays } from "@/hooks/use-holidays"
import { useAuth } from "@/hooks/use-auth"
import { addToast } from "@/lib/toast"
import { getInitials } from "@/lib/utils"
import { generateReport } from "@/lib/generate-report"
import {
  getMonthGrid,
  normalizeEvents,
  assignEventsToWeeks,
  type CalendarEvent,
} from "@/lib/calendar-utils"
import type { CategoryColor } from "@/lib/category-colors"
import type { TimeOffRequest } from "@/types/time-off-request"

export function CalendarPage() {
  const now = new Date()
  const [currentMonth, setCurrentMonth] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1)
  )
  const [selectedUser, setSelectedUser] = useState("all")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [requestModalOpen, setRequestModalOpen] = useState(false)
  const [initialDate, setInitialDate] = useState<Date | undefined>()
  const [detailsModalRequest, setDetailsModalRequest] = useState<TimeOffRequest | null>(null)
  const [downloading, setDownloading] = useState(false)

  const navigate = useNavigate()
  const { workspace, profile } = useAuth()
  const isAdmin = profile?.role === "admin" || profile?.role === "owner"
  const canNavigate = isAdmin
  const { data: requests = [] } = useTimeOffRequests()
  const { data: categories = [] } = useTimeOffCategories()
  const { data: holidays = [] } = useHolidays()
  const { data: employees = [] } = useActiveEmployees()

  // Build category map (matches requests.tsx pattern but includes colour)
  const categoryMap = useMemo(() => {
    const map = new Map<string, { name: string; emoji?: string | null; colour: CategoryColor }>()
    for (const c of categories) map.set(c.id, { name: c.name, emoji: c.emoji, colour: c.colour })
    return map
  }, [categories])

  // Filter requests: only approved + pending, then by user/category
  const filteredRequests = useMemo(() => {
    let result = requests.filter(
      (r) => r.status === "approved" || r.status === "pending"
    )
    // Non-admins: hide other users' pending requests
    if (!isAdmin && profile) {
      result = result.filter(
        (r) => r.status === "approved" || r.profile_id === profile.id
      )
    }
    if (selectedUser !== "all") {
      result = result.filter((r) => r.profile_id === selectedUser)
    }
    if (selectedCategory !== "all") {
      result = result.filter((r) => r.category_id === selectedCategory)
    }
    return result
  }, [requests, selectedUser, selectedCategory, isAdmin, profile])

  // Compute the visible date range for filtering holidays
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  const monthGrid = useMemo(() => getMonthGrid(year, month), [year, month])

  // Filter holidays to visible date range
  const visibleHolidays = useMemo(() => {
    if (monthGrid.length === 0) return []
    const firstDate = monthGrid[0][0].date
    const lastDate = monthGrid[monthGrid.length - 1][6].date
    return holidays.filter((h) => h.date >= firstDate && h.date <= lastDate)
  }, [holidays, monthGrid])

  // Normalize into unified CalendarEvent[]
  const calendarEvents = useMemo(
    () => normalizeEvents(filteredRequests, visibleHolidays, categoryMap),
    [filteredRequests, visibleHolidays, categoryMap]
  )

  // Assign events to weeks with lane positions
  const calendarWeeks = useMemo(
    () => assignEventsToWeeks(monthGrid, calendarEvents),
    [monthGrid, calendarEvents]
  )

  // Filter dropdown options
  const userOptions = useMemo(
    () =>
      employees.map((e) => ({
        id: e.id,
        label: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.email,
        avatarUrl: e.avatar_url,
        initials: getInitials(e.first_name, e.last_name),
      })),
    [employees]
  )

  const categoryOptions = useMemo(
    () =>
      categories
        .filter((c) => c.is_active)
        .map((c) => ({
          id: c.id,
          label: `${c.name}${c.emoji ? ` ${c.emoji}` : ""}`,
        })),
    [categories]
  )

  // Navigation handlers — wrapped in startTransition to keep UI responsive
  const handlePrevMonth = useCallback(() => {
    startTransition(() => {
      setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    })
  }, [])
  const handleNextMonth = useCallback(() => {
    startTransition(() => {
      setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    })
  }, [])
  const handleToday = useCallback(() => {
    startTransition(() => {
      const now = new Date()
      setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1))
    })
  }, [])

  const handleDayClick = useCallback((dateStr: string) => {
    if (isAdmin) {
      const [y, m, d] = dateStr.split("-").map(Number)
      setInitialDate(new Date(y, m - 1, d))
      setCreateModalOpen(true)
    } else {
      setRequestModalOpen(true)
    }
  }, [isAdmin])

  const handleEventClick = useCallback((event: CalendarEvent) => {
    if (event.type === "request" && event.originalRequest) {
      setDetailsModalRequest(event.originalRequest)
    }
  }, [])

  const handleUserChange = useCallback((v: string) => {
    startTransition(() => setSelectedUser(v))
  }, [])

  const handleCategoryChange = useCallback((v: string) => {
    startTransition(() => setSelectedCategory(v))
  }, [])

  const handleDownloadReport = useCallback(async () => {
    if (!workspace) return
    setDownloading(true)
    try {
      await generateReport(workspace.id)
      addToast({ title: "Report downloaded" })
    } catch {
      addToast({ title: "Couldn't download report", description: "Something went wrong. Try again." })
    } finally {
      setDownloading(false)
    }
  }, [workspace])

  return (
    <div className="flex flex-col size-full">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 h-[60px] shrink-0">
        <button className="flex items-center justify-center size-7 rounded-[10px] shrink-0 text-foreground hover:bg-accent transition-colors">
          <Calendar className="size-4" />
        </button>
        <div className="flex items-center h-6 pr-2 relative shrink-0">
          <Separator orientation="vertical" />
        </div>
        <BreadcrumbItem text="Calendar" className="flex-1 text-foreground font-medium" />
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button variant="secondary" loading={downloading} onClick={handleDownloadReport}>
              Download report
            </Button>
          )}
          {isAdmin ? (
            <Button onClick={() => { setInitialDate(undefined); setCreateModalOpen(true) }}>
              <CalendarClock />
              Create time-off record
            </Button>
          ) : (
            <Button onClick={() => setRequestModalOpen(true)}>
              <CalendarClock />
              Request time off
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 p-4">
        <CalendarFilters
          currentMonth={currentMonth}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onToday={handleToday}
          selectedUser={selectedUser}
          onUserChange={handleUserChange}
          selectedCategory={selectedCategory}
          onCategoryChange={handleCategoryChange}
          users={userOptions}
          categories={categoryOptions}
        />

        <CalendarMonthGrid
          weeks={calendarWeeks}
          onEventClick={handleEventClick}
          onDayClick={handleDayClick}
          isAdmin={isAdmin}
        />
      </div>

      <CreateTimeOffRecordModal
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open)
          if (!open) setInitialDate(undefined)
        }}
        initialStartDate={initialDate}
      />

      <SubmitTimeOffRequestModal
        open={requestModalOpen}
        onOpenChange={setRequestModalOpen}
      />

      <RequestDetailsModal
        open={detailsModalRequest !== null}
        onOpenChange={(open) => { if (!open) setDetailsModalRequest(null) }}
        request={detailsModalRequest}
        categoryMap={categoryMap}
        canSeeComment={isAdmin || detailsModalRequest?.profile_id === profile?.id}
        onEmployeeClick={canNavigate && detailsModalRequest
          ? () => { setDetailsModalRequest(null); navigate(`/employees/${detailsModalRequest.profile_id}`) }
          : undefined}
      />
    </div>
  )
}
