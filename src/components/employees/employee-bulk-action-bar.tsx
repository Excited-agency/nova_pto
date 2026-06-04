import { X, UserMinus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { EmployeeStatus } from "@/types/employee"

interface EmployeeBulkActionBarProps {
  selectedCount: number
  activeTab: EmployeeStatus
  isMutationPending: boolean
  onClearSelection: () => void
  onDeactivate: () => void
  onDelete: () => void
}

export function EmployeeBulkActionBar({
  selectedCount,
  activeTab,
  isMutationPending,
  onClearSelection,
  onDeactivate,
  onDelete,
}: EmployeeBulkActionBarProps) {
  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-1 p-1",
        "bg-neutral-900 text-white rounded-xl shadow-2xl border border-white/10",
        "transition-all duration-200 ease-out",
        selectedCount > 0
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-3 pointer-events-none"
      )}
    >
      {/* Left: X icon + count — clicking clears selection */}
      <button
        onClick={onClearSelection}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] hover:bg-white/10 transition-colors"
      >
        <X className="size-3.5 text-slate-300 shrink-0" />
        <span className="text-sm font-medium whitespace-nowrap text-slate-300">{selectedCount} selected</span>
      </button>

      <div className="w-px h-4 bg-white/20 shrink-0 mx-1" />

      {/* Deactivate (active tab only) */}
      {activeTab === "active" && (
        <>
          <button
            onClick={onDeactivate}
            disabled={isMutationPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] hover:bg-white/10 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <UserMinus className="size-3.5 text-slate-300 shrink-0" />
            <span className="text-sm font-medium">Deactivate</span>
          </button>
          <div className="w-px h-4 bg-white/20 shrink-0 mx-1" />
        </>
      )}

      {/* Delete */}
      <button
        onClick={onDelete}
        disabled={isMutationPending}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] hover:bg-white/10 transition-colors disabled:opacity-50 whitespace-nowrap text-red-400 hover:text-red-300"
      >
        <Trash2 className="size-3.5 shrink-0" />
        <span className="text-sm font-medium">Delete</span>
      </button>
    </div>
  )
}
