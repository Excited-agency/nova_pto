import { useState, useMemo, useEffect, useRef } from "react"
import { cn, pluralize } from "@/lib/utils"
import { useForm, useWatch, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { RadioGroup } from "@/components/ui/radio-group"
import { RadioGroupOption } from "@/components/ui/radio-group-option"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { SwitchGroup } from "@/components/ui/switch-group"
import {
  categoryFormSchema,
  type CategoryFormValues,
} from "@/lib/category-form-schema"
import { CATEGORY_COLORS } from "@/lib/category-colors"

interface CategoryFormProps {
  mode: "add" | "edit"
  initialData?: CategoryFormValues
  title: string
  subtitle: string
  submitLabel: string
  onSubmit: (data: CategoryFormValues) => Promise<void>
  onCancel: () => void
}

export function CategoryForm({
  mode,
  initialData,
  title,
  subtitle,
  submitLabel,
  onSubmit,
  onCancel,
}: CategoryFormProps) {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { isValid, isDirty, isSubmitting },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: initialData,
    mode: "onChange",
  })

  const [
    accrualMethod,
    grantingFrequency,
    newHireRule,
    carryoverEnabled,
    waitingPeriodValue,
    amountValue,
    anniversaryYears,
    carryoverExpirationValue,
  ] = useWatch({
    control,
    name: [
      "accrual_method",
      "granting_frequency",
      "new_hire_rule",
      "carryover_limit_enabled",
      "waiting_period_value",
      "amount_value",
      "anniversary_years",
      "carryover_expiration_value",
    ],
  })

  const frequencyChangeRef = useRef(true)

  // Clear dependent fields when accrual method changes
  useEffect(() => {
    if (accrualMethod === "unlimited") {
      setValue("amount_value", null, { shouldDirty: false })
      setValue("granting_frequency", null, { shouldDirty: false })
      setValue("accrual_day", null, { shouldDirty: false })
      setValue("anniversary_years", null, { shouldDirty: false })
      setValue("carryover_limit_enabled", false, { shouldDirty: false })
      setValue("carryover_max_days", null, { shouldDirty: false })
      setValue("carryover_expiration_value", null, { shouldDirty: false })
      setValue("carryover_expiration_unit", null, { shouldDirty: false })
    } else if (accrualMethod === "fixed") {
      setValue("accrual_day", null, { shouldDirty: false })
      setValue("anniversary_years", null, { shouldDirty: false })
    } else if (accrualMethod === "periodic") {
      setValue("anniversary_years", null, { shouldDirty: false })
      // Clear hire_anniversary since it's not valid for periodic
      if (grantingFrequency === "hire_anniversary") {
        setValue("granting_frequency", null, { shouldDirty: false })
        setValue("accrual_day", null, { shouldDirty: false })
      }
    } else if (accrualMethod === "anniversary") {
      setValue("granting_frequency", null, { shouldDirty: false })
      setValue("accrual_day", null, { shouldDirty: false })
      setValue("carryover_max_days", null, { shouldDirty: false })
      setValue("carryover_expiration_value", null, { shouldDirty: false })
      setValue("carryover_expiration_unit", null, { shouldDirty: false })
    }
    // Reset the ref so next frequency change will clear accrual_day
    frequencyChangeRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Intentional: granting_frequency excluded — a separate useEffect below handles
    // it; including it here would cause a double-clear on simultaneous changes.
  }, [accrualMethod, setValue])

  // Clear accrual_day when granting_frequency changes (skip initial render)
  useEffect(() => {
    if (frequencyChangeRef.current) {
      frequencyChangeRef.current = false
      return
    }
    setValue("accrual_day", null, { shouldDirty: false })
  }, [grantingFrequency, setValue])

  // Clear waiting period fields when switching to immediate
  useEffect(() => {
    if (newHireRule === "immediate") {
      setValue("waiting_period_value", null, { shouldDirty: false })
      setValue("waiting_period_unit", "year", { shouldDirty: false })
    }
  }, [newHireRule, setValue])


  const saveTooltip = useMemo(() => {
    if (!isValid) return "Please fill in all required fields"
    if (mode === "edit" && !isDirty) return "No changes to save"
    return undefined
  }, [isValid, isDirty, mode])

  const canSubmit = isValid && (mode === "add" || isDirty)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function onFormSubmit(data: CategoryFormValues) {
    try {
      setSubmitError(null)
      await onSubmit(data)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onFormSubmit)}
      className="flex flex-col gap-6 items-center pt-6 pb-8 px-4"
    >
      {/* Title section */}
      <div className="w-[600px] flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-8 tracking-[-0.4px]">
          {title}
        </h2>
        <p className="text-sm font-normal leading-5 tracking-[-0.28px] text-muted-foreground">
          {subtitle}
        </p>
      </div>

      {/* Form fields */}
      <div className="w-[600px] flex flex-col gap-6">
        <div className="flex flex-col gap-4">
        {/* Category name + Colour */}
        <div className="grid grid-cols-2 gap-3">
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <Field label="Category name">
                <Input
                  placeholder='e.g., "Parental leave"'
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              </Field>
            )}
          />

          <Controller
            name="colour"
            control={control}
            render={({ field }) => (
              <Field label="Colour">
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select colour" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_COLORS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        <span
                          className="size-4 rounded shrink-0"
                          style={{ backgroundColor: c.hex }}
                        />
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
        </div>

        {/* Type of leave */}
        <Controller
          name="leave_type"
          control={control}
          render={({ field }) => (
            <Field label="Type of leave">
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="w-full grid grid-cols-2 gap-3"
              >
                <RadioGroupOption
                  value="paid"
                  label="Paid"
                  variant="card"
                />
                <RadioGroupOption
                  value="unpaid"
                  label="Unpaid"
                  variant="card"
                />
              </RadioGroup>
            </Field>
          )}
        />
        </div>

        <Separator />

        {/* Accrual section */}
        <div className="flex flex-col gap-4">
        {/* Accrual method + Amount */}
        <div className={cn(
          "grid gap-3 items-end",
          accrualMethod === "unlimited" ? "grid-cols-1" : "grid-cols-2"
        )}>
          <Controller
            name="accrual_method"
            control={control}
            render={({ field }) => (
              <Field label="Accrual method">
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed amount</SelectItem>
                    <SelectItem value="periodic">Periodic</SelectItem>
                    <SelectItem value="anniversary">On anniversary</SelectItem>
                    <SelectItem value="unlimited">Unlimited</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          />

          {/* Amount field — shown for non-unlimited, non-anniversary methods */}
          {accrualMethod !== "unlimited" && accrualMethod !== "anniversary" && (
            <Controller
              name="amount_value"
              control={control}
              render={({ field }) => {
                const isPeriodic = accrualMethod === "periodic"
                const label = isPeriodic ? "Accrual rate" : "Amount"

                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1">
                      <label className="text-sm font-medium leading-5 tracking-[-0.28px]">
                        {label}
                      </label>
                      {isPeriodic && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="size-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            E.g., 20 days per year equals 1.67 days per month
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="flex items-center gap-3 w-full">
                      <Input
                        className="flex-1"
                        type="number"
                        min={0}
                        step={isPeriodic ? "any" : 1}
                        placeholder={isPeriodic ? "1.67" : "0"}
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const v = e.target.value
                          field.onChange(v === "" ? null : Number(v))
                        }}
                        onBlur={field.onBlur}
                      />
                      <span className="text-sm leading-5 tracking-[-0.28px] text-foreground shrink-0 min-w-[34px] text-left">
                        {pluralize(amountValue, "day", "days")}
                      </span>
                    </div>
                  </div>
                )
              }}
            />
          )}

          {/* Anniversary: inline row — [input] day(s) for every [input] year(s) */}
          {accrualMethod === "anniversary" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium leading-5 tracking-[-0.28px]">Amount</label>
              <div className="flex items-center gap-3 w-full">
                <Controller
                  name="amount_value"
                  control={control}
                  render={({ field }) => (
                    <Input
                      className="flex-1"
                      type="number"
                      min={1}
                      step={1}
                      placeholder="1"
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const v = e.target.value
                        field.onChange(v === "" ? null : Number(v))
                      }}
                      onBlur={field.onBlur}
                    />
                  )}
                />
                <span className="text-sm leading-5 tracking-[-0.28px] text-foreground shrink-0 min-w-[78px]">
                  {pluralize(amountValue, "day", "days")} for every
                </span>
                <Controller
                  name="anniversary_years"
                  control={control}
                  render={({ field }) => (
                    <Input
                      className="flex-1"
                      type="number"
                      min={1}
                      step={1}
                      placeholder="1"
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const v = e.target.value
                        field.onChange(v === "" ? null : Number(v))
                      }}
                      onBlur={field.onBlur}
                    />
                  )}
                />
                <span className="text-sm leading-5 tracking-[-0.28px] text-foreground shrink-0 min-w-[34px]">
                  {pluralize(anniversaryYears, "year", "years")}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Fixed: Granting frequency */}
        {accrualMethod === "fixed" && (
          <Controller
            name="granting_frequency"
            control={control}
            render={({ field }) => (
              <Field label="Granting frequency">
                <RadioGroup
                  value={field.value ?? ""}
                  onValueChange={field.onChange}
                  className="w-full grid grid-cols-2 gap-3"
                >
                  <RadioGroupOption
                    value="yearly"
                    label="Yearly"
                    variant="card"
                  />
                  <RadioGroupOption
                    value="hire_anniversary"
                    label="Hire anniversary"
                    variant="card"
                  />
                </RadioGroup>
              </Field>
            )}
          />
        )}

        {/* Periodic: Frequency select + Accrual day */}
        {accrualMethod === "periodic" && (
          <div className="grid grid-cols-2 gap-3">
            <Controller
              name="granting_frequency"
              control={control}
              render={({ field }) => (
                <Field label="Frequency">
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="bi_weekly">Bi-weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Controller
              name="accrual_day"
              control={control}
              render={({ field }) => {
                const isWeekBased =
                  grantingFrequency === "weekly" ||
                  grantingFrequency === "bi_weekly"

                const weekDays = [
                  { value: "monday", label: "Monday" },
                  { value: "tuesday", label: "Tuesday" },
                  { value: "wednesday", label: "Wednesday" },
                  { value: "thursday", label: "Thursday" },
                  { value: "friday", label: "Friday" },
                  { value: "saturday", label: "Saturday" },
                  { value: "sunday", label: "Sunday" },
                ]

                const monthDays = [
                  { value: "first_day_of_month", label: "First day of month" },
                  { value: "last_day_of_month", label: "Last day of month" },
                  { value: "hire_anniversary_day", label: "Hire anniversary day" },
                ]

                const options = isWeekBased ? weekDays : monthDays

                return (
                  <Field label="Accrual day">
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select day" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )
              }}
            />
          </div>
        )}

        {/* New hire rule */}
        <Controller
          name="new_hire_rule"
          control={control}
          render={({ field }) => (
            <Field label="New hire">
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="w-full grid grid-cols-2 gap-3"
              >
                <RadioGroupOption
                  value="immediate"
                  label="Grant immediately"
                  variant="card"
                />
                <RadioGroupOption
                  value="waiting_period"
                  label="Activate waiting period"
                  variant="card"
                />
              </RadioGroup>
            </Field>
          )}
        />

        {/* Waiting period duration */}
        {newHireRule === "waiting_period" && (
          <Field label="Waiting period duration">
            <div className="grid grid-cols-2 gap-3 w-full">
              <Controller
                name="waiting_period_value"
                control={control}
                render={({ field }) => (
                  <Input
                    type="number"
                    min={1}
                    placeholder="1"
                    className="[&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const v = e.target.value
                      field.onChange(v === "" ? null : Number(v))
                    }}
                    onBlur={field.onBlur}
                  />
                )}
              />
              <Controller
                name="waiting_period_unit"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="month">{pluralize(waitingPeriodValue, "Month", "Months")}</SelectItem>
                      <SelectItem value="year">{pluralize(waitingPeriodValue, "Year", "Years")}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </Field>
        )}
        </div>

        {accrualMethod !== "unlimited" && <Separator />}

        {/* Carryover section — hidden for unlimited */}
        {accrualMethod !== "unlimited" && (
          <div className="flex flex-col gap-4">
          <Controller
            name="carryover_limit_enabled"
            control={control}
            render={({ field }) => (
              <SwitchGroup
                label="Limit carryover"
                description={
                  accrualMethod === "anniversary"
                    ? "Reset on anniversary"
                    : "Define limits for unused days transfer and their expiration period"
                }
                checked={field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked)
                  if (!checked) {
                    setValue("carryover_max_days", null)
                    setValue("carryover_expiration_value", null)
                    setValue("carryover_expiration_unit", null)
                  } else {
                    setValue("carryover_expiration_unit", "year")
                  }
                }}
              />
            )}
          />

          {carryoverEnabled && accrualMethod !== "anniversary" && (
            <>
              <Controller
                name="carryover_max_days"
                control={control}
                render={({ field }) => (
                  <Field label="Max days">
                    <Input
                      type="number"
                      min={1}
                      placeholder="0"
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const v = e.target.value
                        field.onChange(v === "" ? null : Number(v))
                      }}
                      onBlur={field.onBlur}
                    />
                  </Field>
                )}
              />

              <Field label="Expiration">
                <div className="grid grid-cols-2 gap-3 w-full">
                  <Controller
                    name="carryover_expiration_value"
                    control={control}
                    render={({ field }) => (
                      <Input
                        type="number"
                        min={1}
                        placeholder="0"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const v = e.target.value
                          field.onChange(v === "" ? null : Number(v))
                        }}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                  <Controller
                    name="carryover_expiration_unit"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value ?? ""}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="month">{pluralize(carryoverExpirationValue, "Month", "Months")}</SelectItem>
                          <SelectItem value="year">{pluralize(carryoverExpirationValue, "Year", "Years")}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </Field>
            </>
          )}
          </div>
        )}
      </div>

      {/* Error */}
      {submitError && (
        <div className="w-[600px]">
          <p className="text-sm text-destructive">{submitError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="w-[600px] flex items-center justify-between pt-3">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {saveTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex">
                <Button type="submit" disabled loading={isSubmitting}>
                  {submitLabel}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{saveTooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            type="submit"
            disabled={!canSubmit}
            loading={isSubmitting}
          >
            {submitLabel}
          </Button>
        )}
      </div>
    </form>
  )
}
