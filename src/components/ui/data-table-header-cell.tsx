import * as React from "react"
import { cva } from "class-variance-authority"
import { ArrowUpDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

export type DataTableHeaderCellType = "text" | "button" | "checkbox"

export interface DataTableHeaderCellProps extends React.ComponentProps<"div"> {
  type?: DataTableHeaderCellType
  border?: boolean
  label?: string
  rightAlign?: boolean

  // Checkbox type
  checked?: boolean | "indeterminate"
  onCheckedChange?: (checked: boolean | "indeterminate") => void

  // Button (sortable) type
  onSort?: () => void
}

const headerCellVariants = cva(
  "relative flex items-center",
  {
    variants: {
      type: {
        checkbox: "w-10 h-10 justify-center pl-3 pr-0 py-3",
        text:     "w-[144px] h-10 px-3 py-2",
        button:   "w-[144px] h-10 px-2 py-1",
      },
    },
    defaultVariants: { type: "text" },
  }
)

function DataTableHeaderCell({
  className,
  type = "text",
  border = true,
  label,
  rightAlign = false,
  checked,
  onCheckedChange,
  onSort,
  ...props
}: DataTableHeaderCellProps) {
  function renderContent() {
    switch (type) {
      case "checkbox":
        return (
          <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
        )

      case "text":
        return (
          <p
            className={cn(
              "flex-1 min-w-0 truncate text-sm font-medium leading-5 tracking-tight text-foreground",
              rightAlign && "text-right"
            )}
          >
            {label}
          </p>
        )

      case "button":
        return (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "flex-1 gap-2",
              rightAlign ? "justify-end" : "justify-start"
            )}
            onClick={onSort}
          >
            <span className="text-xs font-medium leading-4 tracking-tight text-foreground">
              {label}
            </span>
            <ArrowUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        )

      default:
        return null
    }
  }

  return (
    <div
      data-slot="data-table-header-cell"
      data-type={type}
      className={cn(
        headerCellVariants({ type }),
        rightAlign && type !== "checkbox" && "justify-end",
        className
      )}
      {...props}
    >
      {renderContent()}
      {border && (
        <div className="absolute bottom-0 left-0 right-0 border-b border-border" />
      )}
    </div>
  )
}

export { DataTableHeaderCell, headerCellVariants }
