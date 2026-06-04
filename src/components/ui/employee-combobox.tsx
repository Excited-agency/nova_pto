import { useState, useRef, useEffect, useMemo } from "react"
import { Search, X } from "lucide-react"

import { cn, getDisplayName, getInitials  } from "@/lib/utils"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Avatar } from "@/components/ui/avatar"
import type { ComboboxEmployee } from "@/lib/time-off-request-service"

interface EmployeeComboboxProps {
  employees: ComboboxEmployee[]
  value?: string
  onChange?: (employeeId: string | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

function EmployeeCombobox({
  employees,
  value,
  onChange,
  placeholder = "Search for employee...",
  className,
  disabled = false,
}: EmployeeComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const isHoveringListRef = useRef(false)

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === value),
    [employees, value]
  )

  // Reset query when selection changes externally
  useEffect(() => {
    if (!value) setQuery("")
  }, [value])

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return employees
    return employees.filter((e) => {
      const name = getDisplayName(e.first_name ?? undefined, e.last_name ?? undefined).toLowerCase()
      return name.includes(q) || e.email.toLowerCase().includes(q)
    })
  }, [employees, query])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setOpen(true)
  }

  function handleSelect(employee: ComboboxEmployee) {
    onChange?.(employee.id)
    setQuery("")
    setOpen(false)
  }

  function handleBlur() {
    setTimeout(() => {
      if (!isHoveringListRef.current) {
        setOpen(false)
      }
    }, 200)
  }

  function handleClear() {
    onChange?.(undefined)
    setQuery("")
    inputRef.current?.focus()
  }

  // When selected, show the selected employee chip
  if (selectedEmployee) {
    const displayName = getDisplayName(
      selectedEmployee.first_name ?? undefined,
      selectedEmployee.last_name ?? undefined
    )
    return (
      <div
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 tracking-tight shadow-xs",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Avatar
          src={selectedEmployee.avatar_url ?? undefined}
          fallback={getInitials(selectedEmployee.first_name ?? undefined, selectedEmployee.last_name ?? undefined)}
          size="2xs"
          shape="square"
        />
        <span className="flex-1 truncate font-medium text-foreground">
          {displayName || selectedEmployee.email}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center justify-center size-4 rounded-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    )
  }

  return (
    <Popover open={open && results.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative w-full", className)}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={() => setOpen(true)}
            onBlur={handleBlur}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              "h-9 w-full min-w-0 rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm leading-5 tracking-tight shadow-xs transition-[color,border-color,box-shadow] outline-none",
              "selection:bg-primary selection:text-primary-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:border-focus focus-visible:shadow-focus",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="p-1"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <div
          className="max-h-[160px] overflow-y-auto"
          onMouseEnter={() => { isHoveringListRef.current = true }}
          onMouseLeave={() => { isHoveringListRef.current = false }}
        >
        {results.map((employee) => {
          const name = getDisplayName(employee.first_name ?? undefined, employee.last_name ?? undefined)
          return (
            <button
              key={employee.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm leading-5 tracking-tight outline-hidden select-none cursor-pointer hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(employee)
              }}
            >
              <Avatar
                src={employee.avatar_url ?? undefined}
                fallback={getInitials(employee.first_name ?? undefined, employee.last_name ?? undefined)}
                size="2xs"
                shape="square"
              />
              <span className="flex-1 text-left truncate">
                {name || employee.email}
              </span>
              {name && (
                <span className="text-muted-foreground truncate text-xs">
                  {employee.email}
                </span>
              )}
            </button>
          )
        })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { EmployeeCombobox }
export type { EmployeeComboboxProps }
