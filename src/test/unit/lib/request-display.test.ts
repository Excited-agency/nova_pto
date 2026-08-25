import { describe, it, expect } from "vitest"
import { getCategoryDisplay } from "@/lib/request-display"

type CategoryMap = Map<string, { name: string; emoji?: string | null }>

describe("getCategoryDisplay", () => {
  const categories: CategoryMap = new Map([
    ["cat-1", { name: "Vacation", emoji: "🏖️" }],
    ["cat-2", { name: "Sick Leave" }],
  ])

  it("prefers the live category, including its emoji", () => {
    expect(
      getCategoryDisplay({ category_id: "cat-1", request_type: "other" }, categories)
    ).toBe("Vacation 🏖️")
  })

  it("omits the emoji when the category has none", () => {
    expect(
      getCategoryDisplay({ category_id: "cat-2", request_type: "other" }, categories)
    ).toBe("Sick Leave")
  })

  it("falls back to the snapshot once the category is deleted", () => {
    // What a deleted category leaves behind: category_id nulled by the FK,
    // category_name frozen at its last value. Without this branch the request
    // would read as "Other" in every report.
    expect(
      getCategoryDisplay(
        { category_id: null, category_name: "Summer Leave", request_type: "vacation" },
        categories
      )
    ).toBe("Summer Leave")
  })

  it("uses the snapshot even if the id survives but the category is not loaded", () => {
    // Category exists but is missing from the map (inactive, or filtered out
    // of the fetch). The snapshot is still better than the legacy label.
    expect(
      getCategoryDisplay(
        { category_id: "cat-gone", category_name: "Study Leave", request_type: "other" },
        categories
      )
    ).toBe("Study Leave")
  })

  it("falls back to the legacy request_type label when there is no snapshot", () => {
    expect(
      getCategoryDisplay({ category_id: null, request_type: "bereavement" }, categories)
    ).toBe("Bereavement")
  })

  it("ends at 'Other' for an unrecognised request_type", () => {
    expect(
      getCategoryDisplay({ category_id: null, request_type: "sabbatical" }, categories)
    ).toBe("Other")
  })
})
