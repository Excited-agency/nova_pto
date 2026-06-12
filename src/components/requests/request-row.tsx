import { memo } from "react"
import { CircleCheck, CircleX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTableCell } from "@/components/ui/data-table-cell"
import { formatPeriod, formatDays } from "@/lib/date-utils"
import { getCategoryDisplay } from "@/lib/request-display"
import { getInitials } from "@/lib/utils"
import type { TimeOffRequest } from "@/types/time-off-request"

interface RequestRowProps {
  req: TimeOffRequest
  categoryMap: Map<string, { name: string; emoji?: string | null }>
  debouncedSearch: string
  isLast: boolean
  onRowClick: (req: TimeOffRequest) => void
  onApprove: (req: TimeOffRequest) => void
  onReject: (req: TimeOffRequest) => void
}

export const RequestRow = memo(function RequestRow({
  req,
  categoryMap,
  debouncedSearch,
  isLast,
  onRowClick,
  onApprove,
  onReject,
}: RequestRowProps) {
  const days = req.total_days
  const nameParts = req.employee_name.split(" ")
  const initials = getInitials(nameParts[0], nameParts.slice(1).join(" "))

  return (
    <div className="flex hover:bg-muted/50 cursor-pointer" onClick={() => onRowClick(req)}>
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
              onClick={(e) => { e.stopPropagation(); onApprove(req) }}
              className="text-[var(--color-success)] hover:bg-[var(--color-success-light)] hover:text-[var(--color-success)]"
            >
              <CircleCheck className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={(e) => { e.stopPropagation(); onReject(req) }}
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
})
