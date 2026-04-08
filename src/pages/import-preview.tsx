import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { Users, ChevronRight } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { Separator } from "@/components/ui/separator"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { DataTableHeaderCell } from "@/components/ui/data-table-header-cell"
import { DataTableCell } from "@/components/ui/data-table-cell"
import { rowHasErrors } from "@/lib/csv-validation"
import { inviteEmployee } from "@/lib/employee-service"
import { employeeKeys, departmentKeys, activeEmployeeKeys } from "@/lib/query-keys"
import { addToast } from "@/lib/toast"
import { cn, getInitials } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import type { CsvEmployeeRow, RowValidation, ImportRowResult } from "@/types/csv-import"

interface ImportPreviewState {
  rows: CsvEmployeeRow[]
  validationEntries: [number, RowValidation[]][]
  mappedColumnCount: number
}

export function ImportPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { workspace } = useAuth()
  const queryClient = useQueryClient()
  const cancelledRef = useRef(false)

  const state = location.state as ImportPreviewState | null
  const rows = state?.rows ?? []

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const validations = useMemo(() => new Map<number, RowValidation[]>(state?.validationEntries ?? []), [])

  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => {
    const valid = new Set<number>()
    for (const row of rows) {
      if (!rowHasErrors(row.index, validations)) valid.add(row.index)
    }
    return valid
  })

  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    if (!state) navigate("/employees", { replace: true })
  }, [state, navigate])

  // Derived values — computed before useCallback hooks so they can be used as deps
  const selectedCount = selectedIndices.size
  const errorCount = rows.filter((r) => rowHasErrors(r.index, validations)).length
  const selectableRows = rows.filter((r) => !rowHasErrors(r.index, validations))
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((r) => selectedIndices.has(r.index))
  const someSelected =
    selectableRows.some((r) => selectedIndices.has(r.index)) && !allSelected

  const toggleRow = useCallback(
    (index: number) => {
      if (rowHasErrors(index, validations)) return
      setSelectedIndices((prev) => {
        const next = new Set(prev)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      })
    },
    [validations]
  )

  const toggleAll = useCallback(() => {
    const everySelected = selectableRows.every((r) => selectedIndices.has(r.index))
    setSelectedIndices((prev) => {
      const next = new Set(prev)
      if (everySelected) selectableRows.forEach((r) => next.delete(r.index))
      else selectableRows.forEach((r) => next.add(r.index))
      return next
    })
  }, [selectableRows, selectedIndices])

  if (!state) return null

  async function handleImport() {
    const selectedRows = rows.filter((r) => selectedIndices.has(r.index))
    if (selectedRows.length === 0) return

    cancelledRef.current = false
    setIsImporting(true)

    const results: ImportRowResult[] = []

    for (const row of selectedRows) {
      if (cancelledRef.current) break
      try {
        await inviteEmployee({
          email: row.email,
          first_name: row.first_name || undefined,
          last_name: row.last_name || undefined,
          role: row.role || "user",
          department_id: row.department_id || null,
          location: row.location || undefined,
          hire_date: row.hire_date || undefined,
        })
        results.push({ index: row.index, email: row.email, status: "success" })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        console.error(`Import failed for ${row.email}:`, message)
        results.push({ index: row.index, email: row.email, status: "error", error: message })
      }
    }

    const successCount = results.filter((r) => r.status === "success").length
    const failures = results.filter((r) => r.status === "error")

    if (workspace) {
      queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
      queryClient.invalidateQueries({ queryKey: departmentKeys.all(workspace.id) })
      queryClient.invalidateQueries({ queryKey: activeEmployeeKeys.list(workspace.id) })
    }

    // Group failures by error message for a concise summary
    let description: string
    if (failures.length === 0) {
      description = "All employees imported successfully"
    } else {
      const errorCounts = new Map<string, number>()
      for (const f of failures) {
        const msg = f.error ?? "Unknown error"
        errorCounts.set(msg, (errorCounts.get(msg) ?? 0) + 1)
      }
      description = Array.from(errorCounts.entries())
        .map(([msg, count]) => `${count} failed: ${msg}`)
        .join(". ")
    }

    addToast({
      title:
        successCount > 0
          ? `${successCount} employee${successCount !== 1 ? "s" : ""} added`
          : "Import failed",
      description,
      variant: failures.length > 0 && successCount === 0 ? "error" : successCount > 0 ? "success" : undefined,
      duration: failures.length > 0 ? 8000 : 5000,
    })

    navigate("/employees")
  }

  return (
    <div className="flex flex-col size-full">
      {/* Header */}
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
        <BreadcrumbItem text="Employees" onClick={() => navigate("/employees")} />
        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        <BreadcrumbItem text="Import employees" className="text-foreground font-medium" />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-4 px-6 py-6">
        {/* Title + actions */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Preview import</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              We&apos;ve mapped your file data and found {rows.length} employee{rows.length !== 1 ? "s" : ""}
              {errorCount > 0 && (
                <>
                  {" "}&middot;{" "}
                  <span className="text-destructive">{errorCount} with errors</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              onClick={() => navigate("/employees")}
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button
              disabled={selectedCount === 0 || isImporting}
              loading={isImporting}
              onClick={handleImport}
            >
              Add {selectedCount} employee{selectedCount !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Header row */}
          <div className="flex bg-secondary">
            <DataTableHeaderCell
              type="checkbox"
              className="w-10 pl-2"
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={toggleAll}
            />
            <DataTableHeaderCell type="text" label="Employee" className="flex-1 min-w-[160px]" />
            <DataTableHeaderCell type="text" label="Email" className="w-[260px]" />
            <DataTableHeaderCell type="text" label="Department" className="w-[180px]" />
            <DataTableHeaderCell type="text" label="Role" className="w-[100px]" />
            <DataTableHeaderCell type="text" label="Location" className="w-[160px]" />
            <DataTableHeaderCell type="text" label="Hire date" className="w-[120px]" />
          </div>

          {/* Body rows */}
          <div>
            {rows.map((row, idx) => {
              const hasError = rowHasErrors(row.index, validations)
              const isSelected = selectedIndices.has(row.index)
              const isLast = idx === rows.length - 1
              const displayName =
                [row.first_name, row.last_name].filter(Boolean).join(" ") || "—"

              return (
                <div
                  key={row.index}
                  className={cn("flex", hasError && "bg-destructive/5")}
                >
                  {/* Checkbox */}
                  <div className="relative w-10 shrink-0 flex items-center justify-center pl-2">
                    <Checkbox
                      checked={isSelected}
                      disabled={hasError}
                      onCheckedChange={() => toggleRow(row.index)}
                    />
                    {!isLast && <div className="absolute bottom-0 left-0 right-0 border-b border-border" />}
                  </div>

                  {/* Employee (avatar + name) */}
                  <DataTableCell
                    type="avatar"
                    size="md"
                    className="flex-1"
                    avatarFallback={getInitials(row.first_name, row.last_name)}
                    label={displayName}
                    border={!isLast}
                  />

                  {/* Email */}
                  <DataTableCell
                    type="text"
                    size="md"
                    className="w-[260px]"
                    label={row.email || "—"}
                    border={!isLast}
                  />

                  {/* Department */}
                  <DataTableCell
                    type="text"
                    size="md"
                    className="w-[180px]"
                    label={row.department || "—"}
                    labelClassName="font-medium"
                    border={!isLast}
                  />

                  {/* Role */}
                  <DataTableCell
                    type="badge"
                    size="md"
                    className="w-[100px]"
                    badgeNode={
                      <Badge variant="secondary">
                        {row.role === "admin" ? "Admin" : "User"}
                      </Badge>
                    }
                    border={!isLast}
                  />

                  {/* Location */}
                  <DataTableCell
                    type="text"
                    size="md"
                    className="w-[160px]"
                    label={row.location || "—"}
                    border={!isLast}
                  />

                  {/* Hire date */}
                  <DataTableCell
                    type="text"
                    size="md"
                    className="w-[120px]"
                    label={row.hire_date || "—"}
                    border={!isLast}
                  />
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
