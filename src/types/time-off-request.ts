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

export interface CreateTimeOffRecordParams {
  workspace_id: string
  employee_id: string
  category_id: string
  start_date: string
  end_date: string
  start_period?: "morning" | "midday"
  end_period?: "midday" | "end_of_day"
  comment?: string | null
}

export interface SubmitTimeOffRequestParams {
  workspace_id: string
  profile_id: string
  category_id: string
  start_date: string
  end_date: string
  start_period: "morning" | "midday"
  end_period: "midday" | "end_of_day"
  comment?: string | null
  employee_name: string
  employee_email: string
  employee_avatar_url?: string | null
  total_days: number
  request_type: string
}

export interface ComboboxEmployee {
  id: string
  first_name?: string | null
  last_name?: string | null
  email: string
  avatar_url?: string | null
}
