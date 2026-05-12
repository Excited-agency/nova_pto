import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type DataTablePaginationType = "simple" | "detailed"

export interface DataTablePaginationProps extends React.ComponentProps<"div"> {
  type?: DataTablePaginationType

  selectedCount?: number
  totalRows?: number

  canPrevious?: boolean
  canNext?: boolean
  onPrevious?: () => void
  onNext?: () => void

  rowsPerPage?: string
  onRowsPerPageChange?: (value: string) => void
  rowsPerPageOptions?: string[]

  currentPage?: number
  totalPages?: number

  onFirstPage?: () => void
  onLastPage?: () => void
}

export function DataTablePagination({
  type = "simple",
  selectedCount = 0,
  totalRows = 0,
  canPrevious = false,
  canNext = false,
  onPrevious,
  onNext,
  rowsPerPage,
  onRowsPerPageChange,
  rowsPerPageOptions,
  currentPage = 1,
  totalPages = 1,
  onFirstPage,
  onLastPage,
  className,
  ...props
}: DataTablePaginationProps) {
  function renderSimple() {
    return (
      <>
        <Button variant="outline" size="default" disabled={!canPrevious} onClick={onPrevious}>
          Previous
        </Button>
        <Button variant="outline" size="default" disabled={!canNext} onClick={onNext}>
          Next
        </Button>
      </>
    )
  }

  return (
    <div
      data-slot="data-table-pagination"
      data-type={type}
      className={cn("flex h-[52px] w-full items-center justify-between pt-4", className)}
      {...props}
    >
      {type === "detailed" ? (
        <>
          <div className="flex items-center gap-2">
            <p className="shrink-0 text-sm font-medium leading-5 tracking-tight text-foreground whitespace-nowrap">
              Rows per page
            </p>
            <Select value={rowsPerPage} onValueChange={onRowsPerPageChange}>
              <SelectTrigger className="w-[64px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(rowsPerPageOptions ?? ["5", "10", "20", "50"]).map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4">
            <p className="shrink-0 text-sm font-normal leading-5 tracking-tight text-foreground whitespace-nowrap">
              Page {currentPage} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" disabled={!canPrevious} onClick={onFirstPage}>
                <ChevronsLeftIcon className="size-4" />
              </Button>
              <Button variant="outline" size="icon" disabled={!canPrevious} onClick={onPrevious}>
                <ChevronLeftIcon className="size-4" />
              </Button>
              <Button variant="outline" size="icon" disabled={!canNext} onClick={onNext}>
                <ChevronRightIcon className="size-4" />
              </Button>
              <Button variant="outline" size="icon" disabled={!canNext} onClick={onLastPage}>
                <ChevronsRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 ml-auto">
          {renderSimple()}
        </div>
      )}
    </div>
  )
}
