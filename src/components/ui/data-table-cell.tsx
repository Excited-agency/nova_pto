import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { EllipsisIcon, GripVerticalIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { HighlightText } from "@/components/ui/highlight-text"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup } from "@/components/ui/toggle-group"

export type DataTableCellType =
  | "checkbox"
  | "grip"
  | "text"
  | "text-description"
  | "avatar"
  | "avatar-description"
  | "badge"
  | "button"
  | "image"
  | "input"
  | "switch"
  | "toggle"
  | "ellipsis"
  | "footer"

export type DataTableCellSize = "default" | "md" | "lg"

export interface DataTableCellProps extends React.ComponentProps<"div"> {
  // Layout
  type?: DataTableCellType
  size?: DataTableCellSize
  border?: boolean

  // Text content
  label?: string
  description?: string
  showDescription?: boolean

  // Label class override (for "text" type)
  labelClassName?: string

  // Icons (for "text" type)
  leftIcon?: React.ReactNode
  showLeftIcon?: boolean
  rightIcon?: React.ReactNode
  showRightIcon?: boolean

  // Avatar (for "avatar", "avatar-description")
  avatarSrc?: string
  avatarAlt?: string
  avatarFallback?: string

  // Image (for "image")
  imageSrc?: string
  imageAlt?: string

  // Badge (for "badge")
  badgeNode?: React.ReactNode

  // Checkbox (for "checkbox")
  checked?: boolean | "indeterminate"
  onCheckedChange?: (checked: boolean | "indeterminate") => void

  // Switch (for "switch")
  switchChecked?: boolean
  onSwitchChange?: (checked: boolean) => void

  // Button (for "button")
  buttonLabel?: string
  onButtonClick?: () => void

  // Toggle (for "toggle")
  toggleValue?: string
  onToggleChange?: (value: string) => void
  children?: React.ReactNode

  // Input (for "input")
  inputProps?: React.ComponentProps<"input">

  // Highlight (for search matching)
  highlightQuery?: string
}

const cellVariants = cva(
  "relative flex items-center px-3 py-2",
  {
    variants: {
      size: {
        default: "h-[52px]",
        md: "h-[72px]",
        lg: "h-[96px]",
      },
      type: {
        checkbox: "w-9 justify-center gap-3 pr-0",
        grip: "w-9 justify-center gap-3",
        ellipsis: "w-9 justify-center",
        footer: "w-[200px] gap-2 bg-muted/50",
        text: "w-[200px] gap-2",
        "text-description": "w-[200px] gap-2",
        badge: "w-[200px] gap-2",
        avatar: "w-[200px] gap-3",
        "avatar-description": "w-[200px] gap-3",
        image: "w-[200px] gap-3",
        input: "w-[200px] gap-3",
        button: "w-[200px] gap-3",
        toggle: "w-[200px] gap-3",
        switch: "w-[200px] gap-3",
      },
    },
    defaultVariants: { size: "default", type: "text" },
  }
)

function DataTableCell({
  className,
  type = "text",
  size = "default",
  border = true,
  label,
  description,
  showDescription = true,
  leftIcon,
  showLeftIcon = true,
  rightIcon,
  showRightIcon = true,
  avatarSrc,
  avatarAlt,
  labelClassName,
  avatarFallback,
  imageSrc,
  imageAlt,
  badgeNode,
  checked,
  onCheckedChange,
  switchChecked,
  onSwitchChange,
  buttonLabel,
  onButtonClick,
  toggleValue,
  onToggleChange,
  children,
  highlightQuery,
  inputProps,
  ...props
}: DataTableCellProps) {
  function renderLabel(text: string | undefined) {
    if (!text) return null
    if (!highlightQuery) return text
    return <HighlightText text={text} query={highlightQuery} />
  }

  function renderContent() {
    switch (type) {
      case "checkbox":
        return (
          <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
        )

      case "grip":
        return <GripVerticalIcon className="size-4 text-muted-foreground" />

      case "text":
        return (
          <>
            {showLeftIcon && leftIcon}
            <p className={cn("flex-1 min-w-0 truncate text-sm font-normal leading-5 tracking-tight text-foreground", labelClassName)}>
              {renderLabel(label)}
            </p>
            {showRightIcon && rightIcon}
          </>
        )

      case "text-description":
        return (
          <div className="flex flex-1 min-w-0 flex-col gap-1">
            <p className="truncate text-sm font-medium leading-5 tracking-tight text-foreground">
              {renderLabel(label)}
            </p>
            {showDescription && (
              <p className="truncate text-sm font-normal text-muted-foreground">
                {renderLabel(description)}
              </p>
            )}
          </div>
        )

      case "avatar":
        return (
          <>
            <Avatar
              src={avatarSrc}
              alt={avatarAlt}
              fallback={avatarFallback}
              size="sm"
              shape="square"
            />
            <p className="flex-1 min-w-0 truncate text-sm font-medium leading-5 tracking-tight text-foreground">
              {renderLabel(label)}
            </p>
          </>
        )

      case "avatar-description":
        return (
          <>
            <Avatar
              src={avatarSrc}
              alt={avatarAlt}
              fallback={avatarFallback}
              size="md"
              shape="square"
            />
            <div className="flex flex-1 min-w-0 flex-col gap-1">
              <p className="truncate text-sm font-medium leading-5 tracking-tight text-foreground">
                {renderLabel(label)}
              </p>
              {showDescription && (
                <p className="truncate text-sm font-normal text-muted-foreground">
                  {renderLabel(description)}
                </p>
              )}
            </div>
          </>
        )

      case "badge":
        return badgeNode ?? <Badge>{label}</Badge>

      case "image":
        return (
          <>
            <img
              src={imageSrc}
              alt={imageAlt ?? ""}
              loading="lazy"
              className="size-10 shrink-0 rounded-[calc(var(--radius)-4px)] object-cover"
            />
            <p className="flex-1 min-w-0 truncate text-sm font-normal leading-5 tracking-tight text-foreground">
              {renderLabel(label)}
            </p>
          </>
        )

      case "input":
        return <Input className="flex-1" {...inputProps} />

      case "button":
        return (
          <Button variant="outline" size="sm" onClick={onButtonClick}>
            {buttonLabel ?? label}
          </Button>
        )

      case "toggle":
        return (
          <ToggleGroup
            variant="outline"
            value={toggleValue}
            onValueChange={onToggleChange}
          >
            {children}
          </ToggleGroup>
        )

      case "switch":
        return (
          <Switch checked={switchChecked} onCheckedChange={onSwitchChange} />
        )

      case "ellipsis":
        return (
          <Button variant="ghost" size="icon-sm">
            <EllipsisIcon className="size-4" />
          </Button>
        )

      case "footer":
        return (
          <p className="text-sm text-muted-foreground">{renderLabel(label)}</p>
        )

      default:
        return null
    }
  }

  return (
    <div
      data-slot="data-table-cell"
      data-type={type}
      data-size={size}
      className={cn(cellVariants({ size, type }), className)}
      {...props}
    >
      {renderContent()}
      {border && (
        <div className="absolute bottom-0 left-0 right-0 border-b border-border" />
      )}
    </div>
  )
}

export { DataTableCell }
