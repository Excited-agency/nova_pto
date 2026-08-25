import { describe, it, expect } from "vitest"
import {
  removeFromListCache,
  removeFromPaginatedCache,
  type PaginatedCache,
} from "@/lib/query-cache-utils"

interface Row {
  id: string
  name: string
}

const row = (id: string): Row => ({ id, name: `row-${id}` })

describe("removeFromListCache (plain-array cache, e.g. holidays)", () => {
  it("removes the listed ids and keeps the rest", () => {
    const result = removeFromListCache([row("a"), row("b"), row("c")], ["a", "c"])
    expect(result?.map((r) => r.id)).toEqual(["b"])
  })

  it("ignores ids that are not present", () => {
    const result = removeFromListCache([row("a")], ["zzz"])
    expect(result?.map((r) => r.id)).toEqual(["a"])
  })

  it("returns undefined for an unpopulated cache instead of inventing an array", () => {
    expect(removeFromListCache(undefined, ["a"])).toBeUndefined()
  })

  it("does not mutate the array it was given", () => {
    const original = [row("a"), row("b")]
    removeFromListCache(original, ["a"])
    expect(original.map((r) => r.id)).toEqual(["a", "b"])
  })
})

describe("removeFromPaginatedCache ({ data, count } cache, e.g. employees)", () => {
  it("removes a single row and decrements count", () => {
    const old: PaginatedCache<Row> = { data: [row("a"), row("b")], count: 2 }
    const result = removeFromPaginatedCache(old, ["a"])
    expect(result?.data.map((r) => r.id)).toEqual(["b"])
    expect(result?.count).toBe(1)
  })

  it("removes several rows and decrements count by the number actually removed", () => {
    const old: PaginatedCache<Row> = { data: [row("a"), row("b"), row("c")], count: 3 }
    const result = removeFromPaginatedCache(old, ["a", "c"])
    expect(result?.data.map((r) => r.id)).toEqual(["b"])
    expect(result?.count).toBe(1)
  })

  it("only decrements count for rows present on the current page", () => {
    // count is the server-side total, so ids that are not on this page must not
    // reduce it -- otherwise the total drifts away from reality.
    const old: PaginatedCache<Row> = { data: [row("a")], count: 50 }
    const result = removeFromPaginatedCache(old, ["a", "not-on-this-page"])
    expect(result?.data).toEqual([])
    expect(result?.count).toBe(49)
  })

  it("never produces a negative count", () => {
    const old: PaginatedCache<Row> = { data: [row("a")], count: 0 }
    expect(removeFromPaginatedCache(old, ["a"])?.count).toBe(0)
  })

  it("returns undefined for an unpopulated cache", () => {
    expect(removeFromPaginatedCache(undefined, ["a"])).toBeUndefined()
  })

  it("does not mutate the cache object it was given", () => {
    const old: PaginatedCache<Row> = { data: [row("a"), row("b")], count: 2 }
    removeFromPaginatedCache(old, ["a"])
    expect(old.data.map((r) => r.id)).toEqual(["a", "b"])
    expect(old.count).toBe(2)
  })

  it("regression: an object-shaped cache must not be treated as an array", () => {
    // The original bug: the call sites ran `(old ?? []).filter(...)` against a
    // `{ data, count }` cache. `old` was truthy, so `?? []` kept the object and
    // `.filter` threw synchronously -- which aborted the click handler before
    // the delete mutation was ever sent, so deleting an employee silently did
    // nothing and the confirm dialog stayed open.
    const old: PaginatedCache<Row> = { data: [row("a")], count: 1 }
    expect(() => removeFromPaginatedCache(old, ["a"])).not.toThrow()
    expect(removeFromPaginatedCache(old, ["a"])).toEqual({ data: [], count: 0 })
  })
})
