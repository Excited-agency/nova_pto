import { Controller, type Control } from "react-hook-form"
import { Info } from "lucide-react"
import { cn, pluralize } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { RadioGroup } from "@/components/ui/radio-group"
import { RadioGroupOption } from "@/components/ui/radio-group-option"
import type { CategoryFormValues } from "@/lib/category-form-schema"

interface AccrualAmountFieldProps {
  control: Control<CategoryFormValues>
  accrualMethod: CategoryFormValues["accrual_method"]
  grantingFrequency: CategoryFormValues["granting_frequency"]
  amountValue: CategoryFormValues["amount_value"]
  anniversaryYears: CategoryFormValues["anniversary_years"]
}

export function AccrualAmountField({
  control,
  accrualMethod,
  grantingFrequency,
  amountValue,
  anniversaryYears,
}: AccrualAmountFieldProps) {
  return (
    <>
      {/* Accrual method + Amount row */}
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
    </>
  )
}
