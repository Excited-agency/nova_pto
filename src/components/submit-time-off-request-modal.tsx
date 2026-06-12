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
import { useEmployeeBalances, useSubmitTimeOffRequestMutation } from "@/hooks/use-time-off-requests"
import { addToast } from "@/lib/toast"
import { calculateDays, formatDays, formatLocalDate, isBeforeDate, isSameDay } from "@/lib/date-utils"
import { getBalanceText } from "@/lib/balance-utils"

interface SubmitTimeOffRequestModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function mapRequestType(categoryName: string): string {
  switch (categoryName.toLowerCase()) {
    case "vacation": return "vacation"
    case "sick leave": return "sick_leave"
    case "personal": return "personal"
    case "bereavement": return "bereavement"
    default: return "other"
  }
}

const submitRequestSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  startDate: z.date({ required_error: "Start date is required" }),
  endDate: z.date({ required_error: "End date is required" }),
  startPeriod: z.enum(["morning", "midday"]),
  endPeriod: z.enum(["midday", "end_of_day"]),
  comment: z.string(),
})

type SubmitRequestFormData = z.infer<typeof submitRequestSchema>

export function SubmitTimeOffRequestModal({
  open,
  onOpenChange,
}: SubmitTimeOffRequestModalProps) {
  const { profile, workspace } = useAuth()
  const isAdmin = profile?.role === "admin" || profile?.role === "owner"
  const today = useMemo(() => new Date(), [])
  const minDate = isAdmin ? undefined : today
  const { data: categories = [] } = useTimeOffCategories()
  const { data: holidayRows = [] } = useHolidays()
  const submitMutation = useSubmitTimeOffRequestMutation()

  const holidayDates = useMemo(() => holidayRows.map((h) => h.date), [holidayRows])

  const { control, handleSubmit, reset, watch, setValue } = useForm<SubmitRequestFormData>({
    resolver: zodResolver(submitRequestSchema),
    defaultValues: {
      categoryId: "",
      startDate: undefined,
      endDate: undefined,
      startPeriod: "morning",
      endPeriod: "end_of_day",
      comment: "",
    },
  })

  const { categoryId, startDate, endDate, startPeriod, endPeriod, comment } = watch()

  useEffect(() => {
    if (!open) {
      reset({
        categoryId: "",
        startDate: undefined,
        endDate: undefined,
        startPeriod: "morning",
        endPeriod: "end_of_day",
        comment: "",
      })
    }
  }, [open, reset])

  const { data: balances = [] } = useEmployeeBalances(profile?.id)

  const balanceMap = useMemo(
    () => new Map(balances.map((b) => [b.category_id, b])),
    [balances]
  )

  const activeCategories = useMemo(
    () => categories.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [categories]
  )

  const selectedCategory = useMemo(
    () => activeCategories.find((c) => c.id === categoryId),
    [activeCategories, categoryId]
  )

  const endPeriodOptions = useMemo(() => {
    if (startDate && endDate && isSameDay(startDate, endDate)) {
      if (startPeriod === "midday") {
        return [{ value: "end_of_day" as const, label: "End of day" }]
      }
      return [
        { value: "midday" as const, label: "Midday" },
        { value: "end_of_day" as const, label: "End of day" },
      ]
    }
    return [
      { value: "midday" as const, label: "Midday" },
      { value: "end_of_day" as const, label: "End of day" },
    ]
  }, [startDate, endDate, startPeriod])

  useEffect(() => {
    const validValues = endPeriodOptions.map((o) => o.value)
    if (!validValues.includes(endPeriod)) {
      setValue("endPeriod", validValues[0])
    }
  }, [endPeriodOptions, endPeriod, setValue])

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

  const isUnlimited = selectedCategory?.accrual_method === "unlimited"
  const selectedBalance = categoryId ? balanceMap.get(categoryId) : undefined
  const insufficientBalance =
    !!categoryId && !!startDate && !!endDate &&
    !isUnlimited &&
    totalDays != null &&
    selectedBalance != null &&
    totalDays > selectedBalance.remaining_days

  const hasPastDates =
    !isAdmin &&
    ((startDate != null && isBeforeDate(startDate, new Date())) ||
      (endDate != null && isBeforeDate(endDate, new Date())))

  const isValid =
    !!categoryId && !!startDate && !!endDate &&
    totalDays != null && totalDays > 0 &&
    !hasPastDates &&
    !insufficientBalance

  const onSubmit = handleSubmit((data) => {
    if (!isValid || !profile || !workspace || totalDays == null) return

    const employeeName = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email

    submitMutation.mutate(
      {
        workspace_id: workspace.id,
        profile_id: profile.id,
        category_id: data.categoryId,
        start_date: formatLocalDate(data.startDate),
        end_date: formatLocalDate(data.endDate),
        start_period: data.startPeriod,
        end_period: data.endPeriod,
        total_days: totalDays,
        employee_name: employeeName,
        employee_email: profile.email,
        employee_avatar_url: profile.avatar_url ?? null,
        comment: comment.trim() || null,
        request_type: mapRequestType(selectedCategory?.name ?? ""),
      },
      {
        onSuccess: () => {
          addToast({
            title: "Request submitted",
            description: "Pending manager approval.",
          })
          onOpenChange(false)
        },
        onError: (error) => {
          addToast({
            title: "Couldn't submit request",
            description: error.message,
            variant: "error",
          })
        },
      }
    )
  })

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitMutation.isPending) onOpenChange(v) }}>
      <DialogContent className="max-w-[480px] gap-5">
        <DialogHeader>
          <DialogTitle>Request time off</DialogTitle>
          <DialogDescription>
            Select a category and dates to submit your request for approval
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
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
                    {activeCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="font-medium">
                            {cat.emoji ? `${cat.name} ${cat.emoji}` : cat.name}
                          </span>
                          <span className="ml-2 shrink-0 font-normal text-muted-foreground text-xs">
                            {cat.accrual_method === "unlimited"
                              ? "Unlimited"
                              : getBalanceText(balanceMap.get(cat.id)?.remaining_days)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
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
                      minDate={minDate}
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
                      minDate={minDate}
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

            {totalDays != null && totalDays > 0 && (
              <p className="text-sm leading-5 tracking-tight text-muted-foreground">
                Total:{" "}
                <span className="font-medium text-foreground">{formatDays(totalDays)}</span>
              </p>
            )}
            {insufficientBalance && (
              <p className="text-sm leading-5 tracking-tight text-[var(--color-warning)]">
                You may not have enough balance ({selectedBalance!.remaining_days} days remaining)
              </p>
            )}
            {hasPastDates && (
              <p className="text-sm leading-5 tracking-tight text-[var(--color-error)]">
                Start and end dates cannot be in the past
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
                  placeholder="Add a note for your manager (optional)"
                />
              )}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!isValid}
            loading={submitMutation.isPending}
          >
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
