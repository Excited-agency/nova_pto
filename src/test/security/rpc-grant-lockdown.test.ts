import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient } from "@supabase/supabase-js"
import {
  createIsolatedWorkspace,
  cleanupWorkspace,
  skipIfNoServiceKey,
  type IsolatedWorkspace,
} from "./helpers"

const TEST_URL = process.env.TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ""
const TEST_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ""

// Regression guard for migration 20260723000000_lock_down_rpc_grants.sql.
// The anon role must not be able to EXECUTE sensitive RPCs, and neither anon
// nor authenticated may execute trigger/bot helper functions. authenticated
// must retain EXECUTE on the RPCs the app actually calls.
describe.skipIf(skipIfNoServiceKey())("RPC grant lockdown (migration 20260723000000)", () => {
  // Unauthenticated client — no Authorization header, so it acts as `anon`.
  const anonClient = createClient(TEST_URL, TEST_ANON_KEY, {
    auth: { persistSession: false },
  })

  let admin: IsolatedWorkspace

  beforeAll(async () => {
    admin = await createIsolatedWorkspace("admin")
  }, 30_000)

  afterAll(async () => {
    await cleanupWorkspace(admin.workspaceId, admin.userId)
  }, 15_000)

  const isPermissionError = (error: { message?: string; code?: string } | null) =>
    !!error && ((error.message ?? "").toLowerCase().includes("permission denied") || error.code === "42501")

  // A client cannot execute a function either because EXECUTE is revoked
  // (42501) or because PostgREST does not expose it at all — trigger
  // functions (RETURNS trigger) are never routable (PGRST202).
  const isNotCallable = (error: { message?: string; code?: string } | null) =>
    isPermissionError(error) || error?.code === "PGRST202"

  it("anon CANNOT execute approve_time_off_request", async () => {
    const { error } = await anonClient.rpc("approve_time_off_request", {
      p_request_id: crypto.randomUUID(),
    })
    expect(isPermissionError(error)).toBe(true)
  })

  it("anon CANNOT execute create_time_off_record", async () => {
    // Pass all 8 args so PostgREST resolves the overload deterministically
    // (a partial arg set yields an ambiguous-candidate routing error instead).
    const { error } = await anonClient.rpc("create_time_off_record", {
      p_workspace_id: admin.workspaceId,
      p_employee_id: admin.userId,
      p_category_id: crypto.randomUUID(),
      p_start_date: "2026-06-01",
      p_end_date: "2026-06-02",
      p_comment: "",
      p_start_period: "morning",
      p_end_period: "end_of_day",
    })
    expect(isPermissionError(error)).toBe(true)
  })

  it("anon CANNOT execute the Slack bot RPC (approve_time_off_request_bot)", async () => {
    const { error } = await anonClient.rpc("approve_time_off_request_bot", {
      p_request_id: crypto.randomUUID(),
      p_admin_profile_id: admin.userId,
    })
    expect(isPermissionError(error)).toBe(true)
  })

  it("authenticated CANNOT execute the Slack bot RPC (approve_time_off_request_bot)", async () => {
    const { error } = await admin.userClient.rpc("approve_time_off_request_bot", {
      p_request_id: crypto.randomUUID(),
      p_admin_profile_id: admin.userId,
    })
    expect(isPermissionError(error)).toBe(true)
  })

  it("trigger helper (trg_seed_balances_on_new_employee) is not client-callable", async () => {
    const asAnon = await anonClient.rpc("trg_seed_balances_on_new_employee")
    const asAuth = await admin.userClient.rpc("trg_seed_balances_on_new_employee")
    expect(isNotCallable(asAnon.error)).toBe(true)
    expect(isNotCallable(asAuth.error)).toBe(true)
  })

  it("authenticated CAN execute approve_time_off_request (blocked by logic, NOT by grant)", async () => {
    // A non-existent request id → the RPC runs and raises 'Request not found',
    // proving the grant is intact (the error is business logic, not permission).
    const { error } = await admin.userClient.rpc("approve_time_off_request", {
      p_request_id: crypto.randomUUID(),
    })
    expect(error).not.toBeNull()
    expect(isPermissionError(error)).toBe(false)
    expect((error?.message ?? "").toLowerCase()).toContain("not found")
  })
})
