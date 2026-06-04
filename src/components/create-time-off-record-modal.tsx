import { useEffect, useMemo } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
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
import { calculateDays, formatDays, formatLocalDate, isSameDay } from "@/lib/date-utils"
import { getBalanceText } from "@/lib/balance-utils"
import type { TimeOffCategory } from "@/types/time-off-category"
import type { EmployeeBalance } from "@/types/employee-balance"

interface CreateTimeOffRecordModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialStartDate?: Date
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

const createRecordSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  categoryId: z.string().min(1, "Category is required"),
  startDate: z.date({ required_error: "Start date is required" }),
  endDate: z.date({ required_error: "End date is required" }),
  startPeriod: z.enum(["morning", "midday"]),
  endPeriod: z.enum(["midday", "end_of_day"]),
  comment: z.string(),
})

type CreateRecordFormData = z.infer<typeof createRecordSchema>

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

  const { control, handleSubmit, reset, watch, setValue } = useForm<CreateRecordFormData>({
    resolver: zodResolver(createRecordSchema),
    defaultValues: {
      employeeId: "",
      categoryId: "",
      startDate: undefined,
      endDate: undefined,
      startPeriod: "morning",
      endPeriod: "end_of_day",
      comment: "",
    },
  })

  const employeeId = watch("employeeId")
  const categoryId = watch("categoryId")
  const startDate = watch("startDate")
  const endDate = watch("endDate")
  const startPeriod = watch("startPeriod")
  const endPeriod = watch("endPeriod")
  const comment = watch("comment")

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      // Non-admins are always locked to their own profile
      if (!isAdmin && profile?.id) {
        setValue("employeeId", profile.id)
      }
      // Pre-fill dates if an initial start date was provided
      if (initialStartDate) {
        setValue("startDate", initialStartDate)
        setValue("endDate", initialStartDate)
      }
    } else {
      reset({
        employeeId: "",
        categoryId: "",
        startDate: undefined,
        endDate: undefined,
        startPeriod: "morning",
        endPeriod: "end_of_day",
        comment: "",
      })
    }
  }, [open, initialStartDate, isAdmin, profile?.id, reset, setValue])

  // Fetch all balances for the selected employee
  const { data: balances = [], isLoading: balancesLoading } =
    useEmployeeBalances(employeeId || undefined)

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
      setValue("endPeriod", validValues[0])
    }
  }, [endPeriodOptions, endPeriod, setValue])

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

  const onSubmit = handleSubmit((data) => {
    if (!isValid || !workspace) return

    createMutation.mutate(
      {
        workspace_id: workspace.id,
        employee_id: data.employeeId,
        category_id: data.categoryId,
        start_date: formatLocalDate(data.startDate),
        end_date: formatLocalDate(data.endDate),
        start_period: data.startPeriod,
        end_period: data.endPeriod,
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
            title: "Couldn't create record",
            description: error.message,
            variant: "error",
          })
        },
      }
    )
  })

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
              <Controller
                name="employeeId"
                control={control}
                render={({ field }) => (
                  <EmployeeCombobox
                    employees={employees}
                    value={field.value || undefined}
                    onChange={(v) => field.onChange(v ?? "")}
                  />
                )}
              />
            </Field>
          )}

          {/* Time-off category */}
          <Field label="Time-off category">
            <Controller
              name="categoryId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCategories.map((cat) => {
                      const disabled = isItemDisabled(cat, employeeId || undefined, balancesLoading, balanceMap)
                      return (
                        <SelectItem key={cat.id} value={cat.id} disabled={disabled}>
                          <span className="flex w-full items-center justify-between gap-2">
                            <span className="font-medium">{cat.emoji ? `${cat.name} ${cat.emoji}` : cat.name}</span>
                            {employeeId && (
                              <span className="ml-2 shrink-0 font-normal text-muted-foreground text-xs">
                                {balancesLoading
                                ? "..."
                                : cat.accrual_method === "unlimited"
                                  ? "Unlimited"
                                  : getBalanceText(balanceMap.get(cat.id)?.remaining_days)}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          {/* From date + period */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-3 items-end">
              <Field label="From" className="flex-1">
                <Controller
                  name="startDate"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Pick a date"
                    />
                  )}
                />
              </Field>
              <div className="flex-1">
                <Controller
                  name="startPeriod"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="morning">Morning</SelectItem>
                        <SelectItem value="midday">Midday</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            {/* To date + period */}
            <div className="flex gap-3 items-end">
              <Field label="To" className="flex-1">
                <Controller
                  name="endDate"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Pick a date"
                    />
                  )}
                />
              </Field>
              <div className="flex-1">
                <Controller
                  name="endPeriod"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
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
                  )}
                />
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
            <Controller
              name="comment"
              control={control}
              render={({ field }) => (
                <Textarea
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Type any extra information"
                />
              )}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
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
