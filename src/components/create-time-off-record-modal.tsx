import { useState, useEffect, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import { EmployeeCombobox } from "@/components/ui/employee-combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/hooks/use-auth"
import { useHolidays } from "@/hooks/use-holidays"
import { useTimeOffCategories } from "@/hooks/use-time-off-categories"
import {
  useActiveEmployees,
  useEmployeeBalances,
  useCreateTimeOffRecordMutation,
} from "@/hooks/use-time-off-requests"
import { addToast } from "@/lib/toast"
import { calculateDays, formatDays, formatLocalDate } from "@/lib/date-utils"
import type { TimeOffCategory } from "@/types/time-off-category"
import type { EmployeeBalance } from "@/types/employee-balance"
import type { StartPeriod, EndPeriod } from "@/types/time-off-request"

interface CreateTimeOffRecordModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialStartDate?: Date
}

function getBalanceText(
  cat: TimeOffCategory,
  balanceMap: Map<string, EmployeeBalance>
): string {
  if (cat.accrual_method === "unlimited") return "Unlimited"
  const entry = balanceMap.get(cat.id)
  if (entry) return `${entry.remaining_days} days`
  return "—"
}

function isItemDisabled(
  cat: TimeOffCategory,
  employeeId: string | undefined,
  balancesLoading: boolean,
  balanceMap: Map<string, EmployeeBalance>
): boolean {
  if (!employeeId || balancesLoading) return false
  if (cat.accrual_method === "unlimited") return false
  const entry = balanceMap.get(cat.id)
  return entry != null && entry.remaining_days <= 0
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function CreateTimeOffRecordModal({
  open,
  onOpenChange,
  initialStartDate,
}: CreateTimeOffRecordModalProps) {
  const { workspace, profile } = useAuth()
  const isAdmin = profile?.role === "admin"
  const { data: employees = [] } = useActiveEmployees()
  const { data: categories = [] } = useTimeOffCategories()
  const { data: holidayRows = [] } = useHolidays()
  const createMutation = useCreateTimeOffRecordMutation()

  const holidayDates = useMemo(
    () => holidayRows.map((h) => h.date),
    [holidayRows]
  )

  const [employeeId, setEmployeeId] = useState<string | undefined>()
  const [categoryId, setCategoryId] = useState<string | undefined>()
  const [startDate, setStartDate] = useState<Date | undefined>()
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [startPeriod, setStartPeriod] = useState<StartPeriod>("morning")
  const [endPeriod, setEndPeriod] = useState<EndPeriod>("end_of_day")
  const [comment, setComment] = useState("")

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      // Non-admins are always locked to their own profile
      if (!isAdmin && profile?.id) {
        setEmployeeId(profile.id)
      }
      // Pre-fill dates if an initial start date was provided
      if (initialStartDate) {
        setStartDate(initialStartDate)
        setEndDate(initialStartDate)
      }
    } else {
      setEmployeeId(undefined)
      setCategoryId(undefined)
      setStartDate(undefined)
      setEndDate(undefined)
      setStartPeriod("morning")
      setEndPeriod("end_of_day")
      setComment("")
    }
  }, [open, initialStartDate, isAdmin, profile?.id])

  // Fetch all balances for the selected employee
  const { data: balances = [], isLoading: balancesLoading } =
    useEmployeeBalances(employeeId)

  const balanceMap = useMemo(
    () => new Map(balances.map((b) => [b.category_id, b])),
    [balances]
  )

  // Filter to active categories only
  const activeCategories = useMemo(
    () => categories.filter((c) => c.is_active),
    [categories]
  )

  // Find the selected category for validation
  const selectedCategory = useMemo(
    () => activeCategories.find((c) => c.id === categoryId),
    [activeCategories, categoryId]
  )

  // Compute available end-period options based on dates and start period
  const endPeriodOptions = useMemo(() => {
    if (startDate && endDate && isSameDay(startDate, endDate)) {
      if (startPeriod === "midday") {
        return [{ value: "end_of_day" as const, label: "End of day" }]
      }
      // startPeriod === "morning", same day
      return [
        { value: "midday" as const, label: "Midday" },
        { value: "end_of_day" as const, label: "End of day" },
      ]
    }
    // Different days or dates not yet set
    return [
      { value: "midday" as const, label: "Midday" },
      { value: "end_of_day" as const, label: "End of day" },
    ]
  }, [startDate, endDate, startPeriod])

  // Auto-correct endPeriod when its available options change
  useEffect(() => {
    const validValues = endPeriodOptions.map((o) => o.value)
    if (!validValues.includes(endPeriod)) {
      setEndPeriod(validValues[0])
    }
  }, [endPeriodOptions, endPeriod])

  // Calculate total days (fractional, excluding weekends & holidays)
  const totalDays = useMemo(() => {
    if (!startDate || !endDate) return null
    if (endDate < startDate) return null
    return calculateDays(
      formatLocalDate(startDate),
      formatLocalDate(endDate),
      startPeriod,
      endPeriod,
      holidayDates
    )
  }, [startDate, endDate, startPeriod, endPeriod, holidayDates])

  // Validation
  const hasRequiredFields = !!employeeId && !!categoryId && !!startDate && !!endDate
  const isUnlimited = selectedCategory?.accrual_method === "unlimited"
  const selectedBalance = categoryId ? balanceMap.get(categoryId) : undefined
  const insufficientBalance =
    hasRequiredFields &&
    !isUnlimited &&
    totalDays != null &&
    selectedBalance != null &&
    totalDays > selectedBalance.remaining_days
  const noBalance =
    hasRequiredFields && !balancesLoading && selectedBalance == null && !isUnlimited
  const isValid =
    hasRequiredFields &&
    totalDays != null &&
    totalDays > 0 &&
    !insufficientBalance &&
    !noBalance &&
    !balancesLoading

  function handleSubmit() {
    if (!isValid || !workspace || !employeeId || !categoryId || !startDate || !endDate) return

    createMutation.mutate(
      {
        workspace_id: workspace.id,
        employee_id: employeeId,
        category_id: categoryId,
        start_date: formatLocalDate(startDate),
        end_date: formatLocalDate(endDate),
        start_period: startPeriod,
        end_period: endPeriod,
        comment: comment.trim() || null,
      },
      {
        onSuccess: () => {
          addToast({
            title: "Time-off record created",
            description: "The record has been added and the balance updated",
          })
          onOpenChange(false)
        },
        onError: (error) => {
          addToast({
            title: "Failed to create record",
            description: error.message,
            variant: "error",
          })
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!createMutation.isPending) onOpenChange(v) }}>
      <DialogContent className="max-w-[480px] gap-5">
        <DialogHeader>
          <DialogTitle>Create time-off record</DialogTitle>
          <DialogDescription>
            Recording time-off for a user reduces their balance and creates an
            approved request for the selected dates in the system
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Employee — admin only */}
          {isAdmin && (
            <Field label="Employee">
              <EmployeeCombobox
                employees={employees}
                value={employeeId}
                onChange={setEmployeeId}
              />
            </Field>
          )}

          {/* Time-off category */}
          <Field label="Time-off category">
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {activeCategories.map((cat) => {
                  const disabled = isItemDisabled(cat, employeeId, balancesLoading, balanceMap)
                  return (
                    <SelectItem key={cat.id} value={cat.id} disabled={disabled}>
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="font-medium">{cat.emoji ? `${cat.name} ${cat.emoji}` : cat.name}</span>
                        {employeeId && (
                          <span className="ml-2 shrink-0 font-normal text-muted-foreground text-xs">
                            {balancesLoading ? "..." : getBalanceText(cat, balanceMap)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </Field>

          {/* From date + period */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-3 items-end">
              <Field label="From" className="flex-1">
                <DatePicker
                  value={startDate}
                  onChange={setStartDate}
                  placeholder="Pick a date"
                />
              </Field>
              <div className="flex-1">
                <Select
                  value={startPeriod}
                  onValueChange={(v) => setStartPeriod(v as StartPeriod)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="morning">Morning</SelectItem>
                    <SelectItem value="midday">Midday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* To date + period */}
            <div className="flex gap-3 items-end">
              <Field label="To" className="flex-1">
                <DatePicker
                  value={endDate}
                  onChange={setEndDate}
                  placeholder="Pick a date"
                />
              </Field>
              <div className="flex-1">
                <Select
                  value={endPeriod}
                  onValueChange={(v) => setEndPeriod(v as EndPeriod)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {endPeriodOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Total days */}
            {totalDays != null && totalDays > 0 && (
              <p className="text-sm leading-5 tracking-tight text-muted-foreground">
                Total:{" "}
                <span className="font-medium text-foreground">
                  {formatDays(totalDays)}
                </span>
              </p>
            )}
            {/* Insufficient balance warning */}
            {insufficientBalance && (
              <p className="text-sm leading-5 tracking-tight text-destructive">
                Insufficient balance ({selectedBalance!.remaining_days} days available)
              </p>
            )}
          </div>

          {/* Comment */}
          <Field label="Comment">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Type any extra information"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid}
            loading={createMutation.isPending}
          >
            Create record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
