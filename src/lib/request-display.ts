const legacyTypeLabels: Record<string, string> = {
  vacation: "Vacation",
  sick_leave: "Sick Leave",
  personal: "Personal",
  bereavement: "Bereavement",
  other: "Other",
}

export function getCategoryDisplay(
  request: { category_id?: string | null; request_type: string },
  categoryMap: Map<string, { name: string; emoji?: string | null }>
): string {
  if (request.category_id) {
    const cat = categoryMap.get(request.category_id)
    if (cat) return `${cat.name}${cat.emoji ? ` ${cat.emoji}` : ""}`
  }
  return legacyTypeLabels[request.request_type] ?? "Other"
}
