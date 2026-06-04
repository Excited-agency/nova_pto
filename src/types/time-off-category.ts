import type { CategoryColor } from "@/lib/category-colors"

export type LeaveType = "paid" | "unpaid"
export type AccrualMethod = "fixed" | "periodic" | "anniversary" | "unlimited"
export type GrantingFrequency = "yearly" | "hire_anniversary" | "monthly" | "weekly" | "bi_weekly" | "quarterly"
export type NewHireRule = "immediate" | "waiting_period"
export type PeriodUnit = "month" | "year"

export interface TimeOffCategory {
  id: string
  workspace_id: string
  name: string
  emoji?: string | null
  colour: CategoryColor
  is_active: boolean
  leave_type: LeaveType
  accrual_method: AccrualMethod
  amount_value?: number | null
  granting_frequency?: GrantingFrequency | null
  accrual_day?: string | null
  anniversary_years?: number | null
  new_hire_rule: NewHireRule
  waiting_period_value?: number | null
  waiting_period_unit?: PeriodUnit | null
  carryover_limit_enabled: boolean
  carryover_max_days?: number | null
  carryover_expiration_value?: number | null
  carryover_expiration_unit?: PeriodUnit | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type CreateCategoryData = {
  workspace_id: string
  name: string
  colour: CategoryColor
  leave_type: LeaveType
  accrual_method: AccrualMethod
  amount_value?: number | null
  granting_frequency?: GrantingFrequency | null
  accrual_day?: string | null
  anniversary_years?: number | null
  new_hire_rule: NewHireRule
  waiting_period_value?: number | null
  waiting_period_unit?: PeriodUnit | null
  carryover_limit_enabled: boolean
  carryover_max_days?: number | null
  carryover_expiration_value?: number | null
  carryover_expiration_unit?: PeriodUnit | null
  sort_order: number
}

export type UpdateCategoryData = Omit<CreateCategoryData, "workspace_id" | "sort_order">
