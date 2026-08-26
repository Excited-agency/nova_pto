export type BalanceAdjustmentReason =
  | "manual_adjustment"
  | "request_approved"
  | "record_created"
  /** A scheduled grant from the accrual engine. */
  | "accrual"
  /** Days lost to the category's carryover limit at a reset. */
  | "carryover_capped"
  /** Carried-over days that reached their expiry date. */
  | "carryover_expired"
  /** One-off replay of the accrual schedule; explains a jump in one row. */
  | "recalculated"
  /**
   * Days returned because the request that spent them turned out to overlap an
   * earlier one and was auto-rejected. Written only by
   * resolve_overlapping_requests() (migration 20260827100000).
   */
  | "overlap_resolved"

export interface BalanceAdjustmentLog {
  id: string
  employee_id: string
  /** Null once the category has been deleted — read category_name instead. */
  category_id?: string | null
  category_name?: string | null
  workspace_id: string
  delta: number
  balance_before: number
  balance_after: number
  reason: BalanceAdjustmentReason
  request_id?: string | null
  adjusted_by?: string | null
  created_at: string
}
