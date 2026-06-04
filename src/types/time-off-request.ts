export type TimeOffStatus = "pending" | "approved" | "rejected" | "withdrawn"
export type TimeOffType = "vacation" | "sick_leave" | "personal" | "bereavement" | "other"
export type StartPeriod = "morning" | "midday"
export type EndPeriod = "midday" | "end_of_day"

export interface TimeOffRequest {
  id: string
  profile_id: string
  workspace_id: string
  category_id?: string | null
  employee_name: string
  employee_email: string
  employee_avatar_url?: string
  start_date: string
  end_date: string
  start_period: StartPeriod
  end_period: EndPeriod
  total_days: number
  request_type: TimeOffType
  status: TimeOffStatus
  comment?: string
  rejection_reason?: string | null
  reviewed_by?: string | null
  reviewed_at?: string | null
  created_at: string
  updated_at: string
}
