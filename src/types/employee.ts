export type EmployeeStatus = "active" | "inactive" | "deleted"

export interface InviteEmployeeData {
  email: string
  first_name?: string
  last_name?: string
  role?: "admin" | "user"
  department_id?: string | null
  location?: string
  hire_date?: string
  avatar_url?: string | null
}

export interface UpdateEmployeeData {
  first_name?: string
  last_name?: string
  role?: "admin" | "user"
  department_id?: string | null
  location?: string
  hire_date?: string
  avatar_url?: string | null
}
