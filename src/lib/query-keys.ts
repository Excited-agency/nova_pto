import type { EmployeeStatus } from "@/types/employee"

export const employeeKeys = {
  all: (workspaceId: string) => ["employees", workspaceId] as const,
  list: (workspaceId: string, status: EmployeeStatus) =>
    ["employees", workspaceId, "list", status] as const,
  counts: (workspaceId: string) =>
    ["employees", workspaceId, "counts"] as const,
  detail: (workspaceId: string, employeeId: string) => ["employees", workspaceId, "detail", employeeId] as const,
}

export const departmentKeys = {
  all: (workspaceId: string) => ["departments", workspaceId] as const,
}

export const timeOffCategoryKeys = {
  all: (workspaceId: string) => ["timeOffCategories", workspaceId] as const,
  list: (workspaceId: string) => ["timeOffCategories", workspaceId, "list"] as const,
  detail: (workspaceId: string, categoryId: string) => ["timeOffCategories", workspaceId, "detail", categoryId] as const,
}

export const holidayKeys = {
  all: (workspaceId: string) => ["holidays", workspaceId] as const,
  list: (workspaceId: string) => ["holidays", workspaceId, "list"] as const,
}

export const timeOffRequestKeys = {
  all: (workspaceId: string) => ["timeOffRequests", workspaceId] as const,
  list: (workspaceId: string) => ["timeOffRequests", workspaceId, "list"] as const,
}

export const employeeBalanceKeys = {
  single: (workspaceId: string, employeeId: string, categoryId: string) =>
    ["employeeBalances", workspaceId, employeeId, categoryId] as const,
  allForEmployee: (workspaceId: string, employeeId: string) =>
    ["employeeBalances", workspaceId, employeeId] as const,
}

export const activeEmployeeKeys = {
  list: (workspaceId: string) => ["activeEmployees", workspaceId, "list"] as const,
}

export const myRequestKeys = {
  all: (profileId: string) => ["myRequests", profileId] as const,
  list: (profileId: string, workspaceId: string) => ["myRequests", profileId, workspaceId] as const,
}

export const balanceAdjustmentLogKeys = {
  allForEmployee: (workspaceId: string, employeeId: string) =>
    ["balanceAdjustmentLog", workspaceId, employeeId] as const,
}
