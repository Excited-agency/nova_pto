import { useState, useEffect, useMemo } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  Users,
  ChevronRight,
  ChevronDown,
  PencilLine,
  UserMinus,
  UserCheck,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Avatar } from "@/components/ui/avatar"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { ComboboxMenu } from "@/components/ui/combobox-menu"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"

import { useEmployee, useEmployeeStatusMutation, useDeleteEmployeeMutation } from "@/hooks/use-employees"
import { useEmployeeBalances, useUpdateEmployeeBalancesMutation } from "@/hooks/use-time-off-requests"
import { useTimeOffCategories } from "@/hooks/use-time-off-categories"
import { useDepartments } from "@/hooks/use-departments"
import { addToast } from "@/lib/toast"
import { formatDate } from "@/lib/date-utils"
import { getDisplayName, getInitials } from "@/lib/utils"
import type { Profile } from "@/contexts/auth-context"

export function EmployeeDetailsPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const { data: employee, isLoading, isError } = useEmployee(id)
  const { data: categories = [] } = useTimeOffCategories()
  const { data: balances = [] } = useEmployeeBalances(id)
  const { data: departments = [] } = useDepartments()

  const statusMutation = useEmployeeStatusMutation()
  const deleteMutation = useDeleteEmployeeMutation()
  const updateBalancesMutation = useUpdateEmployeeBalancesMutation()

  const [actionsOpen, setActionsOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
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

  const emp = employee as Profile | undefined
  const displayName = emp ? getDisplayName(emp.first_name, emp.last_name) : ""
  const initials = emp ? getInitials(emp.first_name, emp.last_name) : undefined
  const departmentName = emp?.department_id
    ? departments.find((d) => d.id === emp.department_id)?.name ?? "—"
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

  if (!emp) return null

  const isActive = emp.status === "active"

  return (
    <div className="flex flex-col size-full">
      {header}

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-6 pt-6 pb-8 px-4">
          {/* Employee header */}
          <div className="flex items-center gap-4 w-[600px]">
            <Avatar
              src={emp.avatar_url ?? undefined}
              alt={displayName}
              fallback={initials}
              size="xl"
              shape="square"
            />
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold leading-7 tracking-tight text-foreground">
                  {displayName || "—"}
                </p>
                <Badge variant="secondary">
                  {emp.role === "admin" ? "Admin" : "User"}
                </Badge>
              </div>
              <p className="text-sm leading-5 tracking-tight text-muted-foreground">
                {emp.email}
              </p>
            </div>

            {/* Actions dropdown */}
            <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="default">
                  Actions
                  <ChevronDown className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="p-0 border-0 shadow-none">
                <ComboboxMenu
                  groups={
                    isActive
                      ? [
                          {
                            items: [
                              {
                                type: "icon",
                                icon: <PencilLine className="size-4" />,
                                label: "Edit details",
                                onClick: () => {
                                  setActionsOpen(false)
                                  navigate(`/employees/${id}/edit`, { state: { from: "details" } })
                                },
                              },
                              {
                                type: "icon",
                                icon: <UserMinus className="size-4" />,
                                label: "Deactivate",
                                onClick: () => {
                                  setActionsOpen(false)
                                  handleDeactivate()
                                },
                              },
                            ],
                          },
                          {
                            items: [
                              {
                                type: "icon",
                                variant: "destructive",
                                icon: <Trash2 className="size-4" />,
                                label: "Delete employee",
                                onClick: () => {
                                  setActionsOpen(false)
                                  setDeleteDialogOpen(true)
                                },
                              },
                            ],
                          },
                        ]
                      : [
                          {
                            items: [
                              {
                                type: "icon",
                                icon: <UserCheck className="size-4" />,
                                label: "Activate",
                                onClick: () => {
                                  setActionsOpen(false)
                                  handleActivate()
                                },
                              },
                            ],
                          },
                          {
                            items: [
                              {
                                type: "icon",
                                variant: "destructive",
                                icon: <Trash2 className="size-4" />,
                                label: "Delete employee",
                                onClick: () => {
                                  setActionsOpen(false)
                                  setDeleteDialogOpen(true)
                                },
                              },
                            ],
                          },
                        ]
                  }
                />
              </PopoverContent>
            </Popover>
          </div>

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
                <p className="text-foreground truncate">{emp.location ?? "—"}</p>
              </div>
              <div className="flex gap-3">
                <p className="w-[294px] text-muted-foreground truncate">Hire date</p>
                <p className="text-foreground truncate">{formatDate(emp.hire_date)}</p>
              </div>
            </div>
          </div>

          <div className="w-[600px]"><Separator /></div>

          {/* Leave balance section */}
          <div className="flex flex-col gap-4 w-[600px]">
            <p className="text-base font-semibold leading-6 tracking-tight text-foreground">
              Leave balance
            </p>
            <div className="flex flex-col gap-3">
              {activeCategories.map((cat) => {
                const isUnlimited = cat.accrual_method === "unlimited"
                return (
                  <div
                    key={cat.id}
                    className="flex items-center gap-3"
                  >
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
                )
              })}
            </div>
          </div>

          {/* Action buttons */}
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
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {displayName || emp.email}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
