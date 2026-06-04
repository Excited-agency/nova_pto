import { Controller, type Control, type UseFormSetValue } from "react-hook-form"
import { pluralize } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { SwitchGroup } from "@/components/ui/switch-group"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import type { CategoryFormValues } from "@/lib/category-form-schema"

interface CarryoverSectionProps {
  control: Control<CategoryFormValues>
  setValue: UseFormSetValue<CategoryFormValues>
  accrualMethod: CategoryFormValues["accrual_method"]
  carryoverEnabled: CategoryFormValues["carryover_limit_enabled"]
  carryoverExpirationValue: CategoryFormValues["carryover_expiration_value"]
}

export function CarryoverSection({
  control,
  setValue,
  accrualMethod,
  carryoverEnabled,
  carryoverExpirationValue,
}: CarryoverSectionProps) {
  return (
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
  )
}
