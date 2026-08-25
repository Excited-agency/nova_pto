import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

type ToggleGroupContextValue = {
  variant: "default" | "outline"
  size: "sm" | "default" | "lg"
}

const ToggleGroupContext = React.createContext<ToggleGroupContextValue>({
  variant: "default",
  size: "default",
})

function ToggleGroup({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        "flex items-center gap-0",
        variant === "outline" && "shadow-2xs rounded-md",
        className
      )}
      {...props}
    >
      {/* cva variant props are `T | null | undefined`, so normalise before
          handing them to a context that guarantees a concrete value. */}
      <ToggleGroupContext.Provider value={{ variant: variant ?? "default", size: size ?? "default" }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  variant: variantProp,
  size: sizeProp,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)
  const variant = variantProp ?? context.variant
  const size = sizeProp ?? context.size

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={variant}
      data-size={size}
      className={cn(
        toggleVariants({ variant, size }),
        "rounded-none first:rounded-l-md last:rounded-r-md",
        "focus-visible:z-10",
        variant === "outline" && [
          "shadow-none",
          "[&:not(:first-child)]:border-l-0",
        ],
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
