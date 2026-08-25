import { describe, it, expect } from "vitest"
import { isValidEmail } from "@/lib/validation"

/**
 * isValidEmail is the single check shared by the employee form and the CSV
 * importer. Before it existed the form used Zod's built-in .email() while the
 * importer used its own regex, so the two paths could disagree about the same
 * address. These cases pin the agreed-upon boundary.
 */
describe("isValidEmail", () => {
  it.each([
    "user@example.com",
    "first.last@example.co.uk",
    "user+tag@example.io",
    "user_name@sub.domain.example.com",
  ])("accepts %s", (email) => {
    expect(isValidEmail(email)).toBe(true)
  })

  it.each([
    ["", "empty string"],
    ["not-an-email", "no @ and no domain"],
    ["missing@domain", "no dot-separated TLD"],
    ["missing@domain.", "trailing dot, no TLD"],
    ["missing@domain.x", "single-character TLD"],
    ["@example.com", "no local part"],
    ["user@", "no domain"],
    ["two@@example.com", "@ inside the domain part"],
    ["user name@example.com", "space in the local part"],
    ["user@exa mple.com", "space in the domain"],
  ])("rejects %s (%s)", (email) => {
    expect(isValidEmail(email)).toBe(false)
  })

  it("trims surrounding whitespace before judging", () => {
    // The form trims on submit, the importer trims on parse; the validator
    // must agree with both rather than rejecting a merely padded value.
    expect(isValidEmail("  user@example.com  ")).toBe(true)
  })
})
