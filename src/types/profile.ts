import type { EmployeeStatus } from "@/types/employee"

export interface Profile {
  id: string
  workspace_id: string
  role: string
  email: string
  first_name?: string
  last_name?: string
  avatar_url?: string
  status: EmployeeStatus
  department_id?: string | null
  location?: string
  hire_date?: string
  created_at: string
}
