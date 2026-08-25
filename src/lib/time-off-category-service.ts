import { supabase } from "@/lib/supabase"
import type {
  TimeOffCategory,
  CreateCategoryData,
  UpdateCategoryData,
} from "@/types/time-off-category"

export type { CreateCategoryData, UpdateCategoryData } from "@/types/time-off-category"

// Kept as ONE string literal on purpose: supabase-js infers the row shape from
// the literal type of the select string, and concatenating with `+` widens it to
// `string`, which makes every query using it resolve to GenericStringError.
const CATEGORY_FIELDS = "id, workspace_id, name, emoji, colour, is_active, leave_type, accrual_method, amount_value, granting_frequency, accrual_day, anniversary_years, new_hire_rule, waiting_period_value, waiting_period_unit, carryover_limit_enabled, carryover_max_days, carryover_expiration_value, carryover_expiration_unit, sort_order, created_at, updated_at"

export async function fetchCategory(categoryId: string, workspaceId: string): Promise<TimeOffCategory> {
  const { data, error } = await supabase
    .from("time_off_categories")
    .select(CATEGORY_FIELDS)
    .eq("id", categoryId)
    .eq("workspace_id", workspaceId)
    .single()

  if (error) throw error
  return data
}

export async function createCategory(data: CreateCategoryData): Promise<TimeOffCategory> {
  const { data: result, error } = await supabase
    .from("time_off_categories")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return result
}

export async function updateCategory(
  categoryId: string,
  data: UpdateCategoryData,
  workspaceId: string
): Promise<TimeOffCategory> {
  const { data: result, error } = await supabase
    .from("time_off_categories")
    .update(data)
    .eq("id", categoryId)
    .eq("workspace_id", workspaceId)
    .select()
    .single()

  if (error) throw error
  return result
}

export async function fetchTimeOffCategories(
  workspaceId: string
): Promise<TimeOffCategory[]> {
  const { data, error } = await supabase
    .from("time_off_categories")
    .select(CATEGORY_FIELDS)
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function updateCategoryActive(
  categoryId: string,
  isActive: boolean,
  workspaceId: string
) {
  const { data, error } = await supabase
    .from("time_off_categories")
    .update({ is_active: isActive })
    .eq("id", categoryId)
    .eq("workspace_id", workspaceId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteCategory(categoryId: string, workspaceId: string) {
  const { error } = await supabase
    .from("time_off_categories")
    .delete()
    .eq("id", categoryId)
    .eq("workspace_id", workspaceId)

  if (error) throw error
}

export async function updateCategorySortOrder(
  items: { id: string; sort_order: number }[],
  workspaceId: string
) {
  const { error } = await supabase.rpc("update_categories_sort_order", {
    p_workspace_id: workspaceId,
    p_updates: items,
  })
  if (error) throw error
}

export interface CategoryAvailability {
  category_id: string
  /** ISO date. Leave in this category may not START before it. */
  available_from: string
}

/**
 * When each active category opens up for an employee.
 *
 * Derived server-side from the employee's hire date and the category's
 * new-hire waiting period, so the form can grey out a category and say when
 * it becomes usable instead of letting the employee submit and be refused.
 * The same rule is enforced by a BEFORE INSERT trigger on time_off_requests —
 * this call is the explanation, not the enforcement.
 */
export async function fetchCategoryAvailability(
  employeeId: string
): Promise<CategoryAvailability[]> {
  const { data, error } = await supabase.rpc("category_availability", {
    p_employee_id: employeeId,
  })

  if (error) throw error
  return (data ?? []) as CategoryAvailability[]
}
