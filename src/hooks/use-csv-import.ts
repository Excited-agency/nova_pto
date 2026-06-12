import { useState, useCallback, useMemo, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { useDepartments } from "@/hooks/use-departments"
import { inviteEmployee, fetchWorkspaceEmails } from "@/lib/employee-service"
import { mapHeaders } from "@/lib/csv-header-mapping"
import { processRows, rowHasErrors } from "@/lib/csv-validation"
import { employeeKeys, departmentKeys, activeEmployeeKeys } from "@/lib/query-keys"
import { INVITE_TIMEOUT_MS } from "@/lib/constants"
import type {
  ImportStep,
  CsvEmployeeRow,
  RowValidation,
  ImportRowResult,
  HeaderMapping,
} from "@/types/csv-import"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const PREVIEW_PAGE_SIZE = 50

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms)
    ),
  ])
}

export function useCsvImport() {
  const { workspace } = useAuth()
  const { data: departments = [] } = useDepartments()
  const queryClient = useQueryClient()
  const cancelledRef = useRef(false)

  // Step state
  const [step, setStep] = useState<ImportStep>("upload")
  const [fileError, setFileError] = useState<string | null>(null)

  // Parsed data
  const [headerMapping, setHeaderMapping] = useState<HeaderMapping | null>(null)
  const [parsedRows, setParsedRows] = useState<CsvEmployeeRow[]>([])
  const [validations, setValidations] = useState<Map<number, RowValidation[]>>(
    new Map()
  )

  // Selection
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())

  // Preview pagination
  const [previewPage, setPreviewPage] = useState(0)

  // Import progress
  const [importProgress, setImportProgress] = useState({ completed: 0, total: 0, currentEmail: "" })
  const [importResults, setImportResults] = useState<ImportRowResult[]>([])

  // Department name → ID map
  const departmentNameToId = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of departments) {
      map.set(d.name.toLowerCase().trim(), d.id)
    }
    return map
  }, [departments])

  // Reset all state
  const reset = useCallback(() => {
    setStep("upload")
    setFileError(null)
    setHeaderMapping(null)
    setParsedRows([])
    setValidations(new Map())
    setSelectedIndices(new Set())
    setPreviewPage(0)
    setImportProgress({ completed: 0, total: 0, currentEmail: "" })
    setImportResults([])
    cancelledRef.current = false
  }, [])

  // Process a file (called from drop or file input)
  const processFile = useCallback(
    (file: File) => {
      setFileError(null)

      // Validate file type
      if (!file.name.toLowerCase().endsWith(".csv")) {
        setFileError("Please upload a .csv file")
        return
      }

      // Validate file size
      if (file.size === 0) {
        setFileError("The file appears to be empty")
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        setFileError("File is too large. Maximum size is 5 MB")
        return
      }

      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const text = e.target?.result as string
          if (!text?.trim()) {
            setFileError("The file appears to be empty")
            return
          }

          const { default: Papa } = await import("papaparse")
          const result = Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: true,
          })

          if (result.errors.length > 0 && result.data.length === 0) {
            setFileError("Could not parse the CSV file. Please check the format.")
            return
          }

          const headers = result.meta.fields ?? []
          if (headers.length === 0) {
            setFileError("No columns found in the CSV file")
            return
          }

          const mapping = mapHeaders(headers)

          // Check if we matched at least email
          if (!Array.from(mapping.columnToField.values()).includes("email")) {
            setFileError(
              'Could not find an "Email" column. Expected headers like: Email, Name, Department, Role, Location, Hire Date'
            )
            return
          }

          if (result.data.length === 0) {
            setFileError("No employee data found in the file")
            return
          }

          // Fetch existing workspace emails to detect duplicates
          let existingEmails: Set<string> | undefined
          if (workspace) {
            existingEmails = await fetchWorkspaceEmails(workspace.id)
          }

          const { rows, validations: rowValidations } = processRows({
            rawRows: result.data,
            mapping,
            departmentNameToId,
            existingEmails,
          })

          if (rows.length === 0) {
            setFileError("No valid rows found in the file")
            return
          }

          setHeaderMapping(mapping)
          setParsedRows(rows)
          setValidations(rowValidations)

          // Select all valid rows by default
          const validIndices = new Set<number>()
          for (const row of rows) {
            if (!rowHasErrors(row.index, rowValidations)) {
              validIndices.add(row.index)
            }
          }
          setSelectedIndices(validIndices)
          setPreviewPage(0)
          setStep("preview")
        } catch (err) {
          setFileError(err instanceof Error ? err.message : "An unexpected error occurred. Please try again.")
        }
      }

      reader.onerror = () => {
        setFileError("Failed to read the file. Please try again.")
      }

      reader.readAsText(file)
    },
    [departmentNameToId]
  )

  // Selection handlers
  const toggleRow = useCallback(
    (index: number) => {
      if (rowHasErrors(index, validations)) return
      setSelectedIndices((prev) => {
        const next = new Set(prev)
        if (next.has(index)) {
          next.delete(index)
        } else {
          next.add(index)
        }
        return next
      })
    },
    [validations]
  )

  const toggleAll = useCallback(() => {
    const pageRows = parsedRows.slice(
      previewPage * PREVIEW_PAGE_SIZE,
      (previewPage + 1) * PREVIEW_PAGE_SIZE
    )
    const selectableRows = pageRows.filter(
      (r) => !rowHasErrors(r.index, validations)
    )
    const allSelected = selectableRows.every((r) =>
      selectedIndices.has(r.index)
    )

    setSelectedIndices((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        selectableRows.forEach((r) => next.delete(r.index))
      } else {
        selectableRows.forEach((r) => next.add(r.index))
      }
      return next
    })
  }, [parsedRows, previewPage, validations, selectedIndices])

  // Start the import
  const startImport = useCallback(async () => {
    const selectedRows = parsedRows.filter((r) => selectedIndices.has(r.index))
    if (selectedRows.length === 0) return

    cancelledRef.current = false
    setStep("importing")
    setImportProgress({ completed: 0, total: selectedRows.length, currentEmail: "" })
    setImportResults([])

    const results: ImportRowResult[] = []

    for (let i = 0; i < selectedRows.length; i++) {
      if (cancelledRef.current) break

      const row = selectedRows[i]
      setImportProgress({
        completed: i,
        total: selectedRows.length,
        currentEmail: row.email,
      })

      try {
        await withTimeout(
          inviteEmployee({
            email: row.email,
            first_name: row.first_name || undefined,
            last_name: row.last_name || undefined,
            role: row.role || "user",
            department_id: row.department_id || null,
            location: row.location || undefined,
            hire_date: row.hire_date || undefined,
          }),
          INVITE_TIMEOUT_MS
        )
        results.push({ index: row.index, email: row.email, status: "success" })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error"
        results.push({
          index: row.index,
          email: row.email,
          status: "error",
          error: message,
        })
      }
    }

    setImportProgress({
      completed: results.length,
      total: selectedRows.length,
      currentEmail: "",
    })
    setImportResults(results)
    setStep("results")

    // Invalidate employee caches
    if (workspace) {
      queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })
      queryClient.invalidateQueries({ queryKey: departmentKeys.all(workspace.id) })
      queryClient.invalidateQueries({ queryKey: activeEmployeeKeys.list(workspace.id) })
    }
  }, [parsedRows, selectedIndices, workspace, queryClient])

  const cancelImport = useCallback(() => {
    cancelledRef.current = true
  }, [])

  // Derived values
  const selectedCount = selectedIndices.size
  const errorCount = parsedRows.filter((r) =>
    rowHasErrors(r.index, validations)
  ).length
  const successCount = importResults.filter(
    (r) => r.status === "success"
  ).length
  const failureCount = importResults.filter(
    (r) => r.status === "error"
  ).length

  // Pagination
  const totalPages = Math.ceil(parsedRows.length / PREVIEW_PAGE_SIZE)
  const paginatedRows = parsedRows.slice(
    previewPage * PREVIEW_PAGE_SIZE,
    (previewPage + 1) * PREVIEW_PAGE_SIZE
  )

  return {
    // State
    step,
    fileError,
    headerMapping,
    parsedRows,
    validations,
    selectedIndices,
    importProgress,
    importResults,

    // Pagination
    previewPage,
    setPreviewPage,
    totalPages,
    paginatedRows,
    pageSize: PREVIEW_PAGE_SIZE,

    // Derived
    selectedCount,
    errorCount,
    successCount,
    failureCount,

    // Actions
    processFile,
    toggleRow,
    toggleAll,
    startImport,
    cancelImport,
    reset,
    goBack: useCallback(() => setStep("upload"), []),
  }
}
