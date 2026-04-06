import { supabase } from "@/lib/supabase"
import type { TimeOffRequest, TimeOffStatus } from "@/types/time-off-request"
import type { EmployeeBalance } from "@/types/employee-balance"

export async function fetchTimeOffRequests(workspaceId: string) {
  const { data, error } = await supabase
    .from("time_off_requests_safe")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data ?? []) as TimeOffRequest[]
}

export async function fetchEmployeeBalance(
  employeeId: string,
  categoryId: string,
  workspaceId: string
) {
  const { data, error } = await supabase
    .from("employee_balances")
    .select("id, employee_id, category_id, remaining_days, workspace_id")
    .eq("employee_id", employeeId)
    .eq("category_id", categoryId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (error) throw error
  return data as EmployeeBalance | null
}

export async function fetchEmployeeBalances(
  employeeId: string,
  workspaceId: string
): Promise<EmployeeBalance[]> {
  const { data, error } = await supabase
    .from("employee_balances")
    .select("id, employee_id, category_id, remaining_days, workspace_id")
    .eq("employee_id", employeeId)
    .eq("workspace_id", workspaceId)

  if (error) throw error
  return (data ?? []) as EmployeeBalance[]
}

export async function updateEmployeeBalance(
  employeeId: string,
  categoryId: string,
  remainingDays: number,
  workspaceId: string
) {
  const { error } = await supabase
    .from("employee_balances")
    .update({ remaining_days: remainingDays, updated_at: new Date().toISOString() })
    .eq("employee_id", employeeId)
    .eq("category_id", categoryId)
    .eq("workspace_id", workspaceId)

  if (error) throw error
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

export async function createTimeOffRecord(params: CreateTimeOffRecordParams) {
  const { data, error } = await supabase.rpc("create_time_off_record", {
    p_workspace_id: params.workspace_id,
    p_employee_id: params.employee_id,
    p_category_id: params.category_id,
    p_start_date: params.start_date,
    p_end_date: params.end_date,
    p_comment: params.comment ?? null,
    p_start_period: params.start_period ?? "morning",
    p_end_period: params.end_period ?? "end_of_day",
  })

  if (error) throw error
  return data
}

export async function updateTimeOffRequestStatus(
  requestId: string,
  status: TimeOffStatus,
  workspaceId: string
) {
  const { data, error } = await supabase
    .from("time_off_requests")
    .update({ status })
    .eq("id", requestId)
    .eq("workspace_id", workspaceId)
    .select()
    .single()

  if (error) throw error
  return data as TimeOffRequest
}

export async function rejectTimeOffRequest(requestId: string, rejectionReason: string) {
  const { data, error } = await supabase.rpc("reject_time_off_request", {
    p_request_id: requestId,
    p_rejection_reason: rejectionReason,
  })

  if (error) throw error

  // Fire-and-forget: Slack notification
  supabase.functions
    .invoke("slack-notify", {
      body: { request_id: requestId, action: "rejected" },
    })
    .catch((err) => {
      console.warn("[rejectTimeOffRequest] Slack notification failed (non-fatal):", err)
    })

  return data
}

export async function approveTimeOffRequest(requestId: string) {
  const { data, error } = await supabase.rpc("approve_time_off_request", {
    p_request_id: requestId,
  })

  if (error) throw error

  // Fire-and-forget: Slack notification
  supabase.functions
    .invoke("slack-notify", {
      body: { request_id: requestId, action: "approved" },
    })
    .catch((err) => {
      console.warn("[approveTimeOffRequest] Slack notification failed (non-fatal):", err)
    })

  return data
}

export interface ComboboxEmployee {
  id: string
  first_name?: string | null
  last_name?: string | null
  email: string
  avatar_url?: string | null
}

export async function withdrawTimeOffRequest(requestId: string, workspaceId: string) {
  const { data, error } = await supabase
    .from("time_off_requests")
    .update({ status: "withdrawn" })
    .eq("id", requestId)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .select()
    .single()

  if (error) throw error
  return data as TimeOffRequest
}

export async function fetchMyTimeOffRequests(profileId: string, workspaceId: string) {
  const { data, error } = await supabase
    .from("time_off_requests_safe")
    .select("*")
    .eq("profile_id", profileId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data ?? []) as TimeOffRequest[]
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

export async function submitTimeOffRequest(params: SubmitTimeOffRequestParams) {
  const { data, error } = await supabase
    .from("time_off_requests")
    .insert({
      profile_id: params.profile_id,
      workspace_id: params.workspace_id,
      category_id: params.category_id,
      start_date: params.start_date,
      end_date: params.end_date,
      start_period: params.start_period,
      end_period: params.end_period,
      total_days: params.total_days,
      employee_name: params.employee_name,
      employee_email: params.employee_email,
      employee_avatar_url: params.employee_avatar_url ?? null,
      status: "pending",
      comment: params.comment ?? null,
      request_type: params.request_type,
    })
    .select()
    .single()

  if (error) throw error

  // Fire-and-forget: Slack notification (admin DMs + employee DM with Withdraw)
  supabase.functions
    .invoke("slack-notify", {
      body: {
        action: "submitted",
        request_id: data.id,
        workspace_id: params.workspace_id,
        employee_profile_id: params.profile_id,
      },
    })
    .catch((err) => {
      console.warn("[submitTimeOffRequest] Slack notification failed (non-fatal):", err)
    })

  return data as TimeOffRequest
}

export async function fetchActiveEmployeesForCombobox(workspaceId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, avatar_url")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("first_name", { ascending: true })

  if (error) throw error
  return (data ?? []) as ComboboxEmployee[]
}
