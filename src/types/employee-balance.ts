export interface EmployeeBalance {
  id: string
  employee_id: string
  category_id: string
  workspace_id: string
  remaining_days: number
  /**
   * Accrual-engine bookkeeping. last_accrual_on is the last grant date
   * applied, which is what makes the nightly sweep idempotent; the carryover
   * pair tracks days rolled over from the previous period and when they lapse.
   */
  last_accrual_on?: string | null
  carryover_days?: number
  carryover_expires_on?: string | null
  created_at?: string
  updated_at?: string
}
