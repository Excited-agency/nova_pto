import { supabase } from "@/lib/supabase"
import { seedDefaultCategories } from "@/lib/default-categories"

export async function runFounderFlow(userId: string, email: string) {
  // Check if profile already exists (returning user)
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle()

  if (existingProfile) {
    return { isNewUser: false }
  }

  // First-time user — create workspace + profile
  // Generate UUID client-side to avoid needing SELECT after INSERT
  // (SELECT RLS depends on profile existing, which is a chicken-and-egg problem)
  let workspaceId = crypto.randomUUID()
  const { error: wsError } = await supabase
    .from("workspaces")
    .insert({ id: workspaceId, name: "My Workspace", owner_id: userId })

  if (wsError) {
    // Unique violation on owner_id — another tab already created the workspace
    if (wsError.code === "23505") {
      const { data: existingWs } = await supabase
        .from("workspaces")
        .select("id")
        .eq("owner_id", userId)
        .single()
      if (existingWs) {
        workspaceId = existingWs.id
      } else {
        throw new Error(wsError.message)
      }
    } else {
      throw new Error(wsError.message)
    }
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      workspace_id: workspaceId,
      role: "owner",
      email,
      status: "active",
    })

  if (profileError) {
    // Duplicate PK — another tab already created the profile
    if (profileError.code === "23505") {
      return { isNewUser: false }
    }
    throw new Error(profileError.message)
  }

  // Seed default departments (non-blocking)
  try {
    const defaultDepartments = ["Design", "HR", "Engineering", "Product", "Marketing"]
    const { error: deptError } = await supabase.from("departments").insert(
      defaultDepartments.map((name) => ({ workspace_id: workspaceId, name }))
    )
    if (deptError) {
      console.warn("Failed to seed default departments:", deptError.message)
    }
  } catch (err) {
    console.warn("Failed to seed default departments:", err)
  }

  // Seed default time-off categories (non-blocking)
  try {
    await seedDefaultCategories(workspaceId)
  } catch (err) {
    console.warn("Failed to seed default time-off categories:", err)
  }

  return { isNewUser: true }
}
