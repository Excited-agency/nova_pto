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
import { useTimeOffCategories, useCategoryAvailability } from "@/hooks/use-time-off-categories"
import {
  useEmployeeBalances,
  useMyTimeOffRequests,
  useSubmitTimeOffRequestMutation,
} from "@/hooks/use-time-off-requests"
import { addToast } from "@/lib/toast"
import {
  calculateDays,
  formatDate,
  formatDays,
  formatLocalDate,
  formatPeriod,
  isBeforeDate,
  isSameDay,
  parseDateLocal,
} from "@/lib/date-utils"
import {
  findOverlap,
  isDateOccupied,
  suggestFreeRange,
  toOccupiedRanges,
} from "@/lib/request-overlap"
import { getBalanceText } from "@/lib/balance-utils"

interface SubmitTimeOffRequestModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// The legacy request_type mapping used to live here; submit_time_off_request
// now derives it from the category server-side, so there is one mapping again.

const submitRequestSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  // Zod v4 renamed required_error -> error; the old key was silently ignored,
  // so these custom messages never actually reached the user.
  startDate: z.date({ error: "Start date is required" }),
  endDate: z.date({ error: "End date is required" }),
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
  // holidaysReady matters: with an empty list the day count silently treats
  // public holidays as leave, so the preview would disagree with what the
  // server stores. Block submission until the list has actually loaded.
  const {
    data: holidayRows = [],
    isPending: holidaysLoading,
    isError: holidaysFailed,
  } = useHolidays()
  const submitMutation = useSubmitTimeOffRequestMutation()

  const holidaysReady = !holidaysLoading && !holidaysFailed
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
  const { data: availability = [] } = useCategoryAvailability(profile?.id)
  const { data: myRequests = [] } = useMyTimeOffRequests()

  // Days this employee is already booked for. Rejected and withdrawn requests
  // release their dates, so only pending and approved ones count.
  const occupiedRanges = useMemo(() => toOccupiedRanges(myRequests), [myRequests])

  const balanceMap = useMemo(
    () => new Map(balances.map((b) => [b.category_id, b])),
    [balances]
  )

  // Only categories with a new-hire waiting period land in the future here.
  const availabilityMap = useMemo(
    () =>
      new Map(
        availability
          .filter((a) => isBeforeDate(new Date(), parseDateLocal(a.available_from)))
          .map((a) => [a.category_id, a.available_from])
      ),
    [availability]
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

  // A waiting period bars leave that STARTS before the category opens, not
  // the act of booking it — the same rule the server enforces, so booking
  // ahead for dates after the period is deliberately still allowed.
  const availableFrom = categoryId ? availabilityMap.get(categoryId) : undefined
  const beforeAvailable =
    !!availableFrom &&
    startDate != null &&
    isBeforeDate(startDate, parseDateLocal(availableFrom))

  // Greying out days in the picker is not enough on its own: both endpoints
  // can be free while a booked day sits between them.
  const overlapConflict =
    startDate != null && endDate != null
      ? findOverlap(occupiedRanges, startDate, endDate)
      : undefined

  const freeSuggestion =
    overlapConflict != null && startDate != null && endDate != null
      ? suggestFreeRange(occupiedRanges, startDate, endDate)
      : null

  const isValid =
    !!categoryId && !!startDate && !!endDate &&
    totalDays != null && totalDays > 0 &&
    holidaysReady &&
    !hasPastDates &&
    !beforeAvailable &&
    !overlapConflict &&
    !insufficientBalance

  const isDayBooked = (date: Date) => isDateOccupied(occupiedRanges, date) != null

  const bookedReason = (date: Date) => {
    const range = isDateOccupied(occupiedRanges, date)
    if (!range) return undefined
    return `Already booked: ${range.label} (${range.status})`
  }

  function applyFreeSuggestion() {
    if (!freeSuggestion) return
    setValue("startDate", freeSuggestion.start)
    setValue("endDate", freeSuggestion.end)
  }

  const onSubmit = handleSubmit((data) => {
    if (!isValid || !profile || !workspace || totalDays == null) return

    submitMutation.mutate(
      {
        // total_days, status, request_type and the employee's name/email/avatar
        // are all derived by the submit_time_off_request RPC. The number shown
        // above is a preview of the server's calculation, not the stored value.
        profile_id: profile.id,
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
                            {availabilityMap.has(cat.id)
                              ? `From ${formatDate(availabilityMap.get(cat.id))}`
                              : cat.accrual_method === "unlimited"
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
                      isDateDisabled={isDayBooked}
                      dateTooltip={bookedReason}
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
                      isDateDisabled={isDayBooked}
                      dateTooltip={bookedReason}
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
            {startDate != null && endDate != null && totalDays === 0 && (
              <p className="text-sm leading-5 tracking-tight text-[var(--color-warning)]">
                Those dates contain no working days — weekends and holidays don't count
              </p>
            )}
            {!holidaysReady && (
              <p className="text-sm leading-5 tracking-tight text-muted-foreground">
                {holidaysFailed
                  ? "Couldn't load the holiday calendar, so the day count may be wrong. Try reopening this form."
                  : "Checking the holiday calendar…"}
              </p>
            )}
            {beforeAvailable && (
              <p className="text-sm leading-5 tracking-tight text-[var(--color-error)]">
                This category isn't available to you until{" "}
                {formatDate(availableFrom)} — pick a later start date
              </p>
            )}
            {overlapConflict && (
              <div className="flex flex-col items-start gap-1">
                <p className="text-sm leading-5 tracking-tight text-[var(--color-error)]">
                  You're already off {formatPeriod(
                    formatLocalDate(overlapConflict.start),
                    formatLocalDate(overlapConflict.end)
                  )}{" "}
                  — {overlapConflict.label} ({overlapConflict.status})
                </p>
                {freeSuggestion && (
                  <Button variant="ghost" size="sm" onClick={applyFreeSuggestion}>
                    Take{" "}
                    {formatPeriod(
                      formatLocalDate(freeSuggestion.start),
                      formatLocalDate(freeSuggestion.end)
                    )}{" "}
                    instead
                  </Button>
                )}
              </div>
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
