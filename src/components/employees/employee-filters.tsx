import { startTransition } from "react"
import { Search } from "lucide-react"
import { TabGroup } from "@/components/ui/tab-group"
import { Input } from "@/components/ui/input"
import type { EmployeeStatus } from "@/types/employee"

interface EmployeeFilterCounts {
  active: number
  inactive: number
  deleted: number
}

interface EmployeeFiltersProps {
  activeTab: EmployeeStatus
  onTabChange: (tab: EmployeeStatus) => void
  searchQuery: string
  onSearchChange: (value: string) => void
  counts: EmployeeFilterCounts
}

export function EmployeeFilters({
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  counts,
}: EmployeeFiltersProps) {
  const tabItems = [
    { value: "active", label: "Active", badge: counts.active > 0 ? counts.active : undefined },
    { value: "inactive", label: "Inactive", badge: counts.inactive > 0 ? counts.inactive : undefined },
    { value: "deleted", label: "Deleted", badge: counts.deleted > 0 ? counts.deleted : undefined },
  ]

  return (
    <div className="flex items-center justify-between">
      <TabGroup
        value={activeTab}
        onValueChange={(v) => startTransition(() => onTabChange(v as EmployeeStatus))}
        items={tabItems}
      />
      <div className="relative w-[280px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search for employees..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  )
}
