import { supabase } from "@/lib/supabase"

export interface ReportEmployee {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  department_name: string | null
}

export interface ReportBalance {
  employee_id: string
  category_id: string
  remaining_days: number
}

export async function fetchReportEmployees(
  workspaceId: string
): Promise<ReportEmployee[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, departments(name)")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("first_name", { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    department_name: (row.departments as { name: string } | null)?.name ?? null,
  }))
}

export async function fetchAllEmployeeBalances(
  workspaceId: string
): Promise<ReportBalance[]> {
  const { data, error } = await supabase
    .from("employee_balances")
    .select("employee_id, category_id, remaining_days")
    .eq("workspace_id", workspaceId)

  if (error) throw error
  return (data ?? []) as ReportBalance[]
}
