import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!

    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser()

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { data: callerProfile, error: profileError } = await callerClient
      .from("profiles")
      .select("role, workspace_id")
      .eq("id", caller.id)
      .single()

    if (profileError || !callerProfile || !["admin", "owner"].includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: "Only admins can delete employees" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const { employeeId, purge } = await req.json()

    if (!employeeId) {
      return new Response(
        JSON.stringify({ error: "employeeId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // Verify employee belongs to caller's workspace
    const { data: employeeProfile } = await adminClient
      .from("profiles")
      .select("id, workspace_id, role")
      .eq("id", employeeId)
      .eq("workspace_id", callerProfile.workspace_id)
      .maybeSingle()

    if (!employeeProfile) {
      return new Response(
        JSON.stringify({ error: "Employee not found in this workspace" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (employeeProfile.role === "owner") {
      return new Response(
        JSON.stringify({ error: "Cannot delete workspace owner" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (purge) {
      // Purge mode: remove the profile row entirely from the Deleted list
      const { error: deleteError } = await adminClient
        .from("profiles")
        .delete()
        .eq("id", employeeId)
        .eq("workspace_id", callerProfile.workspace_id)

      if (deleteError) {
        return new Response(
          JSON.stringify({ error: deleteError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    } else {
      // Delete mode: soft-mark profile as deleted, then remove the auth user so the email is freed
      const { error: updateError } = await adminClient
        .from("profiles")
        .update({ status: "deleted" })
        .eq("id", employeeId)
        .eq("workspace_id", callerProfile.workspace_id)

      if (updateError) {
        return new Response(
          JSON.stringify({ error: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(employeeId)

      if (authDeleteError) {
        return new Response(
          JSON.stringify({ error: authDeleteError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
