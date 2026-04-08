import type {
  CsvEmployeeRow,
  HeaderMapping,
  RowValidation,
} from "@/types/csv-import"
import { splitFullName } from "@/lib/csv-header-mapping"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Try to parse a date string in multiple common formats.
 * Returns ISO date string (YYYY-MM-DD) or empty string if unparseable.
 */
function parseDate(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""

  // Try ISO format first: YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const d = new Date(trimmed + "T00:00:00")
    if (!isNaN(d.getTime())) return trimmed
  }

  // MM/DD/YYYY or M/D/YYYY
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (usMatch) {
    const [, month, day, year] = usMatch
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    const d = new Date(iso + "T00:00:00")
    if (!isNaN(d.getTime())) return iso
  }

  // DD.MM.YYYY
  const euDotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (euDotMatch) {
    const [, day, month, year] = euDotMatch
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    const d = new Date(iso + "T00:00:00")
    if (!isNaN(d.getTime())) return iso
  }

  // DD/MM/YYYY (only if day > 12, otherwise ambiguous with US format — already handled)
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const [, first, second, year] = slashMatch
    if (Number(first) > 12) {
      const iso = `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`
      const d = new Date(iso + "T00:00:00")
      if (!isNaN(d.getTime())) return iso
    }
  }

  // Last resort: try native Date parsing
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0]
  }

  return ""
}

/**
 * Normalize a role value to "admin" or "user".
 */
function normalizeRole(value: string): string {
  const lower = value.toLowerCase().trim()
  if (lower === "admin" || lower === "administrator") return "admin"
  return "user"
}

interface ProcessRowsOptions {
  rawRows: Record<string, string>[]
  mapping: HeaderMapping
  departmentNameToId: Map<string, string>
  existingEmails?: Set<string>
}

interface ProcessRowsResult {
  rows: CsvEmployeeRow[]
  validations: Map<number, RowValidation[]>
}

/**
 * Processes raw CSV data into typed rows with validation.
 */
export function processRows({
  rawRows,
  mapping,
  departmentNameToId,
  existingEmails,
}: ProcessRowsOptions): ProcessRowsResult {
  const rows: CsvEmployeeRow[] = []
  const validations = new Map<number, RowValidation[]>()
  const seenEmails = new Map<string, number>() // email → first row index

  // Build reverse map: field → CSV column header
  const fieldToColumn = new Map<string, string>()
  for (const [col, field] of mapping.columnToField) {
    fieldToColumn.set(field, col)
  }

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]
    const rowValidations: RowValidation[] = []

    // Extract raw values
    const getValue = (field: string): string => {
      const col = fieldToColumn.get(field)
      return col ? (raw[col] ?? "").trim() : ""
    }

    let firstName = getValue("first_name")
    let lastName = getValue("last_name")
    const fullName = getValue("full_name")
    const email = getValue("email")
    const department = getValue("department")
    const role = getValue("role")
    const location = getValue("location")
    const hireDateRaw = getValue("hire_date")

    // Handle full_name splitting if no separate first/last columns
    if (!firstName && !lastName && fullName) {
      const split = splitFullName(fullName)
      firstName = split.first_name
      lastName = split.last_name
    }

    // Skip completely empty rows
    if (!email && !firstName && !lastName && !fullName && !department && !location && !hireDateRaw) {
      continue
    }

    const rowIndex = rows.length

    // Validate email (hard errors)
    if (!email) {
      rowValidations.push({
        rowIndex,
        field: "email",
        message: "Email is required",
        severity: "error",
      })
    } else if (!EMAIL_REGEX.test(email)) {
      rowValidations.push({
        rowIndex,
        field: "email",
        message: "Invalid email format",
        severity: "error",
      })
    } else {
      const emailLower = email.toLowerCase()
      if (existingEmails?.has(emailLower)) {
        rowValidations.push({
          rowIndex,
          field: "email",
          message: "Already exists in workspace",
          severity: "error",
        })
      }
      const existingRow = seenEmails.get(emailLower)
      if (existingRow !== undefined) {
        rowValidations.push({
          rowIndex,
          field: "email",
          message: `Duplicate of row ${existingRow + 1}`,
          severity: "error",
        })
      } else {
        seenEmails.set(emailLower, rowIndex)
      }
    }

    // Validate name (soft warning)
    if (!firstName && !lastName) {
      rowValidations.push({
        rowIndex,
        field: "name",
        message: "Name is missing",
        severity: "warning",
      })
    }

    // Resolve department
    let departmentId: string | null = null
    if (department) {
      const id = departmentNameToId.get(department.toLowerCase().trim())
      if (id) {
        departmentId = id
      } else {
        rowValidations.push({
          rowIndex,
          field: "department",
          message: `Department "${department}" not found`,
          severity: "warning",
        })
      }
    }

    // Parse date
    let hireDate = ""
    if (hireDateRaw) {
      hireDate = parseDate(hireDateRaw)
      if (!hireDate) {
        rowValidations.push({
          rowIndex,
          field: "hire_date",
          message: "Could not parse date format. Use YYYY-MM-DD for best results",
          severity: "warning",
        })
      } else {
        // Warn about ambiguous dates (e.g. 03/04/2026 could be March 4 or April 3)
        const slashMatch = hireDateRaw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
        if (slashMatch && Number(slashMatch[1]) <= 12 && Number(slashMatch[2]) <= 12 && slashMatch[1] !== slashMatch[2]) {
          rowValidations.push({
            rowIndex,
            field: "hire_date",
            message: `Interpreted as ${hireDate} (MM/DD/YYYY). Use YYYY-MM-DD to avoid ambiguity`,
            severity: "warning",
          })
        }
      }
    }

    // Normalize role
    const normalizedRole = role ? normalizeRole(role) : "user"
    if (role && normalizedRole !== role.toLowerCase().trim()) {
      rowValidations.push({
        rowIndex,
        field: "role",
        message: `Unrecognized role "${role}", defaulting to "user"`,
        severity: "warning",
      })
    }

    rows.push({
      index: rowIndex,
      email,
      first_name: firstName,
      last_name: lastName,
      department,
      department_id: departmentId,
      role: normalizedRole,
      location,
      hire_date: hireDate,
    })

    if (rowValidations.length > 0) {
      validations.set(rowIndex, rowValidations)
    }
  }

  return { rows, validations }
}

/**
 * Checks if a row has any hard errors (severity: "error").
 */
export function rowHasErrors(
  rowIndex: number,
  validations: Map<number, RowValidation[]>
): boolean {
  const issues = validations.get(rowIndex)
  if (!issues) return false
  return issues.some((v) => v.severity === "error")
}

/**
 * Checks if a row has only warnings (no errors).
 */
export function rowHasWarnings(
  rowIndex: number,
  validations: Map<number, RowValidation[]>
): boolean {
  const issues = validations.get(rowIndex)
  if (!issues) return false
  return issues.some((v) => v.severity === "warning") && !rowHasErrors(rowIndex, validations)
}
