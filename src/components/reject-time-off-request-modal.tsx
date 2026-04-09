import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useRejectRequestMutation } from "@/hooks/use-time-off-requests"
import { getInitials } from "@/lib/utils"
import { addToast } from "@/lib/toast"
import { formatDate, formatDays, formatPeriodLabel } from "@/lib/date-utils"
import { getCategoryDisplay } from "@/lib/request-display"
import { InfoRow } from "@/components/request-info-row"
import type { TimeOffRequest } from "@/types/time-off-request"

interface RejectTimeOffRequestModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: TimeOffRequest | null
  categoryMap: Map<string, { name: string; emoji?: string | null }>
}

export function RejectTimeOffRequestModal({
  open,
  onOpenChange,
  request,
  categoryMap,
}: RejectTimeOffRequestModalProps) {
  const [reason, setReason] = useState("")
  const rejectMutation = useRejectRequestMutation()

  if (!request) return null

  const nameParts = request.employee_name.split(" ")
  const initials = getInitials(nameParts[0], nameParts.slice(1).join(" "))
  const days = request.total_days

  function handleClose(open: boolean) {
    if (rejectMutation.isPending) return
    if (!open) setReason("")
    onOpenChange(open)
  }

  function handleReject() {
    if (!request || !reason.trim()) return

    rejectMutation.mutate(
      { requestId: request.id, reason: reason.trim() },
      {
        onSuccess: () => {
          addToast({
            title: "Request rejected",
            description: `${request.employee_name}'s time-off request has been rejected`,
          })
          handleClose(false)
        },
        onError: (error) => {
          addToast({
            title: "Failed to reject request",
            description: error.message,
            variant: "error",
          })
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[480px] gap-5">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="leading-none tracking-[-0.45px]">Reject time-off request</DialogTitle>
          <DialogDescription>
            Are you sure you want to reject this time off request?
          </DialogDescription>
        </DialogHeader>

        <div className="bg-secondary rounded-xl p-4 flex flex-col gap-3">
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

          <InfoRow label="Request type">
            <span>{getCategoryDisplay(request, categoryMap)}</span>
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

          {request.comment && (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium leading-5 tracking-[-0.28px] text-muted-foreground">
                  Comment
                </span>
                <p className="text-sm font-medium leading-5 tracking-[-0.28px] text-foreground">
                  {request.comment}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium leading-5 tracking-[-0.28px] text-muted-foreground">
            Rejection reason
          </label>
          <Textarea
            placeholder="Type reason here"
            className="h-20"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => handleClose(false)} disabled={rejectMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleReject}
            disabled={!reason.trim()}
            loading={rejectMutation.isPending}
          >
            Reject request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
