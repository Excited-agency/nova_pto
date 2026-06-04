import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useApproveRequestMutation } from "@/hooks/use-time-off-requests"
import { addToast } from "@/lib/toast"
import { RequestDetailsSummary } from "@/components/request-details-summary"
import type { TimeOffRequest } from "@/types/time-off-request"

interface ApproveTimeOffRequestModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: TimeOffRequest | null
  categoryMap: Map<string, { name: string; emoji?: string | null }>
}

export function ApproveTimeOffRequestModal({
  open,
  onOpenChange,
  request,
  categoryMap,
}: ApproveTimeOffRequestModalProps) {
  const approveMutation = useApproveRequestMutation()

  if (!request) return null

  function handleApprove() {
    if (!request) return

    approveMutation.mutate(
      { requestId: request.id, profileId: request.profile_id },
      {
        onSuccess: () => {
          addToast({ title: "Request approved" })
          onOpenChange(false)
        },
        onError: (error) => {
          addToast({
            title: "Couldn't approve request",
            description: error.message,
            variant: "error",
          })
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!approveMutation.isPending) onOpenChange(v) }}>
      <DialogContent className="max-w-[480px] gap-5">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="leading-none tracking-[-0.45px]">Approve time-off request</DialogTitle>
          <DialogDescription>
            Are you sure you want to approve this time off request?
          </DialogDescription>
        </DialogHeader>

        <RequestDetailsSummary
          request={request}
          categoryMap={categoryMap}
          commentVisibility="if-present"
        />

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={approveMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            loading={approveMutation.isPending}
          >
            Approve request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
