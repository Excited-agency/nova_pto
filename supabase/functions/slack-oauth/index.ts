import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const error = url.searchParams.get("error")

    const clientId = Deno.env.get("SLACK_CLIENT_ID")!
    const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET")!
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173"

    const settingsUrl = `${siteUrl}/settings`

    // Handle user cancellation
    if (error) {
      console.warn("[slack-oauth] User cancelled or error:", error)
      return Response.redirect(`${settingsUrl}?slack=error&reason=${encodeURIComponent(error)}`, 302)
    }

    if (!code) {
      return Response.redirect(`${settingsUrl}?slack=error&reason=missing_code`, 302)
    }

    // Exchange code for bot token (always do this first, regardless of state)
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    })

    const tokenData = await tokenRes.json()

    if (!tokenData.ok) {
      console.error("[slack-oauth] Token exchange failed:", tokenData.error)
      return Response.redirect(
        `${settingsUrl}?slack=error&reason=${encodeURIComponent(tokenData.error || "token_exchange_failed")}`,
        302
      )
    }

    const botToken = tokenData.access_token
    const botUserId = tokenData.bot_user_id
    const teamId = tokenData.team?.id
    const teamName = tokenData.team?.name
    const scope = tokenData.scope

    if (!botToken || !teamId) {
      return Response.redirect(`${settingsUrl}?slack=error&reason=missing_token_data`, 302)
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // Decode state to get workspace_id and installer profile_id
    // State may be empty when Slack's admin approval flow triggers the redirect
    let stateData: { workspace_id: string; profile_id: string } | null = null
    try {
      if (state) {
        stateData = JSON.parse(atob(state))
      }
    } catch {
      console.warn("[slack-oauth] Failed to parse state, will derive from OAuth response")
    }

    // If state is missing (admin approval flow), derive workspace/profile from the installer's email
    if (!stateData) {
      const authedUserId = tokenData.authed_user?.id
      if (!authedUserId) {
        console.error("[slack-oauth] No state and no authed_user in OAuth response")
        return Response.redirect(`${settingsUrl}?slack=error&reason=cannot_identify_installer`, 302)
      }

      // Get installer's email from Slack
      const userInfoRes = await fetch(`https://slack.com/api/users.info?user=${authedUserId}`, {
        headers: { Authorization: `Bearer ${botToken}` },
      })
      const userInfoData = await userInfoRes.json()
      const installerEmail = userInfoData.user?.profile?.email

      if (!installerEmail) {
        console.error("[slack-oauth] Could not get installer email from Slack")
        return Response.redirect(`${settingsUrl}?slack=error&reason=cannot_get_installer_email`, 302)
      }

      // Find the admin profile matching this email
      const { data: matchedProfile } = await adminClient
        .from("profiles")
        .select("id, workspace_id, role")
        .ilike("email", installerEmail)
        // Includes the owner: they are the likeliest installer of all.
        .in("role", ["admin", "owner"])
        .eq("status", "active")
        .limit(1)
        .single()

      if (!matchedProfile) {
        console.error("[slack-oauth] No admin profile found for email:", installerEmail)
        return Response.redirect(`${settingsUrl}?slack=error&reason=no_matching_admin_profile`, 302)
      }

      stateData = {
        workspace_id: matchedProfile.workspace_id,
        profile_id: matchedProfile.id,
      }

      console.log(`[slack-oauth] Derived workspace from installer email: ${installerEmail}`)
    }

    // Check if this Slack team is already connected to a different workspace
    const { data: existingInstall } = await adminClient
      .from("slack_installations")
      .select("id, workspace_id")
      .eq("slack_team_id", teamId)
      .single()

    if (existingInstall && existingInstall.workspace_id !== stateData.workspace_id) {
      return Response.redirect(
        `${settingsUrl}?slack=error&reason=team_already_connected`,
        302
      )
    }

    // Upsert installation
    const { error: upsertError } = await adminClient
      .from("slack_installations")
      .upsert(
        {
          workspace_id: stateData.workspace_id,
          slack_team_id: teamId,
          slack_team_name: teamName,
          bot_token: botToken,
          bot_user_id: botUserId,
          installed_by: stateData.profile_id,
          scope,
          raw_response: tokenData,
          is_active: true,
        },
        { onConflict: "workspace_id" }
      )

    if (upsertError) {
      console.error("[slack-oauth] Upsert installation failed:", upsertError)
      return Response.redirect(`${settingsUrl}?slack=error&reason=db_error`, 302)
    }

    // Get the installation ID for user mapping
    const { data: installation } = await adminClient
      .from("slack_installations")
      .select("id")
      .eq("slack_team_id", teamId)
      .single()

    if (!installation) {
      return Response.redirect(`${settingsUrl}?slack=error&reason=install_not_found`, 302)
    }

    // Auto-link users via email matching
    try {
      // Get all Slack workspace members
      const usersRes = await fetch("https://slack.com/api/users.list", {
        headers: { Authorization: `Bearer ${botToken}` },
      })
      const usersData = await usersRes.json()

      if (usersData.ok && usersData.members) {
        // Get all active profiles in the Nova workspace
        const { data: profiles } = await adminClient
          .from("profiles")
          .select("id, email")
          .eq("workspace_id", stateData.workspace_id)
          .eq("status", "active")

        if (profiles && profiles.length > 0) {
          const profileEmailMap = new Map(
            profiles.map((p) => [p.email.toLowerCase(), p.id])
          )

          const mappings: Array<{
            slack_installation_id: string
            slack_user_id: string
            profile_id: string
            workspace_id: string
            linked_via: string
          }> = []

          for (const member of usersData.members) {
            if (member.is_bot || member.id === "USLACKBOT" || member.deleted) continue

            const slackEmail = member.profile?.email?.toLowerCase()
            if (!slackEmail) continue

            const profileId = profileEmailMap.get(slackEmail)
            if (profileId) {
              mappings.push({
                slack_installation_id: installation.id,
                slack_user_id: member.id,
                profile_id: profileId,
                workspace_id: stateData.workspace_id,
                linked_via: "email_match",
              })
            }
          }

          if (mappings.length > 0) {
            // Upsert all mappings (ignore conflicts)
            const { error: mappingError } = await adminClient
              .from("slack_user_mappings")
              .upsert(mappings, {
                onConflict: "slack_installation_id,slack_user_id",
                ignoreDuplicates: true,
              })

            if (mappingError) {
              console.warn("[slack-oauth] Some user mappings failed:", mappingError)
            } else {
              console.log(`[slack-oauth] Auto-linked ${mappings.length} users`)
            }
          }
        }
      }
    } catch (linkErr) {
      // Non-fatal: auto-linking failure shouldn't block installation
      console.warn("[slack-oauth] Auto-link users failed (non-fatal):", linkErr)
    }

    // Success redirect
    return Response.redirect(`${settingsUrl}?slack=connected`, 302)
  } catch (err) {
    console.error("[slack-oauth] Unexpected error:", err)
    const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173"
    return Response.redirect(`${siteUrl}/settings?slack=error&reason=unexpected_error`, 302)
  }
})
