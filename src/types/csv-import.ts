export type SchemaField =
  | "email"
  | "first_name"
  | "last_name"
  | "full_name"
  | "department"
  | "role"
  | "location"
  | "hire_date"

export interface HeaderMapping {
  /** Maps CSV column header (original) → schema field */
  columnToField: Map<string, SchemaField>
  /** CSV headers that could not be mapped */
  unmappedHeaders: string[]
}

export interface CsvEmployeeRow {
  /** Row index in the original CSV (0-based, excluding header) */
  index: number
  email: string
  first_name: string
  last_name: string
  department: string
  department_id: string | null
  role: string
  location: string
  hire_date: string
}

export type ValidationSeverity = "error" | "warning"

export interface RowValidation {
  rowIndex: number
  field: string
  message: string
  severity: ValidationSeverity
}

export interface ImportRowResult {
  index: number
  email: string
  status: "success" | "error"
  error?: string
}

export type ImportStep = "upload" | "preview" | "importing" | "results"
