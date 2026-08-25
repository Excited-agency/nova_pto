import { fetchReportEmployees, fetchAllEmployeeBalances } from "@/lib/report-service"
import { fetchTimeOffRequests } from "@/lib/time-off-request-service"
import { fetchTimeOffCategories } from "@/lib/time-off-category-service"
import { getCategoryDisplay } from "@/lib/request-display"

function getEmployeeName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ") || "—"
}

export async function generateReport(workspaceId: string): Promise<void> {
  // xlsx has known CVEs (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) with no upstream fix.
  // Risk accepted: used only for admin Excel export on trusted server-side data, no user input parsed here.
  const XLSX = await import("xlsx")

  const [employees, balances, categories, requests] = await Promise.all([
    fetchReportEmployees(workspaceId),
    fetchAllEmployeeBalances(workspaceId),
    fetchTimeOffCategories(workspaceId),
    fetchTimeOffRequests(workspaceId),
  ])

  const activeCategories = categories.filter((c) => c.is_active)

  // --- Sheet 1: Employee Balances ---
  const balanceMap = new Map<string, Map<string, number>>()
  for (const b of balances) {
    if (!balanceMap.has(b.employee_id)) balanceMap.set(b.employee_id, new Map())
    balanceMap.get(b.employee_id)?.set(b.category_id, b.remaining_days)
  }

  const balanceHeaders = [
    "Employee Name",
    "Email",
    "Department",
    "Location",
    "Hire Date",
    "Status",
    ...activeCategories.map((c) => c.name),
  ]

  const balanceRows = employees.map((emp) => {
    const empBalances = balanceMap.get(emp.id)
    return [
      getEmployeeName(emp.first_name, emp.last_name),
      emp.email,
      emp.department_name ?? "—",
      emp.location ?? "—",
      emp.hire_date ?? "—",
      emp.status.charAt(0).toUpperCase() + emp.status.slice(1),
      ...activeCategories.map((c) => empBalances?.get(c.id) ?? 0),
    ]
  })

  // --- Sheet 2: Request History ---
  // Emoji deliberately omitted — a spreadsheet cell reads better as plain
  // text. The map shape is what getCategoryDisplay expects, so the report and
  // the UI resolve a leave type the same way, including the fallback to the
  // category_name snapshot for categories that have since been deleted.
  const categoryMap = new Map<string, { name: string; emoji?: string | null }>()
  for (const c of categories) categoryMap.set(c.id, { name: c.name })

  const requestHeaders = [
    "Employee Name",
    "Request Type",
    "Start Date",
    "End Date",
    "Duration (days)",
    "Status",
    "Comment",
    "Rejection Reason",
    "Reviewed At",
  ]

  const requestRows = requests.map((req) => {
    const typeName = getCategoryDisplay(req, categoryMap)

    return [
      req.employee_name,
      typeName,
      req.start_date,
      req.end_date,
      // total_days is NOT NULL and always server-computed (weekends and
      // holidays excluded), so report it as stored. The old fallback here
      // counted raw calendar days, which would have inflated a duration
      // rather than admit it was missing.
      req.total_days,
      req.status.charAt(0).toUpperCase() + req.status.slice(1),
      req.comment ?? "",
      req.rejection_reason ?? "",
      req.reviewed_at ? new Date(req.reviewed_at).toISOString().split("T")[0] : "",
    ]
  })

  // --- Build workbook ---
  const wb = XLSX.utils.book_new()

  const balanceSheet = XLSX.utils.aoa_to_sheet([balanceHeaders, ...balanceRows])
  XLSX.utils.book_append_sheet(wb, balanceSheet, "Employee Balances")

  const requestSheet = XLSX.utils.aoa_to_sheet([requestHeaders, ...requestRows])
  XLSX.utils.book_append_sheet(wb, requestSheet, "Request History")

  const today = new Date().toISOString().split("T")[0]
  XLSX.writeFile(wb, `Nova_Report_${today}.xlsx`)
}
