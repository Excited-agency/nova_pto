import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Avatar } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { getInitials } from "@/lib/utils"
import { formatDate, formatDays, formatPeriodLabel } from "@/lib/date-utils"
import { getCategoryDisplay } from "@/lib/request-display"
import { InfoRow } from "@/components/request-info-row"
import type { TimeOffRequest, TimeOffStatus } from "@/types/time-off-request"

const statusColorMap: Record<TimeOffStatus, string> = {
  approved: "text-[var(--color-success)]",
  rejected: "text-[var(--color-error-foreground)]",
  pending: "text-[var(--color-warning-foreground)]",
  withdrawn: "text-muted-foreground",
}

interface RequestDetailsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: TimeOffRequest | null
  categoryMap: Map<string, { name: string; emoji?: string | null }>
  canSeeComment?: boolean
  hideEmployee?: boolean
}

export function RequestDetailsModal({
  open,
  onOpenChange,
  request,
  categoryMap,
  canSeeComment,
  hideEmployee,
}: RequestDetailsModalProps) {
  if (!request) return null

  const nameParts = request.employee_name.split(" ")
  const initials = getInitials(nameParts[0], nameParts.slice(1).join(" "))
  const days = request.total_days

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] gap-5" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="leading-none tracking-[-0.45px]">
            Request details
          </DialogTitle>
        </DialogHeader>

        <div className="bg-secondary rounded-xl p-4 flex flex-col gap-3">
          {!hideEmployee && (
            <InfoRow label="Employee">
              <Avatar
                size="2xs"
                shape="square"
                src={request.employee_avatar_url}
                alt={request.employee_name}
                fallback={initials}
              />
              <span>{request.employee_name}</span>
            </InfoRow>
          )}

          <InfoRow label="Request type">
            <span>{getCategoryDisplay(request, categoryMap)}</span>
          </InfoRow>

          <InfoRow label="Status">
            <span className={statusColorMap[request.status]}>
              {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
            </span>
          </InfoRow>

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

          {canSeeComment !== false && (
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

              {request.status === "rejected" && (
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
      </DialogContent>
    </Dialog>
  )
}
