import * as React from "react"
import { cn } from "@/lib/utils"
import { ComboboxSearchField } from "@/components/ui/combobox-search-field"
import { ComboboxMenuLabel } from "@/components/ui/combobox-menu-label"
import {
  ComboboxMenuItem,
  type ComboboxMenuItemProps,
} from "@/components/ui/combobox-menu-item"

export type ComboboxMenuItemData = Omit<ComboboxMenuItemProps, "className">

export interface ComboboxMenuGroupData {
  label?: string
  items: ComboboxMenuItemData[]
}

export interface ComboboxMenuProps
  extends React.HTMLAttributes<HTMLDivElement> {
  groups: ComboboxMenuGroupData[]
  showSearch?: boolean
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
}

function ComboboxMenu({
  groups,
  showSearch = false,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  className,
  ...props
}: ComboboxMenuProps) {
  return (
    <div
      data-slot="combobox-menu"
      className={cn(
        "flex flex-col items-center",
        "min-w-[192px] max-w-[576px]",
        "overflow-hidden rounded-[calc(var(--radius)-2px)]",
        "border border-border",
        "shadow-md",
        className
      )}
      {...props}
    >
      {showSearch && (
        <ComboboxSearchField
          placeholder={searchPlaceholder}
          value={searchValue}
          onValueChange={onSearchChange}
        />
      )}
      {groups.map((group, i) => (
        <div
          key={i}
          className={cn(
            "flex flex-col items-start w-full",
            "bg-popover px-1 py-1.5",
            "max-h-[300px] overflow-y-auto",
            i < groups.length - 1 && "border-b border-border"
          )}
        >
          {group.label && (
            <ComboboxMenuLabel>{group.label}</ComboboxMenuLabel>
          )}
          {group.items.map((item, j) => (
            <ComboboxMenuItem key={j} {...item} />
          ))}
        </div>
      ))}
    </div>
  )
}

export { ComboboxMenu }
