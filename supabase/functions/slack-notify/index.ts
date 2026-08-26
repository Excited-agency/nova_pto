import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(y, m - 1, d))
}

function formatDays(days: number): string {
  const formatted = Number.isInteger(days) ? String(days) : days.toFixed(1)
  return `${formatted} ${days === 1 ? "day" : "days"}`
}

function formatPeriodLabel(period: string): string {
  const map: Record<string, string> = {
    morning: "Morning",
    midday: "Midday",
    end_of_day: "End of day",
  }
  return map[period] ?? period
}

async function slackApi(
  method: string,
  botToken: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!data.ok) {
    console.error(`[slack-notify] Slack API ${method} failed:`, data.error)
  }
  return data
}

// ─── Block builders for admin DM updates ─────────────────────

function buildApprovedAdminDM(
  request: { employeeName: string; categoryName: string; emoji: string | null; startDate: string; endDate: string; totalDays: number },
  adminLabel: string
): Record<string, unknown>[] {
  const icon = request.emoji || ":calendar:"
  return [
    { type: "header", text: { type: "plain_text", text: "Time Off Request \u2014 Approved", emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: `*${request.employeeName}* \u2014 ${icon} ${request.categoryName}` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From*\n${formatDate(request.startDate)}` },
        { type: "mrkdwn", text: `*To*\n${formatDate(request.endDate)}` },
        { type: "mrkdwn", text: `*Total*\n${formatDays(request.totalDays)}` },
        { type: "mrkdwn", text: `*Status*\n:white_check_mark: Approved` },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Approved ${adminLabel} on ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` },
      ],
    },
  ]
}

function buildRejectedAdminDM(
  request: { employeeName: string; categoryName: string; emoji: string | null; startDate: string; endDate: string; totalDays: number },
  adminLabel: string,
  reason: string
): Record<string, unknown>[] {
  const icon = request.emoji || ":calendar:"
  return [
    { type: "header", text: { type: "plain_text", text: "Time Off Request \u2014 Rejected", emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: `*${request.employeeName}* \u2014 ${icon} ${request.categoryName}` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From*\n${formatDate(request.startDate)}` },
        { type: "mrkdwn", text: `*To*\n${formatDate(request.endDate)}` },
        { type: "mrkdwn", text: `*Total*\n${formatDays(request.totalDays)}` },
        { type: "mrkdwn", text: `*Status*\n:x: Rejected` },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Rejected ${adminLabel} on ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}\n*Reason:* ${reason}` },
      ],
    },
  ]
}

async function updateAllAdminDMs(
  adminClient: ReturnType<typeof createClient>,
  botToken: string,
  requestId: string,
  updatedBlocks: Record<string, unknown>[]
) {
  const { data: dmMessages } = await adminClient
    .from("slack_dm_messages")
    .select("channel_id, message_ts")
    .eq("request_id", requestId)

  if (!dmMessages?.length) return

  await Promise.allSettled(
    dmMessages.map((dm) =>
      slackApi("chat.update", botToken, {
        channel: dm.channel_id,
        ts: dm.message_ts,
        blocks: updatedBlocks,
      })
    )
  )
}

// Trigger Home Tab refresh via slack-events internal endpoint
async function triggerHomeTabRefresh(
  supabaseUrl: string,
  serviceKey: string,
  users: Array<{ slack_user_id: string; slack_team_id: string }>
) {
  if (users.length === 0) return
  try {
    await fetch(`${supabaseUrl}/functions/v1/slack-events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "internal_refresh_home_tab",
        users,
      }),
    })
  } catch (err) {
    console.warn("[slack-notify] Home Tab refresh failed:", err)
  }
}

interface NotifyPayload {
  request_id?: string
  action: "submitted" | "approved" | "rejected"
  workspace_id?: string
  employee_profile_id?: string
  skip_employee_dm?: boolean
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    const payload: NotifyPayload = await req.json()
    const { action } = payload

    // Derive workspace_id from payload or from request_id
    let workspaceId = payload.workspace_id
    if (!workspaceId && payload.request_id) {
      const { data: req } = await adminClient
        .from("time_off_requests")
        .select("workspace_id")
        .eq("id", payload.request_id)
        .single()
      workspaceId = req?.workspace_id
    }

    if (!workspaceId) {
      return new Response(
        JSON.stringify({ sent: false, reason: "no_workspace_id" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Look up Slack installation for this workspace (include slack_team_id for Home Tab refresh)
    const { data: installation } = await adminClient
      .from("slack_installations")
      .select("id, bot_token, is_active, slack_team_id")
      .eq("workspace_id", workspaceId)
      .single()

    if (!installation || !installation.is_active) {
      return new Response(
        JSON.stringify({ sent: false, reason: "no_slack_installation" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const botToken = installation.bot_token
    const slackTeamId = installation.slack_team_id as string

    if (action === "submitted") {
      // Find the request — use request_id if available, fall back to most recent pending
      let requestQuery = adminClient
        .from("time_off_requests")
        .select("id, profile_id, employee_name, employee_email, employee_avatar_url, start_date, end_date, start_period, end_period, total_days, category_id, comment")

      if (payload.request_id) {
        requestQuery = requestQuery.eq("id", payload.request_id)
      } else {
        requestQuery = requestQuery
          .eq("workspace_id", workspaceId)
          .eq("status", "pending")
          .eq("profile_id", payload.employee_profile_id)
          .order("created_at", { ascending: false })
          .limit(1)
      }

      const { data: recentRequest } = await requestQuery.single()

      if (!recentRequest) {
        return new Response(
          JSON.stringify({ sent: false, reason: "request_not_found" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // Resolve category (including accrual_method for balance display)
      let categoryName = "Time Off"
      let emoji: string | null = null
      let accrualMethod: string | null = null
      if (recentRequest.category_id) {
        const { data: cat } = await adminClient
          .from("time_off_categories")
          .select("name, emoji, accrual_method")
          .eq("id", recentRequest.category_id)
          .single()
        if (cat) {
          categoryName = cat.name
          emoji = cat.emoji
          accrualMethod = cat.accrual_method
        }
      }

      // Fetch employee's current balance for the requested category
      let balanceText = ""
      if (recentRequest.category_id) {
        if (accrualMethod === "unlimited") {
          balanceText = "Balance: Unlimited"
        } else {
          const { data: balance } = await adminClient
            .from("employee_balances")
            .select("remaining_days")
            .eq("employee_id", recentRequest.profile_id)
            .eq("category_id", recentRequest.category_id)
            .single()
          if (balance) {
            const afterApproval = balance.remaining_days - recentRequest.total_days
            balanceText = `Balance after approval: ${formatDays(balance.remaining_days)} \u2192 ${formatDays(afterApproval)}`
          }
        }
      }

      // Fetch overlapping approved requests (who else is out during the same dates)
      const { data: overlaps } = await adminClient
        .from("time_off_requests")
        .select("employee_name")
        .eq("workspace_id", workspaceId)
        .eq("status", "approved")
        .lte("start_date", recentRequest.end_date)
        .gte("end_date", recentRequest.start_date)
        .neq("profile_id", recentRequest.profile_id)
        .limit(3)

      // Find all admins in the workspace
      const { data: admins } = await adminClient
        .from("profiles")
        .select("id")
        .eq("workspace_id", workspaceId)
        // The owner is an admin with extra powers. Filtering on "admin"
        // alone meant a workspace whose only admin is the founder -- the
        // default after founder-flow -- had no recipients at all.
        .in("role", ["admin", "owner"])
        .eq("status", "active")

      if (!admins || admins.length === 0) {
        return new Response(
          JSON.stringify({ sent: false, reason: "no_admins" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // Get Slack user IDs for all admins
      const { data: adminMappings } = await adminClient
        .from("slack_user_mappings")
        .select("slack_user_id, profile_id")
        .eq("slack_installation_id", installation.id)
        .in("profile_id", admins.map((a) => a.id))

      if (!adminMappings || adminMappings.length === 0) {
        return new Response(
          JSON.stringify({ sent: false, reason: "no_admin_slack_mappings" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      const icon = emoji || ":calendar:"

      // Build approval message blocks for admin DMs
      const blocks: Record<string, unknown>[] = [
        {
          type: "header",
          text: { type: "plain_text", text: "New Time Off Request", emoji: true },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${recentRequest.employee_name}* has requested time off`,
          },
          ...(recentRequest.employee_avatar_url
            ? {
                accessory: {
                  type: "image",
                  image_url: recentRequest.employee_avatar_url,
                  alt_text: recentRequest.employee_name,
                },
              }
            : {}),
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Category*\n${icon} ${categoryName}` },
            { type: "mrkdwn", text: `*Total*\n${formatDays(recentRequest.total_days)}` },
            {
              type: "mrkdwn",
              text: `*From*\n${formatDate(recentRequest.start_date)} \u00b7 ${formatPeriodLabel(recentRequest.start_period)}`,
            },
            {
              type: "mrkdwn",
              text: `*To*\n${formatDate(recentRequest.end_date)} \u00b7 ${formatPeriodLabel(recentRequest.end_period)}`,
            },
          ],
        },
      ]

      if (recentRequest.comment) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*Comment:* ${recentRequest.comment}` },
        })
      }

      // Context block with balance and overlap info
      const contextElements: Record<string, unknown>[] = []

      if (balanceText) {
        contextElements.push({ type: "mrkdwn", text: balanceText })
      }

      if (overlaps && overlaps.length > 0) {
        const dateRange =
          recentRequest.start_date === recentRequest.end_date
            ? formatDate(recentRequest.start_date)
            : `${formatDate(recentRequest.start_date)} \u2013 ${formatDate(recentRequest.end_date)}`
        const overlapNames = overlaps.map((o) => o.employee_name).join(", ")
        contextElements.push({
          type: "mrkdwn",
          text: `Also out ${dateRange}: ${overlapNames}`,
        })
      }

      if (contextElements.length > 0) {
        blocks.push({
          type: "context",
          elements: contextElements,
        })
      }

      blocks.push({
        type: "actions",
        block_id: "approval_actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve", emoji: true },
            action_id: "approve_request",
            style: "primary",
            value: recentRequest.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Reject", emoji: true },
            action_id: "reject_request",
            style: "danger",
            value: recentRequest.id,
          },
        ],
      })

      // Send DM to each admin
      let sentCount = 0
      const failedAdmins: Array<{ slack_user_id: string; error: string }> = []
      for (const mapping of adminMappings) {
        try {
          const dmRes = await slackApi("conversations.open", botToken, {
            users: mapping.slack_user_id,
          })
          if (dmRes.ok) {
            const channelId = ((dmRes.channel as { id: string }) || {}).id
            if (channelId) {
              const msgRes = await slackApi("chat.postMessage", botToken, {
                channel: channelId,
                text: `New time-off request from ${recentRequest.employee_name}`,
                blocks,
              })

              if (msgRes.ok) {
                // Store DM ref in slack_dm_messages for multi-admin update support
                await adminClient.from("slack_dm_messages").upsert({
                  request_id: recentRequest.id,
                  slack_installation_id: installation.id,
                  slack_user_id: mapping.slack_user_id,
                  channel_id: channelId,
                  message_ts: msgRes.ts as string,
                }, { onConflict: "request_id,slack_user_id" })

                // Keep backward-compat write to time_off_requests for first admin
                if (sentCount === 0) {
                  await adminClient
                    .from("time_off_requests")
                    .update({
                      slack_message_ts: msgRes.ts as string,
                      slack_channel_id: channelId,
                    })
                    .eq("id", recentRequest.id)
                }

                sentCount++
              } else {
                failedAdmins.push({ slack_user_id: mapping.slack_user_id, error: (msgRes.error as string) || "unknown_postMessage_error" })
              }
            }
          } else {
            failedAdmins.push({ slack_user_id: mapping.slack_user_id, error: (dmRes.error as string) || "unknown_conversations_open_error" })
          }
        } catch (err) {
          console.warn(`[slack-notify] Failed to DM admin ${mapping.slack_user_id}:`, err)
          failedAdmins.push({ slack_user_id: mapping.slack_user_id, error: String(err) })
        }
      }

      // Send employee confirmation DM with Withdraw button (skip if from Slack submission)
      if (!payload.skip_employee_dm) {
        const { data: empMapping } = await adminClient
          .from("slack_user_mappings")
          .select("slack_user_id")
          .eq("slack_installation_id", installation.id)
          .eq("profile_id", recentRequest.profile_id)
          .single()

        if (empMapping) {
          const dmRes = await slackApi("conversations.open", botToken, {
            users: empMapping.slack_user_id,
          })
          if (dmRes.ok) {
            const channelId = ((dmRes.channel as { id: string }) || {}).id
            if (channelId) {
              const dateRange =
                recentRequest.start_date === recentRequest.end_date
                  ? formatDate(recentRequest.start_date)
                  : `${formatDate(recentRequest.start_date)} \u2013 ${formatDate(recentRequest.end_date)}`
              await slackApi("chat.postMessage", botToken, {
                channel: channelId,
                text: "Your time-off request has been submitted!",
                blocks: [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `:clipboard: *Request Submitted*\n\n${icon} *${categoryName}* \u00b7 ${dateRange} \u00b7 ${formatDays(recentRequest.total_days)}\nStatus: :hourglass_flowing_sand: Pending approval`,
                    },
                  },
                  {
                    type: "actions",
                    elements: [
                      {
                        type: "button",
                        text: { type: "plain_text", text: "\ud83d\udeab Withdraw Request", emoji: true },
                        action_id: "withdraw_from_dm",
                        style: "danger",
                        value: recentRequest.id,
                      },
                    ],
                  },
                ],
              })
            }
          }

          // Refresh the employee's Home Tab
          triggerHomeTabRefresh(supabaseUrl, supabaseServiceKey, [
            { slack_user_id: empMapping.slack_user_id, slack_team_id: slackTeamId },
          ]).catch((err) => console.warn("[slack-notify] Employee Home Tab refresh failed:", err))
        }
      }

      // Refresh admin Home Tabs so they see the new request in their admin panel
      triggerHomeTabRefresh(
        supabaseUrl,
        supabaseServiceKey,
        adminMappings.map((m) => ({ slack_user_id: m.slack_user_id, slack_team_id: slackTeamId }))
      ).catch((err) => console.warn("[slack-notify] Admin Home Tab refresh failed:", err))

      return new Response(
        JSON.stringify({ sent: sentCount > 0, admin_count: sentCount, ...(failedAdmins.length > 0 ? { failed: failedAdmins } : {}) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // For approved/rejected, the slack-events handler already sends DMs directly
    // This endpoint is called from the web UI's service layer
    if (action === "approved" || action === "rejected") {
      const requestId = payload.request_id
      if (!requestId) {
        return new Response(
          JSON.stringify({ sent: false, reason: "missing_request_id" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // Fetch request details
      const { data: request } = await adminClient
        .from("time_off_requests")
        .select("profile_id, employee_name, start_date, end_date, total_days, category_id, rejection_reason")
        .eq("id", requestId)
        .single()

      if (!request) {
        return new Response(
          JSON.stringify({ sent: false, reason: "request_not_found" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // Find employee's Slack user
      const { data: empMapping } = await adminClient
        .from("slack_user_mappings")
        .select("slack_user_id")
        .eq("slack_installation_id", installation.id)
        .eq("profile_id", request.profile_id)
        .single()

      if (!empMapping) {
        return new Response(
          JSON.stringify({ sent: false, reason: "employee_not_linked" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // Resolve category (including accrual_method for balance display)
      let categoryName = "Time Off"
      let emoji: string | null = null
      let accrualMethod: string | null = null
      if (request.category_id) {
        const { data: cat } = await adminClient
          .from("time_off_categories")
          .select("name, emoji, accrual_method")
          .eq("id", request.category_id)
          .single()
        if (cat) {
          categoryName = cat.name
          emoji = cat.emoji
          accrualMethod = cat.accrual_method
        }
      }

      const icon = emoji || ":calendar:"
      const dateRange =
        request.start_date === request.end_date
          ? formatDate(request.start_date)
          : `${formatDate(request.start_date)} \u2013 ${formatDate(request.end_date)}`

      // DM the employee
      const dmRes = await slackApi("conversations.open", botToken, {
        users: empMapping.slack_user_id,
      })

      if (dmRes.ok) {
        const channelId = ((dmRes.channel as { id: string }) || {}).id
        if (channelId) {
          if (action === "approved") {
            // Fetch remaining balance after approval
            let balanceLine = ""
            if (request.category_id) {
              if (accrualMethod === "unlimited") {
                balanceLine = "\nBalance: Unlimited"
              } else {
                const { data: balance } = await adminClient
                  .from("employee_balances")
                  .select("remaining_days")
                  .eq("employee_id", request.profile_id)
                  .eq("category_id", request.category_id)
                  .single()
                if (balance) {
                  balanceLine = `\nRemaining balance: ${formatDays(balance.remaining_days)}`
                }
              }
            }

            await slackApi("chat.postMessage", botToken, {
              channel: channelId,
              text: "Your time-off request has been approved!",
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `:white_check_mark: *Request Approved!*\n\n${icon} *${categoryName}* \u00b7 ${dateRange} \u00b7 ${formatDays(request.total_days)}${balanceLine}`,
                  },
                },
              ],
            })
          } else {
            let text = `:x: *Request Rejected*\n\n${icon} *${categoryName}* \u00b7 ${dateRange} \u00b7 ${formatDays(request.total_days)}`
            if (request.rejection_reason) {
              text += `\n\n*Reason:* ${request.rejection_reason}`
            }
            await slackApi("chat.postMessage", botToken, {
              channel: channelId,
              text: "Your time-off request has been rejected.",
              blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
            })
          }
        }
      }

      // Update all admin DMs (web dashboard actions — no DM was already updated inline)
      const requestData = {
        employeeName: request.employee_name,
        categoryName,
        emoji,
        startDate: request.start_date,
        endDate: request.end_date,
        totalDays: request.total_days,
      }
      const adminDMBlocks = action === "approved"
        ? buildApprovedAdminDM(requestData, "via dashboard")
        : buildRejectedAdminDM(requestData, "via dashboard", request.rejection_reason || "No reason provided")
      await updateAllAdminDMs(adminClient, botToken, requestId, adminDMBlocks)

      // Refresh the employee's Home Tab so they see the updated status
      triggerHomeTabRefresh(supabaseUrl, supabaseServiceKey, [
        { slack_user_id: empMapping.slack_user_id, slack_team_id: slackTeamId },
      ]).catch((err) => console.warn("[slack-notify] Employee Home Tab refresh failed:", err))

      // Also refresh admin Home Tabs (pending count changes)
      const { data: admins } = await adminClient
        .from("profiles")
        .select("id")
        .eq("workspace_id", workspaceId)
        // The owner is an admin with extra powers. Filtering on "admin"
        // alone meant a workspace whose only admin is the founder -- the
        // default after founder-flow -- had no recipients at all.
        .in("role", ["admin", "owner"])
        .eq("status", "active")

      if (admins && admins.length > 0) {
        const { data: adminMappings } = await adminClient
          .from("slack_user_mappings")
          .select("slack_user_id")
          .eq("slack_installation_id", installation.id)
          .in("profile_id", admins.map((a) => a.id))

        if (adminMappings && adminMappings.length > 0) {
          triggerHomeTabRefresh(
            supabaseUrl,
            supabaseServiceKey,
            adminMappings.map((m) => ({ slack_user_id: m.slack_user_id, slack_team_id: slackTeamId }))
          ).catch((err) => console.warn("[slack-notify] Admin Home Tab refresh failed:", err))
        }
      }

      return new Response(
        JSON.stringify({ sent: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    return new Response(
      JSON.stringify({ sent: false, reason: "unknown_action" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    console.error("[slack-notify] Unexpected error:", err)
    return new Response(
      JSON.stringify({ sent: false, reason: "unexpected_error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
