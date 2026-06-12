import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { useAuth } from "@/hooks/use-auth"
import { useImportHolidaysMutation, usePublicHolidays } from "@/hooks/use-holidays"
import { addToast } from "@/lib/toast"
import { formatDate } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import { countries } from "@/data/countries"

interface ImportHolidayModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const currentYear = new Date().getFullYear()
const years = [currentYear, currentYear + 1, currentYear + 2]


export function ImportHolidayModal({ open, onOpenChange }: ImportHolidayModalProps) {
  const { workspace } = useAuth()
  const importMutation = useImportHolidaysMutation()

  const [countryCode, setCountryCode] = useState("")
  const [year, setYear] = useState(String(currentYear))
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())

  const { data: fetchedHolidays = [], isLoading: isFetching, isError: hasFetchError } = usePublicHolidays(
    countryCode ? Number(year) : null,
    countryCode || null
  )
  const fetchError = hasFetchError ? "Failed to fetch holidays for the selected country and year" : null

  // Country combobox state
  const [countryQuery, setCountryQuery] = useState("")
  const [countryOpen, setCountryOpen] = useState(false)
  const countryInputRef = useRef<HTMLInputElement>(null)
  const countryDebounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (countryDebounceRef.current) clearTimeout(countryDebounceRef.current)
    }
  }, [])

  // Auto-select all holidays when new data arrives
  useEffect(() => {
    setSelectedIndices(new Set(fetchedHolidays.map((_, i) => i)))
  }, [fetchedHolidays])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setCountryCode("")
      setYear(String(currentYear))
      setSelectedIndices(new Set())
      setCountryQuery("")
      setCountryOpen(false)
    }
  }, [open])

  const filteredCountries = useMemo(() => {
    const q = countryQuery.toLowerCase().trim()
    if (!q) return countries
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
    )
  }, [countryQuery])

  function handleCountryInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setCountryQuery(val)
    // Clear selection when user types
    if (countryCode) setCountryCode("")

    if (countryDebounceRef.current) clearTimeout(countryDebounceRef.current)
    countryDebounceRef.current = setTimeout(() => {
      setCountryOpen(true)
    }, 150)
  }

  function handleCountrySelect(country: { code: string; name: string; flag: string }) {
    setCountryCode(country.code)
    setCountryQuery(`${country.name} ${country.flag}`)
    setCountryOpen(false)
  }

  function handleCountryBlur() {
    setTimeout(() => {
      setCountryOpen(false)
      // Reset query if no valid selection
      if (!countryCode) {
        setCountryQuery("")
      }
    }, 200)
  }

  const allSelected = fetchedHolidays.length > 0 && selectedIndices.size === fetchedHolidays.length
  const someSelected = selectedIndices.size > 0 && selectedIndices.size < fetchedHolidays.length

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIndices(new Set())
    } else {
      setSelectedIndices(new Set(fetchedHolidays.map((_, i) => i)))
    }
  }, [allSelected, fetchedHolidays])

  const handleToggle = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }, [])

  const countryName = useMemo(
    () => countries.find((c) => c.code === countryCode)?.name ?? "",
    [countryCode]
  )

  const handleImport = useCallback(() => {
    if (!workspace || selectedIndices.size === 0) return

    const items = Array.from(selectedIndices).map((i) => ({
      name: fetchedHolidays[i].name,
      date: fetchedHolidays[i].date,
      country_code: countryCode,
      year: Number(year),
    }))

    importMutation.mutate(
      { countryCode, year: Number(year), items },
      {
        onSuccess: () => {
          addToast({
            title: "Holidays imported",
            description: "Previous imports have been replaced.",
          })
          onOpenChange(false)
        },
        onError: () => {
          addToast({ variant: "error", title: "Couldn't import holidays", description: "Something went wrong. Try again." })
        },
      }
    )
  }, [workspace, selectedIndices, fetchedHolidays, countryCode, year, countryName, importMutation, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] gap-5">
        <DialogHeader>
          <DialogTitle>Import holiday calendar</DialogTitle>
          <DialogDescription>
            Import official public holidays for the selected country
          </DialogDescription>
        </DialogHeader>

        {/* Selectors */}
        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-sm font-medium leading-5 tracking-[-0.28px] text-foreground">
              Public holidays in
            </label>
            <Popover open={countryOpen && filteredCountries.length > 0} onOpenChange={setCountryOpen}>
              <PopoverAnchor asChild>
                <input
                  ref={countryInputRef}
                  type="text"
                  value={countryQuery}
                  onChange={handleCountryInputChange}
                  onFocus={() => {
                    if (!countryCode) setCountryOpen(true)
                  }}
                  onBlur={handleCountryBlur}
                  placeholder="Select country"
                  className={cn(
                    "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 tracking-tight shadow-xs transition-[color,border-color,box-shadow] outline-none",
                    "selection:bg-primary selection:text-primary-foreground",
                    "placeholder:text-muted-foreground",
                    "focus-visible:border-focus focus-visible:shadow-focus",
                    countryCode && "font-medium"
                  )}
                />
              </PopoverAnchor>
              <PopoverContent
                className="p-1 max-h-[240px] overflow-y-auto"
                style={{ width: "var(--radix-popover-trigger-width)" }}
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                {filteredCountries.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm leading-5 tracking-tight outline-hidden select-none cursor-pointer hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleCountrySelect(c)
                    }}
                  >
                    {c.name} {c.flag}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-col gap-1.5 w-[120px]">
            <label className="text-sm font-medium leading-5 tracking-[-0.28px] text-foreground">
              Year
            </label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Holiday list */}
        {isFetching && (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">Loading holidays...</p>
          </div>
        )}

        {fetchError && (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-destructive">{fetchError}</p>
          </div>
        )}

        {!isFetching && !fetchError && fetchedHolidays.length > 0 && (
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Table header */}
            <div className="flex items-center bg-secondary px-3 h-10">
              <div className="w-7 shrink-0 flex items-center">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={handleToggleAll}
                />
              </div>
              <div className="flex-1 text-sm leading-5 tracking-[-0.28px]">
                <span className="font-medium text-foreground">Holiday</span>{" "}
                <span className="font-normal text-muted-foreground">({fetchedHolidays.length} total)</span>
              </div>
              <div className="w-[140px] text-sm font-medium leading-5 tracking-[-0.28px] text-foreground text-right">
                Date
              </div>
            </div>

            {/* Table body */}
            <div className="max-h-[360px] overflow-y-auto">
              {fetchedHolidays.map((holiday, index) => (
                <div
                  key={`${holiday.date}-${index}`}
                  className="flex items-center px-3 h-10 border-t border-border"
                >
                  <div className="w-7 shrink-0 flex items-center">
                    <Checkbox
                      checked={selectedIndices.has(index)}
                      onCheckedChange={() => handleToggle(index)}
                    />
                  </div>
                  <div className="flex-1 text-sm font-medium leading-5 tracking-[-0.28px] text-foreground truncate">
                    {holiday.name}
                  </div>
                  <div className="w-[140px] text-sm leading-5 tracking-[-0.28px] text-muted-foreground text-right">
                    {formatDate(holiday.date)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={selectedIndices.size === 0}
            loading={importMutation.isPending}
          >
            Import calendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
