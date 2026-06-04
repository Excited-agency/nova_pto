export type BalanceAdjustmentReason = "manual_adjustment" | "request_approved" | "record_created"

export interface BalanceAdjustmentLog {
  id: string
  employee_id: string
  category_id: string
  workspace_id: string
  delta: number
  balance_before: number
  balance_after: number
  reason: BalanceAdjustmentReason
  request_id?: string | null
  adjusted_by?: string | null
  created_at: string
}
