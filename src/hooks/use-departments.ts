import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import {
  fetchDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "@/lib/settings-service"
import { departmentKeys } from "@/lib/query-keys"

export function useDepartments() {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: departmentKeys.all(workspace?.id ?? ""),
    queryFn: () => fetchDepartments(workspace!.id),
    enabled: !!workspace,
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  })
}

export function useCreateDepartmentMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: (name: string) => createDepartment(workspace!.id, name),
    onSuccess: () => {
      if (workspace) queryClient.invalidateQueries({ queryKey: departmentKeys.all(workspace.id) })
    },
  })
}

export function useUpdateDepartmentMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateDepartment(id, name, workspace!.id),
    onSuccess: () => {
      if (workspace) queryClient.invalidateQueries({ queryKey: departmentKeys.all(workspace.id) })
    },
  })
}

export function useDeleteDepartmentMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: (id: string) => deleteDepartment(id, workspace!.id),
    onSuccess: () => {
      if (workspace) queryClient.invalidateQueries({ queryKey: departmentKeys.all(workspace.id) })
    },
  })
}
