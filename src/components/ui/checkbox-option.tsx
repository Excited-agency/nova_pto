import * as React from "react"
import { type Checkbox as CheckboxPrimitive } from "radix-ui"
import type { CheckedState } from "@radix-ui/react-checkbox"

import { cn } from "@/lib/utils"
import { Checkbox } from "./checkbox"

interface CheckboxOptionProps
  extends Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, "children"> {
  label?: string
  description?: string
  type?: "simple" | "description" | "card"
  orientation?: "left" | "right"
  destructive?: boolean
}

function CheckboxOption({
  className,
  label,
  description,
  type = "simple",
  orientation = "left",
  destructive = false,
  disabled,
  checked,
  defaultChecked,
  onCheckedChange,
  ...props
}: CheckboxOptionProps) {
  const [isChecked, setIsChecked] = React.useState(
    checked === true || defaultChecked === true
  )

  React.useEffect(() => {
    if (checked !== undefined) setIsChecked(checked === true)
  }, [checked])

  const handleCheckedChange = (value: CheckedState) => {
    setIsChecked(value === true)
    onCheckedChange?.(value)
  }

  const checkbox = (
    <Checkbox
      className="disabled:opacity-100"
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={handleCheckedChange}
      disabled={disabled}
      {...props}
    />
  )

  const content = (label || description) && (
    <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
      {label && (
        <span
          className={cn(
            "leading-none",
            type === "simple" ? "font-normal" : "font-medium",
            destructive ? "text-destructive" : "text-foreground"
          )}
        >
          {label}
        </span>
      )}
      {(type === "description" || type === "card") && description && (
        <span className="font-normal leading-5 tracking-[-0.28px] text-muted-foreground">
          {description}
        </span>
      )}
    </div>
  )

  return (
    <label
      data-slot="checkbox-option"
      className={cn(
        "flex cursor-pointer items-start gap-2",
        disabled && "cursor-not-allowed opacity-50",
        type === "card" && [
          "rounded-[var(--radius)] border p-4",
          destructive
            ? "border-destructive"
            : isChecked
              ? "border-primary bg-primary/5"
              : "border-border",
        ],
        className
      )}
    >
      {orientation === "left" ? (
        <>
          {checkbox}
          {content}
        </>
      ) : (
        <>
          {content}
          {checkbox}
        </>
      )}
    </label>
  )
}

export { CheckboxOption }
export type { CheckboxOptionProps }
