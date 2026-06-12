import { useState, useMemo, useEffect, useRef } from "react"
import { useForm, useWatch, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

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
import {
  categoryFormSchema,
  type CategoryFormValues,
} from "@/lib/category-form-schema"
import { CATEGORY_COLORS } from "@/lib/category-colors"
import { FormPageLayout } from "@/components/form-page-layout"
import { pluralize } from "@/lib/utils"
import { AccrualAmountField } from "@/components/categories/accrual-amount-field"
import { CarryoverSection } from "@/components/categories/carryover-section"

interface CategoryFormProps {
  mode: "add" | "edit"
  initialData?: CategoryFormValues
  title: string
  subtitle: string
  submitLabel: string
  onSubmit: (data: CategoryFormValues) => Promise<void>
  onCancel: () => void
  onDirtyChange?: (isDirty: boolean) => void
}

export function CategoryForm({
  mode,
  initialData,
  title,
  subtitle,
  submitLabel,
  onSubmit,
  onCancel,
  onDirtyChange,
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

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

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
    <form onSubmit={handleSubmit(onFormSubmit)}>
      <FormPageLayout>
      {/* Title section */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-8 tracking-[-0.4px]">
          {title}
        </h2>
        <p className="text-sm font-normal leading-5 tracking-[-0.28px] text-muted-foreground">
          {subtitle}
        </p>
      </div>

      {/* Form fields */}
      <div className="flex flex-col gap-6">
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
          <AccrualAmountField
            control={control}
            accrualMethod={accrualMethod}
            grantingFrequency={grantingFrequency}
            amountValue={amountValue}
            anniversaryYears={anniversaryYears}
          />

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
          <CarryoverSection
            control={control}
            setValue={setValue}
            accrualMethod={accrualMethod}
            carryoverEnabled={carryoverEnabled}
            carryoverExpirationValue={carryoverExpirationValue}
          />
        )}
      </div>

      {/* Error */}
      {submitError && (
        <p className="text-sm text-destructive">{submitError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-3">
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
      </FormPageLayout>
    </form>
  )
}
