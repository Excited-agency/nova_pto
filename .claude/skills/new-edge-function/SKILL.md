---
name: new-edge-function
description: Scaffold a new Supabase Edge Function for Nova PTO using the project's established pattern (CORS, JWT verification, admin role check, service role client). Use when the user says "new edge function", "create edge function", or "add edge function".
---

# New Edge Function

Create `supabase/functions/<name>/index.ts` using the project boilerplate below. Fill in only the business logic section — everything else is standard.

## Steps

1. Ask for (or extract from context): function name and what it does.
2. Create the directory `supabase/functions/<name>/`.
3. Write `index.ts` using the template below, replacing `<!-- BUSINESS LOGIC -->`.
4. If the function doesn't need admin-only access, remove the role check.

## Template

```typescript
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

    // Verify caller JWT
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

    // Verify caller is admin in their workspace
    const { data: callerProfile, error: profileError } = await callerClient
      .from("profiles")
      .select("role, workspace_id")
      .eq("id", caller.id)
      .single()

    if (profileError || !callerProfile || callerProfile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only admins can perform this action" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Parse request body
    const body = await req.json()

    // Admin client (service role — bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // ── BUSINESS LOGIC ──────────────────────────────────────────────────────

    // TODO: implement

    // ────────────────────────────────────────────────────────────────────────

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
```

## Calling from the frontend

Use this pattern in `src/lib/*-service.ts` (mirrors `inviteEmployee` / `deleteEmployee`):

```typescript
async function callMyFunction(payload: MyPayload): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error("Not authenticated")

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/<name>`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    }
  )

  const text = await res.text()
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) } catch { /* not JSON */ }

  if (!res.ok || body.error) {
    throw new Error(String(body.error ?? body.message ?? text) || `Request failed (${res.status})`)
  }
}
```

## Deploy

```bash
supabase functions deploy <name>
```
