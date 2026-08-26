import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * The owner is an admin with extra powers, so every gate that means "an admin"
 * has to accept `owner` too. `is_workspace_admin()` in the database does
 * (`role IN ('admin','owner')`), and so does every RLS policy and RPC — checked
 * against production with pg_policies and pg_get_functiondef.
 *
 * The Edge Functions are the layer with no such guarantee: they are plain
 * TypeScript, they run outside RLS on the service role, and nothing type-checks
 * a PostgREST filter string. Three of them shipped `.eq("role", "admin")`,
 * which silently excluded the owner:
 *
 *   slack-notify  the admins to DM about a new request -> a workspace whose
 *                 only admin is the founder (the default after founder-flow)
 *                 got `no_admins` and nobody was notified at all
 *   slack-notify  the admin Home Tabs to refresh after a decision
 *   slack-oauth   identifying the installer in Slack's admin-approval flow
 *
 * This is a whole-class test rather than three per-site tests on purpose: the
 * bug is not "this line is wrong", it is "this line is easy to write wrong",
 * and a new function added next month would reintroduce it. Reading the source
 * is the only check available — an owner-visible Slack DM cannot be asserted
 * without a real Slack workspace.
 */

const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions")

function functionSources(): { name: string; source: string }[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((entry) => statSync(join(FUNCTIONS_DIR, entry)).isDirectory())
    .map((name) => ({
      name,
      source: readFileSync(join(FUNCTIONS_DIR, name, "index.ts"), "utf-8"),
    }))
}

describe("Edge Function role gates", () => {
  const sources = functionSources()

  it("finds the functions to inspect", () => {
    // Guards the test itself: a wrong path would make every assertion below
    // pass over an empty list.
    expect(sources.length).toBeGreaterThanOrEqual(6)
    expect(sources.map((f) => f.name)).toContain("slack-notify")
  })

  it.each(sources)(
    "$name never filters profiles by role = 'admin' alone",
    ({ source }) => {
      // .eq("role", "admin") — the PostgREST equality filter, which drops the
      // owner. The replacement is .in("role", ["admin", "owner"]).
      const matches = source.match(/\.eq\(\s*["']role["']\s*,\s*["']admin["']\s*\)/g)
      expect(matches).toBeNull()
    }
  )

  it.each(sources)(
    "$name never compares a role to \"admin\" without also allowing \"owner\"",
    ({ source }) => {
      // A JS comparison is fine only when `owner` is accepted on the same
      // logical line — `role === "admin" || role === "owner"`, or an
      // ["admin","owner"].includes(...) membership test.
      const offending = source
        .split("\n")
        .filter((line) => /role\s*===?\s*["']admin["']/.test(line))
        .filter((line) => !line.includes("owner"))

      expect(offending).toEqual([])
    }
  )
})
