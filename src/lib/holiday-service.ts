import { supabase } from "@/lib/supabase"
import { HOLIDAYS_LIMIT } from "@/lib/constants"
import type { Holiday, NagerHoliday, CreateHolidayData } from "@/types/holiday"

export interface ReplaceHolidayItem {
  name: string
  date: string
  country_code: string
  year: number
}

const NAGER_BASE_URL = "https://date.nager.at/api/v3"

// ---------------------------------------------------------------------------
// External API — Nager.Date
// ---------------------------------------------------------------------------

export async function fetchPublicHolidays(
  year: number,
  countryCode: string
): Promise<NagerHoliday[]> {
  const res = await fetch(
    `${NAGER_BASE_URL}/PublicHolidays/${year}/${countryCode}`
  )
  if (!res.ok) {
    throw new Error(
      `Failed to fetch public holidays for ${countryCode} (${year}): ${res.statusText}`
    )
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Supabase CRUD
// ---------------------------------------------------------------------------

export async function fetchHolidays(workspaceId: string): Promise<Holiday[]> {
  const { data, error } = await supabase
    .from("holidays")
    .select("id, workspace_id, name, date, is_custom, country_code, year")
    .eq("workspace_id", workspaceId)
    .order("date", { ascending: true })
    .limit(HOLIDAYS_LIMIT)

  if (error) throw error
  return data as Holiday[]
}

export async function createHoliday(
  data: CreateHolidayData
): Promise<Holiday> {
  const { data: holiday, error } = await supabase
    .from("holidays")
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return holiday as Holiday
}

export interface UpdateHolidayData {
  name: string
  date: string
}

export async function updateHoliday(
  holidayId: string,
  data: UpdateHolidayData,
  workspaceId: string
): Promise<Holiday> {
  const { data: holiday, error } = await supabase
    .from("holidays")
    .update(data)
    .eq("id", holidayId)
    .eq("workspace_id", workspaceId)
    .select()
    .single()

  if (error) throw error
  return holiday as Holiday
}

export async function deleteHoliday(holidayId: string, workspaceId: string): Promise<void> {
  const { error } = await supabase
    .from("holidays")
    .delete()
    .eq("id", holidayId)
    .eq("workspace_id", workspaceId)

  if (error) throw error
}

export async function bulkDeleteHolidays(ids: string[], workspaceId: string): Promise<void> {
  const { error } = await supabase
    .from("holidays")
    .delete()
    .in("id", ids)
    .eq("workspace_id", workspaceId)

  if (error) throw error
}

export async function replaceImportedHolidays(
  workspaceId: string,
  holidays: ReplaceHolidayItem[]
): Promise<void> {
  const { error } = await supabase.rpc("replace_imported_holidays", {
    p_workspace_id: workspaceId,
    p_holidays: holidays,
  })

  if (error) throw error
}
