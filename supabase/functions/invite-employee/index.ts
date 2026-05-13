import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0"

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

    // Verify caller is admin
    const { data: callerProfile, error: profileError } = await callerClient
      .from("profiles")
      .select("role, workspace_id")
      .eq("id", caller.id)
      .single()

    if (profileError || !callerProfile || callerProfile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only admins can invite employees" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Parse request body
    const {
      email,
      first_name,
      last_name,
      role,
      department_id,
      location,
      hire_date,
      avatar_url,
      redirect_url,
    } = await req.json()

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (role === "owner") {
      return new Response(
        JSON.stringify({ error: "Cannot assign owner role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const validRoles = ["user", "admin"]
    if (role && !validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ error: "Invalid role. Must be 'user' or 'admin'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (hire_date && !/^\d{4}-\d{2}-\d{2}$/.test(hire_date)) {
      return new Response(
        JSON.stringify({ error: "Invalid hire_date format. Use YYYY-MM-DD" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Create admin client with service role key
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // Validate department belongs to caller's workspace
    if (department_id) {
      const { data: dept } = await adminClient
        .from("departments")
        .select("id")
        .eq("id", department_id)
        .eq("workspace_id", callerProfile.workspace_id)
        .maybeSingle()

      if (!dept) {
        return new Response(
          JSON.stringify({ error: "Department not found in this workspace" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    // Check if email is already active in any workspace (single-workspace constraint)
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id, workspace_id")
      .eq("email", email)
      .neq("status", "deleted")
      .maybeSingle()

    if (existingProfile) {
      return new Response(
        JSON.stringify({ error: "This email is already in use" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Create auth user directly (no invitation email — avoids rate limits)
    let newUserId: string

    const { data: createData, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        email_confirm: true,
      })

    if (createError) {
      // Auth user may already exist (e.g., previously deleted from another workspace)
      // Look up by email using the admin API
      const { data: listData, error: listError } =
        await adminClient.auth.admin.listUsers({
          page: 1,
          perPage: 1,
          filter: email,
        })

      const existingUser = listData?.users?.find(
        (u: { email?: string }) => u.email === email
      )

      if (listError || !existingUser) {
        return new Response(
          JSON.stringify({ error: createError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      newUserId = existingUser.id
    } else {
      newUserId = createData.user.id
    }

    // Insert profile row
    const { data: profile, error: insertError } = await adminClient
      .from("profiles")
      .insert({
        id: newUserId,
        workspace_id: callerProfile.workspace_id,
        role: role ?? "user",
        email,
        first_name: first_name ?? null,
        last_name: last_name ?? null,
        status: "active",
        department_id: department_id ?? null,
        location: location ?? null,
        hire_date: hire_date ?? null,
        avatar_url: avatar_url ?? null,
      })
      .select()
      .single()

    if (insertError) {
      return new Response(
        JSON.stringify({ error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    return new Response(
      JSON.stringify({ profile }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
