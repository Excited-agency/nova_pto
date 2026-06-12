import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import {
  fetchTimeOffRequests,
  fetchEmployeeBalance,
  fetchEmployeeBalances,
  fetchBalanceAdjustmentLog,
  bulkUpdateEmployeeBalances,
  createTimeOffRecord,
  updateTimeOffRequestStatus,
  approveTimeOffRequest,
  rejectTimeOffRequest,
  fetchActiveEmployeesForCombobox,
  fetchMyTimeOffRequests,
  submitTimeOffRequest,
  withdrawTimeOffRequest,
  type CreateTimeOffRecordParams,
  type SubmitTimeOffRequestParams,
} from "@/lib/time-off-request-service"
import type { BalanceAdjustmentLog } from "@/types/balance-adjustment-log"
import type { TimeOffStatus } from "@/types/time-off-request"
import { timeOffRequestKeys, employeeBalanceKeys, activeEmployeeKeys, myRequestKeys, balanceAdjustmentLogKeys } from "@/lib/query-keys"

export function useTimeOffRequests() {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: timeOffRequestKeys.list(workspace?.id ?? ""),
    queryFn: () => fetchTimeOffRequests(workspace!.id),
    enabled: !!workspace,
    placeholderData: keepPreviousData,
  })
}

export function useEmployeeBalance(
  employeeId: string | undefined,
  categoryId: string | undefined
) {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: employeeBalanceKeys.single(workspace?.id ?? "", employeeId ?? "", categoryId ?? ""),
    queryFn: () => fetchEmployeeBalance(employeeId!, categoryId!, workspace!.id),
    enabled: !!employeeId && !!categoryId && !!workspace,
  })
}

export function useEmployeeBalances(employeeId: string | undefined) {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: employeeBalanceKeys.allForEmployee(workspace?.id ?? "", employeeId ?? ""),
    queryFn: () => fetchEmployeeBalances(employeeId!, workspace!.id),
    enabled: !!employeeId && !!workspace,
  })
}

export function useCreateTimeOffRecordMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: (params: CreateTimeOffRecordParams) => createTimeOffRecord(params),
    onSuccess: (_data, variables) => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: timeOffRequestKeys.all(workspace.id) })
        queryClient.invalidateQueries({
          queryKey: employeeBalanceKeys.allForEmployee(workspace.id, variables.employee_id),
        })
        queryClient.invalidateQueries({
          queryKey: balanceAdjustmentLogKeys.allForEmployee(workspace.id, variables.employee_id),
        })
      }
    },
  })
}

export function useUpdateRequestStatusMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: ({ requestId, status }: { requestId: string; status: TimeOffStatus }) =>
      updateTimeOffRequestStatus(requestId, status, workspace!.id),
    onSuccess: () => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: timeOffRequestKeys.all(workspace.id) })
      }
    },
  })
}

export function useRejectRequestMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason: string; profileId: string }) =>
      rejectTimeOffRequest(requestId, reason),
    onSuccess: (_data, variables) => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: timeOffRequestKeys.all(workspace.id) })
        queryClient.invalidateQueries({ queryKey: myRequestKeys.all(variables.profileId) })
        queryClient.invalidateQueries({
          queryKey: employeeBalanceKeys.allForEmployee(workspace.id, variables.profileId),
        })
        queryClient.invalidateQueries({
          queryKey: balanceAdjustmentLogKeys.allForEmployee(workspace.id, variables.profileId),
        })
      }
    },
  })
}

export function useApproveRequestMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: ({ requestId }: { requestId: string; profileId: string }) =>
      approveTimeOffRequest(requestId),
    onSuccess: (_data, variables) => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: timeOffRequestKeys.all(workspace.id) })
        queryClient.invalidateQueries({ queryKey: myRequestKeys.all(variables.profileId) })
        queryClient.invalidateQueries({
          queryKey: employeeBalanceKeys.allForEmployee(workspace.id, variables.profileId),
        })
        queryClient.invalidateQueries({
          queryKey: balanceAdjustmentLogKeys.allForEmployee(workspace.id, variables.profileId),
        })
      }
    },
  })
}

export function usePendingRequestCount() {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: timeOffRequestKeys.list(workspace?.id ?? ""),
    queryFn: () => fetchTimeOffRequests(workspace!.id),
    enabled: !!workspace,
    select: (data) => data.filter((r) => r.status === "pending").length,
  })
}

export function useActiveEmployees() {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: activeEmployeeKeys.list(workspace?.id ?? ""),
    queryFn: () => fetchActiveEmployeesForCombobox(workspace!.id),
    enabled: !!workspace,
    placeholderData: keepPreviousData,
  })
}

export function useMyTimeOffRequests() {
  const { profile, workspace } = useAuth()

  return useQuery({
    queryKey: myRequestKeys.list(profile?.id ?? "", workspace?.id ?? ""),
    queryFn: () => fetchMyTimeOffRequests(profile!.id, workspace!.id),
    enabled: !!profile && !!workspace,
    placeholderData: keepPreviousData,
  })
}

export function useWithdrawRequestMutation() {
  const queryClient = useQueryClient()
  const { profile, workspace } = useAuth()

  return useMutation({
    mutationFn: (requestId: string) => withdrawTimeOffRequest(requestId, workspace!.id),
    onSuccess: () => {
      if (profile && workspace) {
        queryClient.invalidateQueries({ queryKey: myRequestKeys.all(profile.id) })
        queryClient.invalidateQueries({ queryKey: timeOffRequestKeys.all(workspace.id) })
      }
    },
  })
}

export function useSubmitTimeOffRequestMutation() {
  const queryClient = useQueryClient()
  const { profile, workspace } = useAuth()

  return useMutation({
    mutationFn: (params: SubmitTimeOffRequestParams) => submitTimeOffRequest(params),
    onSuccess: () => {
      if (profile && workspace) {
        queryClient.invalidateQueries({ queryKey: myRequestKeys.all(profile.id) })
        queryClient.invalidateQueries({ queryKey: timeOffRequestKeys.all(workspace.id) })
      }
    },
  })
}

export function useBalanceAdjustmentLog(employeeId: string | undefined) {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: balanceAdjustmentLogKeys.allForEmployee(workspace?.id ?? "", employeeId ?? ""),
    queryFn: (): Promise<BalanceAdjustmentLog[]> =>
      fetchBalanceAdjustmentLog(employeeId!, workspace!.id),
    enabled: !!employeeId && !!workspace,
  })
}

export function useUpdateEmployeeBalancesMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: async (params: {
      employeeId: string
      updates: { categoryId: string; remainingDays: number }[]
    }) => {
      await bulkUpdateEmployeeBalances(
        params.employeeId,
        workspace!.id,
        params.updates
      )
    },
    onSuccess: (_data, variables) => {
      if (workspace) {
        queryClient.invalidateQueries({
          queryKey: employeeBalanceKeys.allForEmployee(workspace.id, variables.employeeId),
        })
        queryClient.invalidateQueries({
          queryKey: balanceAdjustmentLogKeys.allForEmployee(workspace.id, variables.employeeId),
        })
      }
    },
  })
}
