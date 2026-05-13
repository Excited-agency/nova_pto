import { useState, useMemo, useEffect, useCallback, startTransition } from "react"
import { useNavigate } from "react-router-dom"
import { CalendarClock, CircleCheck, CircleX, ListCheck, ListX, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { TabGroup } from "@/components/ui/tab-group"
import { DataTableHeaderCell } from "@/components/ui/data-table-header-cell"
import { DataTableCell } from "@/components/ui/data-table-cell"
import { Badge } from "@/components/ui/badge"
import { Empty } from "@/components/ui/empty"
import { DataTablePagination } from "@/components/ui/data-table-pagination"
import { Input } from "@/components/ui/input"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import { CreateTimeOffRecordModal } from "@/components/create-time-off-record-modal"
import { ApproveTimeOffRequestModal } from "@/components/approve-time-off-request-modal"
import { RejectTimeOffRequestModal } from "@/components/reject-time-off-request-modal"
import { RequestDetailsModal } from "@/components/request-details-modal"
import { useTimeOffRequests } from "@/hooks/use-time-off-requests"
import { useTimeOffCategories } from "@/hooks/use-time-off-categories"
import { useAuth } from "@/hooks/use-auth"
import { getInitials } from "@/lib/utils"
import { addToast } from "@/lib/toast"
import { generateReport } from "@/lib/generate-report"
import { formatPeriod, formatDays } from "@/lib/date-utils"
import { getCategoryDisplay } from "@/lib/request-display"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import type { TimeOffRequest, TimeOffStatus } from "@/types/time-off-request"

type TabValue = "all" | TimeOffStatus

export function RequestsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearch = useDebouncedValue(searchQuery, 300)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [approveModalRequest, setApproveModalRequest] = useState<TimeOffRequest | null>(null)
  const [rejectModalRequest, setRejectModalRequest] = useState<TimeOffRequest | null>(null)
  const [detailsModalRequest, setDetailsModalRequest] = useState<TimeOffRequest | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  const navigate = useNavigate()
  const { workspace, profile } = useAuth()
  const canNavigate = profile?.role === "admin" || profile?.role === "owner"
  const { data: requests = [], isLoading, isError, refetch } = useTimeOffRequests()
  const { data: categories = [] } = useTimeOffCategories()

  const categoryMap = useMemo(() => {
    const map = new Map<string, { name: string; emoji?: string | null }>()
    for (const c of categories) map.set(c.id, { name: c.name, emoji: c.emoji })
    return map
  }, [categories])

  const counts = useMemo(() => {
    return {
      all: requests.length,
      pending: requests.filter((r) => r.status === "pending").length,
      approved: requests.filter((r) => r.status === "approved").length,
      rejected: requests.filter((r) => r.status === "rejected").length,
    }
  }, [requests])

  const filteredRequests = useMemo(() => {
    let result = requests
    if (activeTab !== "all") {
      result = result.filter((r) => r.status === activeTab)
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().replace(/\s+/g, " ").toLowerCase()
      result = result.filter((r) =>
        r.employee_name.trim().replace(/\s+/g, " ").toLowerCase().includes(q)
      )
    }
    return result
  }, [requests, activeTab, debouncedSearch])

  useEffect(() => {
    setCurrentPage(1)
  }, [activeTab, debouncedSearch])

  const { totalPages, safePage } = useMemo(() => {
    const total = Math.max(1, Math.ceil(filteredRequests.length / pageSize))
    const safe = Math.min(currentPage, total)
    return { totalPages: total, safePage: safe }
  }, [filteredRequests.length, pageSize, currentPage])

  const paginatedRequests = useMemo(
    () => filteredRequests.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredRequests, safePage, pageSize]
  )

  const tabItems = useMemo(() => [
    { value: "all", label: "All requests", badge: counts.all || undefined },
    { value: "pending", label: "Pending", badge: counts.pending || undefined, badgeClassName: "group-data-[state=active]:bg-foreground group-data-[state=active]:text-background group-data-[state=inactive]:bg-foreground group-data-[state=inactive]:text-background" },
    { value: "approved", label: "Approved", badge: counts.approved || undefined },
    { value: "rejected", label: "Rejected", badge: counts.rejected || undefined },
  ], [counts.all, counts.pending, counts.approved, counts.rejected])

  const handleCreateRecord = useCallback(() => {
    setCreateModalOpen(true)
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

  const handleApprove = useCallback((req: TimeOffRequest) => {
    setApproveModalRequest(req)
  }, [])

  const handleReject = useCallback((req: TimeOffRequest) => {
    setRejectModalRequest(req)
  }, [])

  return (
    <div className="flex flex-col size-full">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 h-[60px] shrink-0">
        <button className="flex items-center justify-center size-7 rounded-[10px] shrink-0 text-foreground hover:bg-accent transition-colors">
          <ListCheck className="size-4" />
        </button>
        <div className="flex items-center h-6 pr-2 relative shrink-0">
          <Separator orientation="vertical" />
        </div>
        <BreadcrumbItem text="Requests" className="flex-1 text-foreground font-medium" />
        <div className="flex items-center gap-3">
          <Button variant="secondary" loading={downloading} onClick={handleDownloadReport}>Download report</Button>
          <Button onClick={handleCreateRecord}>
            <CalendarClock />
            Create time-off record
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 p-4">
        {/* Controls */}
        <div className="flex items-center justify-between">
          <TabGroup
            value={activeTab}
            onValueChange={(v) => startTransition(() => setActiveTab(v as TabValue))}
            items={tabItems}
          />
          <div className="relative w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search requests by employee..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <div>
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Header row */}
          <div className="flex bg-secondary">
            <DataTableHeaderCell type="text" label="Employee" className="w-[260px] pl-4" />
            <DataTableHeaderCell type="text" label="Period" className="w-[200px]" />
            <DataTableHeaderCell type="text" label="Request type" className="w-[150px]" />
            <DataTableHeaderCell type="text" label="Comment" className="flex-1" />
            <DataTableHeaderCell type="text" label="Status" className="w-[110px]" />
            <DataTableHeaderCell type="text" className="w-24" />
          </div>

          {/* Body */}
          {isLoading && requests.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
            </div>
          ) : isError && requests.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Empty
                media={{ type: "icon", icon: ListX }}
                title="Unable to load requests"
                description="Something went wrong. Please try again."
                content={{
                  layout: "single",
                  primaryAction: {
                    label: "Retry",
                    onClick: () => refetch(),
                  },
                }}
              />
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Empty
                media={{ type: "icon", icon: ListX }}
                title={searchQuery ? `No requests found for "${debouncedSearch.trim()}"` : "No requests yet"}
                description={
                  searchQuery
                    ? "Try adjusting your search terms"
                    : "It looks like your team is hard at work. This is where you'll see and manage all time-off requests once they arrive"
                }
                content={
                  searchQuery
                    ? undefined
                    : {
                        layout: "single",
                        primaryAction: {
                          label: "Create time-off record",
                          icon: CalendarClock,
                          onClick: handleCreateRecord,
                        },
                      }
                }
              />
            </div>
          ) : (
            <div>
              {paginatedRequests.map((req, index) => {
                const days = req.total_days
                const nameParts = req.employee_name.split(" ")
                const initials = getInitials(nameParts[0], nameParts.slice(1).join(" "))
                const isLast = index === paginatedRequests.length - 1

                return (
                  <div key={req.id} className="flex hover:bg-muted/50 cursor-pointer" onClick={() => setDetailsModalRequest(req)}>
                    <DataTableCell
                      type="avatar"
                      size="md"
                      className="w-[260px] pl-4"
                      avatarSrc={req.employee_avatar_url}
                      avatarAlt={req.employee_name}
                      avatarFallback={initials}
                      label={req.employee_name}
                      highlightQuery={debouncedSearch}
                      border={!isLast}
                    />
                    <DataTableCell
                      type="text-description"
                      size="md"
                      className="w-[200px]"
                      label={formatPeriod(req.start_date, req.end_date)}
                      description={formatDays(days)}
                      border={!isLast}
                    />
                    <DataTableCell
                      type="text"
                      size="md"
                      className="w-[150px]"
                      labelClassName="font-medium"
                      label={getCategoryDisplay(req, categoryMap)}
                      border={!isLast}
                    />
                    <DataTableCell
                      type="text"
                      size="md"
                      className="flex-1"
                      label={req.comment ?? "—"}
                      border={!isLast}
                    />
                    <DataTableCell
                      type="badge"
                      size="md"
                      className="w-[110px]"
                      badgeNode={
                        <Badge variant={req.status}>
                          {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                        </Badge>
                      }
                      border={!isLast}
                    />
                    <div className="relative flex items-center justify-end gap-2 w-24 h-[72px] px-3 py-2">
                      {req.status === "pending" && (
                        <>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={(e) => { e.stopPropagation(); handleApprove(req) }}
                            className="text-[var(--color-success)] hover:bg-[var(--color-success-light)] hover:text-[var(--color-success)]"
                          >
                            <CircleCheck className="size-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={(e) => { e.stopPropagation(); handleReject(req) }}
                            className="text-[var(--color-error)] hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)]"
                          >
                            <CircleX className="size-4" />
                          </Button>
                        </>
                      )}
                      {!isLast && <div className="absolute bottom-0 left-0 right-0 border-b border-border" />}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {filteredRequests.length > 10 && (
          <DataTablePagination
            type="detailed"
            totalRows={filteredRequests.length}
            rowsPerPage={String(pageSize)}
            onRowsPerPageChange={(v) => { setPageSize(Number(v)); setCurrentPage(1) }}
            rowsPerPageOptions={["10", "20", "30", "50"]}
            currentPage={safePage}
            totalPages={totalPages}
            canPrevious={safePage > 1}
            canNext={safePage < totalPages}
            onFirstPage={() => setCurrentPage(1)}
            onPrevious={() => setCurrentPage((p) => Math.max(1, p - 1))}
            onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            onLastPage={() => setCurrentPage(totalPages)}
          />
        )}
        </div>
      </div>

      <CreateTimeOffRecordModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
      />

      <ApproveTimeOffRequestModal
        open={approveModalRequest !== null}
        onOpenChange={(open) => { if (!open) setApproveModalRequest(null) }}
        request={approveModalRequest}
        categoryMap={categoryMap}
      />

      <RejectTimeOffRequestModal
        open={rejectModalRequest !== null}
        onOpenChange={(open) => { if (!open) setRejectModalRequest(null) }}
        request={rejectModalRequest}
        categoryMap={categoryMap}
      />

      <RequestDetailsModal
        open={detailsModalRequest !== null}
        onOpenChange={(open) => { if (!open) setDetailsModalRequest(null) }}
        request={detailsModalRequest}
        categoryMap={categoryMap}
        onEmployeeClick={canNavigate && detailsModalRequest
          ? () => { setDetailsModalRequest(null); navigate(`/employees/${detailsModalRequest.profile_id}`) }
          : undefined}
      />
    </div>
  )
}
