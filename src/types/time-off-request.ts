export type TimeOffStatus = "pending" | "approved" | "rejected" | "withdrawn"
export type TimeOffType = "vacation" | "sick_leave" | "personal" | "bereavement" | "other"
export type StartPeriod = "morning" | "midday"
export type EndPeriod = "midday" | "end_of_day"

export interface TimeOffRequest {
  id: string
  profile_id: string
  workspace_id: string
  category_id?: string | null
  /**
   * Snapshot of the category name, written server-side and kept in sync on
   * rename. Outlives the category itself, so a deleted category still shows
   * up correctly in reports instead of collapsing to "Other".
   */
  category_name?: string | null
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

/**
 * What the client is allowed to say about a new request.
 *
 * total_days, status, request_type and the denormalised employee fields are
 * deliberately absent: the submit_time_off_request RPC derives them, so the
 * browser cannot decide how many days a request costs. profile_id is kept only
 * to address the Slack notification — the row itself uses auth.uid().
 */
export interface SubmitTimeOffRequestParams {
  profile_id: string
  category_id: string
  start_date: string
  end_date: string
  start_period: "morning" | "midday"
  end_period: "midday" | "end_of_day"
  comment?: string | null
}

export interface ComboboxEmployee {
  id: string
  first_name?: string | null
  last_name?: string | null
  email: string
  avatar_url?: string | null
}
