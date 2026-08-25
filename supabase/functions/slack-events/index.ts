import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ─── HMAC-SHA256 Signature Verification ──────────────────────

async function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): Promise<boolean> {
  // Reject requests older than 5 minutes (replay attack prevention)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp)) > 300) return false

  const sigBasestring = `v0:${timestamp}:${body}`
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(sigBasestring)
  )
  const computed = `v0=${Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`

  // Constant-time comparison
  if (computed.length !== signature.length) return false
  const a = new TextEncoder().encode(computed)
  const b = new TextEncoder().encode(signature)
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i]
  }
  return mismatch === 0
}

// ─── Date Utilities (ported from src/lib/date-utils.ts) ──────

function formatLocalDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
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

// ─── Slack API Helpers ───────────────────────────────────────

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
    console.error(`[slack-events] Slack API ${method} failed:`, data.error)
  }
  return data
}

// ─── Block Kit Builders ──────────────────────────────────────

function buildHomeTabBlocks(params: {
  userName: string
  balances: Array<{ categoryName: string; emoji: string | null; remainingDays: number | null; amountValue: number | null; accrualMethod: string }>
  outToday: Array<{ employeeName: string; categoryName: string; emoji: string | null; endDate: string }>
  upcomingThisWeek: Array<{ employeeName: string; categoryName: string; emoji: string | null; startDate: string; endDate: string }>
  pendingRequests: Array<{ id: string; categoryName: string; emoji: string | null; startDate: string; endDate: string; startPeriod: string; endPeriod: string; totalDays: number; createdAt: string }>
  recentDecisions: Array<{ categoryName: string; emoji: string | null; startDate: string; endDate: string; totalDays: number; status: string; rejectionReason?: string | null }>
  isAdmin: boolean
  adminPendingRequests: Array<{ id: string; employeeName: string; categoryName: string; emoji: string | null; startDate: string; endDate: string; totalDays: number; comment: string | null }>
  siteUrl: string
}): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = []

  // ── Section 1: Greeting + Balances ──
  blocks.push(
    { type: "header", text: { type: "plain_text", text: `Hi ${params.userName}! Here's your time-off overview.`, emoji: true } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: "*Your Balances*" } }
  )

  if (params.balances.length > 0) {
    const fields = params.balances.slice(0, 10).map((b) => {
      const icon = b.emoji || ":calendar:"
      const daysText =
        b.accrualMethod === "unlimited"
          ? "Unlimited"
          : `${b.remainingDays ?? 0} of ${b.amountValue ?? 0} days`
      return { type: "mrkdwn", text: `${icon} *${b.categoryName}*\n${daysText}` }
    })
    blocks.push({ type: "section", fields })
    if (params.balances.length > 10) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_Showing 10 of ${params.balances.length} categories. Visit the dashboard for all balances._` }],
      })
    }
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No time-off categories configured yet._" },
    })
  }

  blocks.push({ type: "divider" })

  // ── Section 2: Out Today + Upcoming This Week ──
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*:beach_with_umbrella: Out Today* (${params.outToday.length})` },
  })

  if (params.outToday.length > 0) {
    const elements = params.outToday.map((o) => {
      const icon = o.emoji || ":calendar:"
      return { type: "mrkdwn", text: `\u2022 ${o.employeeName} \u2014 ${icon} ${o.categoryName} (until ${formatDate(o.endDate)})` }
    })
    blocks.push({ type: "context", elements })
  } else {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "No one is out today" }] })
  }

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*:calendar: Upcoming This Week*" },
  })

  if (params.upcomingThisWeek.length > 0) {
    const elements = params.upcomingThisWeek.map((u) => {
      const icon = u.emoji || ":calendar:"
      return { type: "mrkdwn", text: `\u2022 ${u.employeeName} \u2014 ${icon} ${u.categoryName}, ${formatDate(u.startDate)} \u2013 ${formatDate(u.endDate)}` }
    })
    blocks.push({ type: "context", elements })
  } else {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "No upcoming absences this week" }] })
  }

  blocks.push({ type: "divider" })

  // ── Section 3: Pending Requests with Withdraw ──
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*:hourglass_flowing_sand: Your Pending Requests* (${params.pendingRequests.length})` },
  })

  if (params.pendingRequests.length > 0) {
    for (const req of params.pendingRequests) {
      const icon = req.emoji || ":calendar:"
      const dateRange =
        req.startDate === req.endDate
          ? `${formatDate(req.startDate)} \u00b7 ${formatPeriodLabel(req.startPeriod)} \u2013 ${formatPeriodLabel(req.endPeriod)}`
          : `${formatDate(req.startDate)} (${formatPeriodLabel(req.startPeriod)}) \u2013 ${formatDate(req.endDate)} (${formatPeriodLabel(req.endPeriod)})`
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${icon} *${req.categoryName}* \u00b7 ${dateRange} \u00b7 ${formatDays(req.totalDays)}\nSubmitted ${formatDate(req.createdAt)} \u00b7 Awaiting approval`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Withdraw", emoji: true },
              action_id: "withdraw_request",
              style: "danger",
              value: req.id,
            },
          ],
        }
      )
    }
  } else {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "No pending requests \u2014 you're all set!" }],
    })
  }

  blocks.push({ type: "divider" })

  // ── Section 4: Recent Decisions ──
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*:white_check_mark: Recent Decisions*" },
  })

  if (params.recentDecisions.length > 0) {
    for (const dec of params.recentDecisions.slice(0, 5)) {
      const icon = dec.emoji || ":calendar:"
      const statusEmoji =
        dec.status === "approved"
          ? ":white_check_mark:"
          : dec.status === "rejected"
          ? ":x:"
          : ":grey_question:"
      const statusLabel = dec.status.charAt(0).toUpperCase() + dec.status.slice(1)
      const dateRange =
        dec.startDate === dec.endDate
          ? formatDate(dec.startDate)
          : `${formatDate(dec.startDate)} \u2013 ${formatDate(dec.endDate)}`
      let text = `${statusEmoji} ${icon} ${dec.categoryName} \u00b7 ${dateRange} \u00b7 ${formatDays(dec.totalDays)} \u00b7 ${statusLabel}`
      if (dec.status === "rejected" && dec.rejectionReason) {
        text += ` \u2014 ${dec.rejectionReason}`
      }
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text }] })
    }
  } else {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "No recent decisions yet" }],
    })
  }

  blocks.push({ type: "divider" })

  // ── Section 5: Quick Actions ──
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "\ud83d\udcc5 Request Time Off", emoji: true },
        action_id: "open_request_modal",
        style: "primary",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Open Dashboard", emoji: true },
        action_id: "open_dashboard",
        url: `${params.siteUrl}/requests`,
      },
    ],
  })

  // ── Section 6: Admin Panel ──
  if (params.isAdmin) {
    blocks.push(
      { type: "divider" },
      { type: "header", text: { type: "plain_text", text: "Admin Panel", emoji: true } },
    )

    if (params.adminPendingRequests.length > 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*:hourglass_flowing_sand: ${params.adminPendingRequests.length} request${params.adminPendingRequests.length === 1 ? "" : "s"} awaiting your review*` },
      })

      for (const req of params.adminPendingRequests.slice(0, 5)) {
        const icon = req.emoji || ":calendar:"
        const dateRange =
          req.startDate === req.endDate
            ? formatDate(req.startDate)
            : `${formatDate(req.startDate)} \u2013 ${formatDate(req.endDate)}`
        let text = `:bust_in_silhouette: *${req.employeeName}* \u00b7 ${icon} ${req.categoryName} \u00b7 ${dateRange}\n${formatDays(req.totalDays)}`
        if (req.comment) {
          const preview = req.comment.length > 80 ? req.comment.substring(0, 77) + "..." : req.comment
          text += ` \u00b7 _"${preview}"_`
        }
        blocks.push(
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "\u2705 Approve", emoji: true },
                action_id: "approve_request",
                style: "primary",
                value: req.id,
              },
              {
                type: "button",
                text: { type: "plain_text", text: "\u274c Reject", emoji: true },
                action_id: "reject_request",
                style: "danger",
                value: req.id,
              },
            ],
          }
        )
      }
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: ":white_check_mark: No pending requests to review. You're all caught up!" },
      })
    }
  }

  // ── Footer: Last updated timestamp ──
  const nowTs = Math.floor(Date.now() / 1000)
  blocks.push(
    { type: "divider" },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `_Last updated: <!date^${nowTs}^{date_short_pretty} at {time}|${new Date().toISOString()}>_` }],
    }
  )

  return blocks
}

function buildRequestModal(
  categories: Array<{
    id: string
    name: string
    emoji: string | null
    remainingDays: number | null
    accrualMethod: string
  }>,
  privateMetadata: string
): Record<string, unknown> {
  const options = categories.map((c) => {
    const icon = c.emoji || ""
    const balance =
      c.accrualMethod === "unlimited"
        ? "Unlimited"
        : `${c.remainingDays ?? 0} days`
    return {
      text: {
        type: "plain_text" as const,
        text: `${icon} ${c.name} (${balance})`.trim(),
        emoji: true,
      },
      value: c.id,
    }
  })

  return {
    type: "modal",
    callback_id: "submit_time_off",
    title: { type: "plain_text", text: "Request Time Off" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: privateMetadata,
    blocks: [
      {
        type: "input",
        block_id: "category_block",
        label: { type: "plain_text", text: "Category" },
        element: {
          type: "static_select",
          action_id: "category_select",
          placeholder: { type: "plain_text", text: "Select a category" },
          options,
        },
      },
      {
        type: "input",
        block_id: "start_date_block",
        label: { type: "plain_text", text: "Start Date" },
        element: {
          type: "datepicker",
          action_id: "start_date",
          placeholder: { type: "plain_text", text: "Select start date" },
        },
      },
      {
        type: "input",
        block_id: "start_period_block",
        label: { type: "plain_text", text: "Start Period" },
        element: {
          type: "static_select",
          action_id: "start_period",
          initial_option: {
            text: { type: "plain_text", text: "Morning" },
            value: "morning",
          },
          options: [
            { text: { type: "plain_text", text: "Morning" }, value: "morning" },
            { text: { type: "plain_text", text: "Midday" }, value: "midday" },
          ],
        },
      },
      {
        type: "input",
        block_id: "end_date_block",
        label: { type: "plain_text", text: "End Date" },
        element: {
          type: "datepicker",
          action_id: "end_date",
          placeholder: { type: "plain_text", text: "Select end date" },
        },
      },
      {
        type: "input",
        block_id: "end_period_block",
        label: { type: "plain_text", text: "End Period" },
        element: {
          type: "static_select",
          action_id: "end_period",
          initial_option: {
            text: { type: "plain_text", text: "End of Day" },
            value: "end_of_day",
          },
          options: [
            { text: { type: "plain_text", text: "Midday" }, value: "midday" },
            {
              text: { type: "plain_text", text: "End of Day" },
              value: "end_of_day",
            },
          ],
        },
      },
      {
        type: "input",
        block_id: "comment_block",
        label: { type: "plain_text", text: "Comment" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "comment",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Add a note for your manager (optional)",
          },
        },
      },
    ],
  }
}

function buildApprovalMessage(
  request: {
    id: string
    employeeName: string
    employeeAvatarUrl: string | null
    categoryName: string
    emoji: string | null
    startDate: string
    endDate: string
    startPeriod: string
    endPeriod: string
    totalDays: number
    comment: string | null
  },
  balanceInfo?: string,
  overlapInfo?: string
): Record<string, unknown>[] {
  const icon = request.emoji || ":calendar:"
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "New Time Off Request", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${request.employeeName}* has requested time off`,
      },
      ...(request.employeeAvatarUrl
        ? {
            accessory: {
              type: "image",
              image_url: request.employeeAvatarUrl,
              alt_text: request.employeeName,
            },
          }
        : {}),
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Category*\n${icon} ${request.categoryName}` },
        { type: "mrkdwn", text: `*Total*\n${formatDays(request.totalDays)}` },
        {
          type: "mrkdwn",
          text: `*From*\n${formatDate(request.startDate)} \u00b7 ${formatPeriodLabel(request.startPeriod)}`,
        },
        {
          type: "mrkdwn",
          text: `*To*\n${formatDate(request.endDate)} \u00b7 ${formatPeriodLabel(request.endPeriod)}`,
        },
      ],
    },
  ]

  if (request.comment) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Comment:* ${request.comment}` },
    })
  }

  // Balance context + overlap info
  if (balanceInfo || overlapInfo) {
    const contextElements: Record<string, unknown>[] = []
    if (balanceInfo) {
      contextElements.push({ type: "mrkdwn", text: balanceInfo })
    }
    if (overlapInfo) {
      contextElements.push({ type: "mrkdwn", text: overlapInfo })
    }
    if (contextElements.length > 0) {
      blocks.push({ type: "context", elements: contextElements })
    }
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
        value: request.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Reject", emoji: true },
        action_id: "reject_request",
        style: "danger",
        value: request.id,
      },
    ],
  })

  return blocks
}

function buildApprovedMessage(
  request: {
    employeeName: string
    categoryName: string
    emoji: string | null
    startDate: string
    endDate: string
    totalDays: number
  },
  adminName: string
): Record<string, unknown>[] {
  const icon = request.emoji || ":calendar:"
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Time Off Request \u2014 Approved", emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${request.employeeName}* \u2014 ${icon} ${request.categoryName}` },
    },
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
        { type: "mrkdwn", text: `Approved by *${adminName}* on ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` },
      ],
    },
  ]
}

function buildRejectedMessage(
  request: {
    employeeName: string
    categoryName: string
    emoji: string | null
    startDate: string
    endDate: string
    totalDays: number
  },
  adminName: string,
  reason: string
): Record<string, unknown>[] {
  const icon = request.emoji || ":calendar:"
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Time Off Request \u2014 Rejected", emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${request.employeeName}* \u2014 ${icon} ${request.categoryName}` },
    },
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
        { type: "mrkdwn", text: `Rejected by *${adminName}* on ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}\n*Reason:* ${reason}` },
      ],
    },
  ]
}

function buildRejectionReasonModal(
  requestId: string,
  employeeName: string,
  categoryName: string,
  emoji: string | null,
  dateRange: string,
  totalDays: number,
  messageTs: string,
  channelId: string,
  workspaceId: string
): Record<string, unknown> {
  const icon = emoji || ":calendar:"
  return {
    type: "modal",
    callback_id: "reject_reason",
    title: { type: "plain_text", text: "Reject Request" },
    submit: { type: "plain_text", text: "Reject" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: JSON.stringify({
      request_id: requestId,
      message_ts: messageTs,
      channel_id: channelId,
      workspace_id: workspaceId,
    }),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Rejecting *${employeeName}*'s request for ${icon} ${categoryName} (${dateRange}, ${formatDays(totalDays)})`,
        },
      },
      {
        type: "input",
        block_id: "reason_block",
        label: { type: "plain_text", text: "Reason for rejection" },
        element: {
          type: "plain_text_input",
          action_id: "rejection_reason",
          multiline: true,
          placeholder: { type: "plain_text", text: "Please provide a reason..." },
        },
      },
    ],
  }
}

// ─── Lookup Helpers ──────────────────────────────────────────

interface MappingResult {
  profile_id: string
  workspace_id: string
  slack_installation_id: string
  bot_token: string
  is_admin: boolean
  first_name: string | null
  last_name: string | null
  email: string
  avatar_url: string | null
  status: string
}

async function lookupSlackUser(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string
): Promise<MappingResult | null> {
  // Join slack_user_mappings → slack_installations → profiles
  const { data: installation } = await adminClient
    .from("slack_installations")
    .select("id, workspace_id, bot_token, is_active")
    .eq("slack_team_id", slackTeamId)
    .single()

  if (!installation || !installation.is_active) return null

  const { data: mapping } = await adminClient
    .from("slack_user_mappings")
    .select("profile_id")
    .eq("slack_installation_id", installation.id)
    .eq("slack_user_id", slackUserId)
    .single()

  if (!mapping) return null

  const { data: profile } = await adminClient
    .from("profiles")
    .select("id, role, first_name, last_name, email, avatar_url, status, workspace_id")
    .eq("id", mapping.profile_id)
    .single()

  if (!profile) return null

  return {
    profile_id: profile.id,
    workspace_id: profile.workspace_id,
    slack_installation_id: installation.id,
    bot_token: installation.bot_token,
    // Owners are admins too: is_workspace_admin() resolves to
    // role IN ('admin','owner'), and the bot RPCs accept both. Comparing
    // against "admin" alone silently dropped every owner action here.
    is_admin: profile.role === "admin" || profile.role === "owner",
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    avatar_url: profile.avatar_url,
    status: profile.status,
  }
}

async function tryLazyLink(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string,
  botToken: string
): Promise<MappingResult | null> {
  // Get user's email from Slack
  const userInfo = await slackApi("users.info", botToken, { user: slackUserId })
  if (!userInfo.ok) return null

  const slackEmail = (userInfo.user as Record<string, unknown> & { profile: { email?: string } })?.profile?.email
  if (!slackEmail) return null

  // Find installation
  const { data: installation } = await adminClient
    .from("slack_installations")
    .select("id, workspace_id, bot_token")
    .eq("slack_team_id", slackTeamId)
    .single()

  if (!installation) return null

  // Match email to profile
  const { data: profile } = await adminClient
    .from("profiles")
    .select("id, role, first_name, last_name, email, avatar_url, status, workspace_id")
    .eq("workspace_id", installation.workspace_id)
    .ilike("email", slackEmail)
    .eq("status", "active")
    .single()

  if (!profile) return null

  // Create mapping
  await adminClient.from("slack_user_mappings").upsert(
    {
      slack_installation_id: installation.id,
      slack_user_id: slackUserId,
      profile_id: profile.id,
      workspace_id: installation.workspace_id,
      linked_via: "email_match",
    },
    { onConflict: "slack_installation_id,slack_user_id" }
  )

  return {
    profile_id: profile.id,
    workspace_id: profile.workspace_id,
    slack_installation_id: installation.id,
    bot_token: installation.bot_token,
    // Owners are admins too: is_workspace_admin() resolves to
    // role IN ('admin','owner'), and the bot RPCs accept both. Comparing
    // against "admin" alone silently dropped every owner action here.
    is_admin: profile.role === "admin" || profile.role === "owner",
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    avatar_url: profile.avatar_url,
    status: profile.status,
  }
}

function getDisplayName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ") || "Unknown"
}

// ─── Update All Admin DMs ─────────────────────────────────────

async function updateAllAdminDMs(
  adminClient: ReturnType<typeof createClient>,
  botToken: string,
  requestId: string,
  updatedBlocks: Record<string, unknown>[],
  excludeChannelTs?: { channelId: string; messageTs: string }
) {
  const { data: dmMessages } = await adminClient
    .from("slack_dm_messages")
    .select("channel_id, message_ts")
    .eq("request_id", requestId)

  if (!dmMessages?.length) return

  await Promise.allSettled(
    dmMessages
      .filter((dm) =>
        !(excludeChannelTs &&
          dm.channel_id === excludeChannelTs.channelId &&
          dm.message_ts === excludeChannelTs.messageTs)
      )
      .map((dm) =>
        slackApi("chat.update", botToken, {
          channel: dm.channel_id,
          ts: dm.message_ts,
          blocks: updatedBlocks,
        })
      )
  )
}

// ─── Handlers ────────────────────────────────────────────────

async function refreshHomeTab(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string
) {
  // Reuse handleAppHomeOpened — it already does everything
  await handleAppHomeOpened(adminClient, slackUserId, slackTeamId)
}

async function handleAppHomeOpened(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string
) {
  let user = await lookupSlackUser(adminClient, slackUserId, slackTeamId)

  // Try lazy linking if not found
  if (!user) {
    const { data: installation } = await adminClient
      .from("slack_installations")
      .select("bot_token")
      .eq("slack_team_id", slackTeamId)
      .single()

    if (installation) {
      user = await tryLazyLink(adminClient, slackUserId, slackTeamId, installation.bot_token)
    }
  }

  if (!user) {
    // Show unlinked message
    const { data: installation } = await adminClient
      .from("slack_installations")
      .select("bot_token")
      .eq("slack_team_id", slackTeamId)
      .single()

    if (!installation) return

    await slackApi("views.publish", installation.bot_token, {
      user_id: slackUserId,
      view: {
        type: "home",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "Account Not Linked", emoji: true },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: Your Slack account isn't linked to any employee in Nova PTO.\n\nPlease ask your admin to verify that your Slack email matches your Nova PTO email, or ask them to link your account manually from the Nova PTO Settings page.",
            },
          },
        ],
      },
    })
    return
  }

  if (user.status !== "active") {
    await slackApi("views.publish", user.bot_token, {
      user_id: slackUserId,
      view: {
        type: "home",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "Account Deactivated", emoji: true },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: "Your account has been deactivated. Please contact your admin." },
          },
        ],
      },
    })
    return
  }

  const today = formatLocalDate(new Date())
  const weekEnd = formatLocalDate(new Date(Date.now() + 7 * 86400000))
  const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173"

  // Fetch all data in parallel
  const [categoriesRes, balancesRes, requestsRes, outTodayRes, upcomingRes, adminPendingRes] = await Promise.all([
    // Categories with amount_value for "X of Y" display
    adminClient
      .from("time_off_categories")
      .select("id, name, emoji, accrual_method, amount_value, is_active")
      .eq("workspace_id", user.workspace_id)
      .eq("is_active", true)
      .order("sort_order"),

    // Employee balances
    adminClient
      .from("employee_balances")
      .select("category_id, remaining_days")
      .eq("employee_id", user.profile_id),

    // User's own requests (all statuses, recent 15)
    adminClient
      .from("time_off_requests")
      .select("id, status, category_id, start_date, end_date, start_period, end_period, total_days, rejection_reason, created_at")
      .eq("profile_id", user.profile_id)
      .eq("workspace_id", user.workspace_id)
      .order("created_at", { ascending: false })
      .limit(15),

    // Out today (workspace-wide, approved, overlaps today)
    adminClient
      .from("time_off_requests")
      .select("employee_name, category_id, end_date")
      .eq("workspace_id", user.workspace_id)
      .eq("status", "approved")
      .lte("start_date", today)
      .gte("end_date", today)
      .limit(10),

    // Upcoming this week (workspace-wide, approved, starts within 7 days)
    adminClient
      .from("time_off_requests")
      .select("employee_name, category_id, start_date, end_date")
      .eq("workspace_id", user.workspace_id)
      .eq("status", "approved")
      .gt("start_date", today)
      .lte("start_date", weekEnd)
      .limit(10),

    // Admin: pending requests from others
    user.is_admin
      ? adminClient
          .from("time_off_requests")
          .select("id, employee_name, category_id, start_date, end_date, total_days, comment, profile_id")
          .eq("workspace_id", user.workspace_id)
          .eq("status", "pending")
          .neq("profile_id", user.profile_id)
          .order("created_at", { ascending: true })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ])

  const categories = categoriesRes.data ?? []
  const balancesData = balancesRes.data ?? []
  const allRequests = requestsRes.data ?? []
  const outTodayData = outTodayRes.data ?? []
  const upcomingData = upcomingRes.data ?? []
  const adminPendingData = (adminPendingRes as { data: Array<Record<string, unknown>> | null }).data ?? []

  const balanceMap = new Map(balancesData.map((b) => [b.category_id, b.remaining_days]))
  const categoryMap = new Map(categories.map((c) => [c.id, c]))

  const userName = getDisplayName(user.first_name, user.last_name)

  // Build balances array with amount_value
  const balances = categories.map((c) => ({
    categoryName: c.name,
    emoji: c.emoji,
    remainingDays: balanceMap.get(c.id) ?? 0,
    amountValue: c.amount_value ?? null,
    accrualMethod: c.accrual_method,
  }))

  // Build out today
  const outToday = outTodayData.map((r) => {
    const cat = categoryMap.get(r.category_id)
    return {
      employeeName: r.employee_name as string,
      categoryName: cat?.name ?? "Time Off",
      emoji: cat?.emoji ?? null,
      endDate: r.end_date as string,
    }
  })

  // Build upcoming this week
  const upcomingThisWeek = upcomingData.map((r) => {
    const cat = categoryMap.get(r.category_id)
    return {
      employeeName: r.employee_name as string,
      categoryName: cat?.name ?? "Time Off",
      emoji: cat?.emoji ?? null,
      startDate: r.start_date as string,
      endDate: r.end_date as string,
    }
  })

  // Split user's requests into pending vs recent decisions
  const pendingRequests = allRequests
    .filter((r) => r.status === "pending")
    .map((r) => {
      const cat = categoryMap.get(r.category_id)
      return {
        id: r.id as string,
        categoryName: cat?.name ?? "Time Off",
        emoji: cat?.emoji ?? null,
        startDate: r.start_date as string,
        endDate: r.end_date as string,
        startPeriod: (r.start_period as string) || "morning",
        endPeriod: (r.end_period as string) || "end_of_day",
        totalDays: r.total_days as number,
        createdAt: (r.created_at as string).substring(0, 10),
      }
    })

  const recentDecisions = allRequests
    .filter((r) => r.status !== "pending" && r.status !== "withdrawn")
    .slice(0, 5)
    .map((r) => {
      const cat = categoryMap.get(r.category_id)
      return {
        categoryName: cat?.name ?? "Time Off",
        emoji: cat?.emoji ?? null,
        startDate: r.start_date as string,
        endDate: r.end_date as string,
        totalDays: r.total_days as number,
        status: r.status as string,
        rejectionReason: r.rejection_reason as string | null,
      }
    })

  // Build admin pending requests
  const adminPendingRequests = adminPendingData.map((r) => {
    const cat = categoryMap.get(r.category_id as string)
    return {
      id: r.id as string,
      employeeName: r.employee_name as string,
      categoryName: cat?.name ?? "Time Off",
      emoji: cat?.emoji ?? null,
      startDate: r.start_date as string,
      endDate: r.end_date as string,
      totalDays: r.total_days as number,
      comment: r.comment as string | null,
    }
  })

  const blocks = buildHomeTabBlocks({
    userName,
    balances,
    outToday,
    upcomingThisWeek,
    pendingRequests,
    recentDecisions,
    isAdmin: user.is_admin,
    adminPendingRequests,
    siteUrl,
  })

  await slackApi("views.publish", user.bot_token, {
    user_id: slackUserId,
    view: { type: "home", blocks },
  })
}

async function handleSlashCommand(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string,
  triggerId: string,
  responseUrl: string,
  text: string
) {
  let user = await lookupSlackUser(adminClient, slackUserId, slackTeamId)

  if (!user) {
    const { data: installation } = await adminClient
      .from("slack_installations")
      .select("bot_token")
      .eq("slack_team_id", slackTeamId)
      .single()

    if (installation) {
      user = await tryLazyLink(adminClient, slackUserId, slackTeamId, installation.bot_token)
    }
  }

  if (!user || user.status !== "active") {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: ":warning: Your Slack account isn't linked to Nova PTO. Please ask your admin to verify your email.",
      }),
    })
    return
  }

  const subCommand = text.trim().toLowerCase()

  if (subCommand === "balance" || subCommand === "balances") {
    // Show balances inline
    const [categoriesRes, balancesRes] = await Promise.all([
      adminClient
        .from("time_off_categories")
        .select("id, name, emoji, accrual_method, is_active")
        .eq("workspace_id", user.workspace_id)
        .eq("is_active", true)
        .order("sort_order"),
      adminClient
        .from("employee_balances")
        .select("category_id, remaining_days")
        .eq("employee_id", user.profile_id),
    ])

    const categories = categoriesRes.data ?? []
    const balancesData = balancesRes.data ?? []
    const balanceMap = new Map(balancesData.map((b) => [b.category_id, b.remaining_days]))

    const fields = categories.map((c) => {
      const icon = c.emoji || ":calendar:"
      const days =
        c.accrual_method === "unlimited"
          ? "Unlimited"
          : `${balanceMap.get(c.id) ?? 0} days`
      return { type: "mrkdwn", text: `${icon} *${c.name}*\n${days}` }
    })

    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Your Balances", emoji: true } },
          ...(fields.length > 0
            ? [{ type: "section", fields }]
            : [{ type: "section", text: { type: "mrkdwn", text: "_No categories configured._" } }]),
        ],
      }),
    })
    return
  }

  // Default: open request modal
  const [categoriesRes, balancesRes] = await Promise.all([
    adminClient
      .from("time_off_categories")
      .select("id, name, emoji, accrual_method, is_active")
      .eq("workspace_id", user.workspace_id)
      .eq("is_active", true)
      .order("sort_order"),
    adminClient
      .from("employee_balances")
      .select("category_id, remaining_days")
      .eq("employee_id", user.profile_id),
  ])

  const categories = categoriesRes.data ?? []
  const balancesData = balancesRes.data ?? []
  const balanceMap = new Map(balancesData.map((b) => [b.category_id, b.remaining_days]))

  if (categories.length === 0) {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: ":warning: No time-off categories are configured yet. Please ask your admin to set up categories in Nova PTO.",
      }),
    })
    return
  }

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    remainingDays: balanceMap.get(c.id) ?? 0,
    accrualMethod: c.accrual_method,
  }))

  const privateMetadata = JSON.stringify({
    workspace_id: user.workspace_id,
    profile_id: user.profile_id,
  })

  const modal = buildRequestModal(categoryOptions, privateMetadata)

  await slackApi("views.open", user.bot_token, {
    trigger_id: triggerId,
    view: modal,
  })
}

async function handleSubmitTimeOff(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string,
  view: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  // Extract values from modal
  const values = (view.state as { values: Record<string, Record<string, { selected_option?: { value: string }; selected_date?: string; value?: string }>> }).values

  const categoryId = values.category_block.category_select.selected_option?.value
  const startDate = values.start_date_block.start_date.selected_date
  const endDate = values.end_date_block.end_date.selected_date
  const startPeriod = values.start_period_block.start_period.selected_option?.value || "morning"
  const endPeriod = values.end_period_block.end_period.selected_option?.value || "end_of_day"
  const comment = values.comment_block.comment.value || null

  // Validation (sync, within 3s)
  const errors: Record<string, string> = {}

  if (!categoryId) errors.category_block = "Please select a category"
  if (!startDate) errors.start_date_block = "Please select a start date"
  if (!endDate) errors.end_date_block = "Please select an end date"

  if (startDate && endDate && endDate < startDate) {
    errors.end_date_block = "End date must be on or after start date"
  }

  if (startDate && endDate && startDate === endDate && startPeriod === "midday" && endPeriod === "midday") {
    errors.end_period_block = "For a same-day request starting at midday, end period must be End of Day"
  }

  if (Object.keys(errors).length > 0) {
    return { response_action: "errors", errors }
  }

  // Re-derive user from Slack ID (never trust private_metadata for security)
  const user = await lookupSlackUser(adminClient, slackUserId, slackTeamId)
  if (!user) {
    return { response_action: "errors", errors: { category_block: "Account not linked. Please contact your admin." } }
  }

  // Verify category is still active
  const { data: category } = await adminClient
    .from("time_off_categories")
    .select("id, name, emoji, is_active, accrual_method")
    .eq("id", categoryId)
    .eq("workspace_id", user.workspace_id)
    .single()

  if (!category || !category.is_active) {
    return { response_action: "errors", errors: { category_block: "This category has been deactivated. Please select a different one." } }
  }

  // Create the request through the shared RPC. It counts the days (weekends
  // and workspace holidays excluded), forces status='pending', and derives
  // request_type and the denormalised employee fields -- the same code the web
  // app goes through. This replaced a local copy of the day maths plus its own
  // substring-based request_type mapping, which classified a category like
  // "Extra vacation" differently from every other code path.
  const { data: created, error: submitError } = await adminClient.rpc(
    "submit_time_off_request_bot",
    {
      p_profile_id: user.profile_id,
      p_category_id: categoryId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_start_period: startPeriod,
      p_end_period: endPeriod,
      p_comment: comment ?? null,
    }
  )

  if (submitError) {
    console.error("[slack-events] Failed to submit request:", submitError)
    const message = /no working days/i.test(submitError.message)
      ? "Those dates contain no working days (weekends and holidays don't count)."
      : "Failed to submit request. Please try again."
    return { response_action: "errors", errors: { start_date_block: message } }
  }

  const newRequestId = (created as { id: string }).id

  // Fire-and-forget: notify admins via slack-notify
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  fetch(`${supabaseUrl}/functions/v1/slack-notify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "submitted",
      request_id: newRequestId,
      workspace_id: user.workspace_id,
      employee_profile_id: user.profile_id,
      skip_employee_dm: true,
    }),
  }).catch((err) => console.warn("[slack-events] slack-notify call failed:", err))

  // Fire-and-forget: Send confirmation DM + refresh Home Tab (outside 3s budget)
  ;(async () => {
    try {
      const dmRes = await slackApi("conversations.open", user.bot_token, { users: slackUserId })
      if (dmRes.ok) {
        const channelId = ((dmRes.channel as { id: string }) || {}).id
        if (channelId) {
          const icon = category.emoji || ":calendar:"
          const dateRange =
            startDate === endDate
              ? formatDate(startDate!)
              : `${formatDate(startDate!)} \u2013 ${formatDate(endDate!)}`
          await slackApi("chat.postMessage", user.bot_token, {
            channel: channelId,
            text: `Your time-off request has been submitted!`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:clipboard: *Request Submitted*\n\n${icon} *${category.name}* \u00b7 ${dateRange} \u00b7 ${formatDays(totalDays)}\nStatus: :hourglass_flowing_sand: Pending approval`,
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
                    value: newRequestId,
                  },
                ],
              },
            ],
          })
        }
      }
    } catch (err) {
      console.warn("[slack-events] confirmation DM error:", err)
    }
    // Refresh Home Tab
    refreshHomeTab(adminClient, slackUserId, slackTeamId).catch((err) =>
      console.error("[slack-events] refreshHomeTab after submit error:", err)
    )
  })()

  return null // null = close modal (success)
}

async function handleApproveRequest(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string,
  requestId: string,
  actionTs: string,
  messageTs: string,
  channelId: string
) {
  const user = await lookupSlackUser(adminClient, slackUserId, slackTeamId)
  // Status matters: soft-deleting an employee keeps their profile row (role
  // intact) and their slack_user_mappings row, so a deactivated admin would
  // otherwise keep working Slack buttons. The bot RPC also enforces this.
  if (!user || !user.is_admin || user.status !== "active") {
    console.warn("[slack-events] Non-admin attempted approval:", slackUserId)
    return
  }

  // Idempotency check
  const { data: existing } = await adminClient
    .from("slack_interaction_log")
    .select("id")
    .eq("interaction_id", actionTs)
    .single()

  if (existing) {
    console.log("[slack-events] Duplicate interaction, skipping:", actionTs)
    return
  }

  // Call bot-callable approval RPC
  const { data: result, error: rpcError } = await adminClient.rpc("approve_time_off_request_bot", {
    p_request_id: requestId,
    p_admin_profile_id: user.profile_id,
  })

  // Fetch request details for message update
  const { data: request } = await adminClient
    .from("time_off_requests")
    .select("employee_name, start_date, end_date, total_days, category_id, profile_id")
    .eq("id", requestId)
    .single()

  let categoryName = "Time Off"
  let emoji: string | null = null
  if (request?.category_id) {
    const { data: cat } = await adminClient
      .from("time_off_categories")
      .select("name, emoji")
      .eq("id", request.category_id)
      .single()
    if (cat) {
      categoryName = cat.name
      emoji = cat.emoji
    }
  }

  const adminName = getDisplayName(user.first_name, user.last_name)

  if (rpcError) {
    const errMsg = rpcError.message || "Unknown error"
    console.error("[slack-events] Approval RPC error:", errMsg)

    // Handle specific errors
    if (errMsg.includes("not pending")) {
      // Update message to show current status
      if (request) {
        const { data: freshRequest } = await adminClient
          .from("time_off_requests")
          .select("status")
          .eq("id", requestId)
          .single()

        await slackApi("chat.update", user.bot_token, {
          channel: channelId,
          ts: messageTs,
          blocks: buildApprovedMessage(
            { employeeName: request.employee_name, categoryName, emoji, startDate: request.start_date, endDate: request.end_date, totalDays: request.total_days },
            `already ${freshRequest?.status || "processed"}`
          ),
        })
      }
      return
    }

    // Post ephemeral error
    await slackApi("chat.postEphemeral", user.bot_token, {
      channel: channelId,
      user: slackUserId,
      text: `:x: Failed to approve: ${errMsg}`,
    })
    return
  }

  // Log interaction for idempotency
  await adminClient.from("slack_interaction_log").insert({
    interaction_id: actionTs,
    action_type: "approve",
    request_id: requestId,
    processed_by: user.profile_id,
    workspace_id: user.workspace_id,
    result: result as Record<string, unknown>,
  })

  // Update the approval message (only for DM-originated approvals, not Home Tab)
  if (request) {
    const approvedBlocks = buildApprovedMessage(
      { employeeName: request.employee_name, categoryName, emoji, startDate: request.start_date, endDate: request.end_date, totalDays: result?.total_days ?? request.total_days },
      adminName
    )

    if (messageTs && channelId) {
      await slackApi("chat.update", user.bot_token, {
        channel: channelId,
        ts: messageTs,
        blocks: approvedBlocks,
      })
    }

    // Update all other admin DMs (excludes the acting admin's DM if from DM context)
    await updateAllAdminDMs(
      adminClient, user.bot_token, requestId, approvedBlocks,
      messageTs && channelId ? { channelId, messageTs } : undefined
    )

    // DM the employee with remaining balance
    const { data: empMapping } = await adminClient
      .from("slack_user_mappings")
      .select("slack_user_id")
      .eq("profile_id", request.profile_id)
      .eq("workspace_id", user.workspace_id)
      .single()

    if (empMapping) {
      const dmRes = await slackApi("conversations.open", user.bot_token, { users: empMapping.slack_user_id })
      if (dmRes.ok) {
        const dmChannel = ((dmRes.channel as { id: string }) || {}).id
        if (dmChannel) {
          const icon = emoji || ":calendar:"
          const dateRange =
            request.start_date === request.end_date
              ? formatDate(request.start_date)
              : `${formatDate(request.start_date)} \u2013 ${formatDate(request.end_date)}`
          const remainingBalance = result?.remaining_balance != null
            ? `${result.remaining_balance} days`
            : "Unlimited"
          await slackApi("chat.postMessage", user.bot_token, {
            channel: dmChannel,
            text: `Your time-off request has been approved!`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:white_check_mark: *Request Approved!*\n\n${icon} *${categoryName}* \u00b7 ${dateRange} \u00b7 ${formatDays(result?.total_days ?? request.total_days)}\nApproved by *${adminName}*\nRemaining balance: ${remainingBalance}`,
                },
              },
            ],
          })
        }
      }

      // Refresh the employee's Home Tab
      refreshHomeTab(adminClient, empMapping.slack_user_id, slackTeamId).catch((err) =>
        console.error("[slack-events] refreshHomeTab for employee after approve error:", err)
      )
    }
  }

  // Refresh the admin's Home Tab
  refreshHomeTab(adminClient, slackUserId, slackTeamId).catch((err) =>
    console.error("[slack-events] refreshHomeTab for admin after approve error:", err)
  )

}

async function handleRejectButton(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string,
  requestId: string,
  triggerId: string,
  messageTs: string,
  channelId: string
) {
  const user = await lookupSlackUser(adminClient, slackUserId, slackTeamId)
  if (!user || !user.is_admin || user.status !== "active") return

  // Fetch request details for the modal
  const { data: request } = await adminClient
    .from("time_off_requests")
    .select("employee_name, start_date, end_date, total_days, category_id, status")
    .eq("id", requestId)
    .single()

  if (!request) return

  if (request.status !== "pending") {
    await slackApi("chat.postEphemeral", user.bot_token, {
      channel: channelId,
      user: slackUserId,
      text: `:warning: This request is no longer pending (current status: ${request.status}).`,
    })
    return
  }

  let categoryName = "Time Off"
  let emoji: string | null = null
  if (request.category_id) {
    const { data: cat } = await adminClient
      .from("time_off_categories")
      .select("name, emoji")
      .eq("id", request.category_id)
      .single()
    if (cat) {
      categoryName = cat.name
      emoji = cat.emoji
    }
  }

  const dateRange =
    request.start_date === request.end_date
      ? formatDate(request.start_date)
      : `${formatDate(request.start_date)} - ${formatDate(request.end_date)}`

  const modal = buildRejectionReasonModal(
    requestId,
    request.employee_name,
    categoryName,
    emoji,
    dateRange,
    request.total_days,
    messageTs,
    channelId,
    user.workspace_id
  )

  await slackApi("views.open", user.bot_token, {
    trigger_id: triggerId,
    view: modal,
  })
}

async function handleRejectSubmission(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string,
  view: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const metadata = JSON.parse(view.private_metadata as string)
  const { request_id, message_ts, channel_id } = metadata

  const values = (view.state as { values: Record<string, Record<string, { value?: string }>> }).values
  const reason = values.reason_block.rejection_reason.value || ""

  if (!reason.trim()) {
    return { response_action: "errors", errors: { reason_block: "Please provide a reason for rejection" } }
  }

  const user = await lookupSlackUser(adminClient, slackUserId, slackTeamId)
  if (!user || !user.is_admin || user.status !== "active") {
    return { response_action: "errors", errors: { reason_block: "Permission denied" } }
  }

  // Call bot-callable rejection RPC
  const { error: rpcError } = await adminClient.rpc("reject_time_off_request_bot", {
    p_request_id: request_id,
    p_admin_profile_id: user.profile_id,
    p_rejection_reason: reason,
  })

  if (rpcError) {
    const errMsg = rpcError.message || "Unknown error"
    if (errMsg.includes("not pending")) {
      return { response_action: "errors", errors: { reason_block: "This request is no longer pending." } }
    }
    return { response_action: "errors", errors: { reason_block: `Failed: ${errMsg}` } }
  }

  // Log interaction
  await adminClient.from("slack_interaction_log").insert({
    interaction_id: `reject_${request_id}_${Date.now()}`,
    action_type: "reject",
    request_id,
    processed_by: user.profile_id,
    workspace_id: user.workspace_id,
    result: { reason },
  })

  // Fetch request for message update
  const { data: request } = await adminClient
    .from("time_off_requests")
    .select("employee_name, start_date, end_date, total_days, category_id, profile_id")
    .eq("id", request_id)
    .single()

  let categoryName = "Time Off"
  let emoji: string | null = null
  if (request?.category_id) {
    const { data: cat } = await adminClient
      .from("time_off_categories")
      .select("name, emoji")
      .eq("id", request.category_id)
      .single()
    if (cat) {
      categoryName = cat.name
      emoji = cat.emoji
    }
  }

  const adminName = getDisplayName(user.first_name, user.last_name)

  // Update the original message and all other admin DMs
  if (request) {
    const rejectedBlocks = buildRejectedMessage(
      { employeeName: request.employee_name, categoryName, emoji, startDate: request.start_date, endDate: request.end_date, totalDays: request.total_days },
      adminName,
      reason
    )

    if (message_ts && channel_id) {
      await slackApi("chat.update", user.bot_token, {
        channel: channel_id,
        ts: message_ts,
        blocks: rejectedBlocks,
      })
    }

    // Update all other admin DMs
    await updateAllAdminDMs(
      adminClient, user.bot_token, request_id, rejectedBlocks,
      message_ts && channel_id ? { channelId: channel_id, messageTs: message_ts } : undefined
    )
  }

  // DM the employee
  if (request) {
    const { data: empMapping } = await adminClient
      .from("slack_user_mappings")
      .select("slack_user_id")
      .eq("profile_id", request.profile_id)
      .eq("workspace_id", user.workspace_id)
      .single()

    if (empMapping) {
      const dmRes = await slackApi("conversations.open", user.bot_token, { users: empMapping.slack_user_id })
      if (dmRes.ok) {
        const dmChannel = ((dmRes.channel as { id: string }) || {}).id
        if (dmChannel) {
          const icon = emoji || ":calendar:"
          await slackApi("chat.postMessage", user.bot_token, {
            channel: dmChannel,
            text: `Your time-off request has been rejected.`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:x: *Request Rejected*\n\n${icon} *${categoryName}* \u2014 ${formatDate(request.start_date)} to ${formatDate(request.end_date)} (${formatDays(request.total_days)})\n\n*Reason:* ${reason}\n\nRejected by *${adminName}*.`,
                },
              },
            ],
          })
        }
      }

      // Refresh the employee's Home Tab
      refreshHomeTab(adminClient, empMapping.slack_user_id, slackTeamId).catch((err) =>
        console.error("[slack-events] refreshHomeTab for employee after reject error:", err)
      )
    }
  }

  // Refresh the admin's Home Tab
  refreshHomeTab(adminClient, slackUserId, slackTeamId).catch((err) =>
    console.error("[slack-events] refreshHomeTab for admin after reject error:", err)
  )

  return null // close modal
}

async function handleOpenRequestModal(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string,
  triggerId: string
) {
  const user = await lookupSlackUser(adminClient, slackUserId, slackTeamId)
  if (!user || user.status !== "active") return

  const [categoriesRes, balancesRes] = await Promise.all([
    adminClient
      .from("time_off_categories")
      .select("id, name, emoji, accrual_method, is_active")
      .eq("workspace_id", user.workspace_id)
      .eq("is_active", true)
      .order("sort_order"),
    adminClient
      .from("employee_balances")
      .select("category_id, remaining_days")
      .eq("employee_id", user.profile_id),
  ])

  const categories = categoriesRes.data ?? []
  const balancesData = balancesRes.data ?? []
  const balanceMap = new Map(balancesData.map((b) => [b.category_id, b.remaining_days]))

  if (categories.length === 0) return

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    remainingDays: balanceMap.get(c.id) ?? 0,
    accrualMethod: c.accrual_method,
  }))

  const privateMetadata = JSON.stringify({
    workspace_id: user.workspace_id,
    profile_id: user.profile_id,
  })

  const modal = buildRequestModal(categoryOptions, privateMetadata)

  await slackApi("views.open", user.bot_token, {
    trigger_id: triggerId,
    view: modal,
  })
}

async function handleWithdrawRequest(
  adminClient: ReturnType<typeof createClient>,
  slackUserId: string,
  slackTeamId: string,
  requestId: string,
  actionSource: "home" | "dm",
  messageTs?: string,
  channelId?: string
) {
  const user = await lookupSlackUser(adminClient, slackUserId, slackTeamId)
  if (!user) return

  // Withdraw: only allow if pending and owned by user
  const { data, error } = await adminClient
    .from("time_off_requests")
    .update({ status: "withdrawn" })
    .eq("id", requestId)
    .eq("status", "pending")
    .eq("profile_id", user.profile_id)
    .select()
    .single()

  if (error || !data) {
    // Post ephemeral error
    if (actionSource === "dm" && channelId) {
      await slackApi("chat.postEphemeral", user.bot_token, {
        channel: channelId,
        user: slackUserId,
        text: ":warning: Could not withdraw this request. It may have already been processed.",
      })
    }
    return
  }

  // If from DM, update the employee's message in-place
  if (actionSource === "dm" && messageTs && channelId) {
    await slackApi("chat.update", user.bot_token, {
      channel: channelId,
      ts: messageTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: ":no_entry_sign: *Request Withdrawn*\n\nThis request has been withdrawn.",
          },
        },
      ],
    })
  }

  // Update all admin DMs to show withdrawal
  await updateAllAdminDMs(adminClient, user.bot_token, requestId, [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:no_entry_sign: *Request Withdrawn*\n\n*${data.employee_name}* withdrew this request.`,
      },
    },
  ])

  // Refresh user's Home Tab
  await refreshHomeTab(adminClient, slackUserId, slackTeamId)
}

// ─── Main Handler ────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET")!
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const body = await req.text()
    const timestamp = req.headers.get("x-slack-request-timestamp") || ""
    const signature = req.headers.get("x-slack-signature") || ""

    // Determine content type
    const contentType = req.headers.get("content-type") || ""

    // ── URL Verification (JSON, no signature check needed for initial setup) ──
    if (contentType.includes("application/json")) {
      const payload = JSON.parse(body)

      if (payload.type === "url_verification") {
        return new Response(
          JSON.stringify({ challenge: payload.challenge }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // Internal: Home Tab refresh (called by slack-notify, authenticated via service role key)
      if (payload.type === "internal_refresh_home_tab") {
        const authHeader = req.headers.get("authorization") || ""
        if (authHeader !== `Bearer ${supabaseServiceKey}`) {
          return new Response("Unauthorized", { status: 401, headers: corsHeaders })
        }
        const adminClient = createClient(supabaseUrl, supabaseServiceKey)
        if (Array.isArray(payload.users)) {
          for (const u of payload.users) {
            handleAppHomeOpened(adminClient, u.slack_user_id, u.slack_team_id).catch((err) =>
              console.error("[slack-events] internal refresh error:", err)
            )
          }
        }
        return new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      // For all other JSON payloads, verify signature
      const valid = await verifySlackSignature(body, timestamp, signature, signingSecret)
      if (!valid) {
        return new Response("Invalid signature", { status: 401, headers: corsHeaders })
      }

      // Event callback
      if (payload.type === "event_callback") {
        const event = payload.event
        const teamId = payload.team_id

        if (event.type === "app_home_opened") {
          // Acknowledge immediately, process async
          const adminClient = createClient(supabaseUrl, supabaseServiceKey)
          handleAppHomeOpened(adminClient, event.user, teamId).catch((err) =>
            console.error("[slack-events] app_home_opened error:", err)
          )
          return new Response("", { status: 200, headers: corsHeaders })
        }
      }

      return new Response("", { status: 200, headers: corsHeaders })
    }

    // ── Form-urlencoded payloads (slash commands, interactions) ──
    if (contentType.includes("application/x-www-form-urlencoded")) {
      // Verify signature
      const valid = await verifySlackSignature(body, timestamp, signature, signingSecret)
      if (!valid) {
        return new Response("Invalid signature", { status: 401, headers: corsHeaders })
      }

      const params = new URLSearchParams(body)

      // Check if this is an interaction payload
      const payloadStr = params.get("payload")
      if (payloadStr) {
        const payload = JSON.parse(payloadStr)
        const adminClient = createClient(supabaseUrl, supabaseServiceKey)

        // Block actions (button clicks)
        if (payload.type === "block_actions") {
          const action = payload.actions?.[0]
          const slackUserId = payload.user?.id
          const teamId = payload.team?.id
          const triggerId = payload.trigger_id
          const messageTs = payload.message?.ts
          const channelId = payload.channel?.id

          if (action?.action_id === "approve_request") {
            handleApproveRequest(
              adminClient, slackUserId, teamId, action.value, action.action_ts, messageTs, channelId
            ).catch((err) => console.error("[slack-events] approve error:", err))
            return new Response("", { status: 200, headers: corsHeaders })
          }

          if (action?.action_id === "reject_request") {
            handleRejectButton(
              adminClient, slackUserId, teamId, action.value, triggerId, messageTs, channelId
            ).catch((err) => console.error("[slack-events] reject button error:", err))
            return new Response("", { status: 200, headers: corsHeaders })
          }

          if (action?.action_id === "open_request_modal") {
            handleOpenRequestModal(
              adminClient, slackUserId, teamId, triggerId
            ).catch((err) => console.error("[slack-events] open modal error:", err))
            return new Response("", { status: 200, headers: corsHeaders })
          }

          if (action?.action_id === "withdraw_request") {
            handleWithdrawRequest(
              adminClient, slackUserId, teamId, action.value, "home"
            ).catch((err) => console.error("[slack-events] withdraw from home error:", err))
            return new Response("", { status: 200, headers: corsHeaders })
          }

          if (action?.action_id === "withdraw_from_dm") {
            handleWithdrawRequest(
              adminClient, slackUserId, teamId, action.value, "dm", messageTs, channelId
            ).catch((err) => console.error("[slack-events] withdraw from dm error:", err))
            return new Response("", { status: 200, headers: corsHeaders })
          }

          // open_dashboard is a URL button — Slack handles it natively, no handler needed

          return new Response("", { status: 200, headers: corsHeaders })
        }

        // View submissions (modal submits)
        if (payload.type === "view_submission") {
          const callbackId = payload.view?.callback_id
          const slackUserId = payload.user?.id
          const teamId = payload.team?.id

          if (callbackId === "submit_time_off") {
            const result = await handleSubmitTimeOff(adminClient, slackUserId, teamId, payload.view)
            if (result) {
              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              })
            }
            return new Response("", { status: 200, headers: corsHeaders })
          }

          if (callbackId === "reject_reason") {
            const result = await handleRejectSubmission(adminClient, slackUserId, teamId, payload.view)
            if (result) {
              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              })
            }
            return new Response("", { status: 200, headers: corsHeaders })
          }
        }

        return new Response("", { status: 200, headers: corsHeaders })
      }

      // Slash command
      const command = params.get("command")
      if (command === "/timeoff") {
        const slackUserId = params.get("user_id") || ""
        const teamId = params.get("team_id") || ""
        const triggerId = params.get("trigger_id") || ""
        const responseUrl = params.get("response_url") || ""
        const text = params.get("text") || ""

        const adminClient = createClient(supabaseUrl, supabaseServiceKey)
        handleSlashCommand(
          adminClient, slackUserId, teamId, triggerId, responseUrl, text
        ).catch((err) => console.error("[slack-events] slash command error:", err))

        return new Response("", { status: 200, headers: corsHeaders })
      }
    }

    return new Response("", { status: 200, headers: corsHeaders })
  } catch (err) {
    console.error("[slack-events] Unexpected error:", err)
    return new Response("", { status: 200, headers: corsHeaders })
  }
})
