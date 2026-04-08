import { useState, useMemo, useEffect, useCallback, memo, startTransition } from "react"
import { useNavigate } from "react-router-dom"
import {
  Users,
  UserPlus,
  UserSearch,
  Search,
  Eye,
  PencilLine,
  UserMinus,
  UserCheck,
  Trash2,
  EllipsisIcon,
  X,
  Upload,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { TabGroup } from "@/components/ui/tab-group"
import { DataTableHeaderCell } from "@/components/ui/data-table-header-cell"
import { DataTableCell } from "@/components/ui/data-table-cell"
import { Badge } from "@/components/ui/badge"
import { Empty } from "@/components/ui/empty"
import { DataTablePagination } from "@/components/ui/data-table-pagination"
import { Input } from "@/components/ui/input"
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
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import type { Profile } from "@/contexts/auth-context"
import {
  useEmployeeList,
  useEmployeeCounts,
  useEmployeeStatusMutation,
  useDeleteEmployeeMutation,
  useBulkEmployeeStatusMutation,
} from "@/hooks/use-employees"
import { useDepartments } from "@/hooks/use-departments"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn, getInitials, getDisplayName } from "@/lib/utils"
import { addToast } from "@/lib/toast"
import { employeeKeys, activeEmployeeKeys } from "@/lib/query-keys"
import { CsvImportModal } from "@/components/csv-import-modal"
import type { EmployeeStatus } from "@/types/employee"

type TabValue = EmployeeStatus

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr))
}

interface EmployeeRowProps {
  emp: Profile
  isLast: boolean
  isSelected: boolean
  departmentName: string
  debouncedSearch: string
  onToggleSelect: (id: string, checked: boolean) => void
  onNavigateToDetails: (id: string) => void
  onNavigateToEdit: (id: string) => void
  onDeactivate: (emp: Profile) => void
  onActivate: (emp: Profile) => void
  onDelete: (emp: Profile) => void
}

const EmployeeRow = memo(function EmployeeRow({
  emp,
  isLast,
  isSelected,
  departmentName,
  debouncedSearch,
  onToggleSelect,
  onNavigateToDetails,
  onNavigateToEdit,
  onDeactivate,
  onActivate,
  onDelete,
}: EmployeeRowProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)

  return (
    <div
      className={`flex hover:bg-muted/50${emp.status === "active" ? " cursor-pointer" : ""}`}
      onClick={() => {
        if (emp.status === "active") onNavigateToDetails(emp.id)
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <DataTableCell
          type="checkbox"
          size="md"
          className="w-10 pl-2"
          checked={isSelected}
          onCheckedChange={(checked) => onToggleSelect(emp.id, !!checked)}
          border={!isLast}
        />
      </div>
      <DataTableCell
        type="avatar"
        size="md"
        className="flex-1"
        avatarSrc={emp.avatar_url ?? undefined}
        avatarAlt={getDisplayName(emp.first_name, emp.last_name) || emp.email}
        avatarFallback={getInitials(emp.first_name, emp.last_name)}
        label={getDisplayName(emp.first_name, emp.last_name) || "—"}
        highlightQuery={debouncedSearch}
        border={!isLast}
      />
      <DataTableCell
        type="text"
        size="md"
        className="w-[260px]"
        label={emp.email}
        highlightQuery={debouncedSearch}
        border={!isLast}
      />
      <DataTableCell
        type="text"
        size="md"
        className="w-[180px]"
        labelClassName="font-medium"
        label={departmentName}
        border={!isLast}
      />
      <DataTableCell
        type="badge"
        size="md"
        className="w-[100px]"
        badgeNode={
          <Badge variant="secondary">
            {emp.role === "admin" ? "Admin" : "User"}
          </Badge>
        }
        border={!isLast}
      />
      <DataTableCell
        type="text"
        size="md"
        className="w-[160px]"
        label={emp.location ?? "—"}
        border={!isLast}
      />
      <DataTableCell
        type="text"
        size="md"
        className="w-[120px]"
        label={formatDate(emp.hire_date)}
        border={!isLast}
      />
      <div
        className="relative flex items-center justify-center w-[56px] h-[72px] px-3 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <EllipsisIcon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="p-0 border-0 shadow-none">
            <ComboboxMenu
              groups={
                emp.status === "active"
                  ? [
                      {
                        items: [
                          {
                            type: "icon",
                            icon: <Eye className="size-4" />,
                            label: "View details",
                            onClick: () => {
                              setPopoverOpen(false)
                              onNavigateToDetails(emp.id)
                            },
                          },
                          {
                            type: "icon",
                            icon: <PencilLine className="size-4" />,
                            label: "Edit details",
                            onClick: () => {
                              setPopoverOpen(false)
                              onNavigateToEdit(emp.id)
                            },
                          },
                          {
                            type: "icon",
                            icon: <UserMinus className="size-4" />,
                            label: "Deactivate",
                            onClick: () => {
                              setPopoverOpen(false)
                              onDeactivate(emp)
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
                              setPopoverOpen(false)
                              onDelete(emp)
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
                              setPopoverOpen(false)
                              onActivate(emp)
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
                              setPopoverOpen(false)
                              onDelete(emp)
                            },
                          },
                        ],
                      },
                    ]
              }
            />
          </PopoverContent>
        </Popover>
        {!isLast && <div className="absolute bottom-0 left-0 right-0 border-b border-border" />}
      </div>
    </div>
  )
})

export function EmployeesPage() {
  const navigate = useNavigate()
  const { profile: currentProfile, workspace } = useAuth()

  const [activeTab, setActiveTab] = useState<TabValue>("active")
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearch = useDebouncedValue(searchQuery, 300)

  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)

  // Query hooks
  const { data: employees = [], isLoading: loading, isError, refetch } = useEmployeeList(activeTab)
  const { data: counts = { active: 0, inactive: 0, deleted: 0 } } = useEmployeeCounts()
  const { data: departments = [] } = useDepartments()
  const statusMutation = useEmployeeStatusMutation()
  const deleteMutation = useDeleteEmployeeMutation()
  const bulkMutation = useBulkEmployeeStatusMutation()
  const queryClient = useQueryClient()

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  // CSV import modal state
  const [importOpen, setImportOpen] = useState(false)

  const departmentMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of departments) {
      map.set(d.id, d.name)
    }
    return map
  }, [departments])

  // Filter out workspace owner and apply search
  const filteredEmployees = useMemo(() => {
    let list = employees as Profile[]
    if (currentProfile) {
      list = list.filter((e) => e.id !== currentProfile.id)
    }
    if (!debouncedSearch.trim()) return list
    const q = debouncedSearch.toLowerCase()
    return list.filter(
      (e) =>
        getDisplayName(e.first_name, e.last_name).toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q)
    )
  }, [employees, debouncedSearch, currentProfile])

  // Adjust counts to exclude workspace owner
  const adjustedCounts = useMemo(() => {
    if (!currentProfile) return counts
    const adjusted = { ...counts }
    if (adjusted[currentProfile.status] > 0) {
      adjusted[currentProfile.status] -= 1
    }
    return adjusted
  }, [counts, currentProfile])

  useEffect(() => {
    setCurrentPage(1)
  }, [activeTab, debouncedSearch])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [activeTab])

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedEmployees = useMemo(
    () => filteredEmployees.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredEmployees, safePage, pageSize]
  )

  const allPageSelected =
    paginatedEmployees.length > 0 &&
    paginatedEmployees.every((e) => selectedIds.has(e.id))

  const somePageSelected =
    paginatedEmployees.some((e) => selectedIds.has(e.id)) && !allPageSelected

  const tabItems = [
    { value: "active", label: "Active", badge: adjustedCounts.active || undefined },
    {
      value: "inactive",
      label: "Inactive",
      badge: adjustedCounts.inactive || undefined,
    },
    { value: "deleted", label: "Deleted", badge: adjustedCounts.deleted || undefined },
  ]

  const handleToggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      checked ? next.add(id) : next.delete(id)
      return next
    })
  }, [])

  const handleNavigateToDetails = useCallback((id: string) => {
    navigate(`/employees/${id}`)
  }, [navigate])

  const handleNavigateToEdit = useCallback((id: string) => {
    navigate(`/employees/${id}/edit`, { state: { from: "list" } })
  }, [navigate])

  const handleAddEmployee = useCallback(() => {
    navigate("/employees/new")
  }, [navigate])

  const handleDeactivate = useCallback((emp: Profile) => {
    statusMutation.mutate(
      { employeeId: emp.id, status: "inactive" },
      {
        onSuccess: () => {
          addToast({
            title: "Employee deactivated",
            description: `${getDisplayName(emp.first_name, emp.last_name) || emp.email} has been deactivated`,
          })
        },
      }
    )
  }, [statusMutation])

  const handleActivate = useCallback((emp: Profile) => {
    statusMutation.mutate(
      { employeeId: emp.id, status: "active" },
      {
        onSuccess: () => {
          addToast({
            title: "Employee activated",
            description: `${getDisplayName(emp.first_name, emp.last_name) || emp.email} is now back in the Active list`,
          })
        },
      }
    )
  }, [statusMutation])

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        addToast({
          title: "Employee deleted",
          description: `${getDisplayName(deleteTarget.first_name, deleteTarget.last_name) || deleteTarget.email} has been deleted`,
        })
        setDeleteTarget(null)
      },
    })
  }, [deleteTarget, deleteMutation])

  const handleClearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const handleBulkDeactivate = useCallback(() => {
    if (!workspace) return
    const ids = [...selectedIds]
    queryClient.setQueryData(
      employeeKeys.list(workspace.id, "active"),
      (old: Profile[] | undefined) => (old ?? []).filter((e) => !ids.includes(e.id))
    )
    setSelectedIds(new Set())
    bulkMutation.mutate(
      { ids, status: "inactive" },
      {
        onSuccess: () => {
          addToast({
            title: `Successfully deactivated ${ids.length} employee${ids.length > 1 ? "s" : ""}`,
            variant: "success",
          })
        },
        onError: () => {
          queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
          addToast({ title: "Failed to deactivate employees", variant: "error" })
        },
      }
    )
  }, [selectedIds, workspace, queryClient, bulkMutation])

  const handleBulkDeleteConfirm = useCallback(() => {
    if (!workspace) return
    const ids = [...selectedIds]
    queryClient.setQueryData(
      employeeKeys.list(workspace.id, activeTab),
      (old: Profile[] | undefined) => (old ?? []).filter((e) => !ids.includes(e.id))
    )
    setSelectedIds(new Set())
    setBulkDeleteOpen(false)
    bulkMutation.mutate(
      { ids, status: "deleted" },
      {
        onSuccess: () => {
          addToast({
            title: `Successfully deleted ${ids.length} employee${ids.length > 1 ? "s" : ""}`,
            variant: "success",
          })
        },
        onError: () => {
          queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
          addToast({ title: "Failed to delete employees", variant: "error" })
        },
      }
    )
  }, [selectedIds, workspace, queryClient, bulkMutation, activeTab])

  return (
    <div className="flex flex-col size-full">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 h-[60px] shrink-0">
        <button className="flex items-center justify-center size-7 rounded-[10px] shrink-0 text-foreground hover:bg-accent transition-colors">
          <Users className="size-4" />
        </button>
        <div className="flex items-center h-6 pr-2 relative shrink-0">
          <Separator orientation="vertical" />
        </div>
        <BreadcrumbItem
          text="Employees"
          className="flex-1 text-foreground font-medium"
        />
        <Button variant="secondary" onClick={() => setImportOpen(true)}>
          Import CSV
        </Button>
        <Button onClick={handleAddEmployee}>
          <UserPlus />
          Add employee
        </Button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 p-4">
        {/* Controls */}
        <div className="flex items-center justify-between">
          <TabGroup
            value={activeTab}
            onValueChange={(v) => startTransition(() => setActiveTab(v as TabValue))}
            items={tabItems}
          />
          <div className="relative w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search for employees..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <div>
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Header row */}
          <div className="flex bg-secondary">
            <DataTableHeaderCell
              type="checkbox"
              className="w-10 pl-2"
              checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
              onCheckedChange={() => {
                if (allPageSelected) {
                  setSelectedIds((prev) => {
                    const next = new Set(prev)
                    paginatedEmployees.forEach((e) => next.delete(e.id))
                    return next
                  })
                } else {
                  setSelectedIds((prev) => {
                    const next = new Set(prev)
                    paginatedEmployees.forEach((e) => next.add(e.id))
                    return next
                  })
                }
              }}
            />
            <DataTableHeaderCell
              type="text"
              label="Employee"
              className="flex-1"
            />
            <DataTableHeaderCell
              type="text"
              label="Email"
              className="w-[260px]"
            />
            <DataTableHeaderCell
              type="text"
              label="Department"
              className="w-[180px]"
            />
            <DataTableHeaderCell
              type="text"
              label="Role"
              className="w-[100px]"
            />
            <DataTableHeaderCell
              type="text"
              label="Location"
              className="w-[160px]"
            />
            <DataTableHeaderCell
              type="text"
              label="Hire date"
              className="w-[120px]"
            />
            <DataTableHeaderCell type="text" className="w-[56px]" />
          </div>

          {/* Body */}
          {loading && filteredEmployees.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
            </div>
          ) : isError && filteredEmployees.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Empty
                media={{ type: "icon", icon: UserSearch }}
                title="Unable to load employees"
                description="Something went wrong. Please try again."
                content={{
                  layout: "single",
                  primaryAction: {
                    label: "Retry",
                    onClick: () => refetch(),
                  },
                }}
              />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Empty
                media={{ type: "icon", icon: UserSearch }}
                title={
                  searchQuery
                    ? "No employees found"
                    : activeTab === "inactive"
                      ? "No inactive employees"
                      : activeTab === "deleted"
                        ? "No deleted employees"
                        : "No employees added yet"
                }
                description={
                  searchQuery
                    ? "Try adjusting your search terms"
                    : activeTab === "inactive"
                      ? "Currently, all team members have an active status. You can change an employee's status to 'Inactive' in their profile if they are on long-term leave or leaving the company."
                      : activeTab === "deleted"
                        ? "Currently, there are no deleted user records in this workspace. When you delete an employee, their profile and history will be moved here for record-keeping purposes."
                        : "Start building your team to manage their time off, balances, and accrual rules"
                }
                content={
                  searchQuery || activeTab === "inactive" || activeTab === "deleted"
                    ? undefined
                    : {
                        layout: "single",
                        primaryAction: {
                          label: "Add employee",
                          icon: UserPlus,
                          onClick: handleAddEmployee,
                        },
                      }
                }
              />
            </div>
          ) : (
            <div>
              {paginatedEmployees.map((emp, index) => (
                <EmployeeRow
                  key={emp.id}
                  emp={emp}
                  isLast={index === paginatedEmployees.length - 1}
                  isSelected={selectedIds.has(emp.id)}
                  departmentName={emp.department_id ? departmentMap.get(emp.department_id) ?? "—" : "—"}
                  debouncedSearch={debouncedSearch}
                  onToggleSelect={handleToggleSelect}
                  onNavigateToDetails={handleNavigateToDetails}
                  onNavigateToEdit={handleNavigateToEdit}
                  onDeactivate={handleDeactivate}
                  onActivate={handleActivate}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </div>

        {filteredEmployees.length > 10 && (
          <DataTablePagination
            type="detailed"
            selectedCount={selectedIds.size}
            totalRows={filteredEmployees.length}
            rowsPerPage={String(pageSize)}
            onRowsPerPageChange={(v) => { setPageSize(Number(v)); setCurrentPage(1) }}
            rowsPerPageOptions={["10", "20", "30", "50"]}
            currentPage={safePage}
            totalPages={totalPages}
            canPrevious={safePage > 1}
            canNext={safePage < totalPages}
            onFirstPage={() => setCurrentPage(1)}
            onPrevious={() => setCurrentPage((p) => Math.max(1, p - 1))}
            onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            onLastPage={() => setCurrentPage(totalPages)}
          />
        )}
        </div>
      </div>

      {/* Floating Bulk Action Bar */}
      <div
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
          "flex items-center gap-1 p-1",
          "bg-neutral-900 text-white rounded-xl shadow-2xl border border-white/10",
          "transition-all duration-200 ease-out",
          selectedIds.size > 0
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-3 pointer-events-none"
        )}
      >
        {/* Left: X icon + count — clicking clears selection */}
        <button
          onClick={handleClearSelection}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] hover:bg-white/10 transition-colors"
        >
          <X className="size-3.5 text-slate-300 shrink-0" />
          <span className="text-sm font-medium whitespace-nowrap text-slate-300">{selectedIds.size} selected</span>
        </button>

        <div className="w-px h-4 bg-white/20 shrink-0 mx-1" />

        {/* Deactivate (active tab only) */}
        {activeTab === "active" && (
          <>
            <button
              onClick={handleBulkDeactivate}
              disabled={bulkMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] hover:bg-white/10 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <UserMinus className="size-3.5 text-slate-300 shrink-0" />
              <span className="text-sm font-medium">Deactivate</span>
            </button>
            <div className="w-px h-4 bg-white/20 shrink-0 mx-1" />
          </>
        )}

        {/* Delete */}
        <button
          onClick={() => setBulkDeleteOpen(true)}
          disabled={bulkMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] hover:bg-white/10 transition-colors disabled:opacity-50 whitespace-nowrap text-red-400 hover:text-red-300"
        >
          <Trash2 className="size-3.5 shrink-0" />
          <span className="text-sm font-medium">Delete</span>
        </button>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              {deleteTarget
                ? getDisplayName(
                    deleteTarget.first_name,
                    deleteTarget.last_name
                  ) || deleteTarget.email
                : ""}
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Bulk delete confirmation dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} employee{selectedIds.size !== 1 ? "s" : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.size} employee{selectedIds.size !== 1 ? "s" : ""}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDeleteConfirm}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CSV Import Modal */}
      <CsvImportModal open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
