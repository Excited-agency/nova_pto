import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import {
  fetchTimeOffCategories,
  fetchCategory,
  createCategory,
  updateCategory,
  updateCategoryActive,
  deleteCategory,
  updateCategorySortOrder,
  type CreateCategoryData,
  type UpdateCategoryData,
} from "@/lib/time-off-category-service"
import type { TimeOffCategory } from "@/types/time-off-category"
import { timeOffCategoryKeys } from "@/lib/query-keys"

export function useTimeOffCategories() {
  const { workspace } = useAuth()

  return useQuery({
    queryKey: timeOffCategoryKeys.list(workspace?.id ?? ""),
    queryFn: () => fetchTimeOffCategories(workspace!.id),
    enabled: !!workspace,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  })
}

export function useToggleCategoryActiveMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: ({ categoryId, isActive }: { categoryId: string; isActive: boolean }) =>
      updateCategoryActive(categoryId, isActive, workspace!.id),
    onSuccess: () => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: timeOffCategoryKeys.all(workspace.id) })
      }
    },
  })
}

export function useDeleteCategoryMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: (categoryId: string) => deleteCategory(categoryId, workspace!.id),
    onSuccess: () => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: timeOffCategoryKeys.all(workspace.id) })
      }
    },
  })
}

export function useCategory(id: string | undefined) {
  const { workspace } = useAuth()
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: timeOffCategoryKeys.detail(workspace?.id ?? "", id ?? ""),
    queryFn: () => fetchCategory(id!, workspace!.id),
    enabled: !!id && !!workspace,
    placeholderData: () => {
      if (!id || !workspace) return undefined
      const categories = queryClient.getQueryData<TimeOffCategory[]>(
        timeOffCategoryKeys.list(workspace.id)
      )
      return categories?.find((c) => c.id === id)
    },
  })
}

export function useCreateCategoryMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: (data: CreateCategoryData) => createCategory(data),
    onSuccess: () => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: timeOffCategoryKeys.all(workspace.id) })
      }
    },
  })
}

export function useUpdateCategoryMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: ({ categoryId, data }: { categoryId: string; data: UpdateCategoryData }) =>
      updateCategory(categoryId, data, workspace!.id),
    onSuccess: (_result, variables) => {
      if (workspace) {
        queryClient.invalidateQueries({ queryKey: timeOffCategoryKeys.all(workspace.id) })
        queryClient.invalidateQueries({
          queryKey: timeOffCategoryKeys.detail(workspace.id, variables.categoryId),
        })
      }
    },
  })
}

export function useReorderCategoriesMutation() {
  const queryClient = useQueryClient()
  const { workspace } = useAuth()

  return useMutation({
    mutationFn: (items: { id: string; sort_order: number }[]) =>
      updateCategorySortOrder(items, workspace!.id),
    onMutate: async (items) => {
      if (!workspace) return

      const listKey = timeOffCategoryKeys.list(workspace.id)
      await queryClient.cancelQueries({ queryKey: listKey })

      const previous = queryClient.getQueryData<TimeOffCategory[]>(listKey)

      if (previous) {
        const orderMap = new Map(items.map((i) => [i.id, i.sort_order]))
        const updated = previous
          .map((cat) => ({
            ...cat,
            sort_order: orderMap.get(cat.id) ?? cat.sort_order,
          }))
          .sort((a, b) => a.sort_order - b.sort_order)

        queryClient.setQueryData(listKey, updated)
      }

      return { previous }
    },
    onError: (_err, _items, context) => {
      if (context?.previous && workspace) {
        queryClient.setQueryData(
          timeOffCategoryKeys.list(workspace.id),
          context.previous
        )
      }
    },
    onSettled: () => {
      if (workspace) {
        queryClient.invalidateQueries({
          queryKey: timeOffCategoryKeys.all(workspace.id),
        })
      }
    },
  })
}
