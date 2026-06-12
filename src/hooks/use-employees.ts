import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import {
  fetchEmployees,
  fetchEmployeeCounts,
  fetchEmployee,
  updateEmployee,
  updateEmployeeStatus,
  bulkUpdateEmployeeStatus,
  deleteEmployee,
  purgeEmployee,
  inviteEmployee,
  type UpdateEmployeeData,
  type InviteEmployeeData,
} from "@/lib/employee-service"
import { employeeKeys, departmentKeys, activeEmployeeKeys } from "@/lib/query-keys"
import type { EmployeeStatus } from "@/types/employee"

export function useEmployeeList(status: EmployeeStatus) {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: employeeKeys.list(workspace?.id ?? "", status),
    queryFn: () => fetchEmployees(workspace!.id, status, 0, 100),
    enabled: !!workspace,
    placeholderData: keepPreviousData,
    select: (result) => result.data,
  })
}

export function useEmployeeCounts() {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: employeeKeys.counts(workspace?.id ?? ""),
    queryFn: () => fetchEmployeeCounts(workspace!.id),
    enabled: !!workspace,
    placeholderData: keepPreviousData,
  })
}

export function useEmployee(id: string | undefined) {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: employeeKeys.detail(workspace?.id ?? "", id ?? ""),
    queryFn: () => fetchEmployee(id!, workspace!.id),
    enabled: !!id && !!workspace,
  })
}

export function useEmployeeStatusMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: ({ employeeId, status }: { employeeId: string; status: EmployeeStatus }) =>
      updateEmployeeStatus(employeeId, status, workspace!.id),
    onSuccess: () => {
      if (workspace) {
        // Invalidate counts and all employee lists at once with a single prefix match
        queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
        // Also bust the active-employees combobox cache so modals reflect the change immediately
        queryClient.invalidateQueries({ queryKey: activeEmployeeKeys.list(workspace.id) })
      }
    },
  })
}

export function useDeleteEmployeeMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: (employeeId: string) => deleteEmployee(employeeId),
    onSuccess: () => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
        queryClient.invalidateQueries({ queryKey: activeEmployeeKeys.list(workspace.id) })
      }
    },
  })
}

export function usePurgeEmployeeMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: (employeeId: string) => purgeEmployee(employeeId),
    onSuccess: () => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
        queryClient.invalidateQueries({ queryKey: activeEmployeeKeys.list(workspace.id) })
      }
    },
  })
}

export function useBulkEmployeeStatusMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: EmployeeStatus }) =>
      bulkUpdateEmployeeStatus(ids, status, workspace!.id),
    onSuccess: () => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
        queryClient.invalidateQueries({ queryKey: activeEmployeeKeys.list(workspace.id) })
      }
    },
  })
}

export function useUpdateEmployeeMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: ({ employeeId, data }: { employeeId: string; data: UpdateEmployeeData }) =>
      updateEmployee(employeeId, data, workspace!.id),
    onSuccess: (_data, variables) => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
        queryClient.invalidateQueries({ queryKey: employeeKeys.detail(workspace.id, variables.employeeId) })
      }
    },
  })
}

export function useInviteEmployeeMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: (data: InviteEmployeeData) => inviteEmployee(data),
    onSuccess: () => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
        queryClient.invalidateQueries({ queryKey: activeEmployeeKeys.list(workspace.id) })
      }
    },
  })
}
