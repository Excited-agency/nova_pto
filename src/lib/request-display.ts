export const legacyTypeLabels: Record<string, string> = {
  vacation: "Vacation",
  sick_leave: "Sick Leave",
  personal: "Personal",
  bereavement: "Bereavement",
  other: "Other",
}

/**
 * What leave type a request was taken under.
 *
 * Three sources, in descending order of quality:
 *   1. the live category — the only one that carries the emoji;
 *   2. category_name — a snapshot written when the request was created and
 *      kept in sync on rename. This is what survives after the category is
 *      deleted, so reports still say "Summer Leave" instead of "Other";
 *   3. request_type — the pre-category legacy column.
 */
export function getCategoryDisplay(
  request: {
    category_id?: string | null
    category_name?: string | null
    request_type: string
  },
  categoryMap: Map<string, { name: string; emoji?: string | null }>
): string {
  if (request.category_id) {
    const cat = categoryMap.get(request.category_id)
    if (cat) return `${cat.name}${cat.emoji ? ` ${cat.emoji}` : ""}`
  }
  if (request.category_name) return request.category_name
  return legacyTypeLabels[request.request_type] ?? "Other"
}
