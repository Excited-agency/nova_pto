import { useState, useEffect, useMemo } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Users, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"

import { useAuth } from "@/hooks/use-auth"
import { useEmployee, useEmployeeStatusMutation, useDeleteEmployeeMutation } from "@/hooks/use-employees"
import { useEmployeeBalances, useUpdateEmployeeBalancesMutation } from "@/hooks/use-time-off-requests"
import { useTimeOffCategories } from "@/hooks/use-time-off-categories"
import { useDepartments } from "@/hooks/use-departments"
import { addToast } from "@/lib/toast"
import { formatDate } from "@/lib/date-utils"
import { getDisplayName, getInitials } from "@/lib/utils"
import { EmployeeInfoCard } from "@/components/employees/employee-info-card"

export function EmployeeDetailsPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const { user, profile: viewerProfile } = useAuth()
  const { data: employee, isLoading, isError } = useEmployee(id)
  const { data: categories = [] } = useTimeOffCategories()
  const { data: balances = [] } = useEmployeeBalances(id)
  const { data: departments = [] } = useDepartments()

  const statusMutation = useEmployeeStatusMutation()
  const deleteMutation = useDeleteEmployeeMutation()
  const updateBalancesMutation = useUpdateEmployeeBalancesMutation()

  const [balanceValues, setBalanceValues] = useState<Record<string, string>>({})
  const [initialValues, setInitialValues] = useState<Record<string, string>>({})

  const activeCategories = useMemo(
    () => categories.filter((c) => c.is_active),
    [categories]
  )

  // Build balance map: categoryId → remaining_days
  const balanceMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of balances) {
      map.set(b.category_id, b.remaining_days)
    }
    return map
  }, [balances])

  // Initialize balance input values when data loads
  useEffect(() => {
    if (activeCategories.length === 0) return

    const vals: Record<string, string> = {}
    for (const cat of activeCategories) {
      if (cat.accrual_method === "unlimited") continue
      const days = balanceMap.get(cat.id)
      vals[cat.id] = days !== undefined ? String(days) : "0"
    }
    setBalanceValues(vals)
    setInitialValues(vals)
  }, [activeCategories, balanceMap])

  useEffect(() => {
    if (isError) {
      addToast({ title: "Employee not found", description: "Couldn't load this employee." })
      navigate("/employees")
    }
  }, [isError, navigate])

  const isDirty = useMemo(() => {
    return Object.keys(balanceValues).some(
      (key) => balanceValues[key] !== initialValues[key]
    )
  }, [balanceValues, initialValues])

  function handleBalanceChange(categoryId: string, value: string) {
    // Allow empty string, digits, and single decimal point
    if (value !== "" && !/^\d*\.?\d*$/.test(value)) return
    setBalanceValues((prev) => ({ ...prev, [categoryId]: value }))
  }

  async function handleSave() {
    if (!id) return

    const updates: { categoryId: string; remainingDays: number }[] = []
    for (const [categoryId, value] of Object.entries(balanceValues)) {
      if (value !== initialValues[categoryId]) {
        const parsed = parseFloat(value)
        if (isNaN(parsed) || parsed < 0) {
          addToast({ title: "Invalid value", description: "Enter valid numbers for all balances." })
          return
        }
        updates.push({ categoryId, remainingDays: parsed })
      }
    }

    if (updates.length === 0) return

    await updateBalancesMutation.mutateAsync({ employeeId: id, updates })
    setInitialValues({ ...balanceValues })
    addToast({ title: "Balances updated", description: "Leave balances saved." })
  }

  function handleDeactivate() {
    if (!id) return
    statusMutation.mutate(
      { employeeId: id, status: "inactive" },
      {
        onSuccess: () => {
          addToast({ title: "Employee deactivated" })
          navigate("/employees")
        },
      }
    )
  }

  function handleActivate() {
    if (!id) return
    statusMutation.mutate(
      { employeeId: id, status: "active" },
      {
        onSuccess: () => {
          addToast({ title: "Employee activated" })
          navigate("/employees")
        },
      }
    )
  }

  function handleDelete() {
    if (!id) return
    deleteMutation.mutate(id, {
      onSuccess: () => {
        addToast({ title: "Employee deleted" })
        navigate("/employees")
      },
    })
  }

  const displayName = employee ? getDisplayName(employee.first_name, employee.last_name) : ""
  const initials = employee ? getInitials(employee.first_name, employee.last_name) : undefined
  const departmentName = employee?.department_id
    ? departments.find((d) => d.id === employee.department_id)?.name ?? "—"
    : "—"

  // Header (shared between loading and loaded states)
  const header = (
    <div className="flex items-center gap-2 border-b border-border px-4 h-[60px] shrink-0">
      <button
        className="flex items-center justify-center size-7 rounded-[10px] shrink-0 text-foreground hover:bg-accent transition-colors"
        onClick={() => navigate("/employees")}
      >
        <Users className="size-4" />
      </button>
      <div className="flex items-center h-6 pr-2 relative shrink-0">
        <Separator orientation="vertical" />
      </div>
      <BreadcrumbItem
        text="Employees"
        onClick={() => navigate("/employees")}
      />
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
      <BreadcrumbItem
        text="Employee details"
        className="text-foreground font-medium"
      />
    </div>
  )

  if (isLoading) {
    return (
      <div className="flex flex-col size-full">
        {header}
        <div className="flex-1 flex items-center justify-center">
          <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
        </div>
      </div>
    )
  }

  if (!employee) return null

  const isActive = employee.status === "active"
  const isViewedEmployeeOwner = employee.role === "owner"
  const isSelfView = user?.id === employee.id
  const viewerIsOwner = viewerProfile?.role === "owner"
  // Admin can't manage the owner; owner can manage anyone
  const canManage = !(isViewedEmployeeOwner && !viewerIsOwner)

  return (
    <div className="flex flex-col size-full">
      {header}

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-6 pt-6 pb-8 px-4">
          {/* Employee header */}
          <EmployeeInfoCard
            displayName={displayName}
            email={employee.email}
            avatarUrl={employee.avatar_url}
            initials={initials}
            role={employee.role}
            isActive={isActive}
            canManage={canManage}
            isSelfView={isSelfView}
            onEdit={() => navigate(`/employees/${id}/edit`, { state: { from: "details" } })}
            onDeactivate={handleDeactivate}
            onActivate={handleActivate}
            onDelete={handleDelete}
          />

          {!isSelfView && !(viewerProfile?.role === "admin" && isViewedEmployeeOwner) && (
            <>
              <div className="w-[600px]"><Separator /></div>

              {/* Overview section */}
              <div className="flex flex-col gap-4 w-[600px]">
                <p className="text-base font-semibold leading-6 tracking-tight text-foreground">
                  Overview
                </p>
                <div className="flex flex-col gap-3 text-sm font-medium leading-5 tracking-tight">
                  <div className="flex gap-3">
                    <p className="w-[294px] text-muted-foreground truncate">Department</p>
                    <p className="text-foreground truncate">{departmentName}</p>
                  </div>
                  <div className="flex gap-3">
                    <p className="w-[294px] text-muted-foreground truncate">Location</p>
                    <p className="text-foreground truncate">{employee.location ?? "—"}</p>
                  </div>
                  <div className="flex gap-3">
                    <p className="w-[294px] text-muted-foreground truncate">Hire date</p>
                    <p className="text-foreground truncate">{formatDate(employee.hire_date)}</p>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="w-[600px]"><Separator /></div>

          {/* Leave balance section */}
          <div className="flex flex-col gap-4 w-[600px]">
            <p className="text-base font-semibold leading-6 tracking-tight text-foreground">
              Leave balance
            </p>
            <div className="flex flex-col gap-3">
              {activeCategories.map((cat) => {
                const isUnlimited = cat.accrual_method === "unlimited"
                return canManage ? (
                  <div key={cat.id} className="flex items-center gap-3">
                    <p className="flex-1 min-w-0 text-sm font-medium leading-5 tracking-tight text-foreground truncate">
                      {cat.name} {cat.emoji ?? ""}
                    </p>
                    <div className="flex-1 min-w-0 flex justify-end">
                      <Input
                        value={isUnlimited ? "" : (balanceValues[cat.id] ?? "")}
                        placeholder={isUnlimited ? "Unlimited" : "0"}
                        disabled={isUnlimited}
                        onChange={(e) => handleBalanceChange(cat.id, e.target.value)}
                        className="w-full"
                      />
                    </div>
                  </div>
                ) : (
                  <div key={cat.id} className="flex gap-3">
                    <p className="w-[294px] text-sm font-medium leading-5 tracking-tight text-foreground truncate">
                      {cat.name} {cat.emoji ?? ""}
                    </p>
                    <p className="text-sm font-medium leading-5 tracking-tight text-foreground">
                      {isUnlimited ? "Unlimited" : (balanceMap.get(cat.id) ?? 0)}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Action buttons */}
          {canManage && (
            <div className="flex items-center justify-between pt-3 w-[600px]">
              <Button
                variant="secondary"
                disabled={!isDirty}
                onClick={() => navigate("/employees")}
              >
                Cancel
              </Button>
              <Button
                disabled={!isDirty}
                loading={updateBalancesMutation.isPending}
                onClick={handleSave}
              >
                Save changes
              </Button>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
