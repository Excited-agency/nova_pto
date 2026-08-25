/**
 * Helpers for optimistically removing rows from a TanStack Query list cache.
 *
 * These exist because a `queryClient.setQueryData` updater has to match the
 * shape actually stored in the cache — which is the raw `queryFn` result, NOT
 * what the component receives. A hook's `select` transform runs on read only,
 * so a query whose `queryFn` returns `{ data, count }` still caches the object
 * even when `select: r => r.data` hands the component a plain array.
 *
 * Getting that wrong is not a silent no-op: the updater runs synchronously
 * inside the click handler, so a TypeError there aborts the rest of the
 * handler and the mutation never fires at all. Both shapes therefore get an
 * explicit, tested helper instead of an inline filter per call site.
 */

interface Identifiable {
  id: string
}

/** Raw cache shape of a paginated list query (see fetchEmployees). */
export interface PaginatedCache<T> {
  data: T[]
  count: number
}

/**
 * Removes rows by id from a plain-array cache.
 * Returns `undefined` untouched so an unpopulated cache stays unpopulated.
 */
export function removeFromListCache<T extends Identifiable>(
  old: T[] | undefined,
  ids: string[]
): T[] | undefined {
  if (!old) return old
  const removing = new Set(ids)
  return old.filter((row) => !removing.has(row.id))
}

/**
 * Removes rows by id from a `{ data, count }` cache, keeping `count` in step
 * with the rows actually removed so pagination totals stay believable.
 */
export function removeFromPaginatedCache<T extends Identifiable>(
  old: PaginatedCache<T> | undefined,
  ids: string[]
): PaginatedCache<T> | undefined {
  if (!old) return old
  const removing = new Set(ids)
  const data = old.data.filter((row) => !removing.has(row.id))
  const removed = old.data.length - data.length
  return { data, count: Math.max(0, old.count - removed) }
}
