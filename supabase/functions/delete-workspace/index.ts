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

    // Step 1: Delete every row of workspace data in ONE transaction.
    // The RPC deletes the workspaces row and lets the ON DELETE CASCADE chain
    // remove profiles, requests, balances, categories, holidays and all Slack
    // tables together, so a mid-way failure can no longer leave the workspace
    // half-deleted. It re-verifies ownership server-side and returns the
    // profile IDs it removed, which we need for auth cleanup below.
    const { data: cascadeResult, error: cascadeError } = await adminClient.rpc(
      "delete_workspace_cascade",
      { p_workspace_id: workspace_id, p_owner_id: caller.id }
    )

    if (cascadeError) {
      console.error("[delete-workspace] Cascade delete failed:", cascadeError)
      return new Response(
        JSON.stringify({ error: `Failed to delete workspace: ${cascadeError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const profileIds: string[] =
      (cascadeResult as { profile_ids?: string[] } | null)?.profile_ids ?? []
    console.log(
      `[delete-workspace] Deleted workspace ${workspace_id} and ${profileIds.length} profiles`
    )

    // Step 2: Delete the auth users, freeing their emails for re-use.
    // This could not run earlier: workspaces.owner_id -> auth.users is
    // NO ACTION, so the owner's auth row was pinned while the workspace
    // existed. All workspace data is already committed at this point, so a
    // failure here only means an email stays occupied — re-running the
    // deletion is safe, and the details are logged for manual cleanup.
    const authResults = await Promise.all(
      profileIds.map(async (id: string) => {
        // deleteUser resolves with { error } instead of throwing, so inspect
        // the payload — allSettled alone would report these as successes.
        const { error } = await adminClient.auth.admin.deleteUser(id)
        return { id, error }
      })
    )

    const failedAuth = authResults.filter((r) => r.error)
    if (failedAuth.length > 0) {
      console.error(
        `[delete-workspace] Workspace data deleted, but ${failedAuth.length}/${profileIds.length} auth users remain:`,
        failedAuth.map((r) => ({ id: r.id, message: r.error?.message }))
      )
    }

    return new Response(
      JSON.stringify({ deleted: true, orphanedAuthUsers: failedAuth.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
