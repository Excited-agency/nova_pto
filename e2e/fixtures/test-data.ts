import { adminClient } from "./auth"

export async function createCategory(workspaceId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await adminClient
    .from("time_off_categories")
    .insert({
      workspace_id: workspaceId,
      name: "Vacation",
      colour: "green",
      is_active: true,
      leave_type: "paid",
      accrual_method: "fixed",
      amount_value: 20,
      granting_frequency: "yearly",
      new_hire_rule: "immediate",
      waiting_period_value: 0,
      waiting_period_unit: "month",
      carryover_limit_enabled: false,
      sort_order: 0,
      ...overrides,
    })
    .select("id")
    .single()
  if (error) throw new Error(`createCategory: ${error.message}`)
  return data!.id as string
}

export async function createBalance(
  employeeId: string,
  categoryId: string,
  workspaceId: string,
  remainingDays = 20
) {
  const { error } = await adminClient.from("employee_balances").upsert({
    employee_id: employeeId,
    category_id: categoryId,
    workspace_id: workspaceId,
    remaining_days: remainingDays,
  }, { onConflict: "employee_id,category_id" })
  if (error) throw new Error(`createBalance: ${error.message}`)
}

export async function createPendingRequest(
  profileId: string,
  workspaceId: string,
  categoryId: string | null = null,
  overrides: Record<string, unknown> = {}
) {
  const { data, error } = await adminClient
    .from("time_off_requests")
    .insert({
      profile_id: profileId,
      workspace_id: workspaceId,
      category_id: categoryId,
      employee_name: "Test Employee",
      employee_email: "emp@test.invalid",
      start_date: "2026-08-01",
      end_date: "2026-08-03",
      start_period: "morning",
      end_period: "end_of_day",
      total_days: 1,
      request_type: "vacation",
      status: "pending",
      ...overrides,
    })
    .select("id")
    .single()
  if (error) throw new Error(`createPendingRequest: ${error.message}`)
  return data!.id as string
}

export async function addEmployeeToWorkspace(employeeId: string, workspaceId: string) {
  const { error } = await adminClient
    .from("profiles")
    .update({ workspace_id: workspaceId })
    .eq("id", employeeId)
  if (error) throw new Error(`addEmployeeToWorkspace: ${error.message}`)
}
