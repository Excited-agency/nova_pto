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
import { Textarea } from "@/components/ui/textarea"
import { useRejectRequestMutation } from "@/hooks/use-time-off-requests"
import { addToast } from "@/lib/toast"
import { RequestDetailsSummary } from "@/components/request-details-summary"
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
          addToast({ title: "Request rejected" })
          handleClose(false)
        },
        onError: (error) => {
          addToast({
            title: "Couldn't reject request",
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

        <RequestDetailsSummary
          request={request}
          categoryMap={categoryMap}
          commentVisibility="if-present"
        />

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
