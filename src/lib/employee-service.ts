import { supabase } from "@/lib/supabase"
import type { EmployeeStatus } from "@/types/employee"

export async function updateEmployeeStatus(
  employeeId: string,
  status: EmployeeStatus,
  workspaceId: string
) {
  const { data, error } = await supabase
    .from("profiles")
    .update({ status })
    .eq("id", employeeId)
    .eq("workspace_id", workspaceId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function bulkUpdateEmployeeStatus(
  ids: string[],
  status: EmployeeStatus,
  workspaceId: string
) {
  const { error } = await supabase
    .from("profiles")
    .update({ status })
    .in("id", ids)
    .eq("workspace_id", workspaceId)

  if (error) throw error
}

export async function fetchEmployees(
  workspaceId: string,
  status: EmployeeStatus,
  page: number = 0,
  limit: number = 10
) {
  const from = page * limit
  const to = from + limit - 1

  const { data, error, count } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, avatar_url, status, department_id, role, location, hire_date, created_at", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) throw error
  return { data: data ?? [], count: count ?? 0 }
}

export interface InviteEmployeeData {
  email: string
  first_name?: string
  last_name?: string
  role?: string
  department_id?: string | null
  location?: string
  hire_date?: string
  avatar_url?: string | null
}

async function callDeleteEmployeeFunction(employeeId: string, purge: boolean): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token

  if (!token) throw new Error("Not authenticated")

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-employee`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ employeeId, purge }),
    }
  )

  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text)
  } catch {
    // not JSON
  }

  if (!res.ok || body.error) {
    const message = (body.error ?? body.msg ?? body.message ?? text) || `Request failed (${res.status})`
    throw new Error(String(message))
  }
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  return callDeleteEmployeeFunction(employeeId, false)
}

export async function purgeEmployee(employeeId: string): Promise<void> {
  return callDeleteEmployeeFunction(employeeId, true)
}

export async function inviteEmployee(data: InviteEmployeeData) {
  const { getSiteUrl } = await import("@/lib/site-url")
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token

  if (!token) throw new Error("Not authenticated")

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-employee`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        ...data,
        redirect_url: `${getSiteUrl()}/auth/callback`,
      }),
    }
  )

  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text)
  } catch {
    // Response is not JSON
  }

  if (!res.ok || body.error) {
    const message = (body.error ?? body.msg ?? body.message ?? text) || `Request failed (${res.status})`
    console.error("[inviteEmployee]", res.status, text)
    throw new Error(String(message))
  }
  return body.profile
}

export async function fetchEmployee(employeeId: string, workspaceId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, avatar_url, status, department_id, role, location, hire_date, workspace_id")
    .eq("id", employeeId)
    .eq("workspace_id", workspaceId)
    .single()

  if (error) throw error
  return data
}

export interface UpdateEmployeeData {
  first_name?: string
  last_name?: string
  role?: string
  department_id?: string | null
  location?: string
  hire_date?: string
  avatar_url?: string | null
}

export async function updateEmployee(
  employeeId: string,
  data: UpdateEmployeeData,
  workspaceId: string
) {
  const { data: result, error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", employeeId)
    .eq("workspace_id", workspaceId)
    .select()
    .single()

  if (error) throw error
  return result
}

export async function fetchEmployeeCounts(workspaceId: string) {
  const statuses: EmployeeStatus[] = ["active", "inactive", "deleted"]

  const results = await Promise.all(
    statuses.map((status) =>
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", status)
    )
  )

  const counts: Record<EmployeeStatus, number> = { active: 0, inactive: 0, deleted: 0 }
  statuses.forEach((status, i) => {
    counts[status] = results[i].count ?? 0
  })

  return counts
}
