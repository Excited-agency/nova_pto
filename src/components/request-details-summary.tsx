import { Avatar } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { InfoRow } from "@/components/request-info-row"
import { getInitials } from "@/lib/utils"
import { formatDate, formatDays, formatPeriodLabel } from "@/lib/date-utils"
import { getCategoryDisplay } from "@/lib/request-display"
import type { TimeOffRequest, TimeOffStatus } from "@/types/time-off-request"

const statusColorMap: Record<TimeOffStatus, string> = {
  approved: "text-[var(--color-success)]",
  rejected: "text-[var(--color-error-foreground)]",
  pending: "text-[var(--color-warning-foreground)]",
  withdrawn: "text-muted-foreground",
}

interface RequestDetailsSummaryProps {
  request: TimeOffRequest
  categoryMap: Map<string, { name: string; emoji?: string | null }>
  /** When true, the Employee row is omitted entirely. Default: false */
  hideEmployee?: boolean
  /** When provided, the employee name/avatar becomes a clickable button */
  onEmployeeClick?: () => void
  /** When true, show the Status row. Default: false */
  showStatus?: boolean
  /**
   * Controls comment visibility.
   * - undefined / true  → always show the comment section (using "–" fallback)
   * - false             → hide the comment section entirely
   * - "if-present"      → only show when request.comment is truthy
   */
  commentVisibility?: boolean | "if-present"
  /** When true, show the rejection reason section (only relevant when status === "rejected"). Default: false */
  showRejectionReason?: boolean
}

export function RequestDetailsSummary({
  request,
  categoryMap,
  hideEmployee = false,
  onEmployeeClick,
  showStatus = false,
  commentVisibility = true,
  showRejectionReason = false,
}: RequestDetailsSummaryProps) {
  const nameParts = request.employee_name.split(" ")
  const initials = getInitials(nameParts[0], nameParts.slice(1).join(" "))
  const days = request.total_days

  const shouldShowComment =
    commentVisibility !== false &&
    (commentVisibility === "if-present" ? Boolean(request.comment) : true)

  return (
    <div className="bg-secondary rounded-xl p-4 flex flex-col gap-3">
      {!hideEmployee && (
        <InfoRow label="Employee">
          {onEmployeeClick ? (
            <button
              className="flex items-center gap-2 cursor-pointer hover:opacity-80"
              onClick={onEmployeeClick}
            >
              <Avatar
                size="2xs"
                shape="square"
                src={request.employee_avatar_url}
                alt={request.employee_name}
                fallback={initials}
              />
              <span className="hover:underline">{request.employee_name}</span>
            </button>
          ) : (
            <>
              <Avatar
                size="2xs"
                shape="square"
                src={request.employee_avatar_url}
                alt={request.employee_name}
                fallback={initials}
              />
              <span>{request.employee_name}</span>
            </>
          )}
        </InfoRow>
      )}

      <InfoRow label="Request type">
        <span>{getCategoryDisplay(request, categoryMap)}</span>
      </InfoRow>

      {showStatus && (
        <InfoRow label="Status">
          <span className={statusColorMap[request.status]}>
            {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
          </span>
        </InfoRow>
      )}

      <InfoRow label="From">
        <span>{formatDate(request.start_date)}</span>
        <span className="text-muted-foreground">
          ({formatPeriodLabel(request.start_period)})
        </span>
      </InfoRow>

      <InfoRow label="To">
        <span>{formatDate(request.end_date)}</span>
        <span className="text-muted-foreground">
          ({formatPeriodLabel(request.end_period)})
        </span>
      </InfoRow>

      <InfoRow label="Total">
        <span>{formatDays(days)}</span>
      </InfoRow>

      {shouldShowComment && (
        <>
          <Separator />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium leading-5 tracking-[-0.28px] text-muted-foreground">
              Comment
            </span>
            <p className="text-sm font-medium leading-5 tracking-[-0.28px] text-foreground">
              {request.comment || "–"}
            </p>
          </div>
          {showRejectionReason && request.status === "rejected" && (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium leading-5 tracking-[-0.28px] text-muted-foreground">
                  Rejection reason
                </span>
                <p className="text-sm font-medium leading-5 tracking-[-0.28px] text-foreground">
                  {request.rejection_reason || "–"}
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
