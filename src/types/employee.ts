export type EmployeeStatus = "active" | "inactive" | "deleted"

/** Every role a profile row may hold. Mirrors the profiles_role_check constraint. */
export type ProfileRole = "owner" | "admin" | "user"

/**
 * Roles an admin is allowed to assign. "owner" is deliberately excluded: it is
 * set once by the founder flow and guarded by the profiles_update_admin RLS
 * policy, so it must be unrepresentable in invite/update payloads rather than
 * merely rejected at runtime.
 */
export type AssignableRole = Exclude<ProfileRole, "owner">

export interface InviteEmployeeData {
  email: string
  first_name?: string
  last_name?: string
  role?: AssignableRole
  department_id?: string | null
  location?: string
  hire_date?: string
  avatar_url?: string | null
}

export interface UpdateEmployeeData {
  first_name?: string
  last_name?: string
  role?: AssignableRole
  department_id?: string | null
  location?: string
  hire_date?: string
  avatar_url?: string | null
}
