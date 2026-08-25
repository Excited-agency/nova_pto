import { useState, useRef, useEffect, useMemo } from "react"
import { MapPin } from "lucide-react"

import { cn } from "@/lib/utils"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import cities from "@/data/cities.json"

interface LocationComboboxProps {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

interface City {
  name: string
  country: string
}

const cityData = cities as City[]

function LocationCombobox({
  value = "",
  onChange,
  placeholder = "Select location",
  className,
  disabled = false,
}: LocationComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Sync external value changes
  useEffect(() => {
    setQuery(value)
  }, [value])

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return []
    return cityData
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.country.toLowerCase().includes(q) ||
          `${c.name}, ${c.country}`.toLowerCase().includes(q)
      )
      .slice(0, 6)
  }, [query])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setOpen(val.trim().length > 0)
    }, 150)
  }

  function handleSelect(city: City) {
    const formatted = `${city.name}, ${city.country}`
    setQuery(formatted)
    onChange?.(formatted)
    setOpen(false)
  }

  function handleBlur() {
    // Delay to allow click on result
    setTimeout(() => {
      setOpen(false)
      // If the current query doesn't match value, reset or commit
      if (query !== value) {
        onChange?.(query)
      }
    }, 200)
  }

  return (
    <Popover open={open && results.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative w-full", className)}>
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            data-slot="location-combobox"
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={() => query.trim().length > 0 && results.length > 0 && setOpen(true)}
            onBlur={handleBlur}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              "h-9 w-full min-w-0 rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm leading-5 tracking-tight shadow-xs transition-[color,border-color,box-shadow] outline-none",
              "selection:bg-primary selection:text-primary-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:border-focus focus-visible:shadow-focus",
              "disabled:cursor-not-allowed disabled:opacity-50",
              query && "font-medium"
            )}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="p-1"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {results.map((city) => (
          <button
            key={`${city.name}-${city.country}`}
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm leading-5 tracking-tight outline-hidden select-none cursor-pointer hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            onMouseDown={(e) => {
              e.preventDefault()
              handleSelect(city)
            }}
          >
            <MapPin className="size-4 shrink-0 text-muted-foreground" />
            <span>
              {city.name}, <span className="text-muted-foreground">{city.country}</span>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export { LocationCombobox }
export type { LocationComboboxProps }
