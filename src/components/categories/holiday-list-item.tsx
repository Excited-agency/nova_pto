import { memo } from "react"
import { EllipsisIcon, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTableCell } from "@/components/ui/data-table-cell"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { ComboboxMenu } from "@/components/ui/combobox-menu"
import type { Holiday } from "@/types/holiday"
import { parseDateLocal } from "@/lib/date-utils"

function formatHolidayDate(dateStr: string): string {
  return parseDateLocal(dateStr).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

function getDayOfWeek(dateStr: string): string {
  return parseDateLocal(dateStr).toLocaleDateString("en-US", { weekday: "long" })
}

interface HolidayListItemProps {
  holiday: Holiday
  isLast: boolean
  isSelected: boolean
  isPopoverOpen: boolean
  onToggleSelect: (id: string) => void
  onPopoverOpenChange: (id: string | null) => void
  onEdit: (holiday: Holiday) => void
  onDelete: (holiday: Holiday) => void
}

export const HolidayListItem = memo(function HolidayListItem({
  holiday,
  isLast,
  isSelected,
  isPopoverOpen,
  onToggleSelect,
  onPopoverOpenChange,
  onEdit,
  onDelete,
}: HolidayListItemProps) {
  return (
    <div key={holiday.id} className="flex">
      <DataTableCell
        type="checkbox"
        size="md"
        className="w-[28px]"
        checked={isSelected}
        onCheckedChange={() => onToggleSelect(holiday.id)}
        border={!isLast}
      />
      <DataTableCell
        type="text"
        size="md"
        label={holiday.name}
        labelClassName="font-medium"
        className="flex-1"
        border={!isLast}
      />
      <DataTableCell
        type="text-description"
        size="md"
        label={formatHolidayDate(holiday.date)}
        description={getDayOfWeek(holiday.date)}
        className="flex-1"
        border={!isLast}
      />
      <DataTableCell
        type="badge"
        size="md"
        className="flex-1"
        badgeNode={
          <Badge variant="secondary">
            {holiday.is_custom ? "Custom" : "Public"}
          </Badge>
        }
        border={!isLast}
      />
      <div
        className="relative flex items-center justify-center w-14 h-[72px] px-3 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Popover
          open={isPopoverOpen}
          onOpenChange={(open) => onPopoverOpenChange(open ? holiday.id : null)}
        >
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <EllipsisIcon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="p-0 border-0 shadow-none">
            <ComboboxMenu
              groups={
                holiday.is_custom
                  ? [
                      {
                        items: [
                          {
                            type: "icon",
                            icon: <Pencil className="size-4" />,
                            label: "Edit holiday",
                            onClick: () => {
                              onPopoverOpenChange(null)
                              onEdit(holiday)
                            },
                          },
                        ],
                      },
                      {
                        items: [
                          {
                            type: "icon",
                            variant: "destructive",
                            icon: <Trash2 className="size-4" />,
                            label: "Delete",
                            onClick: () => {
                              onPopoverOpenChange(null)
                              onDelete(holiday)
                            },
                          },
                        ],
                      },
                    ]
                  : [
                      {
                        items: [
                          {
                            type: "icon",
                            variant: "destructive",
                            icon: <Trash2 className="size-4" />,
                            label: "Delete",
                            onClick: () => {
                              onPopoverOpenChange(null)
                              onDelete(holiday)
                            },
                          },
                        ],
                      },
                    ]
              }
            />
          </PopoverContent>
        </Popover>
        {!isLast && <div className="absolute bottom-0 left-0 right-0 border-b border-border" />}
      </div>
    </div>
  )
})
