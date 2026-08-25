import { supabase } from "@/lib/supabase"
import { TIME_OFF_REQUESTS_LIMIT, BALANCE_LOG_LIMIT } from "@/lib/constants"
import type { TimeOffRequest, TimeOffStatus, CreateTimeOffRecordParams, SubmitTimeOffRequestParams, ComboboxEmployee } from "@/types/time-off-request"
import type { EmployeeBalance } from "@/types/employee-balance"
import type { BalanceAdjustmentLog } from "@/types/balance-adjustment-log"

export type { CreateTimeOffRecordParams, SubmitTimeOffRequestParams, ComboboxEmployee } from "@/types/time-off-request"

// These select lists must stay as SINGLE string literals: supabase-js derives the
// row type from the literal, and joining parts with `+` widens it to `string`,
// which collapses the result type to GenericStringError.
const REQUEST_FIELDS = "id, profile_id, workspace_id, category_id, category_name, employee_name, employee_email, employee_avatar_url, start_date, end_date, start_period, end_period, total_days, request_type, status, comment, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at"

const BALANCE_LOG_FIELDS = "id, employee_id, category_id, category_name, workspace_id, delta, balance_before, balance_after, reason, request_id, adjusted_by, created_at"

export async function fetchTimeOffRequests(workspaceId: string) {
  const { data, error } = await supabase
    .from("time_off_requests_safe")
    .select(REQUEST_FIELDS)
    .eq("workspace_id", workspaceId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })
    .limit(TIME_OFF_REQUESTS_LIMIT)

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

export async function bulkUpdateEmployeeBalances(
  employeeId: string,
  workspaceId: string,
  updates: { categoryId: string; remainingDays: number }[]
) {
  const { error } = await supabase.rpc("bulk_update_employee_balances", {
    p_employee_id: employeeId,
    p_workspace_id: workspaceId,
    p_updates: updates.map((u) => ({
      category_id: u.categoryId,
      remaining_days: u.remainingDays,
    })),
  })

  if (error) throw error
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

  // Fire-and-forget: Slack notification (failures are non-fatal, logged for observability)
  supabase.functions
    .invoke("slack-notify", {
      body: { request_id: requestId, action: "rejected" },
    })
    .then(({ error: fnError }) => {
      if (fnError) console.error("[slack-notify] reject notification failed:", { requestId, error: fnError.message })
    })
    .catch((err) => {
      console.error("[slack-notify] reject notification failed:", { requestId, error: err })
    })

  return data
}

export async function approveTimeOffRequest(requestId: string) {
  const { data, error } = await supabase.rpc("approve_time_off_request", {
    p_request_id: requestId,
  })

  if (error) throw error

  // Fire-and-forget: Slack notification (failures are non-fatal, logged for observability)
  supabase.functions
    .invoke("slack-notify", {
      body: { request_id: requestId, action: "approved" },
    })
    .then(({ error: fnError }) => {
      if (fnError) console.error("[slack-notify] approve notification failed:", { requestId, error: fnError.message })
    })
    .catch((err) => {
      console.error("[slack-notify] approve notification failed:", { requestId, error: err })
    })

  return data
}

export async function withdrawTimeOffRequest(requestId: string) {
  // RPC, not a table update: clients have no UPDATE privilege on
  // time_off_requests, so status transitions stay server-owned.
  const { data, error } = await supabase.rpc("withdraw_time_off_request", {
    p_request_id: requestId,
  })

  if (error) throw error
  return data
}

export async function fetchMyTimeOffRequests(profileId: string, workspaceId: string) {
  const { data, error } = await supabase
    .from("time_off_requests_safe")
    .select(REQUEST_FIELDS)
    .eq("profile_id", profileId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data ?? []) as TimeOffRequest[]
}

export async function submitTimeOffRequest(params: SubmitTimeOffRequestParams) {
  // RPC, not a table insert. The server derives total_days, status, the
  // denormalised employee fields and request_type, so a request can no longer
  // be created with a day count (or a status) chosen by the browser.
  const { data, error } = await supabase.rpc("submit_time_off_request", {
    p_category_id: params.category_id,
    p_start_date: params.start_date,
    p_end_date: params.end_date,
    p_start_period: params.start_period,
    p_end_period: params.end_period,
    p_comment: params.comment ?? null,
  })

  if (error) throw error

  const created = data as { id: string; total_days: number; workspace_id: string }

  // Fire-and-forget: Slack notification (admin DMs + employee DM with Withdraw)
  supabase.functions
    .invoke("slack-notify", {
      body: {
        action: "submitted",
        request_id: created.id,
        workspace_id: created.workspace_id,
        employee_profile_id: params.profile_id,
      },
    })
    .then(({ error: fnError }) => {
      if (fnError) console.warn("[slack-notify] submit notification failed:", fnError.message)
    })
    .catch((err) => {
      console.warn("[submitTimeOffRequest] Slack notification failed (non-fatal):", err)
    })

  return created
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

export async function fetchBalanceAdjustmentLog(
  employeeId: string,
  workspaceId: string
): Promise<BalanceAdjustmentLog[]> {
  const { data, error } = await supabase
    .from("balance_adjustment_log")
    .select(BALANCE_LOG_FIELDS)
    .eq("employee_id", employeeId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(BALANCE_LOG_LIMIT)

  if (error) throw error
  return (data ?? []) as BalanceAdjustmentLog[]
}
