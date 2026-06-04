import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RequestDetailsSummary } from "@/components/request-details-summary"
import type { TimeOffRequest } from "@/types/time-off-request"

interface RequestDetailsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: TimeOffRequest | null
  categoryMap: Map<string, { name: string; emoji?: string | null }>
  canSeeComment?: boolean
  hideEmployee?: boolean
  onEmployeeClick?: () => void
}

export function RequestDetailsModal({
  open,
  onOpenChange,
  request,
  categoryMap,
  canSeeComment,
  hideEmployee,
  onEmployeeClick,
}: RequestDetailsModalProps) {
  if (!request) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] gap-5" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="leading-none tracking-[-0.45px]">
            Request details
          </DialogTitle>
        </DialogHeader>

        <RequestDetailsSummary
          request={request}
          categoryMap={categoryMap}
          hideEmployee={hideEmployee}
          onEmployeeClick={onEmployeeClick}
          showStatus
          commentVisibility={canSeeComment !== false}
          showRejectionReason
        />
      </DialogContent>
    </Dialog>
  )
}
