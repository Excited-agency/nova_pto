import { useNavigate } from "react-router-dom"
import { FileClock, ChevronRight } from "lucide-react"

import { Separator } from "@/components/ui/separator"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import { CategoryForm } from "@/components/category-form"
import { categoryFormDefaults, type CategoryFormValues } from "@/lib/category-form-schema"
import { useAuth } from "@/hooks/use-auth"
import {
  useTimeOffCategories,
  useCreateCategoryMutation,
} from "@/hooks/use-time-off-categories"
import { addToast } from "@/lib/toast"

export function AddCategoryPage() {
  const navigate = useNavigate()
  const { workspace } = useAuth()
  const { data: categories = [] } = useTimeOffCategories()
  const createMutation = useCreateCategoryMutation()

  async function handleSubmit(data: CategoryFormValues) {
    if (!workspace) return

    const nextSortOrder =
      categories.length > 0
        ? Math.max(...categories.map((c) => c.sort_order)) + 1
        : 0

    await createMutation.mutateAsync({
      workspace_id: workspace.id,
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
      sort_order: nextSortOrder,
    })

    addToast({
      title: "Category created",
      description: `${data.name} has been added.`,
    })
    navigate("/time-off-setup")
  }

  return (
    <div className="flex flex-col size-full">
      {/* Header */}
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
          text="Add new time-off category"
          className="text-foreground font-medium"
        />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <CategoryForm
          mode="add"
          initialData={categoryFormDefaults}
          title="Add new time-off category"
          subtitle="Define the rules and accrual limits for this leave type"
          submitLabel="Add category"
          onSubmit={handleSubmit}
          onCancel={() => navigate("/time-off-setup")}
        />
      </div>
    </div>
  )
}
