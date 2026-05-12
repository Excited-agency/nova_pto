import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!

    // Verify caller JWT
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Create client with caller's JWT to verify identity
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user: caller },
      error: authError,
    } = await callerClient.auth.getUser()

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Parse request body
    const { workspace_id, confirmation_name } = await req.json()

    if (!workspace_id || !confirmation_name) {
      return new Response(
        JSON.stringify({ error: "workspace_id and confirmation_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Create admin client with service role key
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // Fetch workspace and verify ownership
    const { data: workspace, error: wsError } = await adminClient
      .from("workspaces")
      .select("id, name, owner_id")
      .eq("id", workspace_id)
      .single()

    if (wsError || !workspace) {
      return new Response(
        JSON.stringify({ error: "Workspace not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (workspace.owner_id !== caller.id) {
      return new Response(
        JSON.stringify({ error: "Only the workspace owner can delete the workspace" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Verify confirmation name matches
    if (confirmation_name !== workspace.name) {
      return new Response(
        JSON.stringify({ error: "Confirmation name does not match workspace name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Fetch all profile IDs in the workspace
    const { data: profiles, error: profilesError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("workspace_id", workspace_id)

    if (profilesError) {
      console.error("[delete-workspace] Failed to fetch profiles:", profilesError)
      return new Response(
        JSON.stringify({ error: `Failed to fetch workspace members: ${profilesError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const profileIds = (profiles ?? []).map((p: { id: string }) => p.id)
    console.log(`[delete-workspace] Found ${profileIds.length} profiles to delete`)

    // Step 1: Delete all auth users (frees emails in Supabase Auth)
    const authDeletions = await Promise.allSettled(
      profileIds.map((id: string) => adminClient.auth.admin.deleteUser(id))
    )

    const failedAuth = authDeletions.filter((r) => r.status === "rejected")
    if (failedAuth.length > 0) {
      console.error(
        `[delete-workspace] Failed to delete ${failedAuth.length}/${profileIds.length} auth users:`,
        failedAuth.map((r) => (r as PromiseRejectedResult).reason)
      )
    }

    // Step 2: Delete slack_installations explicitly (installed_by FK has NO ACTION — blocks profile cascade)
    const { error: deleteSlackError } = await adminClient
      .from("slack_installations")
      .delete()
      .eq("workspace_id", workspace_id)

    if (deleteSlackError) {
      console.error("[delete-workspace] Failed to delete slack_installations:", deleteSlackError)
      return new Response(
        JSON.stringify({ error: `Failed to delete Slack data: ${deleteSlackError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Step 3: Delete all profiles (cascades to requests, balances, slack_user_mappings)
    const { error: deleteProfilesError } = await adminClient
      .from("profiles")
      .delete()
      .eq("workspace_id", workspace_id)

    if (deleteProfilesError) {
      console.error("[delete-workspace] Failed to delete profiles:", deleteProfilesError)
      return new Response(
        JSON.stringify({ error: `Failed to delete workspace members: ${deleteProfilesError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Step 4: Delete workspace (cascades to departments, categories, holidays, etc.)
    const { error: deleteWsError } = await adminClient
      .from("workspaces")
      .delete()
      .eq("id", workspace_id)

    if (deleteWsError) {
      console.error("[delete-workspace] Failed to delete workspace:", deleteWsError)
      return new Response(
        JSON.stringify({ error: `Failed to delete workspace: ${deleteWsError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Step 5: Retry auth user deletion now that workspace FK reference is removed.
    // Step 1 failed because workspaces.owner_id -> auth.users (NO ACTION) blocked it.
    // Now the workspace is gone, so the auth users can be deleted to free their emails.
    const retryDeletions = await Promise.allSettled(
      profileIds.map((id: string) => adminClient.auth.admin.deleteUser(id))
    )
    const failedRetry = retryDeletions.filter((r) => r.status === "rejected")
    if (failedRetry.length > 0) {
      console.error(
        `[delete-workspace] Failed to delete ${failedRetry.length}/${profileIds.length} auth users on retry:`,
        failedRetry.map((r) => (r as PromiseRejectedResult).reason)
      )
    }

    return new Response(
      JSON.stringify({ deleted: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
