import { supabase } from "@/lib/supabase"

// Internal row shapes: only this module's own exported functions reference
// them, so they stay unexported to keep the service's public surface minimal.
interface ReportEmployee {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  department_name: string | null
  status: string
  hire_date: string | null
  location: string | null
}

interface ReportBalance {
  employee_id: string
  category_id: string
  remaining_days: number
}

/**
 * Reads the joined department name. PostgREST returns an object for a
 * to-one relation but an array when it cannot prove cardinality, so accept
 * both instead of asserting one shape.
 */
function departmentName(relation: unknown): string | null {
  if (!relation) return null
  const row = Array.isArray(relation) ? relation[0] : relation
  return (row as { name?: string } | undefined)?.name ?? null
}

export async function fetchReportEmployees(
  workspaceId: string
): Promise<ReportEmployee[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, status, hire_date, location, departments(name)")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("first_name", { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    department_name: departmentName(row.departments),
    status: row.status,
    hire_date: row.hire_date,
    location: row.location,
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
