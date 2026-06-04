import { fetchReportEmployees, fetchAllEmployeeBalances } from "@/lib/report-service"
import { fetchTimeOffRequests } from "@/lib/time-off-request-service"
import { fetchTimeOffCategories } from "@/lib/time-off-category-service"

const legacyTypeLabels: Record<string, string> = {
  vacation: "Vacation",
  sick_leave: "Sick Leave",
  personal: "Personal",
  bereavement: "Bereavement",
  other: "Other",
}

// Simple calendar-day fallback for legacy records where total_days was not stored.
// Matches the backfill in 20260320000000_add_half_day_periods migration.
function calendarDaysFallback(startDate: string, endDate: string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

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
    balanceMap.get(b.employee_id)!.set(b.category_id, b.remaining_days)
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
  const categoryMap = new Map<string, string>()
  for (const c of categories) categoryMap.set(c.id, c.name)

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
    const typeName = req.category_id
      ? categoryMap.get(req.category_id) ?? legacyTypeLabels[req.request_type] ?? "Other"
      : legacyTypeLabels[req.request_type] ?? "Other"

    return [
      req.employee_name,
      typeName,
      req.start_date,
      req.end_date,
      req.total_days ?? calendarDaysFallback(req.start_date, req.end_date),
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
