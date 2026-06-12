import { useState, useEffect, useMemo, useCallback } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { FileClock, ChevronRight } from "lucide-react"

import { Separator } from "@/components/ui/separator"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import { CategoryForm } from "@/components/category-form"
import type { CategoryFormValues } from "@/lib/category-form-schema"
import {
  useCategory,
  useUpdateCategoryMutation,
} from "@/hooks/use-time-off-categories"
import { useNavigationGuard } from "@/contexts/navigation-guard-context"
import { addToast } from "@/lib/toast"
import type { TimeOffCategory } from "@/types/time-off-category"

function mapToFormValues(cat: TimeOffCategory): CategoryFormValues {
  return {
    name: cat.name,
    colour: cat.colour,
    leave_type: cat.leave_type,
    accrual_method: cat.accrual_method,
    amount_value: cat.amount_value ?? null,
    granting_frequency: cat.granting_frequency ?? null,
    accrual_day: cat.accrual_day ?? null,
    anniversary_years: cat.anniversary_years ?? null,
    new_hire_rule: cat.new_hire_rule,
    waiting_period_value: cat.waiting_period_value ?? null,
    waiting_period_unit: cat.new_hire_rule === "immediate"
      ? "year"
      : (cat.waiting_period_unit ?? null),
    carryover_limit_enabled: cat.carryover_limit_enabled,
    carryover_max_days: cat.carryover_max_days ?? null,
    carryover_expiration_value: cat.carryover_expiration_value ?? null,
    carryover_expiration_unit: cat.carryover_expiration_unit ?? null,
  }
}

export function EditCategoryPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data: category, isLoading, isError } = useCategory(id)
  const updateMutation = useUpdateCategoryMutation()
  const { registerGuard, unregisterGuard } = useNavigationGuard()
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    if (isError) {
      addToast({ title: "Category not found", description: "Couldn't load this category." })
      navigate("/time-off-setup")
    }
  }, [isError, navigate])

  useEffect(() => {
    registerGuard(() => {
      if (!isDirty) return true
      return window.confirm("You have unsaved changes. Are you sure you want to leave?")
    })
    return () => unregisterGuard()
  }, [isDirty, registerGuard, unregisterGuard])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  const handleDirtyChange = useCallback((dirty: boolean) => setIsDirty(dirty), [])

  const initialData = useMemo(() => {
    if (!category) return undefined
    return mapToFormValues(category)
  }, [category])

  async function handleSubmit(data: CategoryFormValues) {
    if (!id) return

    await updateMutation.mutateAsync({
      categoryId: id,
      data: {
        name: data.name,
        colour: data.colour,
        leave_type: data.leave_type,
        accrual_method: data.accrual_method,
        amount_value: data.accrual_method !== "unlimited" ? data.amount_value : null,
        granting_frequency:
          data.accrual_method === "fixed" || data.accrual_method === "periodic"
            ? data.granting_frequency
            : null,
        accrual_day: data.accrual_method === "periodic" ? data.accrual_day : null,
        anniversary_years:
          data.accrual_method === "anniversary" ? data.anniversary_years : null,
        new_hire_rule: data.new_hire_rule,
        waiting_period_value:
          data.new_hire_rule === "waiting_period" ? data.waiting_period_value : null,
        waiting_period_unit:
          data.new_hire_rule === "waiting_period" ? data.waiting_period_unit : null,
        carryover_limit_enabled: data.accrual_method === "unlimited" ? false : data.carryover_limit_enabled,
        carryover_max_days: data.accrual_method === "unlimited" || !data.carryover_limit_enabled ? null : data.carryover_max_days,
        carryover_expiration_value: data.accrual_method === "unlimited" || !data.carryover_limit_enabled ? null : data.carryover_expiration_value,
        carryover_expiration_unit: data.accrual_method === "unlimited" || !data.carryover_limit_enabled ? null : data.carryover_expiration_unit,
      },
    })

    addToast({ title: "Category updated" })
    navigate("/time-off-setup")
  }

  if (isLoading) {
    return (
      <div className="flex flex-col size-full">
        <div className="flex items-center gap-2 border-b border-border px-4 h-[60px] shrink-0">
          <button
            className="flex items-center justify-center size-7 rounded-[10px] shrink-0 text-foreground hover:bg-accent transition-colors"
            onClick={() => navigate("/time-off-setup")}
          >
            <FileClock className="size-4" />
          </button>
          <div className="flex items-center h-6 pr-2 relative shrink-0">
            <Separator orientation="vertical" />
          </div>
          <BreadcrumbItem
            text="Time-off setup"
            onClick={() => navigate("/time-off-setup")}
          />
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          <BreadcrumbItem
            text="Edit category"
            className="text-foreground font-medium"
          />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
        </div>
      </div>
    )
  }

  if (!category || !initialData) return null

  return (
    <div className="flex flex-col size-full">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 h-[60px] shrink-0">
        <button
          aria-label="Back to time-off setup"
          className="flex items-center justify-center size-7 rounded-[10px] shrink-0 text-foreground hover:bg-accent transition-colors"
          onClick={() => navigate("/time-off-setup")}
        >
          <FileClock className="size-4" />
        </button>
        <div className="flex items-center h-6 pr-2 relative shrink-0">
          <Separator orientation="vertical" />
        </div>
        <BreadcrumbItem
          text="Time-off setup"
          onClick={() => navigate("/time-off-setup")}
        />
        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        <BreadcrumbItem
          text="Edit category"
          className="text-foreground font-medium"
        />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <CategoryForm
          mode="edit"
          initialData={initialData}
          title="Edit category"
          subtitle="Update the rules for this time-off category"
          submitLabel="Save changes"
          onSubmit={handleSubmit}
          onCancel={() => navigate("/time-off-setup")}
          onDirtyChange={handleDirtyChange}
        />
      </div>
    </div>
  )
}
